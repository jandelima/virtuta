import type { WebSocket } from 'ws';
import { DESKS, ENTRY, PROX, REUNIAO, SALA, areaAt, inside } from '../../shared/layout';
import type { BoardElement, ClientMsg, Conv, FocusBlock, FocusSession, GameState, Presence, PublicUser, RadioItem, RadioState, ServerMsg, Status } from '../../shared/protocol';
import { boards, guests, invites, notes, settings, users } from './db';
import { publicGuest, publicUser, randomId, type Who } from './auth';
import { config } from './config';

// Estado vivo do escritório. O servidor é a referência para presença e para quem conversa
// com quem; o cliente só decide a própria posição.

interface Person {
  user: PublicUser;
  presence: Presence;
  ws: WebSocket | null;
  dropTimer?: NodeJS.Timeout;
  guestHost?: string;
}

interface LiveConv extends Conv { since: number }

const DROP_GRACE_MS = 25_000;
const WALL_BOARDS = ['sala', 'reuniao'];
const send = (ws: WebSocket | null, m: ServerMsg) => {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
};
const finite = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const dist = (a: Presence, b: Presence) => Math.hypot(a.x - b.x, a.z - b.z);
const acoustic = (p: Presence) => areaAt(p.x, p.z)?.acoustic ?? 'salao';
const emptyGame = (): GameState => ({ id: randomId(4), board: Array(9).fill(''), players: [null, null], turn: 0, winner: null, draw: false });

export class Office {
  readonly people = new Map<string, Person>();
  private dirty = new Set<string>();
  private convs = new Map<string, LiveConv>();
  private convOf = new Map<string, string>();
  private lastSentConv = new Map<string, string>();
  private lastConvsKey = '';
  private dwell = new Map<string, number>();
  private apart = new Map<string, number>();
  private cooldown = new Map<string, Set<string>>();
  private doorOpen = true;
  private doorAllowed = new Set<string>();
  private radio: RadioState = { queue: [], current: null, startedAt: 0, listeners: [] };
  private radioSeq = 1;
  private focus: FocusSession | null = null;
  private focusBlock = -1;
  private game: GameState = emptyGame();
  private editors = new Map<string, Set<string>>();
  private docs = new Map<string, { elements: Map<string, BoardElement>; timer?: NodeJS.Timeout; by: string }>();

  constructor() {
    const saved = settings.get('radio');
    if (saved) {
      const r = JSON.parse(saved) as { queue: RadioItem[]; seq: number };
      this.radio.queue = r.queue.filter((q) => q?.videoId).map((q) => ({ ...q, title: q.title || 'Vídeo do YouTube', addedBy: q.addedBy || '' }));
      this.radioSeq = r.seq;
    }
    setInterval(() => this.flushMoves(), 100);
    setInterval(() => this.proximity(0.2), 200);
    setInterval(() => this.focusTick(), 1000);
  }

  // ---------- conexão ----------
  connect(ws: WebSocket, who: Who) {
    const existing = this.people.get(who.id);
    if (existing?.ws) {
      // a mesma pessoa abriu outra aba: a nova assume, a antiga avisa e para
      send(existing.ws, { t: 'replaced' });
      existing.ws.close(4001, 'replaced');
    }
    let p = existing;
    if (p) {
      clearTimeout(p.dropTimer);
      p.ws = ws;
      p.presence.unstable = false;
      this.broadcast({ t: 'presence', presence: p.presence });
    } else {
      const user = this.userFor(who);
      if (!user) { ws.close(4003, 'forbidden'); return; }
      // integrantes chegam sentados na própria mesa; visitantes, na recepção
      const desk = DESKS.find((d) => d.index === user.desk);
      const start = who.guest ? { x: ENTRY.x + 0.6, z: ENTRY.z - 0.4 } : desk ? { x: desk.x, z: desk.z + (desk.side === 'n' ? -0.72 : 0.72) } : ENTRY;
      const seat = !who.guest && desk ? `mesa-${desk.index}` : null;
      p = {
        user,
        ws,
        presence: { id: who.id, status: who.guest ? 'visita' : 'disp', note: '', x: start.x, z: start.z, rot: 0, seat, unstable: false, waiting: who.guest },
      };
      if (who.guest) p.guestHost = invites.get(guests.get(who.id)!.invite)?.created_by;
      this.people.set(who.id, p);
      this.broadcast({ t: 'user', user }, who.id);
      this.broadcast({ t: 'join', presence: p.presence }, who.id);
      if (who.guest) this.announceGuest(p);
    }
    send(ws, this.initFor(p));
    ws.on('message', (raw) => {
      try { this.handle(p!, JSON.parse(String(raw)) as ClientMsg); } catch (e) { console.warn('mensagem inválida', e); }
    });
    ws.on('close', (code) => this.disconnected(p!, ws, code));
  }

