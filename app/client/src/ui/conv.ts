import type { Track } from 'livekit-client';
import type { OfficeApp } from '../app';
import type { Conv } from '../../../shared/protocol';
import type { Feed } from '../media';
import { icon } from './icons';
import { esc } from './dom';

// Painel da conversa atual e visão de apresentação, com apontador e marcas temporárias
// sobre as telas compartilhadas (enviadas só para quem está na conversa).

interface Mark { pts: number[]; color: string; at: number }
interface Pointer { x: number; y: number; at: number; who: string }

const MARK_LIFE = 4000;
const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6'];

export class ConvView {
  private panel = document.getElementById('conv')!;
  private stage = document.getElementById('present')!;
  private videoEls = new Map<string, HTMLVideoElement>();
  private stageOpen = false;
  private seenShares = new Set<string>();
  private tool: 'ptr' | 'pen' = 'ptr';
  private color = COLORS[0];
  private marks = new Map<string, Mark[]>();
  private pointers = new Map<string, Map<string, Pointer>>();
  private drawing: { share: string; mark: Mark } | null = null;
  private raf = 0;

  constructor(private app: OfficeApp) {
    app.media.onData = (from, d) => this.receive(from, d as Record<string, unknown>);
  }

  private feeds(): Feed[] {
    const c = this.app.conv;
    return c ? this.app.media.feeds(c.members, this.app.me) : [];
  }

  private video(track: Track, key: string) {
    let el = this.videoEls.get(key);
    if (!el || (el as unknown as { _t?: Track })._t !== track) {
      el = track.attach() as HTMLVideoElement;
      el.muted = true;
      el.playsInline = true;
      (el as unknown as { _t?: Track })._t = track;
      this.videoEls.set(key, el);
    }
    return el;
  }

  /** Chave do que aparece na conversa, sem quem está falando: se não mudou, só o destaque de fala muda. */
  private shape() {
    const app = this.app;
    const c = app.conv;
    if (!c) return '';
    const m = app.media;
    const sid = (t: Track | null) => (t ? t.sid ?? 'x' : '');
    return JSON.stringify([c.id, c.kind, c.locked, this.stageOpen, this.collapsed, this.micDismissed === c.id, app.doorOpen, app.notify.pending.filter((h) => h.key?.startsWith('door-')).length, m.mic, m.cam, m.screen, m.state, this.feeds().map((f) => [f.id, f.micOn, sid(f.camera), sid(f.screen), !!app.presence.get(f.id)?.hand])]);
  }
  private lastShape = '';
  /** Cartão recolhido numa pílula (a pessoa escolhe; vale até a próxima conversa). */
  private collapsed = false;
  /** Conversa em que a pessoa dispensou o aviso de microfone desligado. */
  private micDismissed = '';

  /** Chamado a cada mudança de mídia (várias por segundo quando muda quem fala). */
  update() {
    if (this.shape() !== this.lastShape) return this.render();
    const speaking = new Set(this.feeds().filter((f) => f.speaking).map((f) => f.id));
    for (const root of [this.panel, this.stage]) {
      root.querySelectorAll<HTMLElement>('.tile[data-id]:not(.slide)').forEach((t) => t.classList.toggle('speaking', speaking.has(t.dataset.id!)));
    }
  }

