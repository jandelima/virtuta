import type { OfficeApp } from '../app';
import type { FocusSession, Note } from '../../../shared/protocol';
import { icon } from './icons';
import { ago, esc } from './dom';

// Avisos discretos na página e, com a aba em segundo plano, notificações do navegador.

interface Action { label: string; primary?: boolean; run: () => void }
/** Item do histórico; um pedido ainda sem resposta mantém os botões. */
interface Entry { text: string; at: number; who?: string; key?: string; actions?: Action[]; open?: boolean; ic?: string }
interface ToastOpts { actions?: Action[]; who?: string; important?: boolean; key?: string; sticky?: boolean; ttl?: number; log?: boolean; ic?: string; quiet?: boolean }

const PREF = 'virtuta.notify';

export class Notifier {
  private stack = document.getElementById('toasts')!;
  private history: Entry[] = [];
  unread = 0;
  browser = false;
  sound = true;

  constructor(private app: OfficeApp) {
    try {
      const p = JSON.parse(localStorage.getItem(PREF) ?? '{}') as { browser?: boolean; sound?: boolean };
      this.browser = !!p.browser && 'Notification' in window && Notification.permission === 'granted';
      this.sound = p.sound !== false;
    } catch { /* sem preferências salvas */ }
  }

  private save() {
    try { localStorage.setItem(PREF, JSON.stringify({ browser: this.browser, sound: this.sound })); } catch { /* vale só nesta sessão */ }
  }