  private userFor(who: Who): PublicUser | null {
    if (who.guest) {
      const g = guests.get(who.id);
      return g ? publicGuest(g.id, g.name) : null;
    }
    const u = users.get(who.id);
    return u && u.active ? publicUser(u) : null;
  }

  private disconnected(p: Person, ws: WebSocket, code: number) {
    if (p.ws !== ws) return; // já substituída por outra aba
    p.ws = null;
    if (code === 4000) return this.remove(p.presence.id); // saiu pelo botão
    // queda de conexão: mantém o avatar marcado como instável por um tempo
    p.presence.unstable = true;
    this.broadcast({ t: 'presence', presence: p.presence });
    p.dropTimer = setTimeout(() => this.remove(p.presence.id), DROP_GRACE_MS);
  }

  private remove(id: string) {
    const p = this.people.get(id);
    if (!p) return;
    clearTimeout(p.dropTimer);
    this.people.delete(id);
    this.leaveConv(id);
    this.doorAllowed.delete(id);
    this.radio.listeners = this.radio.listeners.filter((x) => x !== id);
    if (this.focus) this.focus.participants = this.focus.participants.filter((x) => x !== id);
    for (const [bid, set] of this.editors) if (set.delete(id)) this.broadcastEditors(bid);
    if (this.game.players.includes(id)) this.gameLeave(id);
    this.broadcast({ t: 'leave', id });
    this.broadcastRadio();
  }

  /** Mudanças vindas da administração (nome, papel, mesa, desativação). */
  userChanged(id: string) {
    const p = this.people.get(id);
    const row = users.get(id);
    if (!p || !row) return;
    if (!row.active) {
      send(p.ws, { t: 'toast', text: 'Seu acesso foi removido pela administração.' });
      p.ws?.close(4003, 'forbidden');
      return this.remove(id);
    }
    p.user = publicUser(row);
    this.broadcast({ t: 'user', user: p.user });
  }

  private initFor(p: Person): ServerMsg {
    const member = p.user.role !== 'guest';
    const list = [...this.people.values()];
    return {
      t: 'init',
      you: p.presence.id,
      users: list.map((x) => x.user).concat(member ? users.all().filter((u) => u.active && !this.people.has(u.id)).map(publicUser) : []),
      presence: list.map((x) => x.presence),
      doorOpen: this.doorOpen,
      radio: this.radio,
      focus: this.focus,
      notes: member ? notes.forUser(p.presence.id, (id) => this.nameOf(id)) : [],
      noteCounts: notes.unreadCounts(),
      game: this.game,
      settings: { officeName: settings.get('officeName') ?? config.officeName },
      walls: Object.fromEntries(WALL_BOARDS.filter((b) => member || b === 'reuniao').map((b) => [b, this.boardElements(b)])),
      serverTime: Date.now(),
    };
  }

  nameOf(id: string) {
    return this.people.get(id)?.user.name ?? users.get(id)?.name ?? guests.get(id)?.name ?? 'Alguém';
  }

