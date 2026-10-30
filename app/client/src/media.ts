import type { LocalParticipant, RemoteParticipant, RemoteTrackPublication, Room, Track } from 'livekit-client';
import { api } from './api';

// Voz, câmera e tela pelo LiveKit. Cada conversa é uma sala de mídia própria, e o servidor só
// entrega o acesso à sala da conversa em que a pessoa está: trocar de conversa é trocar de sala.
// Microfone e câmera só funcionam dentro de uma conversa. Um anúncio para a sala usa uma sala
// à parte, ouvida ao mesmo tempo que a conversa. O SDK só é carregado quando precisa.

type LK = typeof import('livekit-client');

export interface Feed {
  id: string;
  camera: Track | null;
  screen: Track | null;
  micOn: boolean;
  speaking: boolean;
}

export type MediaState = 'off' | 'connecting' | 'on' | 'reconnecting' | 'failed';

const DEV_KEY = 'virtuta.devices';
export interface DevicePrefs { audioinput?: string; videoinput?: string; audiooutput?: string }
export function loadDevicePrefs(): DevicePrefs {
  try { return JSON.parse(localStorage.getItem(DEV_KEY) ?? '{}') as DevicePrefs; } catch { return {}; }
}
function saveDevicePrefs(p: DevicePrefs) {
  try { localStorage.setItem(DEV_KEY, JSON.stringify(p)); } catch { /* preferências valem só nesta sessão */ }
}

export class Media {
  private lk: LK | null = null;
  private room: Room | null = null;
  private connecting: Promise<void> | null = null;
  /** Conversa atual (sala que deveria estar aberta) e a sala aberta de fato. */
  private convId: string | null = null;
  private roomConv: string | null = null;
  /** Microfone e câmera pedidos: continuam ao trocar de uma conversa direto para outra. */
  private wantMic = false;
  private wantCam = false;
  private gen = 0;
  private ann: Room | null = null;
  /** Anúncio em andamento que esta pessoa ouve ou faz. */
  announcing: 'speaker' | 'listener' | null = null;
  private allowed = new Set<string>();
  private audioBox = document.createElement('div');
  private speaking = new Set<string>();
  state: MediaState = 'off';
  mic = false;
  cam = false;
  screen = false;
  needsAudioUnlock = false;
  prefs = loadDevicePrefs();
  onChange: () => void = () => {};
  onData: (from: string, data: unknown) => void = () => {};

  constructor() {
    this.audioBox.hidden = true;
    document.body.appendChild(this.audioBox);
  }

  private async load() {
    this.lk ??= await import('livekit-client');
    return this.lk;
  }

  /** Conecta à sala da conversa atual (se ainda não estiver nela). */
  ensure() {
    if (!this.convId) return Promise.reject(Object.assign(new Error('Fora de conversa'), { name: 'NoConversation' }));
    if (this.room && this.roomConv === this.convId) return Promise.resolve();
    this.connecting ??= this.connect().finally(() => (this.connecting = null));
    return this.connecting;
  }

