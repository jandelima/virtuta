import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { CAFE_SPOT, DOORS, GUEST_ENTRY, REUNIAO, SALA, areaAt, doorGeom, inside, type Door, type SpaceId } from '../../shared/layout';
import type { Announce, BoardElement, Conv, FocusSession, GameState, Note, Presence, PublicUser, RadioState, ServerMsg, Settings, StoredLook, Status as NetStatus } from '../../shared/protocol';
import { api } from './api';
import { Avatar } from './avatar';
import { Media } from './media';
import { Net, type NetState } from './net';
import { STATUS_LABEL, type Person, type Status } from './people';
import { icon } from './ui/icons';
import { Scene3D } from './scene';
import { renderPortraits } from './ui/portraits';
import { esc } from './ui/dom';
import { buildEscritorio, type World } from './world/escritorio';
import { mergeStatic } from './world/optimize';
import { animateHalloween, finishHalloween, huntPumpkin, setHalloween, setPlacar } from './world/halloween';
import { setCostumes } from './look';
import type { Hunt, Season } from '../../shared/season';
import { boardTex, gameTex, tvTex } from './world/live';
import { nameplateTex } from './world/props';
import type { Interactive, Seat, Space } from './world/space';
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
  /** Quadro aberto: reabre no servidor depois de uma reconexão (senão as edições se perdem). */
  boardReopen: (() => void) | null = null;
  /** Pedidos "Posso falar?" feitos e ainda sem resposta: para quem → quando. */
  pendingKnocks = new Map<string, number>();
  /** Avisos pedidos ("quando ficar livre", "quando chegar"): de quem → tipo. */
  watching = new Map<string, 'free' | 'arrive'>();
  announce: Announce | null = null;
  season: Season | null = null;
  hunt: Hunt = { pumpkin: null, scores: {} };
  private huntObj: THREE.Group | null = null;
  followUntil = 0;
  followId: string | null = null;
  /** Atravessando uma porta (tela escurecida): não anda nem atravessa de novo. */
  private crossing = false;
  /** Porta que a pessoa está indo atravessar e o que fazer do outro lado. */
  private pending: { door: string; then: () => void } | null = null;
  private fadeEl!: HTMLDivElement;

  constructor(readonly role: 'member' | 'admin' | 'guest') {
    this.sc = new Scene3D(document.getElementById('viewport')!);
    this.shell = new Shell(this);
    this.convView = new ConvView(this);
    this.panels = new Panels(this);
    this.notify = new Notifier(this);
    this.radioPlayer = new RadioPlayer(this);
    // troca de quem fala chega várias vezes por segundo: a conversa só redesenha o que mudou
    this.media.onChange = () => { this.convView.update(); this.shell.renderDock(); this.shell.renderConnection(); this.refreshCallLabels(); };
    this.net.onMessage = (m) => this.onMessage(m);
    this.net.onState = (s) => { this.netState = s; this.shell.renderConnection(); };
  }

  get guest() { return this.role === 'guest'; }
  get myAvatar() { return this.avatars.get(this.me); }
  get myPresence() { return this.presence.get(this.me); }
  /** Ambiente onde a pessoa está: é o único desenhado. */
  get here(): SpaceId {
    const p = this.myAvatar?.pos ?? this.myPresence;
    return (p && areaAt(p.x, p.z)?.id) || 'sala';
  }
  get space(): Space { return this.world.spaces[this.here]; }
  /** Assento pelo id, em qualquer ambiente (quem está em outro também senta). */
  seat(id: string | null) {
    if (!id) return null;
    for (const sp of Object.values(this.world.spaces)) { const s = sp.seats.get(id); if (s) return s; }
    return null;
  }
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
    let before = 0, after = 0;
    for (const sp of Object.values(this.world.spaces)) {
      const m = mergeStatic(sp.group);
      before += m.before; after += m.after;
      // quem vê um ambiente está dentro dele: as paredes de vidro ficam baixas, sem esconder ninguém
      for (const c of sp.cutaways) { c.upper.visible = false; c.cap.visible = true; }
    }
    // a decoração de época fica em grupos próprios (liga e desliga), juntados à parte
    finishHalloween((g) => mergeStatic(g));
    console.info(`Cenário: ${before} malhas juntadas em ${after}`);
    this.sc.setSpace(this.world.spaces.sala);
    this.setupInteractives();
    this.setupInput();
    this.fadeEl = document.createElement('div');
    this.fadeEl.className = 'scene-fade';
    document.getElementById('viewport')!.appendChild(this.fadeEl);
    this.sc.follow = () => {
      const f = this.followId && performance.now() < this.followUntil ? this.avatars.get(this.followId) : null;
      return (f?.root.visible ? f : this.myAvatar)?.pos ?? new THREE.Vector3(4, 0, 4);
    };
    this.sc.onFrame = (dt) => this.frame(dt);
    this.net.connect();
  }

  /** Mostra o ambiente onde a pessoa está e, nele, só quem está ali. */
  private syncSpace() {
    if (!this.world) return;
    if (this.sc.space !== this.space) {
      this.sc.setSpace(this.space);
      this.highlight.show(null);
      this.shell.renderAll();
    }
    const here = this.here;
    for (const a of this.avatars.values()) {
      const vis = areaAt(a.pos.x, a.pos.z)?.id === here;
      if (a.root.visible !== vis) a.setActive(vis);
    }
    for (const t of this.hubTags) t.visible = here === 'hub';
    if (this.huntObj) this.huntObj.visible = !!this.season && this.hunt.pumpkin?.space === here;
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
          this.avatars.get(id)?.follow(x, z, rot, this.seat(seat));
        }
        this.sc.wake(1500);
        return;
      case 'conv': return this.setConv(m.conv);
      case 'convs': this.convs = m.convs; this.refreshCallLabels(); this.shell.renderPeople(); return this.panels.refresh('pessoa');
      case 'react': return this.showReaction(m.from, m.emoji);
      case 'knock': return this.notify.knock(m.from, m.text);
      case 'knockReply':
        this.pendingKnocks.delete(m.from);
        this.refreshPersonPanel(m.from);
        return this.notify.toast(m.accept ? `${this.name(m.from)} aceitou. Vocês estão em conversa.` : m.later ? `${this.name(m.from)} não pode agora e vai chamar você quando terminar.` : `${this.name(m.from)} não pode falar agora.`, { who: m.from });
      case 'knockGone': return this.notify.dismiss(`knock-${m.from}`);
      case 'knockExpired': return this.knockExpired(m.to);
      case 'watchHit': return this.watchHit(m.target, m.kind);
      case 'watched': return this.notify.watched(m.by, m.kind, m.on);
      case 'remind': return this.notify.remind(m.who);
      case 'convAsk': return this.notify.convAsk(m.who);
      case 'convAskResolved': return this.notify.dismiss(`convask-${m.who}`);
      case 'announce': return this.setAnnounce(m.announce);
      case 'season': return this.setSeason(m.season);
      case 'hunt': return this.setHunt({ pumpkin: m.pumpkin, scores: m.scores }, m.by, m.spawned);
      case 'guestResolved': return this.notify.dismiss(`guest-${m.guest}`);
      case 'radioAddResult': return this.panels.radioAdded(m.ok, m.text);
      case 'door': return this.setDoor(m.open, m.by);
      case 'doorKnock': this.notify.doorKnock(m.who); return this.convView.render();
      case 'doorResolved': this.notify.doorResolved(m.who, m.accept, m.by); return this.convView.render();
      case 'doorReply':
        this.notify.dismiss('door-wait');
        if (m.expired) return this.notify.toast('Ninguém respondeu à batida na porta. Tente de novo ou deixe um bilhete para quem está na reunião.');
        if (m.accept) {
          this.doorAllowed = true;
          this.applyDoorNav();
          // quem bateu e ainda está no hub entra sozinho
          if (this.here === 'hub' && !this.crossing) { this.notify.toast('Sua entrada foi autorizada. Entrando na sala de reunião…', { log: false }); this.travel('reuniao'); }
          else this.notify.toast('Sua entrada na sala de reunião foi autorizada.');
        } else this.notify.toast('Agora não é possível entrar na sala de reunião.');
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
        this.shell.renderDock();
        this.refreshAllPeople();
        this.panels.refresh('foco');
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
    // reconexão: o servidor pode ter recriado a presença (reinício); o estado daqui é o que vale
    const before = this.started && this.myPresence ? { ...this.myPresence } : null;
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
    this.setSeason(m.season, true);
    this.hunt = m.hunt;
    for (const [id, els] of Object.entries(m.walls)) this.setWall(id, els);
    // reconexão: refaz os avatares a partir do estado atual do servidor
    const keep = new Set(m.presence.map((p) => p.id));
    for (const id of [...this.avatars.keys()]) if (!keep.has(id)) this.removePresence(id);
    for (const p of m.presence) this.upsertPresence(p, true);
    this.portraits = { ...this.portraits, ...renderPortraits([...this.users.values()].map((u) => this.person(u.id))) };
    if (before) this.restoreAfterReconnect(before);
    if (!this.started) {
      this.started = true;
      const me = this.myAvatar!;
      this.sc.zoom = 1.15;
      this.sc.start();
      if (me) this.lastSent = { x: me.pos.x, z: me.pos.z, rot: 0, seat: null, at: 0 };
      this.syncSpace();
      document.getElementById('loading')?.classList.add('done');
      // quem chega pela primeira vez monta o próprio avatar antes de tudo
      if (!this.guest && !this.users.get(this.me)?.look) this.shell.editAvatar(true);
      else if (!this.guest) setTimeout(() => this.shell.guide(), 1200);
      this.restoreStatusUntil();
    }
    this.refreshDesks();
    this.refreshGame();
    this.refreshTv();
    this.setHunt(this.hunt);
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
      look: u?.look ?? null,
      hand: !!p?.hand,
    };
  }

  /** Depois de reconectar: posição, status, mensagem e mão voltam a valer no servidor e para todos. */
  private restoreAfterReconnect(before: Presence) {
    const me = this.myAvatar, p = this.myPresence;
    if (!p) return;
    if (!this.guest && (p.status !== before.status || p.note !== before.note)) this.setStatus(before.status, before.note, this.statusUntil);
    if (p.hand !== before.hand) { p.hand = before.hand; this.send({ t: 'hand', up: before.hand }); }
    // força o envio da posição no próximo quadro
    if (me) { Object.assign(p, { x: me.pos.x, z: me.pos.z, seat: me.seat?.id ?? null }); this.lastSent = { x: NaN, z: NaN, rot: NaN, seat: '', at: 0 }; }
    this.boardReopen?.();
    this.radioPlayer.update();
  }

  /** Estado exibido: visitante aguardando, em reunião (dentro da sala), foco coletivo ou o escolhido. */
  displayStatus(id: string): Status {
    const p = this.presence.get(id);
    if (!p) return 'afk';
    if (p.waiting) return 'visita';
    // estar na sala de reunião vale mais que o foco coletivo: a pessoa está numa chamada
    if (p.status !== 'afk' && inside(REUNIAO, p.x, p.z)) return 'reuniao';
    const focusNow = this.focus?.participants.includes(id) && this.focusBlock()?.kind === 'foco';
    if (focusNow) return 'foco';
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

  async saveLook(look: StoredLook) {
    const user = await api.saveLook(look);
    this.upsertUser(user);
  }

  private upsertUser(u: PublicUser) {
    const prev = this.users.get(u.id);
    this.users.set(u.id, u);
    const a = this.avatars.get(u.id);
    a?.setPerson(this.person(u.id));
    // um nome novo pode criar (ou desfazer) um xará: os balões dos outros mudam junto
    if (prev?.name !== u.name) this.refreshAllPeople();
    Object.assign(this.portraits, renderPortraits([this.person(u.id)]));
    this.refreshDesks();
    this.shell.renderAll();
    this.convView.render();
  }

  private upsertPresence(p: Presence, fromInit = false) {
    const prev = this.presence.get(p.id);
    this.presence.set(p.id, p);
    // mão levantada por alguém da mesma conversa
    if (!fromInit && p.hand && prev && !prev.hand && p.id !== this.me && this.conv?.members.includes(p.id)) this.notify.toast(`${this.name(p.id)} levantou a mão`, { who: p.id, log: false });
    // visitante aguardando não aparece no mapa de quem está dentro
    const visible = !p.waiting || p.id === this.me;
    let a = this.avatars.get(p.id);
    if (visible && !a) {
      a = new Avatar(this.person(p.id));
      this.avatars.set(p.id, a);
      this.sc.scene.add(a.root);
      const seat = this.seat(p.seat);
      if (seat) a.sit(seat); else a.place(p.x, p.z, p.rot);
      a.setActive(areaAt(p.x, p.z)?.id === this.here);
    } else if (!visible && a) {
      this.removeAvatar(p.id);
      a = undefined;
    }
    if (a && p.id !== this.me && fromInit) a.follow(p.x, p.z, p.rot, this.seat(p.seat));
    a?.setPerson(this.person(p.id));

    if (a && this.season) { const top = Math.max(0, ...Object.values(this.hunt.scores)); a.setCrown(top > 0 && (this.hunt.scores[p.id] ?? 0) === top); }
    if (!fromInit) this.shell.renderPeople();
    if (p.id === this.me && !fromInit) { this.shell.renderMe(); this.shell.renderDock(); }
    if (!fromInit && prev?.hand !== p.hand) this.convView.render();
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
    for (const [id, a] of this.avatars) a.setPerson(this.person(id));
    this.shell.renderPeople();
    this.shell.renderMe();
  }

  // ---------- conversas ----------
  private setConv(c: Conv | null) {
    const before = this.conv;
    this.conv = c;
    this.media.setConv(c);
    this.refreshCallLabels();
    this.convView.render(before);
    this.shell.renderPeople();
    this.shell.renderDock();
    this.shell.renderConnection();
    // alguém chegou para conversar (quem chega andando já sabe; quem estava parado é avisado)
    if (c && c.kind === 'prox') {
      const fresh = c.members.filter((id) => id !== this.me && !before?.members.includes(id));
      if (fresh.length && performance.now() - this.lastWalk > 1500) this.notify.joinedConv(fresh);
    }
  }
  /** Quando a própria pessoa andou pela última vez (para saber quem chegou até quem). */
  private lastWalk = -1e9;

  refreshCallLabels() {
    const mine = new Set(this.conv?.members ?? []);
    const feeds = this.conv ? this.media.feeds(this.conv.members, this.me) : [];
    // cadeado sobre quem está numa conversa reservada
    const locked = new Set(this.convs.filter((c) => c.locked).flatMap((c) => c.members));
    for (const [id, a] of this.avatars) {
      const f = feeds.find((x) => x.id === id);
      a.inCall = mine.has(id);
      a.micOn = mine.has(id) ? !!f?.micOn : false;
      a.locked = locked.has(id);
      a.announcing = this.announce?.by === id;
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
      if (k === 'escape') { if (!this.shell.closePopups()) this.panels.close(); }
      if (e.key === '?') this.shell.openShortcuts();
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
      if (id === this.me || !a.root.visible) continue;
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
    if (this.pumpkinAt(cx - r.left, cy - r.top)) return this.takePumpkin();
    const other = this.personUnderMouse(cx - r.left, cy - r.top);
    if (other) return this.panels.openPerson(other);
    const obj = this.interactiveAt(cx - r.left, cy - r.top);
    if (obj) return this.use(obj.it, obj.point);
    const { ground } = this.sc.pick(cx, cy);
    if (ground && this.space.contains(ground.x, ground.z)) this.walkTo(ground.x, ground.z);
  }

  seatNear(x: number, z: number, max: number) {
    let best: Seat | null = null, bd = max;
    for (const s of this.space.seats.values()) {
      const d = Math.hypot(s.x - x, s.z - z);
      const taken = [...this.avatars.values()].some((a) => a.seat === s && a !== this.myAvatar);
      if (d < bd && !taken) { best = s; bd = d; }
    }
    return best;
  }

  /** Anda até (x, z); se o ponto for um assento livre, senta nele (a não ser com `sit` falso). */
  walkTo(x: number, z: number, then?: () => void, sit = true): boolean {
    const me = this.myAvatar;
    if (!me || this.crossing) return false;
    // em outro ambiente: primeiro as portas, depois o caminho até o ponto
    const target = areaAt(x, z)?.id;
    if (target && target !== this.here) return this.travel(target, () => { this.walkTo(x, z, then, sit); });
    this.pending = null;
    const best = sit ? this.seatNear(x, z, 0.45) : null;
    if (best && best === me.seat) return true;
    const ok = best ? me.goSit(this.space.nav, best, then) : me.goTo(this.space.nav, x, z, then);
    if (ok) this.sc.markClick(x, z);
    else this.notify.toast('Não há caminho até lá.');
    this.followId = null;
    return ok;
  }

  /** Vai até outro ambiente pelas portas (o hub liga os outros dois); `then` roda ao chegar. */
  travel(to: SpaceId, then?: () => void): boolean {
    if (this.crossing) return false;
    const here = this.here;
    if (to === here) { then?.(); return true; }
    if (this.guest && to === 'sala') { this.notify.toast('Visitantes não entram na sala da equipe.'); return false; }
    const next = here === 'hub' ? to : 'hub';
    const d = DOORS.find((x) => x.space === here && doorTarget(x).space === next)!;
    // reunião de porta fechada: quem está fora bate antes
    if (!this.canCross(d)) { this.panels.open('porta'); return false; }
    const g = doorGeom(d);
    const ok = this.walkTo(g.c.x + g.n.x * 0.15, g.c.z + g.n.z * 0.15, undefined, false);
    if (ok) this.pending = { door: d.id, then: () => { this.travel(to, then); } };
    return ok;
  }

  /** Vai para um ambiente pela lista de lugares: a sala da equipe leva à própria mesa. */
  goToArea(id: SpaceId) {
    if (id === 'sala' && !this.guest && this.users.get(this.me)?.desk != null) return this.goToDesk();
    if (id !== this.here) this.travel(id);
  }

  private canCross(d: Door) {
    const to = doorTarget(d).space;
    if (to === 'sala' && this.guest) return false;
    if (d.id === 'hub-reuniao') return this.doorOpen || this.doorAllowed;
    return true;
  }

  /** Quem anda até o vão de uma porta passa para o outro ambiente. */
  private checkDoors() {
    const me = this.myAvatar;
    if (!me || me.seat || this.crossing || this.myPresence?.waiting) return;
    const here = this.here;
    for (const d of DOORS) {
      if (d.space !== here) continue;
      const g = doorGeom(d);
      const dx = me.pos.x - g.c.x, dz = me.pos.z - g.c.z;
      const depth = dx * g.n.x + dz * g.n.z, along = Math.abs(g.vertical ? dz : dx);
      if (depth < 0.3 && along < g.width / 2 && this.canCross(d)) return this.cross(d);
    }
  }

  /** Atravessa: a tela escurece por um instante e a pessoa aparece do lado de dentro da outra porta. */
  private cross(d: Door) {
    const me = this.myAvatar!;
    const g = doorGeom(doorTarget(d));
    const then = this.pending?.door === d.id ? this.pending.then : undefined;
    this.pending = null;
    this.crossing = true;
    me.stop();
    this.fadeEl.classList.add('on');
    this.sc.wake(1200);
    // logo depois da porta; se alguém estiver parado ali, um pouco para o lado
    const nav = this.world.spaces[doorTarget(d).space].nav;
    const spots = [0, 0.7, -0.7, 1.4, -1.4].map((k) => ({ x: g.c.x + g.n.x * 0.9 + g.n.z * k, z: g.c.z + g.n.z * 0.9 + g.n.x * k }));
    const spot = spots.find((p) => nav.walkable(p.x, p.z) && ![...this.avatars.values()].some((a) => a !== me && Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < 0.6)) ?? spots[0];
    setTimeout(() => {
      me.place(spot.x, spot.z, g.rot);
      this.syncSpace();
      this.fadeEl.classList.remove('on');
      this.crossing = false;
      then?.();
    }, 170);
  }

  /** Senta no assento `id`, se estiver livre; senão, anda até perto dele. */
  sitOn(id: string) {
    const s = this.seat(id);
    if (!s) return;
    const taken = [...this.avatars.values()].some((a) => a.seat === s && a !== this.myAvatar);
    if (taken) this.walkTo(s.x, s.z, undefined, false);
    else this.walkTo(s.x, s.z);
  }

  /** Pausa no café do hub, sem ficar ausente: senta na primeira cadeira livre das mesinhas. */
  goPause() {
    const free = ['cafe-0-w', 'cafe-0-e', 'cafe-1-w', 'cafe-1-e'].find((id) => {
      const s = this.seat(id)!;
      return ![...this.avatars.values()].some((a) => a.seat === s && a !== this.myAvatar);
    });
    if (free) this.sitOn(free);
    else this.walkTo(CAFE_SPOT.x + 1.5, CAFE_SPOT.z + 0.9, undefined, false);
  }

  /** Senta na própria mesa. */
  goToDesk() {
    const u = this.users.get(this.me);
    const s = u?.desk != null ? this.seat(`mesa-${u.desk}`) : null;
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
    if (!this.myPresence?.waiting && !this.crossing && me.steer(mx, mz, dt, this.space.nav)) { this.followId = null; this.pending = null; this.sc.wake(1500); }
    for (const a of this.avatars.values()) a.update(dt);
    if (this.season) this.animateSeason(performance.now() / 1000);
    this.separate();
    this.checkDoors();
    if (this.mouseMoved) { this.mouseMoved = false; this.updateHover(); }
    if (me.moving) { this.sc.wake(1500); this.lastWalk = performance.now(); }

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
      this.syncSpace();
      this.updateLabels();
      // o que estava sob o mouse pode ter mudado (alguém sentou, a câmera andou)
      if (t - this.hoverAt > 400) this.updateHover();
      this.sc.drawConvs(this.convs.filter((c) => c.kind !== 'room').map((c) => c.members.map((id) => this.avatars.get(id)).filter((a): a is Avatar => !!a?.root.visible)));
    }
    if (t - this.slow > 1000) {
      this.slow = t;
      this.shell.everySecond();
      this.checkStatusExpiry();
      this.syncAnnounce();
      this.radioPlayer.update();
      this.refreshTv();
    }
  }
  private tick = 0;
  private hoverAt = 0;
  private slow = 0;

  /** Ninguém atravessa ninguém: quem está em pé é afastado de quem está perto. */
  private separate() {
    const list = [...this.avatars.values()].filter((a) => a.root.visible);
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
        if (this.space.nav.walkable(tx, tz)) { a.pos.x = tx; a.pos.z = tz; }
      }
    }
  }

  // ---------- objetos interativos ----------
  // Interage-se clicando no próprio objeto: ao passar o mouse ele ganha contorno e véu da cor
  // de destaque, e uma dica perto do cursor diz o que o clique faz.
  /** Rótulos fixos sobre os pontos do hub (placas em perspectiva não se leem no zoom padrão). */
  private hubTags: CSS2DObject[] = [];
  private doorTag: HTMLElement | null = null;
  private setupHubTags() {
    const hub = this.world.spaces.hub;
    const spots: [string, string, string][] = [['cafe', 'coffee', 'Café'], ['jogo', 'smile', 'Jogo da velha'], ['sugestoes', 'bulb', 'Caixa de sugestões'], ['door:hub-reuniao', 'screen', 'Sala de reunião'], ['door:hub-sala', 'users', 'Sala da equipe']];
    for (const [id, ic, label] of spots) {
      const it = hub.interactives.find((i) => i.id === id);
      if (!it) continue;
      const el = document.createElement('div');
      el.className = 'place-tag';
      el.innerHTML = `${icon(ic)}<b>${label}</b><small></small>`;
      const obj = new CSS2DObject(el);
      const c = it.box.getCenter(new THREE.Vector3());
      obj.position.set(c.x, it.box.max.y + 0.2, c.z);
      obj.center.set(0.5, 1);
      this.sc.scene.add(obj);
      this.hubTags.push(obj);
      if (id === 'door:hub-reuniao') this.doorTag = el;
    }
  }

  private setupInteractives() {
    this.setupHubTags();
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
    if (it.id === 'placar') return this.season === 'halloween';
    if (it.id === 'seat') {
      if (this.guest && it.seats.some((id) => { const s = this.seat(id)!; return inside(SALA, s.x, s.z); })) return false;
      return !!this.freeSeat(it);
    }
    if (this.guest) return ['board:reuniao', 'door:hub-reuniao', 'door:reuniao-hub', 'jogo'].includes(it.id);
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
      const s = this.seat(id)!;
      if ([...this.avatars.values()].some((a) => a.seat === s)) continue;
      const d = near ? Math.hypot(s.x - near.x, s.z - near.z) : 0;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  private describePerson(id: string) {
    const s = this.displayStatus(id);
    const conv = this.convs.find((c) => c.members.includes(id));
    const free = s === 'disp' && !conv;
    const hint = conv?.locked && !conv.members.includes(this.me) ? 'Conversa reservada · clique para pedir para entrar' : free ? 'Clique para conversar' : 'Clique para ver as opções';
    return { title: `${this.shortName(id)} · ${conv && s === 'disp' ? 'Em conversa' : STATUS_LABEL[s]}`, hint };
  }

  /** Título e ação mostrados na dica, conforme o estado atual. */
  private describe(it: Interactive) {
    const [kind, arg] = it.id.split(':');
    if (kind === 'seat') return { title: '', hint: 'Sentar' };
    if (kind === 'mesa') {
      const u = this.deskOwner(Number(arg))!;
      return u.id === this.me ? { title: 'Sua mesa', hint: 'Ver bilhetes' } : { title: `Mesa de ${u.name.split(' ')[0]}`, hint: 'Deixar um bilhete' };
    }
    if (it.id === 'door:reuniao-hub') return { title: it.title, hint: this.doorOpen ? 'Fechar a porta ou sair' : 'Abrir a porta ou sair' };
    if (it.id === 'door:hub-reuniao') return { title: it.title, hint: this.doorOpen || this.doorAllowed ? 'Entrar' : 'Porta fechada: bater' };
    return { title: it.title, hint: it.hint };
  }

  /** Objeto sob o ponto da tela (em pixels do canvas), o mais próximo da câmera. */
  interactiveAt(px: number, py: number) {
    const el = this.sc.renderer.domElement;
    this.ray.setFromCamera(new THREE.Vector2((px / el.clientWidth) * 2 - 1, -(py / el.clientHeight) * 2 + 1), this.sc.camera);
    let best: { it: Interactive; point: THREE.Vector3 } | null = null, bd = Infinity;
    for (const it of this.space.interactives) {
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
    const onPumpkin = !blocked && this.pumpkinAt(this.mouse.x, this.mouse.y);
    this.sc.renderer.domElement.style.cursor = person || hov || onPumpkin ? 'pointer' : '';
    const tip = this.hoverTip;
    // sobre um colega, a mesma dica dos objetos: quem é, como está e o que o clique faz
    const pd = onPumpkin ? { title: 'Abóbora! 🎃', hint: 'Clique para pegar antes dos outros' } : person ? this.describePerson(person) : null;
    if (hov || pd) {
      const d = pd ?? this.describe(hov!.it);
      tip.innerHTML = d.title ? `<b>${esc(d.title)}</b><span>${esc(d.hint)}</span>` : `<span>${esc(d.hint)}</span>`;
      tip.hidden = false;
      // perto da borda direita ou de baixo, a dica abre para o outro lado
      const vw = this.sc.renderer.domElement.clientWidth, vh = this.sc.renderer.domElement.clientHeight;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      const x = this.mouse.x + 16 + tw > vw - 8 ? this.mouse.x - 12 - tw : this.mouse.x + 16;
      const y = this.mouse.y + 18 + th > vh - 8 ? this.mouse.y - 12 - th : this.mouse.y + 18;
      tip.style.transform = `translate(${Math.round(Math.max(4, x))}px, ${Math.round(Math.max(4, y))}px)`;
    } else tip.hidden = true;
  }
  private highlightSoft = false;

  /** Objeto mais perto de quem está andando, para a tecla E (cadeiras e mesas ficam de fora). */
  private nearestInteractive() {
    const me = this.myAvatar;
    if (!me || me.seat) return null;
    let best: Interactive | null = null, bd = 0.9;
    for (const it of this.space.interactives) {
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
    // portas levam a pessoa até elas sozinhas
    if (it.id.startsWith('door:')) return this.act(it);
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
    const nav = this.space.nav, me = this.myAvatar!;
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
    if (kind === 'placar') return this.panels.open('placar');
    if (kind === 'mesa') return this.panels.openDesk(Number(arg));
    if (kind === 'door') {
      // dentro da reunião, a porta abre o painel (fechar, abrir ou sair); de fora, quem não pode entrar bate
      if (arg === 'reuniao-hub' || (arg === 'hub-reuniao' && !this.doorOpen && !this.doorAllowed)) return this.panels.open('porta');
      return void this.travel(doorTarget(DOORS.find((d) => d.id === arg)!).space);
    }
    this.panels.open(kind);
  }

  private updateLabels() {
    const me = this.myAvatar;
    const showAll = this.keys.has('alt') || this.sc.camera.zoom > 2.0;
    const hovered = this.personUnderMouse(this.mouse.x, this.mouse.y);
    const mine = new Set(this.conv?.members ?? []);
    for (const [id, a] of this.avatars) {
      if (!a.root.visible) continue;
      // quem está sentado mostra o nome (dá para ver quem está em cada mesa); quem anda longe vira só a bolinha
      const near = me ? Math.hypot(a.pos.x - me.pos.x, a.pos.z - me.pos.z) < 6 : false;
      a.setCompact(!(showAll || near || a.seat || mine.has(id) || id === hovered));
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
  setStatus(status: NetStatus, note = '', until = 0) {
    this.send({ t: 'status', status, note });
    this.statusUntil = note ? until : 0;
    try { localStorage.setItem('virtuta.statusUntil', JSON.stringify({ note, until: this.statusUntil })); } catch { /* vale só nesta sessão */ }
    const p = this.myPresence;
    if (p) { p.status = status; p.note = note; }
    this.refreshAllPeople();
    this.shell.renderDock();
  }

  /** Mensagem de status com prazo: ao vencer, volta a disponível (ou só apaga a mensagem). */
  statusUntil = 0;
  checkStatusExpiry() {
    const p = this.myPresence;
    if (!this.statusUntil || !p || Date.now() < this.statusUntil) return;
    this.statusUntil = 0;
    if (p.status === 'afk') this.setStatus('disp');
    else this.setStatus(p.status, '');
  }
  /** Retoma o prazo da mensagem depois de recarregar a página. */
  private restoreStatusUntil() {
    try {
      const s = JSON.parse(localStorage.getItem('virtuta.statusUntil') ?? '{}') as { note?: string; until?: number };
      if (s.until && s.note && s.note === this.myPresence?.note) this.statusUntil = s.until;
    } catch { /* sem prazo salvo */ }
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

  /** Foco só da pessoa (status). Dentro da sessão coletiva, o botão só mostra a sessão: sai-se pelo topo. */
  toggleFocus() {
    const p = this.myPresence;
    if (!p) return;
    if (this.focus?.participants.includes(this.me)) return this.panels.open('foco');
    if (p.status === 'foco') this.setStatus('disp');
    else this.setStatus('foco', 'Em foco');
  }

  focusJoin() { this.send({ t: 'focusJoin' }); }
  focusLeave() { this.notify.leaving = 'leave'; this.send({ t: 'focusLeave' }); }
  focusEnd() { this.notify.leaving = 'end'; this.send({ t: 'focusEnd' }); }

  raiseHand() {
    const up = !this.myPresence?.hand;
    const p = this.myPresence;
    if (p) p.hand = up;
    this.send({ t: 'hand', up });
    this.refreshAllPeople();
    this.shell.renderDock();
    this.convView.render();
  }

  /** Levanta da cadeira (ex.: ao sair da mesa de jogo). */
  standUp() {
    const me = this.myAvatar;
    if (me?.seat) me.leaveSeat(this.space.nav);
  }

  // sem conexão de mídia, o aviso fixo de conexão já explica e oferece "Tentar de novo";
  // fora de conversa não há com quem falar: microfone e câmera ligam dentro de uma
  async toggleMic() {
    if (!this.conv) return this.notify.toast('O microfone liga dentro de uma conversa. Chegue perto de alguém ou entre na sala de reunião.', { log: false, ic: 'micOff', key: 'nomedia' });
    try { await this.media.setMic(!this.media.mic); } catch (e) { if (this.media.state !== 'failed') this.notify.mediaError(e, 'microfone'); }
  }
  async toggleCam() {
    if (!this.conv) return this.notify.toast('A câmera liga dentro de uma conversa. Chegue perto de alguém ou entre na sala de reunião.', { log: false, ic: 'camOff', key: 'nomedia' });
    try { await this.media.setCam(!this.media.cam); } catch (e) { if (this.media.state !== 'failed') this.notify.mediaError(e, 'câmera'); }
  }

  // ---------- pedidos, avisos de disponibilidade e conversa reservada ----------
  knock(to: string, text: string) {
    this.send({ t: 'knock', to, text });
    this.pendingKnocks.set(to, Date.now());
    this.shell.renderPeople();
  }
  cancelKnock(to: string) {
    this.send({ t: 'knockCancel', to });
    this.pendingKnocks.delete(to);
    this.shell.renderPeople();
    this.refreshPersonPanel(to);
  }
  private knockExpired(to: string) {
    this.pendingKnocks.delete(to);
    this.shell.renderPeople();
    this.refreshPersonPanel(to);
    this.notify.toast(`${this.name(to)} não respondeu ao pedido para falar.`, { who: to, actions: [{ label: 'Deixar um bilhete', primary: true, run: () => this.panels.openPerson(to, 'note') }, { label: 'Fechar', run: () => {} }] });
  }
  watch(target: string, kind: 'free' | 'arrive', on: boolean) {
    this.send({ t: 'watch', target, kind, on });
    if (on) this.watching.set(target, kind); else this.watching.delete(target);
    this.refreshPersonPanel(target);
  }
  private watchHit(target: string, kind: 'free' | 'arrive') {
    this.watching.delete(target);
    this.refreshPersonPanel(target);
    this.notify.watchHit(target, kind);
  }
  refreshPersonPanel(id: string) {
    if (this.panels.showing('pessoa', id)) this.panels.refresh('pessoa');
  }
  lockConv(locked: boolean) { this.send({ t: 'convLock', locked }); }

  // ---------- tema de época e caça às abóboras ----------
  /** Liga ou desliga o tema: decoração, luz, fantasias dos avatares, interface. */
  private setSeason(s: Season | null, quiet = false) {
    const changed = s !== this.season;
    this.season = s;
    const hw = s === 'halloween';
    setCostumes(hw);
    setHalloween(hw);
    this.sc.season = s;
    if (this.world) this.sc.applyTheme(this.sc.theme);
    if (changed) {
      for (const a of this.avatars.values()) a.remount();
      if (this.world) this.sc.refreshShadows();
    }
    this.shell.renderSeason();
    if (changed && !quiet && hw) this.notify.toast('Começou o Halloween no escritório! 🎃 Fique de olho nas abóboras.', { log: false, ic: 'smile' });
    if (!hw) this.setHunt({ pumpkin: null, scores: {} });
  }

  /** Ranking da caça: nome curto e pontos, do maior para o menor. */
  huntRanking(): [string, number, string][] {
    return Object.entries(this.hunt.scores).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || this.name(a[0]).localeCompare(this.name(b[0]))).map(([id, n]) => [this.shortName(id), n, id]);
  }

  private setHunt(h: Hunt, by?: string, spawned?: boolean) {
    this.hunt = h;
    if (!this.world) return;
    const pk = this.season ? h.pumpkin : null;
    if (pk && !this.huntObj) { this.huntObj = huntPumpkin(); this.sc.scene.add(this.huntObj); }
    if (this.huntObj) {
      this.huntObj.visible = !!pk && pk.space === this.here;
      if (pk) this.huntObj.position.set(pk.x, 0, pk.z);
    }
    setPlacar(this.huntRanking().map(([n, k]) => [n, k]));
    // coroinha para quem lidera (empates dividem a coroa)
    const top = Math.max(0, ...Object.values(h.scores));
    for (const [id, a] of this.avatars) a.setCrown(top > 0 && (h.scores[id] ?? 0) === top);
    this.panels.refresh('placar');
    this.sc.wake();
    if (!this.season || this.guest) return;
    const where = (sp: string) => (sp === 'sala' ? 'na sala da equipe' : 'no hub');
    // quem está numa reunião não é distraído com a caça
    if (spawned && pk && this.here !== 'reuniao') this.notify.toast(`🎃 Uma abóbora apareceu ${where(pk.space)}! Quem clicar nela primeiro leva o ponto.`, { key: 'pumpkin', ttl: 12000, quiet: true, important: true, log: false, ic: 'smile' });
    if (by) {
      this.notify.dismiss('pumpkin');
      const n = h.scores[by] ?? 0;
      this.notify.toast(by === this.me ? `Você pegou a abóbora! Agora você tem ${n} 🎃` : `${this.shortName(by)} pegou a abóbora (${n} no total)`, { who: by, ttl: 5000, log: false });
    }
    if (!pk) this.notify.dismiss('pumpkin');
  }

  /** A abóbora da caça está sob este ponto da tela (em pixels do canvas)? */
  private pumpkinAt(px: number, py: number) {
    const o = this.huntObj;
    if (!o?.visible) return false;
    const s = this.sc.toScreen(o.position.clone().setY(0.25));
    return Math.hypot(s.x - px, s.y - py) < 34 * Math.max(0.8, this.sc.camera.zoom);
  }

  private takePumpkin() {
    const pk = this.hunt.pumpkin;
    if (!pk) return;
    if (this.guest) return this.notify.toast('A caça às abóboras é da equipe.', { log: false });
    this.send({ t: 'pumpkinTake', id: pk.id });
  }

  private animateSeason(t: number) {
    animateHalloween(this.space, t);
    const o = this.huntObj;
    if (o?.visible) {
      (o.userData.bob as THREE.Object3D).position.y = 0.05 + Math.abs(Math.sin(t * 2.2)) * 0.12;
      (o.userData.bob as THREE.Object3D).rotation.y = Math.PI / 4 + Math.sin(t * 1.3) * 0.3;
      const ring = o.userData.ring as THREE.Mesh;
      ring.scale.setScalar(1 + (Math.sin(t * 3) + 1) * 0.12);
    }
  }

  // ---------- anúncio para a sala ----------
  private setAnnounce(a: Announce | null) {
    this.announce = a;
    this.refreshCallLabels();
    this.syncAnnounce();
    this.shell.renderDock();
    this.shell.renderAnnounce();
    this.refreshAllPeople();
  }
  /** Entra ou sai da sala do anúncio conforme o ambiente e o estado da pessoa (roda a cada segundo). */
  syncAnnounce() {
    const a = this.announce, p = this.myPresence;
    const st = this.displayStatus(this.me);
    const speaker = !!a && a.by === this.me;
    const hears = !!a && !!p && areaAt(p.x, p.z)?.id === a.space && (speaker || (st !== 'foco' && st !== 'afk' && this.conv?.kind !== 'room' && this.conv?.kind !== 'direct'));
    // uma tentativa por anúncio: se a mídia falhar, não insiste a cada segundo
    if (hears && !this.media.announcing && this.annTried !== a!.until) {
      this.annTried = a!.until;
      this.media.joinAnnounce(speaker).catch((e) => {
        if (speaker) { this.send({ t: 'announceStop' }); this.notify.mediaError(e, 'microfone'); }
      });
    } else if (!hears && this.media.announcing) this.media.leaveAnnounce();
  }
  private annTried = 0;
  toggleAnnounce() {
    if (this.announce?.by === this.me) return this.send({ t: 'announceStop' });
    if (this.announce) return this.notify.toast(`${this.name(this.announce.by)} já está falando para ${this.announce.space === 'sala' ? 'a sala' : 'o hub'}.`, { log: false });
    this.send({ t: 'announceStart' });
  }
  async toggleScreen() {
    if (!this.conv && !this.media.screen) return this.notify.toast('Entre numa conversa para apresentar a tela.', { log: false });
    try { await this.media.setScreen(!this.media.screen); } catch (e) { if ((e as Error).name !== 'NotAllowedError' && this.media.state !== 'failed') this.notify.mediaError(e, 'tela'); }
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
    me?.place(GUEST_ENTRY.x, GUEST_ENTRY.z, Math.PI);
    this.syncSpace();
    this.notify.toast('Você foi admitido. A sala de reunião fica pela porta do fundo do hub.');
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
    this.world.meetingLight.color.set(open ? '#22c55e' : '#ef4444');
    this.world.meetingLight.emissive.set(open ? '#22c55e' : '#ef4444');
    this.applyDoorNav();
    this.sc.refreshShadows();
    if (!quiet && by && by !== this.me && wasOpen !== open) this.notify.toast(`${this.name(by)} ${open ? 'abriu' : 'fechou'} a porta da sala de reunião.`);
    this.panels.refresh('porta');
    this.convView.render();
  }

  /** Porta fechada vira parede para quem está fora e não foi autorizado; quem está dentro sempre sai. */
  applyDoorNav() {
    const pass = this.doorOpen || this.doorAllowed;
    gate(this.world.spaces.hub, 'hub-reuniao', pass);
    gate(this.world.spaces.reuniao, 'reuniao-hub', pass || this.here === 'reuniao');
    // visitantes não passam pela porta da sala da equipe
    if (this.guest) gate(this.world.spaces.hub, 'hub-sala', false);
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
    // o rótulo da porta, no hub, diz o mesmo e herda a cor da luz
    if (this.doorTag) {
      this.doorTag.classList.toggle('shut', !this.doorOpen);
      this.doorTag.querySelector('small')!.textContent = n ? `${n} dentro · ${this.doorOpen ? 'porta aberta' : 'porta fechada'}` : this.doorOpen ? 'livre' : 'porta fechada';
    }
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
    if (s === 'reuniao') return STATUS_LABEL.reuniao;
    const c = this.convs.find((x) => x.kind !== 'room' && x.members.includes(id));
    const others = c ? c.members.filter((m) => m !== id) : [];
    const talk = others.length ? `em conversa com ${others.length > 2 ? `${others.length} pessoas` : others.map((m) => (m === this.me ? 'você' : this.shortName(m))).join(' e ')}` : '';
    const base = s === 'disp' ? this.areaName(id) : `${STATUS_LABEL[s]} · ${this.areaName(id)}`;
    return talk ? `${base} · ${talk}` : base;
  }
}

/** Distância no chão de um ponto até a caixa de um objeto (zero se estiver dentro). */
function boxDist(b: THREE.Box3, x: number, z: number) {
  return Math.hypot(Math.max(b.min.x - x, 0, x - b.max.x), Math.max(b.min.z - z, 0, z - b.max.z));
}

/** Porta do outro lado de `d`. */
function doorTarget(d: Door) {
  return DOORS.find((x) => x.id === d.to)!;
}

/** Abre ou fecha a passagem pelo vão da porta `id` na navegação do ambiente. */
function gate(sp: Space, id: string, open: boolean) {
  const g = doorGeom(DOORS.find((d) => d.id === id)!);
  const half = g.width / 2;
  const [x1, z1, x2, z2] = g.vertical ? [g.c.x - 0.3, g.c.z - half, g.c.x + 0.3, g.c.z + half] : [g.c.x - half, g.c.z - 0.3, g.c.x + half, g.c.z + 0.3];
  if (open) sp.nav.open(x1 + (g.vertical ? 0 : 0.05), z1 + (g.vertical ? 0.05 : 0), x2 - (g.vertical ? 0 : 0.05), z2 - (g.vertical ? 0.05 : 0));
  else sp.nav.block(x1, z1, x2, z2);
}