  broadcast(m: ServerMsg, except?: string, filter?: (p: Person) => boolean) {
    const s = JSON.stringify(m);
    for (const p of this.people.values()) {
      if (p.presence.id === except || !p.ws || p.ws.readyState !== p.ws.OPEN) continue;
      if (filter && !filter(p)) continue;
      p.ws.send(s);
    }
  }
  /** Aviso para a administração online (ex.: sugestão nova na caixa). */
  toastAdmins(text: string, except?: string) {
    this.broadcast({ t: 'toast', text }, except, (p) => p.user.role === 'admin');
  }
  private to(id: string, m: ServerMsg) { send(this.people.get(id)?.ws ?? null, m); }
  private members = (p: Person) => p.user.role !== 'guest';

  // ---------- mensagens ----------
  private handle(p: Person, m: ClientMsg) {
    const id = p.presence.id;
    const member = p.user.role !== 'guest';
    if (p.presence.waiting && m.t !== 'ping') return; // visitante só age depois de admitido
    switch (m.t) {
      case 'ping': return send(p.ws, { t: 'pong', serverTime: Date.now() });
      case 'move': {
        if (!finite(m.x, -1, 30) || !finite(m.z, -1, 20) || !finite(m.rot, -10, 10)) return;
        // visitantes não entram na sala da equipe
        if (!member && inside(SALA, m.x, m.z)) return;
        Object.assign(p.presence, { x: m.x, z: m.z, rot: m.rot, seat: typeof m.seat === 'string' ? m.seat.slice(0, 32) : null });
        this.dirty.add(id);
        // a rádio só toca dentro da sala da equipe
        if (this.radio.listeners.includes(id) && !inside(SALA, m.x, m.z)) {
          this.radio.listeners = this.radio.listeners.filter((x) => x !== id);
          this.broadcastRadio();
        }
        return;
      }
      case 'status': {
        if (!member || !['disp', 'foco', 'afk'].includes(m.status)) return;
        p.presence.status = m.status;
        p.presence.note = clean(m.note, 80);
        if (m.status !== 'disp') this.leaveConv(id, true);
        return this.broadcast({ t: 'presence', presence: p.presence });
      }
      case 'look': {
        if (!member || !m.look || typeof m.look !== 'object') return;
        users.update(id, { look: m.look });
        p.user = publicUser(users.get(id)!);
        return this.broadcast({ t: 'user', user: p.user });
      }
      case 'react': return this.broadcast({ t: 'react', from: id, emoji: clean(m.emoji, 8) });
      case 'leaveConv': return this.leaveConv(id, true);
      case 'knock': {
        const target = this.people.get(m.to);
        if (!target || target === p) return;
        return this.to(m.to, { t: 'knock', from: id, text: clean(m.text, 120) });
      }
      case 'knockReply': {
        this.to(m.to, { t: 'knockReply', from: id, accept: !!m.accept });
        if (m.accept && this.people.has(m.to)) this.directConv(id, m.to);
        return;
      }
      case 'door': {
        if (!this.inRoom(p)) return;
        this.doorOpen = !!m.open;
        this.doorAllowed = new Set(this.doorOpen ? [] : [...this.people.values()].filter((x) => this.inRoom(x)).map((x) => x.presence.id));
        return this.broadcast({ t: 'door', open: this.doorOpen, by: id });
      }
      case 'doorKnock': {
        for (const x of this.people.values()) if (this.inRoom(x)) send(x.ws, { t: 'doorKnock', who: id });
        return;
      }
      case 'doorReply': {
        if (!this.inRoom(p)) return;
        if (m.accept) this.doorAllowed.add(m.who);
        return this.to(m.who, { t: 'doorReply', accept: !!m.accept });
      }
      case 'note': {
        const text = clean(m.text, 600);
        if (!member || !text || !users.get(m.to)) return;
        const note = notes.add(id, m.to, text, p.user.name);
        this.to(m.to, { t: 'note', note });
        return this.broadcast({ t: 'noteCounts', counts: notes.unreadCounts() }, undefined, this.members);
      }
      case 'noteRead': {
        notes.markRead(m.id, id);
        return this.broadcast({ t: 'noteCounts', counts: notes.unreadCounts() }, undefined, this.members);
      }
      case 'boardOpen': return this.boardOpen(p, m.id);
      case 'boardClose': {
        if (this.editors.get(m.id)?.delete(id)) this.broadcastEditors(m.id);
        return;
      }
      case 'boardOp': return this.boardOp(p, m.id, m.put, m.del);
      case 'boardCursor': {
        if (!finite(m.x, -1e5, 1e5) || !finite(m.y, -1e5, 1e5)) return;
        for (const e of this.editors.get(m.id) ?? []) if (e !== id) this.to(e, { t: 'boardCursor', id: m.id, by: id, x: m.x, y: m.y });
        return;
      }
      case 'boardCopy': {
        const doc = this.docs.get(m.id);
        if (!this.canBoard(p, m.id)) return;
        const name = clean(m.name, 60) || `Cópia de ${new Date().toLocaleString('pt-BR')}`;
        boards.copy(m.id, name, doc ? [...doc.elements.values()] : boards.get(m.id)?.elements ?? [], p.user.name);
        for (const e of this.editors.get(m.id) ?? []) this.to(e, { t: 'boardCopies', id: m.id, copies: boards.copies(m.id) });
        return;
      }
      case 'boardRestore': {
        // recuperar uma cópia abre um quadro novo, sem sobrescrever o trabalho em andamento
        const c = boards.getCopy(m.copyId);
        const src = c && boards.get(c.board_id);
        if (!c || !src || !this.canBoard(p, src.id)) return;
        const nid = `${src.id}-r${randomId(4)}`;
        boards.create(nid, `${src.title} · ${c.name}`, src.scope, JSON.parse(c.elements), p.user.name);
        this.broadcast({ t: 'boards', boards: boards.list() }, undefined, this.members);
        return this.boardOpen(p, nid);
      }
      case 'radioJoin': {
        if (!member || !inside(SALA, p.presence.x, p.presence.z)) return;
        if (!this.radio.listeners.includes(id)) this.radio.listeners.push(id);
        if (!this.radio.current) this.radioAdvance();
        return this.broadcastRadio();
      }
      case 'radioLeave': {
        this.radio.listeners = this.radio.listeners.filter((x) => x !== id);
        return this.broadcastRadio();
      }
      case 'radioAdd': return void this.radioAdd(p, m.url);
      case 'radioSkip':
      case 'radioEnded':
        if (this.radio.current?.id === m.itemId) this.radioAdvance();
        return;
      case 'radioError':
        if (this.radio.current?.id === m.itemId) {
          const title = this.radio.current.title;
          this.radioAdvance();
          for (const l of this.radio.listeners) this.to(l, { t: 'toast', text: `“${title}” está indisponível. A rádio seguiu para o próximo.` });
        }
        return;
      case 'focusStart': return this.focusStart(p, m.blocks);
      case 'focusJoin': {
        if (!this.focus || !member || this.focus.participants.includes(id)) return;
        this.focus.participants.push(id);
        this.leaveConv(id, true);
        return this.broadcastFocus();
      }
      case 'focusLeave': {
        if (!this.focus) return;
        this.focus.participants = this.focus.participants.filter((x) => x !== id);
        if (!this.focus.participants.length) this.focus = null;
        return this.broadcastFocus();
      }
      case 'gameJoin': {
        if (this.game.players.includes(id)) return;
        const slot = this.game.players.indexOf(null);
        if (slot < 0) return;
        this.game.players[slot] = id;
        return this.broadcast({ t: 'game', game: this.game });
      }
      case 'gameMove': return this.gameMove(id, m.cell);
      case 'gameLeave': return this.gameLeave(id);
      case 'gameReset': {
        if (!this.game.players.includes(id)) return;
        this.game = { ...emptyGame(), players: this.game.players };
        return this.broadcast({ t: 'game', game: this.game });
      }
      case 'pauseInvite': {
        if (!member) return;
        return this.broadcast({ t: 'pauseInvite', from: id }, id, (x) => this.members(x) && this.effectiveStatus(x) === 'disp');
      }
      case 'admit': {
        const g = this.people.get(m.guest);
        if (!member || !g?.presence.waiting) return;
        if (m.accept) {
          g.presence.waiting = false;
          g.presence.status = 'disp';
          send(g.ws, { t: 'admitted' });
          this.broadcast({ t: 'presence', presence: g.presence });
          this.broadcast({ t: 'toast', text: `${g.user.name} entrou como visitante.` }, undefined, this.members);
        } else {
          send(g.ws, { t: 'refused' });
          g.ws?.close(4003, 'refused');
          this.remove(m.guest);
        }
        return;
      }
    }
  }