  /** Microfone, câmera e tela: na faixa lateral (quadro ou apresentação abertos) o dock some. */
  private controls() {
    const m = this.app.media;
    const b = (id: string, ic: string, label: string, cls: string) => `<button class="cc ${cls}" data-cc="${id}" aria-label="${label}" title="${label}">${icon(ic)}</button>`;
    // o mesmo vermelho de alerta do dock: sem microfone dentro de uma conversa
    return b('mic', m.mic ? 'mic' : 'micOff', m.mic ? 'Desligar microfone (M)' : 'Ligar microfone (M)', m.mic ? 'on' : 'alert') +
      b('cam', m.cam ? 'cam' : 'camOff', m.cam ? 'Desligar câmera (V)' : 'Ligar câmera (V)', m.cam ? 'on' : '') +
      b('screen', 'screen', m.screen ? 'Parar de compartilhar' : 'Compartilhar tela', m.screen ? 'share' : '');
  }
  private bindControls(root: HTMLElement) {
    root.querySelectorAll<HTMLElement>('[data-cc]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.cc;
      if (k === 'mic') void this.app.toggleMic();
      if (k === 'cam') void this.app.toggleCam();
      if (k === 'screen') void this.app.toggleScreen();
    }));
  }

  render(before?: Conv | null) {
    const app = this.app;
    const c = app.conv;
    this.lastShape = this.shape();
    if (!c) {
      this.panel.hidden = true;
      this.closeStage();
      this.videoEls.clear();
      return;
    }
    // conversa nova (só quando quem chama informa a anterior; os redesenhos não contam)
    if (before !== undefined && before?.id !== c.id) { this.seenShares.clear(); this.collapsed = false; }
    const feeds = this.feeds();
    const shares = feeds.filter((f) => f.screen);
    // abre a apresentação quando alguém da conversa começa a compartilhar
    for (const s of shares) {
      if (!this.seenShares.has(s.id)) {
        this.seenShares.add(s.id);
        if (s.id !== app.me) this.openStage();
      }
    }
    for (const id of [...this.seenShares]) if (!shares.some((s) => s.id === id)) this.seenShares.delete(id);

    const title = c.kind === 'room' ? 'Sala de reunião' : c.kind === 'direct' ? 'Conversa a pedido' : 'Conversa por proximidade';
    const presenting = shares.map((s) => (s.id === app.me ? 'você' : app.name(s.id))).join(' e ');
    this.panel.hidden = this.stageOpen;
    this.panel.classList.toggle('collapsed', this.collapsed);
    const others = c.members.length - 1;
    if (this.collapsed) {
      // recolhido: uma pílula com quem fala e o microfone, que abre de novo ao clicar
      const speaking = feeds.some((f) => f.speaking && f.id !== app.me);
      this.panel.innerHTML = `<button class="conv-pill" id="convOpen" aria-label="Mostrar a conversa"><span class="pulse${speaking ? ' talk' : ''}"></span><b>${title}</b><small>${c.members.length} ${c.members.length === 1 ? 'pessoa' : 'pessoas'}</small>${icon('chev')}</button><span class="pill-ctl">${this.controls()}</span>`;
      this.panel.querySelector('#convOpen')!.addEventListener('click', () => { this.collapsed = false; this.render(); });
      this.bindControls(this.panel);
      return;
    }
    // sem microfone numa conversa, os dois lados acham que estão falando: o cartão avisa
    const micNote = !app.media.mic && others > 0 && this.micDismissed !== c.id && app.media.state !== 'failed'
      ? `<div class="mic-note">${icon('micOff')}<span>Seu microfone está desligado</span><button id="micOn">Ligar (M)</button><button class="x" id="micX" aria-label="Dispensar">${icon('x')}</button></div>` : '';
    // na sala de reunião, a porta se controla daqui, e os pedidos de entrada aparecem aqui mesmo
    const doorAsks = c.kind === 'room' ? app.notify.pending.filter((h) => h.key?.startsWith('door-')) : [];
    const door = c.kind === 'room'
      ? `<div class="conv-door"><button id="doorToggle" class="${app.doorOpen ? '' : 'shut'}">${icon(app.doorOpen ? 'unlock' : 'lock')}${app.doorOpen ? 'Porta aberta · Fechar' : 'Porta fechada · Abrir'}</button>${doorAsks.map((h) => `<span class="ask">${app.shell.avatarImg(h.key!.slice(5), 22)}${esc(app.shortName(h.key!.slice(5)))} quer entrar<button data-letin="${h.key!.slice(5)}">Deixar entrar</button></span>`).join('')}</div>` : '';
    const lock = c.kind !== 'room' ? `<button id="convLock" class="${c.locked ? 'on' : ''}" title="${c.locked ? 'Quem chega perto não entra sozinho. Clique para abrir a conversa' : 'Reservar: quem chegar perto precisa pedir para entrar'}">${icon(c.locked ? 'lock' : 'unlock')}${c.locked ? 'Reservada' : 'Reservar'}</button>` : '';
    this.panel.innerHTML = `<div class="conv-h"><span class="pulse"></span><b>${title}</b><small>${c.members.length} ${c.members.length === 1 ? 'pessoa' : 'pessoas'}${presenting ? ` · ${esc(presenting)} apresentando` : ''}</small>${shares.length ? `<button id="openStage">${icon('maximize')}Apresentação</button>` : ''}${lock}<button id="leaveConv">${c.kind === 'room' ? 'Sair da sala' : 'Sair da conversa'}</button><button class="iconbtn sm2" id="convMin" aria-label="Recolher a conversa" title="Recolher">${icon('minus')}</button></div>${door}${micNote}<div class="tiles" id="convTiles"></div><div class="conv-ctl">${this.controls()}</div>`;
    const tiles = this.panel.querySelector('#convTiles')!;
    for (const f of shares) tiles.appendChild(this.tile(f, true));
    for (const f of feeds) tiles.appendChild(this.tile(f, false));
    this.panel.querySelector('#leaveConv')!.addEventListener('click', () => this.leave());
    this.bindControls(this.panel);
    this.panel.querySelector('#openStage')?.addEventListener('click', () => this.openStage());
    this.panel.querySelector('#convMin')!.addEventListener('click', () => { this.collapsed = true; this.render(); });
    this.panel.querySelector('#micOn')?.addEventListener('click', () => void app.toggleMic());
    this.panel.querySelector('#micX')?.addEventListener('click', () => { this.micDismissed = c.id; this.render(); });
    this.panel.querySelector('#convLock')?.addEventListener('click', () => app.lockConv(!c.locked));
    this.panel.querySelector('#doorToggle')?.addEventListener('click', () => app.send({ t: 'door', open: !app.doorOpen }));
    this.panel.querySelectorAll<HTMLElement>('[data-letin]').forEach((b) => b.addEventListener('click', () => {
      app.send({ t: 'doorReply', who: b.dataset.letin!, accept: true });
      app.notify.dismiss(`door-${b.dataset.letin}`);
    }));
    if (this.stageOpen) this.renderStage(feeds);
  }

  private tile(f: Feed, screen: boolean) {
    const app = this.app;
    const u = app.users.get(f.id);
    const el = document.createElement('div');
    el.className = `tile${f.speaking && !screen ? ' speaking' : ''}${screen ? ' slide' : ''}`;
    el.dataset.id = f.id;
    if (!screen) el.style.background = `linear-gradient(160deg, ${u?.color ?? '#555'}, #1d2129)`;
    const track = screen ? f.screen : f.camera;
    if (track) {
      const v = this.video(track, `${f.id}:${screen ? 's' : 'c'}`);
      v.className = screen ? 'vid contain' : 'vid';
      el.appendChild(v);
    } else el.insertAdjacentHTML('beforeend', `<img class="pt" src="${app.portraits[f.id] ?? ''}" alt=""/><span class="off">${icon('camOff')}</span>`);
    const hand = !screen && app.presence.get(f.id)?.hand ? ' ✋' : '';
    const label = screen ? `${icon('screen')}${f.id === app.me ? 'Sua tela' : esc(app.shortName(f.id))}` : `${icon(f.micOn ? 'mic' : 'micOff')}${f.id === app.me ? 'Você' : esc(app.shortName(f.id))}${hand}`;
    el.insertAdjacentHTML('beforeend', `<span class="nm">${label}</span>`);
    if (screen) el.addEventListener('click', () => this.openStage());
    return el;
  }

  private leave() {
    const app = this.app;
    const c = app.conv;
    if (!c) return;
    if (c.kind === 'room') {
      // sai da sala pela porta, para o hub
      app.travel('hub');
    } else app.send({ t: 'leaveConv' });
  }

  // ---------- apresentação ----------
  private openStage() {
    this.stageOpen = true;
    this.stage.hidden = false;
    this.app.sceneSide('present', true);
    this.panel.hidden = true;
    this.renderStage(this.feeds());
    cancelAnimationFrame(this.raf);
    const loop = () => { this.paintMarks(); this.raf = requestAnimationFrame(loop); };
    loop();
  }

  private closeStage() {
    this.stageOpen = false;
    this.stage.hidden = true;
    this.app.sceneSide('present', false);
    cancelAnimationFrame(this.raf);
    if (this.app.conv) this.panel.hidden = false;
  }

  private renderStage(feeds: Feed[]) {
    const app = this.app;
    const shares = feeds.filter((f) => f.screen);
    this.stage.innerHTML = `<div class="pr-h"><b>${shares.length ? 'Apresentação' : 'Conversa'}</b><small>${shares.map((s) => (s.id === app.me ? 'Sua tela' : esc(app.shortName(s.id)))).join(' · ') || 'Ninguém compartilhando a tela'}</small>
      <div class="pr-tools">${shares.length ? `<button data-tool="ptr" class="${this.tool === 'ptr' ? 'on' : ''}" title="Apontador">${icon('pointer')}</button><button data-tool="pen" class="${this.tool === 'pen' ? 'on' : ''}" title="Marcação temporária">${icon('pen')}</button>${COLORS.map((c) => `<button data-color="${c}" class="sw${this.color === c ? ' on' : ''}" style="--c:${c}" title="Cor"></button>`).join('')}` : ''}</div>
      <div class="pr-media">${this.controls()}</div>
      <button class="btn soft" id="backMap">${icon('map')}Voltar ao mapa</button></div>
      <div class="pr-main n${Math.min(2, shares.length)}" id="prMain"></div>
      <div class="pr-strip" id="prStrip"></div>`;
    const main = this.stage.querySelector('#prMain')!;
    for (const s of shares) {
      const box = document.createElement('div');
      box.className = 'pr-share';
      box.dataset.share = s.id;
      box.appendChild(this.video(s.screen!, `${s.id}:s`));
      const cv = document.createElement('canvas');
      cv.className = 'pr-ink';
      box.appendChild(cv);
      box.insertAdjacentHTML('beforeend', `<span class="nm">${icon('screen')}${s.id === app.me ? 'Sua tela' : esc(app.shortName(s.id))}</span>`);
      this.bindInk(cv, s.id);
      main.appendChild(box);
    }
    if (!shares.length) main.innerHTML = `<p class="empty">Quando alguém compartilhar a tela, ela aparece aqui.</p>`;
    const strip = this.stage.querySelector('#prStrip')!;
    for (const f of feeds) strip.appendChild(this.tile(f, false));
    this.stage.querySelector('#backMap')!.addEventListener('click', () => this.closeStage());
    this.bindControls(this.stage);
    this.stage.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => b.addEventListener('click', () => { this.tool = b.dataset.tool as 'ptr' | 'pen'; this.renderStage(this.feeds()); }));
    this.stage.querySelectorAll<HTMLElement>('[data-color]').forEach((b) => b.addEventListener('click', () => { this.color = b.dataset.color!; this.renderStage(this.feeds()); }));
  }

  /** Coordenadas normalizadas (0–1) sobre a área visível do vídeo. */
  private norm(cv: HTMLCanvasElement, e: PointerEvent) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  private bindInk(cv: HTMLCanvasElement, share: string) {
    const others = () => (this.app.conv?.members ?? []).filter((m) => m !== this.app.me);
    let lastPtr = 0;
    cv.addEventListener('pointerdown', (e) => {
      if (this.tool !== 'pen') return;
      cv.setPointerCapture(e.pointerId);
      const p = this.norm(cv, e);
      const mark: Mark = { pts: [p.x, p.y], color: this.color, at: Date.now() };
      this.drawing = { share, mark };
      this.addMark(share, mark);
    });
    cv.addEventListener('pointermove', (e) => {
      const p = this.norm(cv, e);
      if (this.drawing && this.drawing.share === share) {
        this.drawing.mark.pts.push(p.x, p.y);
        this.drawing.mark.at = Date.now();
      } else if (this.tool === 'ptr' && performance.now() - lastPtr > 50) {
        lastPtr = performance.now();
        this.app.media.sendData({ k: 'ptr', share, x: p.x, y: p.y }, others(), false);
      }
    });
    const end = () => {
      if (!this.drawing) return;
      this.app.media.sendData({ k: 'mark', share, pts: this.drawing.mark.pts.map((v) => Math.round(v * 1000) / 1000), color: this.drawing.mark.color }, others(), true);
      this.drawing = null;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }

  private addMark(share: string, m: Mark) {
    const list = this.marks.get(share) ?? [];
    list.push(m);
    this.marks.set(share, list);
  }

  private receive(from: string, d: Record<string, unknown>) {
    const share = String(d.share ?? '');
    if (d.k === 'ptr') {
      const map = this.pointers.get(share) ?? new Map<string, Pointer>();
      map.set(from, { x: Number(d.x), y: Number(d.y), at: Date.now(), who: from });
      this.pointers.set(share, map);
    } else if (d.k === 'mark' && Array.isArray(d.pts)) {
      this.addMark(share, { pts: (d.pts as number[]).slice(0, 4000), color: String(d.color ?? COLORS[0]), at: Date.now() });
    }
  }

  private paintMarks() {
    const now = Date.now();
    this.stage.querySelectorAll<HTMLElement>('.pr-share').forEach((box) => {
      const share = box.dataset.share!;
      const cv = box.querySelector<HTMLCanvasElement>('.pr-ink')!;
      // a camada de marcas cobre só a imagem, para coincidir em telas de proporções diferentes
      const v = box.querySelector('video');
      if (v?.videoWidth) {
        const s = Math.min(box.clientWidth / v.videoWidth, box.clientHeight / v.videoHeight);
        const cw = v.videoWidth * s, ch = v.videoHeight * s;
        Object.assign(cv.style, { left: `${(box.clientWidth - cw) / 2}px`, top: `${(box.clientHeight - ch) / 2}px`, width: `${cw}px`, height: `${ch}px` });
      }
      const w = Math.round(cv.clientWidth), h = Math.round(cv.clientHeight);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      const g = cv.getContext('2d')!;
      g.clearRect(0, 0, w, h);
      const marks = (this.marks.get(share) ?? []).filter((m) => now - m.at < MARK_LIFE);
      this.marks.set(share, marks);
      g.lineCap = g.lineJoin = 'round';
      g.lineWidth = 4;
      for (const m of marks) {
        g.globalAlpha = Math.min(1, (MARK_LIFE - (now - m.at)) / 800);
        g.strokeStyle = m.color;
        g.beginPath();
        for (let i = 0; i < m.pts.length; i += 2) {
          const x = m.pts[i] * w, y = m.pts[i + 1] * h;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
      for (const p of this.pointers.get(share)?.values() ?? []) {
        if (now - p.at > 2500) continue;
        const x = p.x * w, y = p.y * h;
        g.fillStyle = this.app.users.get(p.who)?.color ?? '#ef4444';
        g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
        g.font = '600 12px Geist, sans-serif';
        g.fillText(this.app.name(p.who), x + 12, y + 4);
      }
    });
  }
}
