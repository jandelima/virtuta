import type { OfficeApp } from '../app';
import { SALA, inside } from '../../../shared/layout';
import { icon } from './icons';
import { esc } from './dom';

// Rádio compartilhada com o player incorporado do YouTube. O servidor guarda a fila e o
// instante em que cada item começou; cada ouvinte calcula onde a música está e se alinha.
// A rádio fica na sala da equipe: quem ligou "Ouvir" escuta enquanto estiver lá dentro;
// ao sair a música para e, ao voltar, retoma no ponto em que a rádio está.

interface YTPlayer {
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(s: number, allowSeekAhead: boolean): void;
  setVolume(v: number): void;
  playVideo(): void;
  stopVideo(): void;
  destroy(): void;
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, o: unknown) => YTPlayer; PlayerState: { ENDED: number; PLAYING: number } };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiReady: Promise<void> | null = null;
function loadApi() {
  apiReady ??= new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => resolve();
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return apiReady;
}

const VOL_KEY = 'virtuta.radioVolume';
const VIDEO_KEY = 'virtuta.radioVideo';
// tolerância de alinhamento entre ouvintes, em segundos
const DRIFT = 3;

export class RadioPlayer {
  private card = document.getElementById('radio')!;
  private player: YTPlayer | null = null;
  private ready = false;
  private playing = 0;
  /** Item e início do que está carregado: com uma música só na programação, o id se repete a cada volta. */
  private loaded = '';
  private volume = 50;
  private driftTimer = 0;
  /** A pessoa ligou "Ouvir" (vale enquanto ela estiver na sala). */
  private want = false;

  /** O vídeo fica recolhido (só o som) a menos que a pessoa peça para ver: ele empurrava a lista de pessoas. */
  private video = false;

  constructor(private app: OfficeApp) {
    try {
      this.volume = Number(localStorage.getItem(VOL_KEY) ?? 50);
      this.video = localStorage.getItem(VIDEO_KEY) === '1';
    } catch { /* preferências padrão */ }
  }

  /** Tocando de fato para esta pessoa (o servidor confirma). */
  get listening() { return this.app.radio.listeners.includes(this.app.me); }
  get wanted() { return this.want; }

  private inRoom() {
    const p = this.app.myPresence;
    return !!p && !this.app.guest && inside(SALA, p.x, p.z);
  }

  /** Ligar a rádio exige um clique, como pedem os navegadores para tocar som. */
  join() {
    if (this.app.guest) return;
    this.want = true;
    void loadApi();
    if (!this.inRoom()) this.app.notify.toast('A rádio toca dentro da sala da equipe. Ela começa quando você entrar.');
    this.update();
    this.render();
    this.app.panels.refresh('radio');
  }

  leave() {
    this.want = false;
    this.update();
    this.render();
    this.app.panels.refresh('radio');
  }

  /** Entra ou sai da escuta conforme a pessoa está ou não na sala; chamado a cada segundo. */
  update() {
    const should = this.want && this.inRoom();
    if (should && !this.listening) this.app.send({ t: 'radioJoin' });
    else if (!should && this.listening) this.app.send({ t: 'radioLeave' });
    if (!should && this.player) this.stop();
    const away = this.want && !should;
    const inRoom = this.inRoom();
    if (away !== this.away || inRoom !== this.wasInRoom) { this.away = away; this.wasInRoom = inRoom; this.render(); }
  }
  private away = false;
  private wasInRoom = false;

  stop() {
    this.player?.destroy();
    this.player = null;
    this.ready = false;
    this.parts().yt.replaceChildren();
    this.playing = 0;
    this.loaded = '';
    clearInterval(this.driftTimer);
  }

  /** Posição esperada do item atual, pelo relógio do servidor. */
  private target() { return Math.max(0, (this.app.now() - this.app.radio.startedAt) / 1000); }

