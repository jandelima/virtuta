import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { CAFE_SPOT, REUNIAO, REUNIAO_DOOR, SALA, SALA_DOOR, areaAt, inside } from '../../shared/layout';
import type { BoardElement, Conv, FocusSession, GameState, Note, Presence, PublicUser, RadioState, ServerMsg, Settings, Status as NetStatus } from '../../shared/protocol';
import { Avatar } from './avatar';
import { Media } from './media';
import { Net, type NetState } from './net';
import { STATUS_LABEL, type Person, type Status } from './people';
import { Scene3D } from './scene';
import { renderPortraits } from './ui/portraits';
import { esc } from './ui/dom';
import { buildEscritorio, type World } from './world/escritorio';
import { mergeStatic } from './world/optimize';
import { boardTex, gameTex, tvTex } from './world/live';
import { nameplateTex } from './world/props';
import type { Interactive, Seat } from './world/space';
import { Highlight } from './world/highlight';
import { Shell } from './ui/shell';
import { ConvView } from './ui/conv';
import { Panels } from './ui/panels';
import { Notifier } from './ui/notify';
import { RadioPlayer } from './ui/radio';

// O escritório conectado: estado vindo do servidor, cena 3D, avatares, mídia e interface.

export class OfficeApp {
  readonly net = new Net();
  readonly media = new Media();
  readonly sc: Scene3D;
  world!: World;
  me = '';
  users = new Map<string, PublicUser>();
  presence = new Map<string, Presence>();
  avatars = new Map<string, Avatar>();
  conv: Conv | null = null;
  convs: Conv[] = [];
  doorOpen = true;
  doorAllowed = false;
  radio: RadioState = { queue: [], current: null, startedAt: 0, listeners: [] };
  focus: FocusSession | null = null;
  notes: Note[] = [];
  noteCounts: Record<string, number> = {};
  game: GameState = { id: '', board: [], players: [null, null], turn: 0, winner: null, draw: false };
  settings: Settings = { officeName: 'Virtuta' };
  walls = new Map<string, BoardElement[]>();
  serverOffset = 0;
  portraits: Record<string, string> = {};
  netState: NetState = 'connecting';
  keys = new Set<string>();
  readonly shell: Shell;
  readonly convView: ConvView;
  readonly panels: Panels;
  readonly notify: Notifier;
  readonly radioPlayer: RadioPlayer;
  private wasAdmitted = false;
  private readonly highlight = new Highlight();
  private readonly ray = new THREE.Raycaster();
  private hoverTip!: HTMLDivElement;
  private mouseMoved = false;
  private lastSent = { x: 0, z: 0, rot: 0, seat: '' as string | null, at: 0 };
  private started = false;
  boardListener: ((m: ServerMsg) => void) | null = null;
  followUntil = 0;
  followId: string | null = null;

  constructor(readonly role: 'member' | 'admin' | 'guest') {
    this.sc = new Scene3D(document.getElementById('viewport')!);
    this.shell = new Shell(this);
    this.convView = new ConvView(this);
    this.panels = new Panels(this);
    this.notify = new Notifier(this);
    this.radioPlayer = new RadioPlayer(this);
    this.media.onChange = () => { this.convView.render(); this.shell.renderDock(); this.refreshCallLabels(); };
    this.net.onMessage = (m) => this.onMessage(m);
    this.net.onState = (s) => { this.netState = s; this.shell.renderConnection(); };
  }

  get guest() { return this.role === 'guest'; }
  get myAvatar() { return this.avatars.get(this.me); }
  get myPresence() { return this.presence.get(this.me); }
  now() { return Date.now() + this.serverOffset; }
  send: Net['send'] = (m) => this.net.send(m);
  name(id: string) { return this.users.get(id)?.name ?? 'Alguém'; }

  /** Primeiro nome; quando outra pessoa tem o mesmo, acrescenta a inicial do último sobrenome. */
  shortName(id: string) {
    const words = this.name(id).trim().split(/\s+/);
    const first = (n: string) => n.trim().split(/\s+/)[0].toLowerCase();
    const twin = [...this.users.values()].some((u) => u.id !== id && first(u.name) === words[0].toLowerCase());
    return twin && words.length > 1 ? `${words[0]} ${words[words.length - 1][0].toUpperCase()}.` : words[0];
  }

  start() {
    this.world = buildEscritorio();
    const { before, after } = mergeStatic(this.world.space.group);
    console.info(`Cenário: ${before} malhas juntadas em ${after}`);
    this.sc.setSpace(this.world.space);
    this.setupInteractives();
    this.setupInput();
    this.sc.follow = () => {
      const f = this.followId && performance.now() < this.followUntil ? this.avatars.get(this.followId) : null;
      return (f ?? this.myAvatar)?.pos ?? new THREE.Vector3(12, 0, 6);
    };
    this.sc.onFrame = (dt) => this.frame(dt);
    // dentro de uma sala, as paredes de vidro dela baixam para não esconder ninguém
    this.sc.onRoom = (room) => {
      for (const c of this.world.space.cutaways) {
        const inside = c.room === room?.id;
        c.upper.visible = !inside;
        c.cap.visible = inside;
      }
      this.sc.refreshShadows();
    };
    this.net.connect();
  }

