import type { OfficeApp } from '../app';
import { AREAS, areaAt } from '../../../shared/layout';
import { STATUS_COLOR, STATUS_LABEL } from '../people';
import { icon } from './icons';
import { esc } from './dom';
import { openAvatarEditor } from './avatarEditor';
import { resolveLook } from '../look';
import { api } from '../api';

// Moldura do escritório: topo, lateral (ambientes e pessoas), dock e telas de estado.

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class Shell {
  constructor(private app: OfficeApp) {
    $('me').addEventListener('click', () => { const m = $('statusMenu'); m.hidden = !m.hidden; if (!m.hidden) this.renderMenu(); });
    document.addEventListener('pointerdown', (e) => {
      const m = $('statusMenu');
      if (!m.hidden && !(e.target as HTMLElement).closest('.me-wrap')) m.hidden = true;
    });
    $('themeBtn').addEventListener('click', () => {
      const night = app.sc.theme !== 'night';
      app.sc.applyTheme(night ? 'night' : 'day');
      try { localStorage.setItem('virtuta.theme', night ? 'night' : 'day'); } catch { /* sem preferência salva */ }
      this.renderTop();
    });
    $('bell').addEventListener('click', () => app.notify.openCenter());
    $('search').addEventListener('input', () => this.renderPeople());
    $('people').addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.prow');
      if (!row) return;
      const id = row.dataset.id!;
      if (id === app.me || !app.presence.has(id)) return;
      // aproxima a câmera da pessoa (se estiver no mesmo ambiente) e abre as ações rápidas
      app.followId = id;
      app.followUntil = performance.now() + 4000;
      app.panels.openPerson(id);
    });
    $('spaces').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-area]');
      const a = AREAS.find((x) => x.id === b?.dataset.area);
      if (a) app.goToArea(a.id);
    });
    $('zoom').innerHTML = `<button id="zIn" aria-label="Aproximar">${icon('plus')}</button><button id="zOut" aria-label="Afastar">${icon('minus')}</button><button id="zMe" aria-label="Ver o ambiente inteiro" title="Ver o ambiente inteiro">${icon('locate')}</button>`;
    $('zIn').onclick = () => (app.sc.zoom = Math.min(2.4, app.sc.zoom * 1.25));
    $('zOut').onclick = () => (app.sc.zoom = Math.max(0.5, app.sc.zoom / 1.25));
    $('zMe').onclick = () => { app.followId = null; app.sc.toggleWhole(); };
    $('hint').innerHTML = `<span><kbd>WASD</kbd> andar</span><span><kbd>E</kbd> usar</span><span><kbd>M</kbd> mic</span><span><kbd>V</kbd> câmera</span><span><kbd>Alt</kbd> nomes</span>`;
    $('searchIcon').innerHTML = icon('search');
  }

  renderAll() {
    const me = this.app.myPresence;
    $('crumb').textContent = me ? areaAt(me.x, me.z)?.name ?? '' : '';
    this.renderTop();
    this.renderMe();
    this.renderAreas();
    this.renderPeople();
    this.renderDock();
    this.renderFocus();
    this.renderConnection();
  }

  everySecond() {
    this.renderFocus();
    this.renderPeople();
    this.renderAreas();
    const me = this.app.myPresence;
    $('crumb').textContent = me ? areaAt(me.x, me.z)?.name ?? '' : '';
  }

  renderTop() {
    $('officeName').textContent = this.app.settings.officeName;
    document.title = this.app.settings.officeName;
    const night = this.app.sc.theme === 'night';
    $('themeBtn').innerHTML = icon(night ? 'sun' : 'moon');
    $('themeBtn').title = night ? 'Modo claro' : 'Modo escuro';
    $('bell').innerHTML = `${icon('bell')}${this.app.notify.unread ? '<i class="badge"></i>' : ''}`;
  }

  avatarImg(id: string, size = 32) {
    const u = this.app.users.get(id);
    return `<img src="${this.app.portraits[id] ?? ''}" width="${size}" height="${size}" alt="" style="background:${u?.color ?? '#888'}22"/>`;
  }

  renderMe() {
    const app = this.app;
    const s = app.displayStatus(app.me);
    const p = app.myPresence;
    const unread = app.notes.filter((n) => !n.readAt).length;
    $('me').innerHTML = `<span class="av" style="width:28px;height:28px">${this.avatarImg(app.me, 28)}</span><span class="sdot" style="background:${STATUS_COLOR[s]}"></span>${STATUS_LABEL[s]}${p?.note ? `<small>${esc(p.note)}</small>` : ''}${unread ? `<span class="count" title="Bilhetes não lidos">${unread}</span>` : ''}${icon('chev')}`;
  }

  private renderMenu() {
    const app = this.app;
    const p = app.myPresence;
    const opt = (s: 'disp' | 'foco' | 'afk', label: string) => `<button data-s="${s}"><span class="sdot" style="background:${STATUS_COLOR[s]}"></span>${label}${p?.status === s ? icon('check', 'tick') : ''}</button>`;
    const member = !app.guest;
    const unread = app.notes.filter((n) => !n.readAt).length;
    $('statusMenu').innerHTML =
      (member ? opt('disp', 'Disponível') + opt('foco', 'Em foco') + opt('afk', 'Ausente') +
        `<input id="statusNote" maxlength="80" placeholder="Mensagem curta de status (Enter)" value="${esc(p?.note ?? '')}"/><hr/>` +
        `<button data-act="notes">${icon('note')}Meus bilhetes${unread ? ` <span class="count">${unread}</span>` : ''}</button>` +
        `<button data-act="avatar">${icon('user')}Personalizar avatar</button>` : '') +
      `<button data-act="devices">${icon('settings')}Microfone, câmera e som</button>` +
      (member ? `<button data-act="invite">${icon('userPlus')}Convidar visitante</button>` : '') +
      (app.role === 'admin' ? `<button data-act="admin">${icon('shield')}Administração</button>` : '') +
      `<hr/><button data-act="logout">${icon('logout')}Sair da conta</button>`;
    const m = $('statusMenu');
    m.onclick = (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      if (b.dataset.s) {
        const s = b.dataset.s as 'disp' | 'foco' | 'afk';
        app.setStatus(s, s === 'disp' ? '' : ($<HTMLInputElement>('statusNote').value.trim() || (s === 'afk' ? 'Volto já' : 'Em foco')));
      }
      const act = b.dataset.act;
      if (act === 'notes') app.panels.openMyNotes();
      if (act === 'avatar') this.editAvatar();
      if (act === 'devices') void app.panels.openDevices();
      if (act === 'invite') app.panels.open('recepcao');
      if (act === 'admin') void app.panels.openAdmin();
      if (act === 'logout') void api.logout().then(() => { app.net.leave(); location.href = '/'; });
      m.hidden = true;
    };
    $<HTMLInputElement>('statusNote')?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const note = (e.target as HTMLInputElement).value.trim();
      app.setStatus(app.myPresence?.status ?? 'disp', note);
      m.hidden = true;
    });
  }

  /** Abre o criador de avatar; `welcome` é a primeira entrada de quem ainda não tem um. */
  editAvatar(welcome = false) {
    const app = this.app;
    const u = app.users.get(app.me)!;
    openAvatarEditor(resolveLook(u.look, u.model), u.name, (look) => app.saveLook(look), { welcome });
  }

  renderAreas() {
    const app = this.app;
    const counts = new Map<string, number>();
    for (const p of app.presence.values()) {
      if (p.waiting) continue;
      const a = areaAt(p.x, p.z);
      if (a) counts.set(a.id, (counts.get(a.id) ?? 0) + 1);
    }
    const me = app.myPresence ? areaAt(app.myPresence.x, app.myPresence.z)?.id : '';
    const html = AREAS.filter((a) => !app.guest || a.id !== 'sala').map((a) => {
      const n = counts.get(a.id) ?? 0;
      return `<button class="space-row${a.id === me ? ' on' : ''}" data-area="${a.id}" title="${esc(a.hint)}"><span class="sic">${icon(areaIcon[a.id] ?? 'building')}</span><b>${a.name}</b><small>${n || ''}</small></button>`;
    }).join('');
    const el = $('spaces');
    if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  }

  renderPeople() {
    const app = this.app;
    const q = $<HTMLInputElement>('search').value.trim().toLowerCase();
    const order = ['disp', 'reuniao', 'foco', 'afk', 'visita'];
    const online = [...app.presence.values()].filter((p) => !p.waiting || p.id === app.me).map((p) => p.id);
    const offline = [...app.users.values()].filter((u) => u.role !== 'guest' && !app.presence.has(u.id)).map((u) => u.id);
    const sorted = online.sort((a, b) => (a === app.me ? -1 : b === app.me ? 1 : order.indexOf(app.displayStatus(a)) - order.indexOf(app.displayStatus(b)) || app.name(a).localeCompare(app.name(b))));
    const match = (id: string) => !q || app.name(id).toLowerCase().includes(q) || app.statusLine(id).toLowerCase().includes(q);
    const inConv = new Set(app.convs.flatMap((c) => c.members));
    const row = (id: string, on: boolean) => {
      const s = on ? app.displayStatus(id) : 'afk';
      const u = app.users.get(id);
      const sub = id === app.me ? `Você · ${app.statusLine(id)}` : u?.role === 'guest' ? `Visitante · ${app.statusLine(id)}` : app.statusLine(id);
      const live = on && inConv.has(id) && id !== app.me ? `<span class="live" title="Em conversa">${icon('mic')}</span>` : '';
      const weak = app.presence.get(id)?.unstable ? `<span class="weak" title="Conexão instável">${icon('wifiOff')}</span>` : '';
      return `<button class="prow${id === app.me ? ' me' : ''}${on ? '' : ' off'}" data-id="${id}"><span class="av">${this.avatarImg(id)}<i class="sdot" style="background:${on ? STATUS_COLOR[s] : 'transparent'};${on ? '' : 'box-shadow: inset 0 0 0 2px var(--mut)'}"></i></span><span class="who"><b>${esc(app.name(id))}</b><small>${esc(sub)}</small></span>${weak}${live}</button>`;
    };
    const html = sorted.filter(match).map((id) => row(id, true)).join('') + (offline.filter(match).length ? `<div class="sub-sec">Offline</div>${offline.filter(match).map((id) => row(id, false)).join('')}` : '');
    const el = $('people');
    if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
    $('count').textContent = `${online.filter((id) => app.users.get(id)?.role !== 'guest').length} online`;
  }

  renderDock() {
    const app = this.app;
    const m = app.media;
    const p = app.myPresence;
    const afk = p?.status === 'afk';
    const focus = app.displayStatus(app.me) === 'foco';
    const b = (id: string, ic: string, tip: string, cls = '', text = '') => `<button class="db ${cls}" id="${id}" aria-label="${tip}">${icon(ic)}${text}<span class="tip">${tip}</span></button>`;
    const busy = m.state === 'connecting' ? ' busy' : '';
    $('dock').innerHTML =
      b('dMic', m.mic ? 'mic' : 'micOff', m.mic ? 'Desligar microfone (M)' : 'Ligar microfone (M)', (m.mic ? '' : 'off') + busy) +
      b('dCam', m.cam ? 'cam' : 'camOff', m.cam ? 'Desligar câmera (V)' : 'Ligar câmera (V)', (m.cam ? '' : 'off') + busy) +
      b('dShare', 'screen', m.screen ? 'Parar de compartilhar' : 'Compartilhar tela', m.screen ? 'active' : '') +
      b('dDev', 'settings', 'Dispositivos') +
      '<span class="div"></span>' +
      b('dWave', 'hand', 'Acenar') + b('dReact', 'smile', 'Reações') +
      (app.guest ? '' : '<span class="div"></span>' +
        b('dCafe', 'coffee', afk ? 'Voltar para a mesa' : 'Fui tomar café', afk ? 'active' : '', afk ? 'Voltei' : 'Café') +
        b('dFocus', 'focus', focus ? 'Sair do foco' : 'Ativar foco', focus ? 'focus-on' : '', 'Foco')) +
      '<span class="div"></span>' + b('dExit', 'exit', 'Sair do escritório', 'exit');
    $('dMic').onclick = () => void app.toggleMic();
    $('dCam').onclick = () => void app.toggleCam();
    $('dShare').onclick = () => void app.toggleScreen();
    $('dDev').onclick = () => void app.panels.openDevices();
    $('dWave').onclick = () => app.react('👋');
    $('dReact').onclick = () => this.toggleReactions();
    $('dExit').onclick = () => app.leaveOffice();
    if (!app.guest) {
      $('dCafe').onclick = () => (afk ? app.back() : app.goAfk());
      $('dFocus').onclick = () => app.toggleFocus();
    }
    if (m.needsAudioUnlock) app.notify.audioUnlock();
  }

  private toggleReactions() {
    const r = $('reactions');
    r.hidden = !r.hidden;
    if (r.hidden) return;
    r.innerHTML = ['👋', '👍', '😂', '🎉', '❤️', '☕', '👀', '🙏'].map((e) => `<button>${e}</button>`).join('');
    r.onclick = (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b) { this.app.react(b.textContent!); r.hidden = true; }
    };
  }

  renderFocus() {
    const app = this.app;
    const pill = $('focusPill');
    const f = app.focus;
    if (!f) {
      // roda a cada segundo: só refaz quando muda
      if (pill.dataset.idle === String(app.guest)) return;
      pill.dataset.idle = String(app.guest);
      pill.innerHTML = app.guest ? '' : `<span class="lbl">${icon('focus')}Foco coletivo</span><button class="pill-btn" id="focusNew">Começar sessão</button>`;
      if (!app.guest) $('focusNew').onclick = () => app.panels.open('foco');
      return;
    }
    delete pill.dataset.idle;
    const b = app.focusBlock();
    const left = Math.max(0, Math.round(b?.left ?? 0));
    const mm = Math.floor(left / 60), ss = left % 60;
    const total = (b?.minutes ?? 1) * 60;
    const joined = f.participants.includes(app.me);
    const faces = f.participants.slice(0, 4).map((id) => this.avatarImg(id, 22)).join('') + (f.participants.length > 4 ? `<i>+${f.participants.length - 4}</i>` : '');
    const pause = b?.kind === 'pausa';
    pill.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" stroke-opacity=".18" stroke-width="2.4"/><circle cx="9" cy="9" r="7" fill="none" stroke="${pause ? '#22c55e' : '#8b5cf6'}" stroke-width="2.4" stroke-dasharray="44" stroke-dashoffset="${(44 * (left / total)).toFixed(1)}" transform="rotate(-90 9 9)" stroke-linecap="round"/></svg><span class="lbl">${pause ? 'Pausa' : 'Foco coletivo'} · bloco ${(b?.index ?? 0) + 1}/${f.blocks.length}</span><span class="t">${mm}:${String(ss).padStart(2, '0')}</span><span class="faces">${faces}</span>${app.guest ? '' : `<button class="pill-btn${joined ? ' on' : ''}" id="focusJoin">${joined ? 'Sair' : 'Participar'}</button>`}`;
    if (!app.guest) $('focusJoin').onclick = () => app.send({ t: joined ? 'focusLeave' : 'focusJoin' });
  }

  renderConnection() {
    const s = this.app.netState;
    const media = this.app.media.state;
    const el = $('conn');
    const msg = s === 'reconnecting' ? 'Conexão perdida. Tentando reconectar…' : media === 'reconnecting' ? 'Áudio e vídeo reconectando…' : media === 'failed' ? 'Não foi possível conectar o áudio e o vídeo. Tente de novo pelo microfone.' : '';
    el.hidden = !msg;
    el.innerHTML = msg ? `${icon('wifiOff')}${msg}` : '';
    if (s === 'replaced') this.screen('replaced');
    if (s === 'forbidden') this.screen('forbidden');
  }

  /** Telas que cobrem o escritório: aguardando entrada, outra aba, saída. */
  screen(kind: 'waiting' | 'replaced' | 'left' | 'refused' | 'forbidden' | null) {
    const el = $('screen');
    if (!kind) { el.hidden = true; return; }
    const app = this.app;
    const t: Record<string, [string, string, string]> = {
      waiting: ['Aguardando o anfitrião', 'Avisamos quem convidou você. Assim que for admitido, você entra no escritório.', ''],
      replaced: ['O escritório está aberto em outra aba', 'Para não duplicar sua presença, só uma aba fica conectada.', '<button class="btn primary" id="scrAgain">Usar nesta aba</button>'],
      left: ['Você saiu do escritório', 'Seu avatar foi removido do mapa. Bilhetes deixados na sua mesa continuam guardados.', '<button class="btn primary" id="scrAgain">Entrar de novo</button>'],
      refused: ['Entrada não autorizada', 'O anfitrião não pôde receber você agora.', ''],
      forbidden: ['Acesso indisponível', 'Seu acesso a este escritório foi removido ou expirou.', '<button class="btn primary" id="scrAgain">Voltar ao início</button>'],
    };
    const [title, sub, act] = t[kind];
    el.innerHTML = `<div class="screen-card"><span class="logo">${icon(kind === 'waiting' ? 'door' : kind === 'left' ? 'exit' : 'users')}</span><h2>${title}</h2><p>${sub}</p>${act}</div>`;
    el.hidden = false;
    document.getElementById('scrAgain')?.addEventListener('click', () => location.reload());
    void app;
  }
}

const areaIcon: Record<string, string> = {
  sala: 'users', hub: 'coffee', reuniao: 'screen',
};
