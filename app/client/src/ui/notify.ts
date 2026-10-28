import type { OfficeApp } from '../app';
import type { Conv, FocusSession, Note } from '../../../shared/protocol';
import { icon } from './icons';
import { ago, esc } from './dom';

// Avisos discretos na página e, com a aba em segundo plano, notificações do navegador.

interface Action { label: string; primary?: boolean; run: () => void }
interface Entry { text: string; at: number }

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

  /** Aviso na página; com ações, fica até a pessoa responder. */
  toast(text: string, opts: { actions?: Action[]; who?: string; important?: boolean; key?: string; sticky?: boolean; ttl?: number } = {}) {
    if (opts.key) this.stack.querySelector(`[data-key="${opts.key}"]`)?.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    if (opts.key) el.dataset.key = opts.key;
    const av = opts.who ? `<span class="av" style="width:34px;height:34px">${this.app.shell.avatarImg(opts.who, 34)}</span>` : `<span class="tic">${icon('bell')}</span>`;
    el.innerHTML = `<div class="h">${av}<div><b>${esc(text)}</b></div><button class="x" aria-label="Fechar">${icon('x')}</button></div>${opts.actions ? `<div class="acts">${opts.actions.map((a, i) => `<button class="${a.primary ? 'yes' : 'no'}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}`;
    el.querySelector('.x')!.addEventListener('click', () => el.remove());
    el.querySelectorAll<HTMLButtonElement>('[data-i]').forEach((b) => b.addEventListener('click', () => { el.remove(); opts.actions![+b.dataset.i!].run(); }));
    this.stack.prepend(el);
    while (this.stack.children.length > 4) this.stack.lastElementChild?.remove();
    // pedidos de resposta (falar, porta, visitante) ficam até a resposta; os demais somem sozinhos
    if (!opts.sticky) setTimeout(() => el.remove(), opts.ttl ?? (opts.actions ? 15000 : 6000));
    this.history.unshift({ text, at: Date.now() });
    this.history.length = Math.min(this.history.length, 30);
    this.unread++;
    this.app.shell.renderTop();
    if (opts.important) {
      this.ping();
      this.system(text);
    }
    return el;
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
    this.toast(`${app.name(from)} pediu para falar${text ? `: “${text}”` : ''}`, {
      who: from, important: true, key: `knock-${from}`, sticky: true,
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

  note(n: Note) {
    this.toast(`Novo bilhete de ${n.fromName} na sua mesa`, { who: n.from, important: true, actions: [{ label: 'Ler', primary: true, run: () => this.app.panels.openMyNotes() }] });
  }

  pauseInvite(from: string) {
    this.toast(`${this.app.name(from)} convidou para uma pausa no café`, {
      who: from, important: true,
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
    if (prev && !next && mine(prev)) return void this.toast('A sessão de foco coletivo terminou. Bom trabalho!', { important: true });
    if (!next || !mine(next)) return;
    if (prev?.id === next.id) {
      const b = app.focusBlock();
      const key = `${next.id}:${b?.index}`;
      if (!b || this.lastBlock === key) return;
      this.lastBlock = key;
      if (b.kind === 'pausa') {
        this.toast(`Fim do bloco de foco. Pausa compartilhada de ${b.minutes} min.`, { important: true, actions: [{ label: 'Pausa no café', primary: true, run: () => app.goPause() }, { label: 'Ficar aqui', run: () => {} }] });
      } else this.toast(`Novo bloco de foco: ${b.minutes} min.`, { important: true });
    } else this.lastBlock = `${next.id}:0`;
  }
  private lastBlock = '';

  joinedConv(c: Conv) {
    void c;
  }

  mediaError(e: unknown, what: string) {
    const name = (e as Error)?.name;
    const msg = name === 'NotAllowedError' ? `O navegador bloqueou ${what === 'câmera' ? 'a' : 'o'} ${what}. Libere o acesso no cadeado da barra de endereço.`
      : name === 'NotFoundError' ? `Nenhum${what === 'câmera' ? 'a' : ''} ${what} encontrad${what === 'câmera' ? 'a' : 'o'}.`
      : `Não foi possível usar ${what === 'câmera' ? 'a' : 'o'} ${what}. Verifique a conexão e tente de novo.`;
    this.toast(msg);
  }

  audioUnlock() {
    this.toast('Clique para ouvir as conversas', { key: 'audio', sticky: true, actions: [{ label: 'Ativar som', primary: true, run: () => void this.app.media.unlockAudio() }] });
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
        <div class="list">${this.history.length ? this.history.map((h) => `<div class="li"><span class="lic">${icon('bell')}</span><div><b>${esc(h.text)}</b><small>${ago(h.at)}</small></div></div>`).join('') : '<p class="empty">Nada por aqui ainda.</p>'}</div>
      </div>`, (d) => {
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