  private announceGuest(p: Person) {
    const m: ServerMsg = { t: 'guestArrived', guest: p.presence.id, name: p.user.name, host: p.guestHost ?? '' };
    // o anfitrião é avisado; se estiver fora, qualquer integrante pode receber
    if (p.guestHost && this.people.get(p.guestHost)?.ws) this.to(p.guestHost, m);
    else this.broadcast(m, undefined, this.members);
  }

  // ---------- movimento ----------
  private flushMoves() {
    if (!this.dirty.size) return;
    const m: [string, number, number, number, string | null][] = [];
    for (const id of this.dirty) {
      const p = this.people.get(id)?.presence;
      if (p) m.push([id, Math.round(p.x * 100) / 100, Math.round(p.z * 100) / 100, Math.round(p.rot * 100) / 100, p.seat]);
    }
    this.dirty.clear();
    this.broadcast({ t: 'moves', m });
  }

  // ---------- conversas ----------
  private inRoom(p: Person) { return !p.presence.waiting && inside(REUNIAO, p.presence.x, p.presence.z); }

  effectiveStatus(p: Person): Status {
    if (this.focus?.participants.includes(p.presence.id) && this.currentBlock()?.kind === 'foco') return 'foco';
    return p.presence.status;
  }

  private available(p: Person) {
    return !!p.ws && !p.presence.waiting && !p.presence.unstable && this.effectiveStatus(p) !== 'foco' && this.effectiveStatus(p) !== 'afk' && !this.inRoom(p);
  }