  // ---------- mensagens do servidor ----------
  private onMessage(m: ServerMsg) {
    if (this.boardListener && (m.t === 'board' || m.t === 'boardOp' || m.t === 'boardCursor' || m.t === 'boardEditors' || m.t === 'boardCopies' || m.t === 'boards')) this.boardListener(m);
    switch (m.t) {
      case 'init': return this.init(m);
      case 'user': return this.upsertUser(m.user);
      case 'join': return this.upsertPresence(m.presence);
      case 'presence': return this.upsertPresence(m.presence);
      case 'leave': return this.removePresence(m.id);
      case 'moves':
        for (const [id, x, z, rot, seat] of m.m) {
          if (id === this.me) continue;
          const p = this.presence.get(id);
          if (p) Object.assign(p, { x, z, rot, seat });
          this.avatars.get(id)?.follow(x, z, rot, seat ? this.world.space.seats.get(seat) ?? null : null);
        }
        this.sc.wake(1500);
        return;
      case 'conv': return this.setConv(m.conv);
      case 'convs': this.convs = m.convs; this.refreshCallLabels(); return;
      case 'react': return this.showReaction(m.from, m.emoji);
      case 'knock': return this.notify.knock(m.from, m.text);
      case 'knockReply': return this.notify.toast(m.accept ? `${this.name(m.from)} aceitou. Vocês estão em conversa.` : `${this.name(m.from)} não pode falar agora.`);
      case 'door': return this.setDoor(m.open, m.by);
      case 'doorKnock': return this.notify.doorKnock(m.who);
      case 'doorReply':
        if (m.accept) { this.doorAllowed = true; this.applyDoorNav(); this.notify.toast('Pode entrar na sala de reunião.'); }
        else this.notify.toast('Agora não é possível entrar na sala de reunião.');
        return;
      case 'note':
        this.notes.unshift(m.note);
        this.notify.note(m.note);
        this.shell.renderMe();
        return;
      case 'noteCounts': this.noteCounts = m.counts; return this.refreshDesks();
      case 'board': case 'boardOp': return this.wallUpdate(m);
      case 'radio':
        this.serverOffset = m.serverTime - Date.now();
        this.radio = m.radio;
        return this.radioPlayer.sync();
      case 'focus':
        this.serverOffset = m.serverTime - Date.now();
        this.notify.focusChange(this.focus, m.focus);
        this.focus = m.focus;
        this.shell.renderFocus();
        this.refreshAllPeople();
        return;
      case 'game': this.game = m.game; this.refreshGame(); return this.panels.refresh('jogo');
      case 'pauseInvite': return this.notify.pauseInvite(m.from);
      case 'guestArrived': return this.notify.guestArrived(m.guest, m.name);
      case 'admitted': return this.admitted();
      case 'refused': return this.shell.screen('refused');
      case 'toast': return this.notify.toast(m.text);
      case 'replaced': return this.shell.screen('replaced');
      case 'pong': this.serverOffset = m.serverTime - Date.now(); return;
    }
  }

  private init(m: Extract<ServerMsg, { t: 'init' }>) {
    this.me = m.you;
    this.serverOffset = m.serverTime - Date.now();
    this.users = new Map(m.users.map((u) => [u.id, u]));
    this.doorOpen = m.doorOpen;
    this.radio = m.radio;
    this.focus = m.focus;
    this.notes = m.notes;
    this.noteCounts = m.noteCounts;
    this.game = m.game;
    this.settings = m.settings;
    for (const [id, els] of Object.entries(m.walls)) this.setWall(id, els);
    // reconexão: refaz os avatares a partir do estado atual do servidor
    const keep = new Set(m.presence.map((p) => p.id));
    for (const id of [...this.avatars.keys()]) if (!keep.has(id)) this.removePresence(id);
    for (const p of m.presence) this.upsertPresence(p, true);
    this.portraits = { ...this.portraits, ...renderPortraits([...this.users.values()].map((u) => this.person(u.id))) };
    if (!this.started) {
      this.started = true;
      const me = this.myAvatar!;
      this.sc.zoom = 1.15;
      this.sc.start();
      if (me) this.lastSent = { x: me.pos.x, z: me.pos.z, rot: 0, seat: null, at: 0 };
      document.getElementById('loading')?.classList.add('done');
      // quem chega pela primeira vez monta o próprio avatar antes de tudo
      if (!this.guest && !this.users.get(this.me)?.look) this.shell.editAvatar(true);
    }
    this.refreshDesks();
    this.refreshGame();
    this.refreshTv();
    this.setDoor(this.doorOpen, '', true);
    this.radioPlayer.sync();
    this.shell.renderAll();
    this.convView.render();
    if (this.guest && this.myPresence?.waiting) this.shell.screen('waiting');
  }