  /**
   * Aviso na página; com ações, fica até a pessoa responder. `log: false` não entra no histórico
   * nem acende o sino (confirmações do que a própria pessoa fez); `quiet` tira som e notificação.
   */
  toast(text: string, opts: ToastOpts = {}) {
    if (opts.key) this.stack.querySelector(`[data-key="${opts.key}"]`)?.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    if (opts.key) el.dataset.key = opts.key;
    if (opts.sticky) el.dataset.sticky = '1';
    const av = opts.who ? `<span class="av" style="width:34px;height:34px">${this.app.shell.avatarImg(opts.who, 34)}</span>` : `<span class="tic">${icon(opts.ic ?? 'bell')}</span>`;
    el.innerHTML = `<div class="h">${av}<div><b>${esc(text)}</b></div><button class="x" aria-label="Fechar">${icon('x')}</button></div>${opts.actions ? `<div class="acts">${opts.actions.map((a, i) => `<button class="${a.primary ? 'yes' : 'no'}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}`;
    const entry: Entry | null = opts.log === false ? null : { text, at: Date.now(), who: opts.who, key: opts.key, actions: opts.actions, open: !!opts.actions, ic: opts.ic };
    el.querySelector('.x')!.addEventListener('click', () => el.remove());
    el.querySelectorAll<HTMLButtonElement>('[data-i]').forEach((b) => b.addEventListener('click', () => {
      el.remove();
      if (entry) entry.open = false;
      opts.actions![+b.dataset.i!].run();
    }));
    this.stack.prepend(el);
    // passou de 4 avisos: saem primeiro os informativos; pedidos que esperam resposta nunca saem
    while (this.stack.children.length > 4) {
      const old = [...this.stack.children].reverse().find((c) => !(c as HTMLElement).dataset.sticky);
      if (!old) break;
      old.remove();
    }
    // pedidos de resposta (falar, porta, visitante) ficam até a resposta; os demais somem sozinhos
    if (!opts.sticky) setTimeout(() => el.remove(), opts.ttl ?? (opts.actions ? 15000 : 6000));
    if (entry) {
      // um pedido repetido (mesma chave) substitui o anterior no histórico
      if (entry.key) this.history = this.history.filter((h) => h.key !== entry.key);
      this.history.unshift(entry);
      this.history.length = Math.min(this.history.length, 30);
      this.unread++;
      this.app.shell.renderTop();
    }
    if (opts.important && !opts.quiet) {
      this.ping();
      this.system(text);
    }
    return el;
  }

  /** Tira da tela o aviso com essa chave (ou que começa com ela) e encerra o pedido no histórico. */
  dismiss(key: string, prefix = false) {
    const match = (k?: string) => !!k && (prefix ? k.startsWith(key) : k === key);
    this.stack.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => { if (match(el.dataset.key)) el.remove(); });
    for (const h of this.history) if (match(h.key)) h.open = false;
  }

  /** Quantos avisos com essa chave estão na tela agora (para juntar avisos iguais). */
  private shown(key: string) {
    return Number(this.stack.querySelector<HTMLElement>(`[data-key="${key}"]`)?.dataset.count ?? 0);
  }

  /** Notificação do sistema, só com a aba escondida e com permissão. */
  private system(text: string) {
    if (!this.browser || !document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(this.app.settings.officeName, { body: text, tag: 'virtuta', silent: !this.sound });
    n.onclick = () => { window.focus(); n.close(); };
  }

  private ctx: AudioContext | null = null;
  private ping() {
    if (!this.sound) return;
    try {
      this.ctx ??= new AudioContext();
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.frequency.value = 880;
      o.type = 'sine';
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, c.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.35);
      o.connect(g).connect(c.destination);
      o.start();
      o.stop(c.currentTime + 0.4);
    } catch { /* sem áudio disponível */ }
  }

  knock(from: string, text: string) {
    const app = this.app;
    // em foco, o pedido chega sem som e sem notificação do sistema
    this.toast(`${app.name(from)} pediu para falar${text ? `: “${text}”` : ''}`, {
      who: from, important: true, quiet: app.displayStatus(app.me) === 'foco', key: `knock-${from}`, sticky: true,
      actions: [
        { label: 'Aceitar', primary: true, run: () => app.send({ t: 'knockReply', to: from, accept: true }) },
        { label: 'Agora não', run: () => app.send({ t: 'knockReply', to: from, accept: false }) },
      ],
    });
  }

  doorKnock(who: string) {
    const app = this.app;
    this.toast(`${app.name(who)} quer entrar na sala de reunião`, {
      who, important: true, key: `door-${who}`, sticky: true,
      actions: [
        { label: 'Deixar entrar', primary: true, run: () => app.send({ t: 'doorReply', who, accept: true }) },
        { label: 'Agora não', run: () => app.send({ t: 'doorReply', who, accept: false }) },
      ],
    });
  }

  /** Pedido de entrada respondido por alguém de dentro: some da tela dos outros. */
  doorResolved(who: string, accept: boolean, by: string) {
    this.dismiss(`door-${who}`);
    if (by !== this.app.me) this.toast(`${this.app.name(by)} ${accept ? 'deixou' : 'não deixou'} ${this.app.name(who)} entrar`, { who, ttl: 4000, log: false });
  }

  /** Bilhetes seguidos da mesma pessoa viram um aviso só. */
  note(n: Note) {
    const key = `note-${n.from}`;
    const count = this.shown(key) + 1;
    const el = this.toast(count > 1 ? `${count} bilhetes novos de ${n.fromName} na sua mesa` : `Novo bilhete de ${n.fromName} na sua mesa`, { who: n.from, important: true, key, ttl: 20000, actions: [{ label: 'Ler', primary: true, run: () => this.app.panels.openMyNotes() }] });
    el.dataset.count = String(count);
  }

  pauseInvite(from: string) {
    this.toast(`${this.app.name(from)} convidou para uma pausa no café`, {
      who: from, important: true, key: `pause-${from}`,
      actions: [
        { label: 'Ir até lá', primary: true, run: () => this.app.goPause() },
        { label: 'Agora não', run: () => {} },
      ],
    });
  }

  guestArrived(guest: string, name: string) {
    const app = this.app;
    this.toast(`${name} chegou ao hub e pediu para entrar`, {
      important: true, key: `guest-${guest}`, sticky: true,
      actions: [
        { label: 'Admitir', primary: true, run: () => app.send({ t: 'admit', guest, accept: true }) },
        { label: 'Recusar', run: () => app.send({ t: 'admit', guest, accept: false }) },
      ],
    });
  }

  /** Avisa discretamente o fim de cada bloco da sessão de foco para quem participa. */
  focusChange(prev: FocusSession | null, next: FocusSession | null) {
    const app = this.app;
    const mine = (f: FocusSession | null) => !!f?.participants.includes(app.me);
    const left = (f: FocusSession) => {
      const total = f.blocks.reduce((t, b) => t + b.minutes, 0) * 60000;
      return f.startedAt + total - app.now();
    };
    const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
    // a sessão acabou ou a pessoa saiu dela: os avisos da sessão saem junto
    if (prev && mine(prev) && (!next || next.id !== prev.id || !mine(next))) {
      this.dismiss('focus-', true);
      if (!next && left(prev) < 5000) return void this.toast('A sessão de foco coletivo terminou. Bom trabalho!', { important: true, ic: 'focus' });
      const why = this.leaving;
      this.leaving = false;
      if (!next && prev.owner !== app.me && !why) return; // quem começou encerrou: o servidor avisa
      return void this.toast(why === 'end' ? 'Você encerrou a sessão de foco para todos.' : 'Você saiu da sessão de foco coletivo.', { log: false, ic: 'focus' });
    }
    if (!next || !mine(next)) return;
    const b = app.focusBlock();
    if (prev?.id === next.id && mine(prev)) {
      const key = `${next.id}:${b?.index}`;
      if (!b || this.lastBlock === key) return;
      this.lastBlock = key;
      if (b.kind === 'pausa') {
        this.toast(`Fim do bloco de foco. Pausa compartilhada de ${b.minutes} min.`, { important: true, ic: 'focus', key: 'focus-pause', ttl: 30000, actions: [{ label: 'Pausa no café', primary: true, run: () => app.goPause() }, { label: 'Ficar aqui', run: () => {} }] });
      } else this.toast(`Novo bloco de foco: ${b.minutes} min.`, { important: true, ic: 'focus', key: 'focus-block' });
      return;
    }
    // acabou de entrar (ou começou a sessão)
    this.lastBlock = `${next.id}:${b?.index ?? 0}`;
    if (b) this.toast(`Você entrou na sessão de foco coletivo. ${b.kind === 'foco' ? 'Bloco de foco' : 'Pausa'}: faltam ${fmt(b.left)}.`, { log: false, ic: 'focus', key: 'focus-join' });
  }
  private lastBlock = '';
  /** A própria pessoa pediu para sair da sessão (ou encerrou para todos). */
  leaving: 'leave' | 'end' | false = false;

  /** Alguém chegou para conversar: aviso curto, som e, com a aba escondida, notificação do sistema. */
  joinedConv(ids: string[]) {
    const app = this.app;
    const names = ids.map((id) => app.shortName(id));
    const text = `${names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}` : names[0]} ${names.length > 1 ? 'chegaram' : 'chegou'} para conversar`;
    this.toast(text, { who: ids[0], important: true, ttl: 5000 });
  }

  mediaError(e: unknown, what: string) {
    const name = (e as Error)?.name;
    const msg = name === 'NotAllowedError' ? `O navegador bloqueou ${what === 'câmera' ? 'a' : 'o'} ${what}. Libere o acesso no cadeado da barra de endereço.`
      : name === 'NotFoundError' ? `Nenhum${what === 'câmera' ? 'a' : ''} ${what} encontrad${what === 'câmera' ? 'a' : 'o'}.`
      : `Não foi possível usar ${what === 'câmera' ? 'a' : 'o'} ${what}. Verifique a conexão e tente de novo.`;
    this.toast(msg);
  }

  audioUnlock() {
    if (this.stack.querySelector('[data-key="audio"]')) return;
    this.toast('Clique para ouvir as conversas', { key: 'audio', sticky: true, log: false, actions: [{ label: 'Ativar som', primary: true, run: () => void this.app.media.unlockAudio() }] });
  }

  openCenter() {
    this.unread = 0;
    this.app.shell.renderTop();
    const supported = 'Notification' in window;
    this.app.panels.show(`<div class="dh"><span class="dic">${icon('bell')}</span><div><b>Avisos</b><small>Últimas novidades desta sessão</small></div><button class="iconbtn" data-close aria-label="Fechar">${icon('x')}</button></div>
      <div class="db2">
        <label class="switch"><input type="checkbox" id="nBrowser" ${this.browser ? 'checked' : ''} ${supported ? '' : 'disabled'}/><span>Notificar fora da página<small>${supported ? 'Quando a aba estiver em segundo plano' : 'Este navegador não oferece notificações'}</small></span></label>
        <label class="switch"><input type="checkbox" id="nSound" ${this.sound ? 'checked' : ''}/><span>Som discreto nos pedidos<small>Pedidos para falar, porta, bilhetes e visitantes</small></span></label>
        <h4>Recentes</h4>
        <div class="list" id="nList">${this.history.length ? this.history.map((h, i) => `<div class="li hist"><span class="lic">${h.who ? this.app.shell.avatarImg(h.who, 30) : icon(h.ic ?? 'bell')}</span><div><b>${esc(h.text)}</b><small>${ago(h.at)}</small>${h.open && h.actions ? `<span class="acts">${h.actions.map((a, j) => `<button class="btn ${a.primary ? 'primary' : 'soft'}" data-h="${i}" data-a="${j}">${esc(a.label)}</button>`).join('')}</span>` : ''}</div></div>`).join('') : '<p class="empty">Nada por aqui ainda.</p>'}</div>
      </div>`, (d) => {
      // pedidos ainda abertos podem ser respondidos daqui, mesmo depois de o aviso sair da tela
      d.querySelector('#nList')!.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-h]');
        if (!b) return;
        const h = this.history[Number(b.dataset.h)];
        if (!h?.open || !h.actions) return;
        h.open = false;
        if (h.key) this.stack.querySelector(`[data-key="${h.key}"]`)?.remove();
        h.actions[Number(b.dataset.a)].run();
        this.openCenter();
      });
      d.querySelector<HTMLInputElement>('#nBrowser')!.onchange = async (e) => {
        const on = (e.target as HTMLInputElement).checked;
        if (on && Notification.permission !== 'granted') {
          const r = await Notification.requestPermission();
          if (r !== 'granted') { (e.target as HTMLInputElement).checked = false; this.toast('O navegador não liberou as notificações.'); return; }
        }
        this.browser = on;
        this.save();
      };
      d.querySelector<HTMLInputElement>('#nSound')!.onchange = (e) => { this.sound = (e.target as HTMLInputElement).checked; this.save(); };
    });
  }
}