  private setConv(id: string, convId: string | null) {
    if (convId) this.convOf.set(id, convId); else this.convOf.delete(id);
  }

  private leaveConv(id: string, cool = false) {
    const cid = this.convOf.get(id);
    if (!cid) return;
    const c = this.convs.get(cid);
    this.convOf.delete(id);
    if (!c || c.kind === 'room') return;
    c.members = c.members.filter((m) => m !== id);
    if (cool) {
      // quem sai pelo botão não volta automaticamente enquanto continuar perto dos mesmos colegas
      const set = this.cooldown.get(id) ?? new Set();
      c.members.forEach((m) => set.add(m));
      this.cooldown.set(id, set);
    }
    if (c.members.length < 2) {
      c.members.forEach((m) => this.convOf.delete(m));
      this.convs.delete(cid);
    }
  }

  private directConv(a: string, b: string) {
    this.leaveConv(a);
    this.leaveConv(b);
    const cid = `d_${randomId(5)}`;
    this.convs.set(cid, { id: cid, kind: 'direct', members: [a, b], since: Date.now() });
    this.setConv(a, cid);
    this.setConv(b, cid);
  }

  private proximity(dt: number) {
    const ps = [...this.people.values()].filter((p) => p.ws && !p.presence.waiting);

    // sala de reunião: todos que estão dentro (e autorizados, com a porta fechada) dividem a chamada
    const roomIds = ps.filter((p) => this.inRoom(p) && (this.doorOpen || this.doorAllowed.has(p.presence.id))).map((p) => p.presence.id);
    for (const id of roomIds) if (this.convOf.get(id) !== 'room') { this.leaveConv(id); this.setConv(id, 'room'); }
    for (const [id, cid] of [...this.convOf]) if (cid === 'room' && !roomIds.includes(id)) this.convOf.delete(id);
    if (roomIds.length) this.convs.set('room', { id: 'room', kind: 'room', members: roomIds, since: this.convs.get('room')?.since ?? Date.now() });
    else {
      this.convs.delete('room');
      if (!this.doorOpen) { this.doorOpen = true; this.doorAllowed.clear(); this.broadcast({ t: 'door', open: true, by: '' }); }
    }

    // conversas por proximidade: saem quem se afasta (com tolerância) ou deixa de estar disponível
    for (const c of [...this.convs.values()]) {
      if (c.kind !== 'prox') continue;
      for (const id of [...c.members]) {
        const p = this.people.get(id);
        const near = p && c.members.some((o) => o !== id && this.people.get(o) && acoustic(this.people.get(o)!.presence) === acoustic(p.presence) && dist(p.presence, this.people.get(o)!.presence) < PROX.leave);
        if (p && this.available(p) && near) { this.apart.delete(id); continue; }
        const t = (this.apart.get(id) ?? 0) + dt;
        this.apart.set(id, t);
        if (!p || !this.available(p) || t >= PROX.grace) { this.apart.delete(id); this.leaveConv(id); }
      }
    }
    for (const c of [...this.convs.values()]) {
      if (c.kind !== 'direct') continue;
      for (const id of c.members) if (!this.people.get(id)?.ws || this.inRoom(this.people.get(id)!)) this.leaveConv(id);
    }

    // quem está livre entra na conversa de quem está perto (sem fundir duas conversas)
    const avail = ps.filter((p) => this.available(p));
    const seen = new Set<string>();
    for (const u of avail) {
      const uid = u.presence.id;
      const cool = this.cooldown.get(uid);
      if (cool) for (const o of [...cool]) { const op = this.people.get(o); if (!op || dist(u.presence, op.presence) > PROX.leave) cool.delete(o); }
      if (this.convOf.has(uid)) continue;
      let best: Person | null = null, bd = PROX.join;
      for (const v of avail) {
        if (v === u || cool?.has(v.presence.id) || this.cooldown.get(v.presence.id)?.has(uid)) continue;
        if (acoustic(v.presence) !== acoustic(u.presence)) continue;
        const vc = this.convOf.get(v.presence.id);
        if (vc && this.convs.get(vc)?.kind !== 'prox') continue;
        const d = dist(u.presence, v.presence);
        if (d < bd) { bd = d; best = v; }
      }
      if (!best) continue;
      const key = [uid, best.presence.id].sort().join('|');
      seen.add(key);
      const t = (this.dwell.get(key) ?? 0) + dt;
      this.dwell.set(key, t);
      if (t < PROX.dwell) continue;
      this.dwell.delete(key);
      const vid = best.presence.id;
      const existing = this.convOf.get(vid);
      if (existing) {
        this.convs.get(existing)!.members.push(uid);
        this.setConv(uid, existing);
      } else {
        const cid = `p_${randomId(5)}`;
        this.convs.set(cid, { id: cid, kind: 'prox', members: [uid, vid], since: Date.now() });
        this.setConv(uid, cid);
        this.setConv(vid, cid);
      }
    }
    for (const k of this.dwell.keys()) if (!seen.has(k)) this.dwell.delete(k);

    // avisa cada pessoa da sua conversa, e todos das conversas visíveis no mapa
    for (const p of this.people.values()) {
      const cid = this.convOf.get(p.presence.id) ?? '';
      const c = cid ? this.convs.get(cid) : undefined;
      const key = c ? `${c.id}:${[...c.members].sort().join(',')}` : '';
      if (this.lastSentConv.get(p.presence.id) !== key) {
        this.lastSentConv.set(p.presence.id, key);
        send(p.ws, { t: 'conv', conv: c ? { id: c.id, kind: c.kind, members: c.members } : null });
      }
    }
    const all = [...this.convs.values()].map((c) => ({ id: c.id, kind: c.kind, members: [...c.members].sort() }));
    const allKey = JSON.stringify(all);
    if (allKey !== this.lastConvsKey) {
      this.lastConvsKey = allKey;
      this.broadcast({ t: 'convs', convs: all });
    }
  }