  /** Pessoa como a interface a enxerga (nome, modelo, estado exibido). */
  person(id: string): Person {
    const u = this.users.get(id);
    const p = this.presence.get(id);
    return {
      id,
      name: u?.name ?? 'Alguém',
      short: this.shortName(id),
      model: u?.model ?? 'character-male-e',
      color: u?.color ?? '#7c8597',
      status: this.displayStatus(id),
      note: p?.note || undefined,
      me: id === this.me,
      guest: u?.role === 'guest',
      unstable: p?.unstable,
      space: 'terreo',
      look: u?.look ?? null,
    };
  }

  /** Estado exibido: visitante aguardando, em reunião (dentro da sala), foco coletivo ou o escolhido. */
  displayStatus(id: string): Status {
    const p = this.presence.get(id);
    if (!p) return 'afk';
    if (p.waiting) return 'visita';
    const focusNow = this.focus?.participants.includes(id) && this.focusBlock()?.kind === 'foco';
    if (focusNow) return 'foco';
    if (p.status === 'disp' && inside(REUNIAO, p.x, p.z)) return 'reuniao';
    return p.status as Status;
  }

  focusBlock() {
    if (!this.focus) return null;
    let t = (this.now() - this.focus.startedAt) / 60000;
    for (let i = 0; i < this.focus.blocks.length; i++) {
      const b = this.focus.blocks[i];
      if (t < b.minutes) return { ...b, index: i, left: (b.minutes - t) * 60 };
      t -= b.minutes;
    }
    return null;
  }

  private upsertUser(u: PublicUser) {
    const prev = this.users.get(u.id);
    this.users.set(u.id, u);
    const a = this.avatars.get(u.id);
    if (a) {
      Object.assign(a.person, { name: u.name, model: u.model, color: u.color });
      if (JSON.stringify(prev?.look) !== JSON.stringify(u.look) || prev?.model !== u.model) a.setLook(u.look);
      a.refreshLabel();
    }
    // um nome novo pode criar (ou desfazer) um xará: os balões dos outros mudam junto
    if (prev?.name !== u.name) this.refreshAllPeople();
    Object.assign(this.portraits, renderPortraits([this.person(u.id)]));
    this.refreshDesks();
    this.shell.renderAll();
    this.convView.render();
  }

  private upsertPresence(p: Presence, fromInit = false) {
    this.presence.set(p.id, p);
    // visitante aguardando não aparece no mapa de quem está dentro
    const visible = !p.waiting || p.id === this.me;
    let a = this.avatars.get(p.id);
    if (visible && !a) {
      a = new Avatar(this.person(p.id));
      a.spaceId = 'terreo';
      this.avatars.set(p.id, a);
      this.sc.scene.add(a.root);
      const seat = p.seat ? this.world.space.seats.get(p.seat) : null;
      if (seat) a.sit(seat); else a.place(p.x, p.z, p.rot);
    } else if (!visible && a) {
      this.removeAvatar(p.id);
      a = undefined;
    }
    if (a && p.id !== this.me && fromInit) {
      const seat = p.seat ? this.world.space.seats.get(p.seat) : null;
      a.follow(p.x, p.z, p.rot, seat ?? null);
    }
    if (a) {
      Object.assign(a.person, this.person(p.id));
      a.refreshLabel();
    }

    if (!fromInit) this.shell.renderPeople();
    if (p.id === this.me && !fromInit) { this.shell.renderMe(); this.shell.renderDock(); }
    this.sc.wake();
  }

  private removePresence(id: string) {
    this.presence.delete(id);
    this.removeAvatar(id);
    this.shell.renderPeople();
  }

  private removeAvatar(id: string) {
    const a = this.avatars.get(id);
    if (!a) return;
    a.root.removeFromParent();
    a.label.element.remove();
    a.dispose();
    this.avatars.delete(id);
  }

  refreshAllPeople() {
    for (const [id, a] of this.avatars) { Object.assign(a.person, this.person(id)); a.refreshLabel(); }
    this.shell.renderPeople();
    this.shell.renderMe();
  }

  // ---------- conversas ----------
  private setConv(c: Conv | null) {
    const before = this.conv;
    this.conv = c;
    this.media.setMembers(c ? c.members : []);
    this.refreshCallLabels();
    this.convView.render(before);
    this.shell.renderPeople();
    if (c && !before) this.notify.joinedConv(c);
  }

  refreshCallLabels() {
    const mine = new Set(this.conv?.members ?? []);
    const feeds = this.conv ? this.media.feeds(this.conv.members, this.me) : [];
    const inAny = new Set(this.convs.flatMap((c) => c.members));
    for (const [id, a] of this.avatars) {
      const f = feeds.find((x) => x.id === id);
      a.inCall = inAny.has(id);
      a.micOn = mine.has(id) ? !!f?.micOn : false;
      a.speaking = !!f?.speaking;
      a.refreshLabel();
    }
  }