  private async connect() {
    const gen = ++this.gen;
    const conv = this.convId;
    this.setState('connecting');
    try {
      const lk = await this.load();
      // sai da sala da conversa anterior antes de entrar na nova
      if (this.room) await this.leaveRoom();
      const { url, token } = await api.mediaToken('conv');
      if (gen !== this.gen || conv !== this.convId) return;
      const room = new lk.Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, deviceId: this.prefs.audioinput },
        videoCaptureDefaults: { resolution: lk.VideoPresets.h360.resolution, deviceId: this.prefs.videoinput },
        audioOutput: this.prefs.audiooutput ? { deviceId: this.prefs.audiooutput } : undefined,
        publishDefaults: { dtx: true, red: true, videoSimulcastLayers: [lk.VideoPresets.h180] },
      });
      const E = lk.RoomEvent;
      room
        .on(E.TrackPublished, (pub, p) => this.syncSub(pub, p))
        .on(E.TrackSubscribed, (track, _pub, p) => this.attach(track, p))
        .on(E.TrackUnsubscribed, (track) => { track.detach().forEach((el) => el.remove()); this.onChange(); })
        .on(E.TrackMuted, () => this.onChange())
        .on(E.TrackUnmuted, () => this.onChange())
        .on(E.LocalTrackPublished, () => this.onChange())
        .on(E.LocalTrackUnpublished, (pub) => {
          if (pub.source === lk.Track.Source.ScreenShare) this.screen = false;
          this.onChange();
        })
        .on(E.ParticipantConnected, (p) => p.trackPublications.forEach((pub) => this.syncSub(pub as RemoteTrackPublication, p)))
        .on(E.ParticipantDisconnected, () => this.onChange())
        .on(E.ActiveSpeakersChanged, (ps) => { this.speaking = new Set(ps.map((p) => p.identity)); this.onChange(); })
        .on(E.AudioPlaybackStatusChanged, () => { this.needsAudioUnlock = !room.canPlaybackAudio; this.onChange(); })
        .on(E.Reconnecting, () => this.setState('reconnecting'))
        .on(E.Reconnected, () => this.setState('on'))
        .on(E.Disconnected, () => {
          // saída pedida (troca de conversa) já foi tratada; aqui é o servidor tirando da sala
          if (this.room !== room) return;
          this.room = null;
          this.roomConv = null;
          this.mic = this.cam = this.screen = false;
          this.setState('off');
        })
        .on(E.DataReceived, (payload, p, _kind, topic) => {
          if (topic !== 'marcas' || !p) return;
          try { this.onData(p.identity, JSON.parse(new TextDecoder().decode(payload))); } catch { /* pacote inválido */ }
        });
      await room.connect(url, token, { autoSubscribe: false });
      if (gen !== this.gen) { void room.disconnect(); return; }
      this.room = room;
      this.roomConv = conv;
      this.needsAudioUnlock = !room.canPlaybackAudio;
      room.remoteParticipants.forEach((p) => p.trackPublications.forEach((pub) => this.syncSub(pub, p)));
      this.setState('on');
      // quem já estava com microfone ou câmera ligados numa conversa continua assim na seguinte
      if (this.wantMic) await room.localParticipant.setMicrophoneEnabled(true, { deviceId: this.prefs.audioinput }).then(() => (this.mic = true)).catch(() => {});
      if (this.wantCam) await room.localParticipant.setCameraEnabled(true, { deviceId: this.prefs.videoinput, resolution: lk.VideoPresets.h360.resolution }).then(() => (this.cam = true)).catch(() => {});
      this.onChange();
    } catch (e) {
      console.error('Falha na mídia', e);
      this.setState('failed');
      throw e;
    }
  }

  private setState(s: MediaState) {
    this.state = s;
    this.onChange();
  }

  private async leaveRoom() {
    const r = this.room;
    this.room = null;
    this.roomConv = null;
    this.mic = this.cam = this.screen = false;
    await r?.disconnect();
  }

  /** Conversa atual: abre a sala dela (trocando de sala se mudou); sem conversa, fecha a sala. */
  setConv(conv: { id: string; members: string[] } | null) {
    this.allowed = new Set(conv?.members ?? []);
    const next = conv?.id ?? null;
    if (next !== this.convId) {
      this.convId = next;
      if (!next) {
        // fora de conversa, microfone e câmera desligam (entrar na próxima nunca os liga sozinha)
        this.gen++;
        this.wantMic = this.wantCam = false;
        void this.leaveRoom().then(() => this.setState('off'));
      } else void this.ensure().catch(() => {});
    }
    this.room?.remoteParticipants.forEach((p) => p.trackPublications.forEach((pub) => this.syncSub(pub, p)));
    this.onChange();
  }

  // ---------- anúncio para a sala ----------
  /** Entra na sala do anúncio: quem anuncia publica o microfone, os outros só ouvem. */
  async joinAnnounce(speaker: boolean) {
    if (this.ann) return;
    const lk = await this.load();
    const { url, token } = await api.mediaToken('announce');
    const room = new lk.Room({ audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, deviceId: this.prefs.audioinput } });
    room.on(lk.RoomEvent.TrackSubscribed, (track) => { if (track.kind === 'audio') this.audioBox.appendChild(track.attach()); })
      .on(lk.RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()))
      .on(lk.RoomEvent.Disconnected, () => { if (this.ann === room) { this.ann = null; this.announcing = null; this.onChange(); } });
    this.ann = room;
    this.announcing = speaker ? 'speaker' : 'listener';
    try {
      await room.connect(url, token, { autoSubscribe: !speaker });
      if (speaker) await room.localParticipant.setMicrophoneEnabled(true, { deviceId: this.prefs.audioinput });
      if (!room.canPlaybackAudio) { this.needsAudioUnlock = true; }
    } catch (e) {
      this.ann = null;
      this.announcing = null;
      void room.disconnect();
      throw e;
    } finally { this.onChange(); }
  }

  leaveAnnounce() {
    const r = this.ann;
    this.ann = null;
    this.announcing = null;
    void r?.disconnect();
    this.onChange();
  }

  private syncSub(pub: RemoteTrackPublication, p: RemoteParticipant) {
    const want = this.allowed.has(p.identity);
    if (pub.isSubscribed !== want) pub.setSubscribed(want);
  }

  private attach(track: Track, p: RemoteParticipant) {
    if (track.kind === 'audio') {
      const el = track.attach();
      el.dataset.who = p.identity;
      this.audioBox.appendChild(el);
    }
    this.onChange();
  }

  /** Destrava o áudio depois de um clique (exigência dos navegadores). */
  async unlockAudio() {
    await this.room?.startAudio();
    await this.ann?.startAudio();
    this.needsAudioUnlock = false;
    this.onChange();
  }

  private get local(): LocalParticipant | undefined { return this.room?.localParticipant; }

  async setMic(on: boolean) {
    await this.ensure();
    await this.local!.setMicrophoneEnabled(on, { deviceId: this.prefs.audioinput });
    this.mic = this.wantMic = on;
    this.onChange();
  }

  async setCam(on: boolean) {
    await this.ensure();
    this.wantCam = on;
    const lk = this.lk!;
    await this.local!.setCameraEnabled(on, { deviceId: this.prefs.videoinput, resolution: lk.VideoPresets.h360.resolution });
    this.cam = on;
    this.onChange();
  }

  async setScreen(on: boolean) {
    await this.ensure();
    // tela em alta resolução e poucos quadros: texto e código continuam legíveis
    await this.local!.setScreenShareEnabled(on, { audio: false, contentHint: 'detail', resolution: { width: 1920, height: 1080, frameRate: 15 } }, { screenShareEncoding: { maxBitrate: 2_500_000, maxFramerate: 15 } });
    this.screen = on;
    this.onChange();
  }

  /** Faixas de vídeo e estado de cada pessoa da conversa, inclusive a própria. */
  feeds(ids: string[], me: string): Feed[] {
    const lk = this.lk;
    const room = this.room;
    return ids.map((id) => {
      const p = !room || !lk ? undefined : id === me ? room.localParticipant : room.remoteParticipants.get(id);
      const pub = (src: Track.Source) => p?.getTrackPublication(src);
      const cam = lk ? pub(lk.Track.Source.Camera) : undefined;
      const scr = lk ? pub(lk.Track.Source.ScreenShare) : undefined;
      const mic = lk ? pub(lk.Track.Source.Microphone) : undefined;
      return {
        id,
        camera: cam?.track && !cam.isMuted ? cam.track : null,
        screen: scr?.track && !scr.isMuted ? scr.track : null,
        micOn: id === me ? this.mic : !!mic && !mic.isMuted,
        speaking: this.speaking.has(id),
      };
    });
  }

  /** Marcas e apontador sobre telas compartilhadas, enviados só para a conversa. */
  sendData(data: unknown, to: string[], reliable: boolean) {
    if (!this.local || !to.length) return;
    void this.local.publishData(new TextEncoder().encode(JSON.stringify(data)), { reliable, destinationIdentities: to, topic: 'marcas' });
  }

  async devices() {
    const lk = await this.load();
    const [audioinput, videoinput, audiooutput] = await Promise.all([
      lk.Room.getLocalDevices('audioinput'), lk.Room.getLocalDevices('videoinput'), lk.Room.getLocalDevices('audiooutput').catch(() => []),
    ]);
    return { audioinput, videoinput, audiooutput };
  }

  async setDevice(kind: keyof DevicePrefs, deviceId: string) {
    this.prefs[kind] = deviceId;
    saveDevicePrefs(this.prefs);
    await this.room?.switchActiveDevice(kind, deviceId);
  }

  disconnect() {
    this.gen++;
    this.convId = null;
    void this.leaveRoom();
    this.leaveAnnounce();
  }
}