  // ---------- quadros ----------
  private canBoard(p: Person, id: string) {
    if (p.user.role !== 'guest') return true;
    return id === 'reuniao'; // visitante só usa o quadro da sala de reunião
  }

  private boardOpen(p: Person, id: string) {
    const b = boards.get(id);
    if (!b || !this.canBoard(p, id)) return;
    let doc = this.docs.get(id);
    if (!doc) {
      doc = { elements: new Map(b.elements.map((e) => [e.id, e])), by: '' };
      this.docs.set(id, doc);
    }
    const set = this.editors.get(id) ?? new Set();
    set.add(p.presence.id);
    this.editors.set(id, set);
    send(p.ws, { t: 'board', id, title: b.title, elements: [...doc.elements.values()], copies: boards.copies(id), editors: [...set] });
    if (p.user.role !== 'guest') send(p.ws, { t: 'boards', boards: boards.list() });
    this.broadcastEditors(id);
  }

  private boardOp(p: Person, id: string, put?: BoardElement[], del?: string[]) {
    const doc = this.docs.get(id);
    if (!doc || !this.editors.get(id)?.has(p.presence.id)) return;
    const ok: BoardElement[] = [];
    for (const e of (put ?? []).slice(0, 200)) {
      if (!e || typeof e.id !== 'string' || !finite(e.x, -1e5, 1e5) || !finite(e.y, -1e5, 1e5)) continue;
      if (e.points && (!Array.isArray(e.points) || e.points.length > 4000)) continue;
      const el: BoardElement = { ...e, text: e.text ? String(e.text).slice(0, 2000) : e.text, by: p.user.name };
      doc.elements.set(el.id, el);
      ok.push(el);
    }
    const gone = (del ?? []).filter((d) => typeof d === 'string' && doc.elements.delete(d));
    if (!ok.length && !gone.length) return;
    doc.by = p.user.name;
    const msg: ServerMsg = { t: 'boardOp', id, put: ok, del: gone, by: p.presence.id };
    // quadros das paredes: todos recebem, para o desenho no mapa acompanhar
    if (WALL_BOARDS.includes(id)) this.broadcast(msg, p.presence.id, (x) => this.members(x) || id === 'reuniao');
    else for (const e of this.editors.get(id) ?? []) if (e !== p.presence.id) this.to(e, msg);
    // salva automaticamente, agrupando edições próximas
    clearTimeout(doc.timer);
    doc.timer = setTimeout(() => boards.save(id, [...doc.elements.values()], doc.by), 1200);
  }