  // ---------- movimento local ----------
  private setupInput() {
    addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || document.querySelector('.modal-open')) return;
      const k = e.key.toLowerCase();
      if (e.key === 'Alt') e.preventDefault();
      this.keys.add(k);
      if (k === 'e') this.interactNearest();
      if (k === 'escape') this.panels.close();
      if (k === 'm' && !e.ctrlKey && !e.metaKey) void this.toggleMic();
      if (k === 'v' && !e.ctrlKey && !e.metaKey) void this.toggleCam();
      if (k === 'k' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); (document.getElementById('search') as HTMLInputElement).focus(); }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
    const canvas = this.sc.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) this.clickWorld(e.clientX, e.clientY); });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.sc.zoom = THREE.MathUtils.clamp(this.sc.zoom * Math.exp(-e.deltaY * 0.0012), 0.5, 2.4);
    }, { passive: false });
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.set(e.clientX - r.left, e.clientY - r.top);
      this.mouseMoved = true;
    });
    canvas.addEventListener('pointerleave', () => { this.mouse.set(-9999, -9999); this.mouseMoved = true; });
  }
  private mouse = new THREE.Vector2(-9999, -9999);

  private personUnderMouse(px: number, py: number) {
    let best: string | null = null, bd = 30;
    for (const [id, a] of this.avatars) {
      if (id === this.me) continue;
      const s = this.sc.toScreen(a.pos.clone().setY(a.pos.y + 0.6));
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }

  private clickWorld(cx: number, cy: number) {
    const me = this.myAvatar;
    if (!me || this.myPresence?.waiting) return;
    const r = this.sc.renderer.domElement.getBoundingClientRect();
    const other = this.personUnderMouse(cx - r.left, cy - r.top);
    if (other) return this.panels.openPerson(other);
    const obj = this.interactiveAt(cx - r.left, cy - r.top);
    if (obj) return this.use(obj.it, obj.point);
    const { ground } = this.sc.pick(cx, cy);
    if (ground && ground.x > 0 && ground.z > 0 && ground.x < this.world.space.w && ground.z < this.world.space.d) this.walkTo(ground.x, ground.z);
  }

  seatNear(x: number, z: number, max: number) {
    let best: Seat | null = null, bd = max;
    for (const s of this.world.space.seats.values()) {
      const d = Math.hypot(s.x - x, s.z - z);
      const taken = [...this.avatars.values()].some((a) => a.seat === s && a !== this.myAvatar);
      if (d < bd && !taken) { best = s; bd = d; }
    }
    return best;
  }

  /** Anda até (x, z); se o ponto for um assento livre, senta nele (a não ser com `sit` falso). */
  walkTo(x: number, z: number, then?: () => void, sit = true) {
    const me = this.myAvatar;
    if (!me) return false;
    const best = sit ? this.seatNear(x, z, 0.45) : null;
    if (best && best === me.seat) return true;
    const ok = best ? me.goSit(this.world.space.nav, best, then) : me.goTo(this.world.space.nav, x, z, then);
    if (ok) this.sc.markClick(x, z);
    else this.notify.toast(this.guest && inside(SALA, x, z) ? 'Visitantes não entram na sala da equipe.' : 'Não há caminho até lá.');
    this.followId = null;
    return ok;
  }

  /** Senta no assento `id`, se estiver livre; senão, anda até perto dele. */
  sitOn(id: string) {
    const s = this.world.space.seats.get(id);
    if (!s) return;
    const taken = [...this.avatars.values()].some((a) => a.seat === s && a !== this.myAvatar);
    if (taken) this.walkTo(s.x, s.z, undefined, false);
    else this.walkTo(s.x, s.z);
  }

  /** Vai para o lounge e senta no primeiro lugar livre do sofá ou das poltronas. */
  goLounge() {
    const free = ['sofa-0', 'sofa-1', 'poltrona-w', 'poltrona-e'].find((id) => {
      const s = this.world.space.seats.get(id)!;
      return ![...this.avatars.values()].some((a) => a.seat === s && a !== this.myAvatar);
    });
    if (free) this.sitOn(free);
    else this.walkTo(12.2, 6.2);
  }

  /** Senta na própria mesa. */
  goToDesk() {
    const u = this.users.get(this.me);
    const s = u?.desk != null ? this.world.space.seats.get(`mesa-${u.desk}`) : null;
    if (s) this.walkTo(s.x, s.z);
  }

  private frame(dt: number) {
    const me = this.myAvatar;
    if (!me) return;
    // teclado relativo à câmera isométrica
    const fwd = new THREE.Vector2(-1, -1).normalize();
    const right = new THREE.Vector2(-fwd.y, fwd.x);
    let mx = 0, mz = 0;
    const k = this.keys;
    if (k.has('w') || k.has('arrowup')) { mx += fwd.x; mz += fwd.y; }
    if (k.has('s') || k.has('arrowdown')) { mx -= fwd.x; mz -= fwd.y; }
    if (k.has('d') || k.has('arrowright')) { mx += right.x; mz += right.y; }
    if (k.has('a') || k.has('arrowleft')) { mx -= right.x; mz -= right.y; }
    // depois de parar, a transição de andar para parado continua fluida por um tempo
    if (!this.myPresence?.waiting && me.steer(mx, mz, dt, this.world.space.nav)) { this.followId = null; this.sc.wake(1500); }
    for (const a of this.avatars.values()) a.update(dt);
    this.separate();
    if (this.mouseMoved) { this.mouseMoved = false; this.updateHover(); }
    if (me.moving) this.sc.wake(1500);

    // envia a própria posição no máximo 10 vezes por segundo, só quando muda
    const t = performance.now();
    const seat = me.seat?.id ?? null;
    const L = this.lastSent;
    if (t - L.at > 100 && (Math.abs(me.pos.x - L.x) > 0.01 || Math.abs(me.pos.z - L.z) > 0.01 || seat !== L.seat || Math.abs(me.root.rotation.y - L.rot) > 0.05)) {
      this.lastSent = { x: me.pos.x, z: me.pos.z, rot: me.root.rotation.y, seat, at: t };
      const p = this.myPresence;
      if (p) Object.assign(p, { x: me.pos.x, z: me.pos.z, seat });
      this.send({ t: 'move', x: me.pos.x, z: me.pos.z, rot: me.root.rotation.y, seat });
    }

    // tarefas periódicas pelo relógio real (o dt do quadro tem teto e atrasaria em máquinas lentas)
    if (t - this.tick > 100) {
      this.tick = t;
      this.updateLabels();
      // o que estava sob o mouse pode ter mudado (alguém sentou, a câmera andou)
      if (t - this.hoverAt > 400) this.updateHover();
      this.sc.drawConvs(this.convs.filter((c) => c.kind !== 'room').map((c) => c.members.map((id) => this.avatars.get(id)).filter((a): a is Avatar => !!a)));
    }
    if (t - this.slow > 1000) {
      this.slow = t;
      this.shell.everySecond();
      this.radioPlayer.update();
      this.refreshTv();
    }
  }
  private tick = 0;
  private hoverAt = 0;
  private slow = 0;

  /** Ninguém atravessa ninguém: quem está em pé é afastado de quem está perto. */
  private separate() {
    const list = [...this.avatars.values()];
    for (const a of list) {
      if (a.seat) continue;
      for (const b of list) {
        if (a === b) continue;
        const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
        const dd = Math.hypot(dx, dz);
        if (dd >= 0.5) continue;
        const push = (0.5 - dd) * (b.seat ? 1 : 0.5);
        const nx = dd > 1e-4 ? dx / dd : 1, nz = dd > 1e-4 ? dz / dd : 0;
        const tx = a.pos.x + nx * push, tz = a.pos.z + nz * push;
        if (this.world.space.nav.walkable(tx, tz)) { a.pos.x = tx; a.pos.z = tz; }
      }
    }
  }

  // ---------- objetos interativos ----------
  // Interage-se clicando no próprio objeto: ao passar o mouse ele ganha contorno e véu da cor
  // de destaque, e uma dica perto do cursor diz o que o clique faz.
  private setupInteractives() {
    this.sc.scene.add(this.highlight.group);
    this.highlight.setColor(this.sc.accent());
    this.sc.onTheme = () => this.highlight.setColor(this.sc.accent());
    this.hoverTip = document.createElement('div');
    this.hoverTip.className = 'hover-tip';
    this.hoverTip.hidden = true;
    document.getElementById('viewport')!.appendChild(this.hoverTip);
  }

  /** Se o objeto pode ser usado agora por esta pessoa. */
  private usable(it: Interactive) {
    if (it.id === 'seat') {
      if (this.guest && it.seats.some((id) => { const s = this.world.space.seats.get(id)!; return inside(SALA, s.x, s.z); })) return false;
      return !!this.freeSeat(it);
    }
    if (this.guest) return ['board:reuniao', 'porta', 'jogo'].includes(it.id);
    if (it.id.startsWith('mesa:')) return !!this.deskOwner(Number(it.id.slice(5)));
    return true;
  }

  private deskOwner(index: number) {
    return [...this.users.values()].find((u) => u.desk === index);
  }

  /** Assento livre do objeto, o mais perto de `near` (ponto clicado). */
  private freeSeat(it: Interactive, near?: THREE.Vector3) {
    let best: Seat | null = null, bd = Infinity;
    for (const id of it.seats) {
      const s = this.world.space.seats.get(id)!;
      if ([...this.avatars.values()].some((a) => a.seat === s)) continue;
      const d = near ? Math.hypot(s.x - near.x, s.z - near.z) : 0;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /** Título e ação mostrados na dica, conforme o estado atual. */
  private describe(it: Interactive) {
    const [kind, arg] = it.id.split(':');
    if (kind === 'seat') return { title: '', hint: 'Sentar' };
    if (kind === 'mesa') {
      const u = this.deskOwner(Number(arg))!;
      return u.id === this.me ? { title: 'Sua mesa', hint: 'Ver bilhetes' } : { title: `Mesa de ${u.name.split(' ')[0]}`, hint: 'Deixar um bilhete' };
    }
    if (kind === 'porta') {
      const me = this.myPresence;
      const inRoom = !!me && inside(REUNIAO, me.x, me.z);
      return { title: it.title, hint: inRoom ? (this.doorOpen ? 'Fechar a porta' : 'Abrir a porta') : this.doorOpen || this.doorAllowed ? 'Entrar' : 'Bater na porta' };
    }
    return { title: it.title, hint: it.hint };
  }

  /** Objeto sob o ponto da tela (em pixels do canvas), o mais próximo da câmera. */
  interactiveAt(px: number, py: number) {
    const el = this.sc.renderer.domElement;
    this.ray.setFromCamera(new THREE.Vector2((px / el.clientWidth) * 2 - 1, -(py / el.clientHeight) * 2 + 1), this.sc.camera);
    let best: { it: Interactive; point: THREE.Vector3 } | null = null, bd = Infinity;
    for (const it of this.world.space.interactives) {
      if (!this.ray.ray.intersectsBox(it.box) || !this.usable(it)) continue;
      for (const m of it.meshes) {
        if (m.parent && !m.visible) continue;
        const h = this.ray.intersectObject(m, false)[0];
        if (h && h.distance < bd) { bd = h.distance; best = { it, point: h.point }; }
      }
    }
    return best;
  }

  private updateHover() {
    this.hoverAt = performance.now();
    const me = this.myAvatar;
    const blocked = !me || this.myPresence?.waiting || document.querySelector('.modal-open');
    const person = blocked ? null : this.personUnderMouse(this.mouse.x, this.mouse.y);
    const hov = blocked || person ? null : this.interactiveAt(this.mouse.x, this.mouse.y);
    // sem nada sob o mouse, o objeto ao alcance da tecla E ganha só o contorno
    const near = hov ? null : this.nearestInteractive();
    const it = hov?.it ?? near;
    if (it !== this.highlight.current || (!!near && it === near) !== this.highlightSoft) {
      this.highlightSoft = !hov && !!near;
      this.highlight.show(it ?? null, this.highlightSoft);
      this.sc.wake(300);
    }
    // contorno com espessura constante na tela, qualquer que seja o zoom
    const cam = this.sc.camera;
    this.highlight.setPixels(3, (cam.top - cam.bottom) / cam.zoom / Math.max(1, this.sc.renderer.domElement.clientHeight));
    this.sc.renderer.domElement.style.cursor = person || hov ? 'pointer' : '';
    const tip = this.hoverTip;
    if (hov) {
      const d = this.describe(hov.it);
      tip.innerHTML = d.title ? `<b>${esc(d.title)}</b><span>${esc(d.hint)}</span>` : `<span>${esc(d.hint)}</span>`;
      tip.style.transform = `translate(${Math.round(this.mouse.x + 16)}px, ${Math.round(this.mouse.y + 18)}px)`;
      tip.hidden = false;
    } else tip.hidden = true;
  }
  private highlightSoft = false;

  /** Objeto mais perto de quem está andando, para a tecla E (cadeiras e mesas ficam de fora). */
  private nearestInteractive() {
    const me = this.myAvatar;
    if (!me || me.seat) return null;
    let best: Interactive | null = null, bd = 0.9;
    for (const it of this.world.space.interactives) {
      if (it.id === 'seat' || it.id.startsWith('mesa:') || !this.usable(it)) continue;
      const d = boxDist(it.box, me.pos.x, me.pos.z);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  private interactNearest() {
    const it = this.nearestInteractive();
    if (it) this.act(it);
  }

  /** Clique num objeto: anda até ele e, ao chegar, usa (ou senta, se for assento). */
  private use(it: Interactive, point: THREE.Vector3) {
    if (it.id === 'seat') {
      const s = this.freeSeat(it, point);
      if (s) this.walkTo(s.x, s.z);
      return;
    }
    // o café já leva a pessoa até lá
    if (it.id === 'cafe') return this.act(it);
    const me = this.myAvatar!;
    if (boxDist(it.box, me.pos.x, me.pos.z) < 1.0) return this.act(it);
    const spot = it.spot ?? this.approach(it);
    if (!spot) return this.act(it);
    this.walkTo(spot.x, spot.z, () => {
      me.faceTowards((it.box.min.x + it.box.max.x) / 2, (it.box.min.z + it.box.max.z) / 2);
      this.act(it);
    }, false);
  }

  /** Ponto livre ao lado do objeto, do lado mais perto de quem vai até ele e com caminho. */
  private approach(it: Interactive) {
    const nav = this.world.space.nav, me = this.myAvatar!;
    const b = it.box, m = 0.5, pts: { x: number; z: number }[] = [];
    const x1 = b.min.x - m, x2 = b.max.x + m, z1 = b.min.z - m, z2 = b.max.z + m;
    for (let x = x1; x <= x2 + 1e-6; x += 0.2) pts.push({ x, z: z1 }, { x, z: z2 });
    for (let z = z1; z <= z2 + 1e-6; z += 0.2) pts.push({ x: x1, z }, { x: x2, z });
    // de frente para o objeto (não nas quinas) vale mais que um pouco de caminhada
    const cost = (p: { x: number; z: number }) => Math.hypot(p.x - me.pos.x, p.z - me.pos.z) + (p.x >= b.min.x && p.x <= b.max.x ? 0 : p.z >= b.min.z && p.z <= b.max.z ? 0 : 2.5);
    const free = pts.filter((p) => nav.walkable(p.x, p.z)).sort((p, q) => cost(p) - cost(q));
    return free.slice(0, 6).find((p) => nav.findPath(me.pos.x, me.pos.z, p.x, p.z)) ?? null;
  }

  private act(it: Interactive) {
    if (!this.usable(it)) return;
    const [kind, arg] = it.id.split(':');
    if (kind === 'board') return void this.panels.openBoard(arg);
    if (kind === 'mesa') return this.panels.openDesk(Number(arg));
    if (kind === 'cafe') return this.goAfk();
    this.panels.open(kind);
  }

  private updateLabels() {
    const me = this.myAvatar;
    const showAll = this.keys.has('alt') || this.sc.camera.zoom > 2.0;
    const hovered = this.personUnderMouse(this.mouse.x, this.mouse.y);
    const mine = new Set(this.conv?.members ?? []);
    for (const [id, a] of this.avatars) {
      const near = me ? Math.hypot(a.pos.x - me.pos.x, a.pos.z - me.pos.z) < 2.6 : false;
      a.setCompact(!(showAll || near || mine.has(id) || id === hovered));
    }
  }

  /**
   * Quadro e apresentação ocupam a maior parte da tela, mas o escritório continua visível ao
   * vivo numa faixa à direita: ninguém some da vista enquanto se trabalha no quadro.
   */
  sceneSide(reason: 'board' | 'present', on: boolean) {
    if (on) this.sideReasons.add(reason); else this.sideReasons.delete(reason);
    const side = this.sideReasons.size > 0;
    document.body.classList.toggle('scene-side', side);
    if (side) this.panels.close();
    this.sc.setSide(side);
  }
  private sideReasons = new Set<string>();

  // ---------- ações da pessoa ----------
  setStatus(status: NetStatus, note = '') {
    this.send({ t: 'status', status, note });
    const p = this.myPresence;
    if (p) { p.status = status; p.note = note; }
    this.refreshAllPeople();
    this.shell.renderDock();
  }

  /** "Fui tomar café": vai até o café e fica ausente. */
  goAfk() {
    if (this.guest) return;
    this.setStatus('afk', 'Fui tomar café');
    this.walkTo(CAFE_SPOT.x, CAFE_SPOT.z, () => this.myAvatar?.face(Math.PI));
  }

  /** "Voltei": fica disponível e volta para a mesa. */
  back() {
    this.setStatus('disp');
    this.goToDesk();
  }

  toggleFocus() {
    const p = this.myPresence;
    if (!p) return;
    if (this.focus?.participants.includes(this.me)) return this.send({ t: 'focusLeave' });
    if (p.status === 'foco') this.setStatus('disp');
    else this.setStatus('foco', 'Em foco');
  }

  async toggleMic() {
    try { await this.media.setMic(!this.media.mic); } catch (e) { this.notify.mediaError(e, 'microfone'); }
  }
  async toggleCam() {
    try { await this.media.setCam(!this.media.cam); } catch (e) { this.notify.mediaError(e, 'câmera'); }
  }
  async toggleScreen() {
    try { await this.media.setScreen(!this.media.screen); } catch (e) { if ((e as Error).name !== 'NotAllowedError') this.notify.mediaError(e, 'tela'); }
  }

  react(emoji: string) {
    this.send({ t: 'react', emoji });
  }

  private showReaction(from: string, emoji: string) {
    const a = this.avatars.get(from);
    if (!a) return;
    const el = document.createElement('div');
    el.className = 'react-float';
    el.textContent = emoji;
    const obj = new CSS2DObject(el);
    obj.position.set(0, 1.45, 0);
    a.root.add(obj);
    a.emote(emoji === '👋' ? 'emote-yes' : 'emote-yes', 1.0);
    this.sc.wake(2500);
    setTimeout(() => { a.root.remove(obj); el.remove(); }, 2400);
  }

  leaveOffice() {
    this.media.disconnect();
    this.radioPlayer.stop();
    this.net.leave();
    this.shell.screen('left');
  }

  private admitted() {
    if (this.wasAdmitted) return;
    this.wasAdmitted = true;
    this.shell.screen(null);
    const me = this.myAvatar ?? (this.upsertPresence(this.myPresence!), this.myAvatar);
    me?.place(2.6, 10.2, Math.PI);
    this.notify.toast('Você foi admitido. A sala de reunião fica no fundo do salão, à direita.');
    this.shell.renderAll();
  }

  // ---------- porta da sala de reunião ----------
  private setDoor(open: boolean, by: string, quiet = false) {
    const wasOpen = this.doorOpen;
    this.doorOpen = open;
    const me = this.myPresence;
    if (!open && wasOpen) this.doorAllowed = !!me && inside(REUNIAO, me.x, me.z);
    if (open) this.doorAllowed = false;
    this.world.door.visible = !open;
    this.applyDoorNav();
    this.sc.refreshShadows();
    if (!quiet && by && by !== this.me && wasOpen !== open) this.notify.toast(`${this.name(by)} ${open ? 'abriu' : 'fechou'} a porta da sala de reunião.`);
    this.panels.refresh('porta');
  }

  /** Porta fechada vira parede para quem não está autorizado. */
  applyDoorNav() {
    const nav = this.world.space.nav;
    const z = REUNIAO.z2, d = REUNIAO_DOOR;
    if (this.doorOpen || this.doorAllowed) nav.open(d.x1 + 0.05, z - 0.3, d.x2 - 0.05, z + 0.3);
    else nav.block(d.x1, z - 0.3, d.x2, z + 0.3);
    // visitantes não passam pela porta da sala da equipe
    if (this.guest) nav.block(SALA_DOOR.x - 0.3, SALA_DOOR.z1, SALA_DOOR.x + 0.3, SALA_DOOR.z2);
  }

  // ---------- cenário vivo ----------
  refreshDesks() {
    const owners = new Map<number, PublicUser>();
    for (const u of this.users.values()) if (u.desk != null) owners.set(u.desk, u);
    for (const d of this.world.desks) {
      const u = owners.get(d.desk.index);
      const name = u?.name.split(' ')[0] ?? 'Livre';
      const mat = d.plate.material as THREE.MeshStandardMaterial;
      if (mat.userData.name !== name) {
        mat.map?.dispose();
        mat.map = nameplateTex(name);
        mat.userData.name = name;
        mat.needsUpdate = true;
      }
      d.note.visible = !!u && (this.noteCounts[u.id] ?? 0) > 0;
    }
    this.sc.wake();
  }

  private wallUpdate(m: Extract<ServerMsg, { t: 'board' } | { t: 'boardOp' }>) {
    if (!this.world.boards.has(m.id)) return;
    let els = this.walls.get(m.id) ?? [];
    if (m.t === 'board') els = m.elements;
    else {
      const map = new Map(els.map((e) => [e.id, e]));
      m.del?.forEach((id) => map.delete(id));
      m.put?.forEach((e) => map.set(e.id, e));
      els = [...map.values()];
    }
    this.setWall(m.id, els);
  }

  setWall(id: string, els: BoardElement[]) {
    this.walls.set(id, els);
    const mat = this.world.boards.get(id);
    if (!mat) return;
    clearTimeout(this.wallTimers.get(id));
    // redesenha a lousa no mundo com no máximo uma atualização por segundo
    this.wallTimers.set(id, window.setTimeout(() => {
      mat.map?.dispose();
      mat.map = boardTex(els, id === 'reuniao' ? 1024 : 1600);
      mat.needsUpdate = true;
      this.sc.wake();
    }, 1000));
  }
  private wallTimers = new Map<string, number>();

  private refreshGame() {
    const g = this.game;
    const status = g.winner ? `${this.name(g.winner)} venceu` : g.draw ? 'Empate' : g.players[0] && g.players[1] ? `Vez de ${this.name(g.players[g.turn]!)}` : 'Esperando jogadores';
    this.world.game.map?.dispose();
    this.world.game.map = gameTex(g, status);
    this.world.game.needsUpdate = true;
    this.sc.wake();
  }

  refreshTv() {
    const room = this.convs.find((c) => c.kind === 'room');
    const n = [...this.presence.values()].filter((p) => inside(REUNIAO, p.x, p.z)).length;
    const sub = n ? `${n} ${n === 1 ? 'pessoa' : 'pessoas'} na chamada${this.doorOpen ? '' : ' · porta fechada'}` : 'Livre';
    const key = `${sub}|${!!room}`;
    if (this.world.tv.userData.key === key) return;
    this.world.tv.userData.key = key;
    this.world.tv.map?.dispose();
    const t = tvTex('Sala de reunião', sub, n ? '#22c55e' : '#5b8cff');
    this.world.tv.map = t;
    this.world.tv.emissiveMap = t;
    this.world.tv.needsUpdate = true;
  }

  areaName(id: string) {
    const p = this.presence.get(id);
    if (!p) return 'Offline';
    const u = this.users.get(id);
    if (p.seat && u?.desk != null && p.seat === `mesa-${u.desk}`) return 'Na mesa';
    return areaAt(p.x, p.z)?.name ?? 'Escritório';
  }

  statusLine(id: string) {
    const p = this.presence.get(id);
    if (!p) return 'Offline';
    if (p.unstable) return 'Conexão instável';
    const s = this.displayStatus(id);
    if (s === 'visita') return 'Aguardando entrada';
    if (p.note && s !== 'reuniao') return p.note;
    return s === 'disp' ? this.areaName(id) : `${STATUS_LABEL[s]} · ${this.areaName(id)}`;
  }
}

/** Distância no chão de um ponto até a caixa de um objeto (zero se estiver dentro). */
function boxDist(b: THREE.Box3, x: number, z: number) {
  return Math.hypot(Math.max(b.min.x - x, 0, x - b.max.x), Math.max(b.min.z - z, 0, z - b.max.z));
}