  async sync() {
    this.render();
    this.app.panels.refresh('radio');
    const cur = this.app.radio.current;
    if (!this.listening || !cur) { if (this.player) this.stop(); return; }
    const key = `${cur.id}@${this.app.radio.startedAt}`;
    if (this.loaded === key && this.player) return;
    await loadApi();
    this.playing = cur.id;
    this.loaded = key;
    const start = this.target();
    if (!this.player) {
      const host = this.parts().yt;
      const el = document.createElement('div');
      host.replaceChildren(el);
      this.player = new window.YT!.Player(el, {
        width: '100%',
        height: '100%',
        videoId: cur.videoId,
        // sem cookies: o player não usa a conta do YouTube do navegador, então não aparece o
        // aviso de "conta em uso em outro dispositivo" nem a pausa que vem com ele
        host: 'https://www.youtube-nocookie.com',
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1, rel: 0, start: Math.floor(start) },
        events: {
          onReady: () => {
            this.ready = true;
            this.player?.setVolume(this.volume);
            // a programação pode ter mudado enquanto o player carregava
            const now = this.app.radio.current;
            if (now && now.videoId !== cur.videoId) this.player?.loadVideoById({ videoId: now.videoId, startSeconds: this.target() });
            else this.player?.playVideo();
          },
          onStateChange: (e: { data: number }) => {
            if (e.data === window.YT!.PlayerState.ENDED) this.app.send({ t: 'radioEnded', itemId: this.playing });
          },
          // vídeo indisponível ou bloqueado para incorporação: avisa e segue para o próximo
          onError: () => this.app.send({ t: 'radioError', itemId: this.playing }),
        },
      });
    } else if (this.ready) {
      this.player.loadVideoById({ videoId: cur.videoId, startSeconds: start });
      this.player.setVolume(this.volume);
    }
    clearInterval(this.driftTimer);
    this.driftTimer = window.setInterval(() => this.realign(), 5_000);
  }

  private realign() {
    const p = this.player;
    if (!p || !this.ready) return;
    const dur = p.getDuration();
    // transmissões ao vivo não têm duração: o próprio YouTube mantém todos no ao vivo
    if (!dur || !isFinite(dur)) return;
    const want = this.target();
    // pela programação esta música já acabou (o YouTube recomeça do zero quem pede além do fim):
    // segue para a próxima, para todos voltarem a ouvir a mesma coisa
    if (want > dur + DRIFT) this.app.send({ t: 'radioEnded', itemId: this.playing });
    else if (want < dur && Math.abs(p.getCurrentTime() - want) > DRIFT) p.seekTo(want, true);
  }

  /** O player fica num elemento fixo: redesenhar o cartão não pode recriar o iframe. */
  private parts() {
    if (!this.card.querySelector('.yt')) {
      this.card.innerHTML = '<div class="info"></div><div class="yt" hidden></div><div class="ctl"></div>';
    }
    return { info: this.card.querySelector<HTMLElement>('.info')!, yt: this.card.querySelector<HTMLElement>('.yt')!, ctl: this.card.querySelector<HTMLElement>('.ctl')! };
  }

  render() {
    const app = this.app;
    const r = app.radio;
    const on = this.want;
    const n = r.listeners.length;
    const { info, yt, ctl } = this.parts();
    const playing = this.listening && !!r.current;
    info.innerHTML = `<div class="h">${icon('radio')}<b>Rádio</b><small>${n ? `${n} ouvindo` : ''}</small>${playing ? `<button class="mini" id="rbVideo" aria-pressed="${this.video}" title="${this.video ? 'Ocultar o vídeo (só o som)' : 'Mostrar o vídeo'}">${icon('screen')}</button>` : ''}${app.guest ? '' : '<button class="mini txt" id="rbQueue">Programação</button>'}</div>
      <div class="trk"><span class="cover">${r.current ? `<img src="https://i.ytimg.com/vi/${esc(r.current.videoId)}/default.jpg" alt=""/>` : ''}</span><div><b>${r.current ? esc(r.current.title) : 'Nada tocando'}</b><small>${this.away ? 'Toca quando você está na sala da equipe' : r.current ? `Adicionado por ${esc(r.current.addedBy)}` : 'Adicione um link do YouTube'}</small></div></div>`;
    yt.hidden = !playing;
    // recolhido, o player continua tocando: só deixa de ocupar espaço
    yt.classList.toggle('collapsed', !this.video);
    ctl.innerHTML = on
      ? `<button id="rbSkip" aria-label="Pular a música" title="Pular a música">${icon('skip')}</button>${icon('vol')}<input class="vol" id="rbVol" type="range" min="0" max="100" value="${this.volume}" aria-label="Volume"/><button class="leave" id="rbLeave">Desligar</button>`
      : app.guest ? '' : `<button class="join" id="rbJoin">${icon('play')}${this.inRoom() ? 'Ouvir' : 'Ouvir ao voltar à sala'}</button>`;
    ctl.hidden = !ctl.innerHTML;
    ctl.querySelector('#rbJoin')?.addEventListener('click', () => this.join());
    info.querySelector('#rbQueue')?.addEventListener('click', () => app.panels.open('radio'));
    info.querySelector('#rbVideo')?.addEventListener('click', () => {
      this.video = !this.video;
      try { localStorage.setItem(VIDEO_KEY, this.video ? '1' : '0'); } catch { /* vale só nesta sessão */ }
      this.render();
    });
    ctl.querySelector('#rbLeave')?.addEventListener('click', () => this.leave());
    ctl.querySelector('#rbSkip')?.addEventListener('click', () => r.current && app.send({ t: 'radioSkip', itemId: r.current.id }));
    ctl.querySelector<HTMLInputElement>('#rbVol')?.addEventListener('input', (e) => {
      this.volume = Number((e.target as HTMLInputElement).value);
      this.player?.setVolume(this.volume);
      try { localStorage.setItem(VOL_KEY, String(this.volume)); } catch { /* vale só nesta sessão */ }
    });
  }
}