  private boardElements(id: string) {
    const doc = this.docs.get(id);
    return doc ? [...doc.elements.values()] : boards.get(id)?.elements ?? [];
  }

  private broadcastEditors(id: string) {
    const eds = [...(this.editors.get(id) ?? [])];
    for (const e of eds) this.to(e, { t: 'boardEditors', id, editors: eds });
  }

  /** Grava quadros pendentes (ao desligar o servidor). */
  flush() {
    for (const [id, doc] of this.docs) {
      if (doc.timer) { clearTimeout(doc.timer); boards.save(id, [...doc.elements.values()], doc.by); }
    }
  }

  // ---------- rádio ----------
  private async radioAdd(p: Person, url: string) {
    const videoId = youtubeId(String(url ?? ''));
    if (!videoId) return send(p.ws, { t: 'toast', text: 'Não reconheci esse link do YouTube.' });
    let title = 'Vídeo do YouTube';
    try {
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`);
      if (!r.ok) return send(p.ws, { t: 'toast', text: 'Esse vídeo não pode ser tocado fora do YouTube ou está indisponível.' });
      // transmissões ao vivo às vezes vêm sem título: usa o canal como nome
      const j = (await r.json()) as { title?: string; author_name?: string };
      title = j.title || (j.author_name ? `Ao vivo · ${j.author_name}` : title);
    } catch {
      // sem acesso ao YouTube pelo servidor: aceita e deixa o player avisar se falhar
    }
    this.radio.queue.push({ id: this.radioSeq++, videoId, title, addedBy: p.user.name });
    if (!this.radio.current && this.radio.listeners.length) this.radioAdvance();
    else { this.saveRadio(); this.broadcastRadio(); }
  }

  private radioAdvance() {
    // a programação é uma fila circular: o que tocou volta para o fim
    if (this.radio.current) this.radio.queue.push(this.radio.current);
    this.radio.current = this.radio.queue.shift() ?? null;
    this.radio.startedAt = Date.now();
    this.saveRadio();
    this.broadcastRadio();
  }

  private saveRadio() {
    settings.set('radio', JSON.stringify({ queue: this.radio.current ? [this.radio.current, ...this.radio.queue] : this.radio.queue, seq: this.radioSeq }));
  }

  private broadcastRadio() { this.broadcast({ t: 'radio', radio: this.radio, serverTime: Date.now() }); }

  // ---------- foco coletivo ----------
  private focusStart(p: Person, blocks: FocusBlock[]) {
    if (this.focus || p.user.role === 'guest' || !Array.isArray(blocks)) return;
    const ok = blocks.filter((b) => (b.kind === 'foco' || b.kind === 'pausa') && finite(b.minutes, 1, 180)).slice(0, 16);
    if (!ok.length) return;
    this.focus = { id: randomId(5), owner: p.presence.id, startedAt: Date.now(), blocks: ok, participants: [p.presence.id] };
    this.focusBlock = 0;
    this.leaveConv(p.presence.id, true);
    this.broadcastFocus();
  }

  currentBlock() {
    if (!this.focus) return null;
    let t = (Date.now() - this.focus.startedAt) / 60000;
    for (const b of this.focus.blocks) {
      if (t < b.minutes) return b;
      t -= b.minutes;
    }
    return null;
  }

  private focusTick() {
    if (!this.focus) return;
    const b = this.currentBlock();
    if (!b) { this.focus = null; return this.broadcastFocus(); }
    let i = 0, t = (Date.now() - this.focus.startedAt) / 60000;
    for (const x of this.focus.blocks) { if (t < x.minutes) break; t -= x.minutes; i++; }
    if (i !== this.focusBlock) {
      this.focusBlock = i;
      // ao entrar num bloco de foco, quem participa sai das conversas
      if (b.kind === 'foco') this.focus.participants.forEach((id) => this.leaveConv(id));
      this.broadcastFocus();
    }
  }

  private broadcastFocus() { this.broadcast({ t: 'focus', focus: this.focus, serverTime: Date.now() }); }

  // ---------- jogo da velha (lazer) ----------
  private gameMove(id: string, cell: number) {
    const g = this.game;
    if (g.winner || g.draw || !Number.isInteger(cell) || cell < 0 || cell > 8 || g.board[cell]) return;
    if (g.players[g.turn] !== id || !g.players[0] || !g.players[1]) return;
    g.board[cell] = g.turn === 0 ? 'X' : 'O';
    const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
    if (lines.some((l) => l.every((c) => g.board[c] === g.board[cell]))) g.winner = id;
    else if (g.board.every(Boolean)) g.draw = true;
    else g.turn = g.turn === 0 ? 1 : 0;
    this.broadcast({ t: 'game', game: g });
  }

  private gameLeave(id: string) {
    const i = this.game.players.indexOf(id);
    if (i < 0) return;
    // quem fica continua na mesa, esperando o próximo adversário
    const stays = this.game.players[i === 0 ? 1 : 0];
    this.game = emptyGame();
    this.game.players[0] = stays;
    this.broadcast({ t: 'game', game: this.game });
  }
}

/** Extrai o id de um link do YouTube (watch, youtu.be, shorts, live ou embed). */
export function youtubeId(url: string) {
  const m = url.trim().match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/) ?? url.trim().match(/^([\w-]{11})$/);
  return m?.[1] ?? null;
}

