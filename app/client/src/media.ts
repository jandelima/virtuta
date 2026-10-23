import type { LocalParticipant, RemoteParticipant, RemoteTrackPublication, Room, Track } from 'livekit-client';
import { api } from './api';

// Voz, câmera e tela pelo LiveKit. Todos entram numa única sala de mídia, mas cada pessoa só
// assina (recebe) as faixas de quem está na mesma conversa — quem decide isso é o servidor.
// O SDK só é carregado quando a pessoa precisa de mídia, para a página abrir leve.

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

  /** Conecta à sala de mídia (uma vez). */
  ensure() {
    if (this.room) return Promise.resolve();
    this.connecting ??= this.connect().finally(() => (this.connecting = null));
    return this.connecting;
  }

  private async connect() {
    this.setState('connecting');
    try {
      const lk = await this.load();
      const { url, token } = await api.mediaToken();
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
        .on(E.Disconnected, () => { this.room = null; this.mic = this.cam = this.screen = false; this.setState('off'); })
        .on(E.DataReceived, (payload, p, _kind, topic) => {
          if (topic !== 'marcas' || !p) return;
          try { this.onData(p.identity, JSON.parse(new TextDecoder().decode(payload))); } catch { /* pacote inválido */ }
        });
      await room.connect(url, token, { autoSubscribe: false });
      this.room = room;
      this.needsAudioUnlock = !room.canPlaybackAudio;
      room.remoteParticipants.forEach((p) => p.trackPublications.forEach((pub) => this.syncSub(pub, p)));
      this.setState('on');
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

  /** Quem está na conversa atual: só essas faixas são recebidas. */
  setMembers(ids: string[]) {
    this.allowed = new Set(ids);
    if (ids.length) void this.ensure().catch(() => {});
    this.room?.remoteParticipants.forEach((p) => p.trackPublications.forEach((pub) => this.syncSub(pub, p)));
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
    this.needsAudioUnlock = false;
    this.onChange();
  }

  private get local(): LocalParticipant | undefined { return this.room?.localParticipant; }

  async setMic(on: boolean) {
    await this.ensure();
    await this.local!.setMicrophoneEnabled(on, { deviceId: this.prefs.audioinput });
    this.mic = on;
    this.onChange();
  }

  async setCam(on: boolean) {
    await this.ensure();
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
    void this.room?.disconnect();
    this.room = null;
  }
}
