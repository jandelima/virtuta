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
      const t = e.target as HTMLElement;
      const m = $('statusMenu');
      if (!m.hidden && !t.closest('.me-wrap')) m.hidden = true;
      // reações, confirmação de saída e atalhos fecham com um clique fora deles
      if (!t.closest('.dock, #reactions, #exitAsk')) { $('reactions').hidden = true; this.exitAsk.hidden = true; }
      if (!t.closest('#keys, #zKeys')) this.keys.hidden = true;
    });
    this.exitAsk.id = 'exitAsk';
    this.exitAsk.className = 'reactions exit-ask';
    this.exitAsk.hidden = true;
    this.keys.id = 'keys';
    this.keys.className = 'keys-card';
    this.keys.hidden = true;
    this.keys.innerHTML = `<b>Atalhos</b>${[
      ['WASD ou setas', 'andar'], ['Clique', 'andar até o ponto ou usar o objeto'], ['E', 'usar o objeto mais perto'],
      ['M', 'ligar ou desligar o microfone'], ['V', 'ligar ou desligar a câmera'], ['Alt', 'mostrar todos os nomes'],
      ['Ctrl K', 'buscar pessoas'], ['Esc', 'fechar painel ou menu'], ['?', 'esta lista'],
    ].map(([k, t]) => `<span><kbd>${k}</kbd>${t}</span>`).join('')}`;
    $('stage').append(this.exitAsk, this.keys);
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
      if (id === app.me) return;
      // offline: abre o painel da pessoa só com o bilhete
      if (!app.presence.has(id)) return app.panels.openPerson(id);
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
    $('zoom').innerHTML = `<button id="zIn" aria-label="Aproximar" title="Aproximar">${icon('plus')}</button><button id="zOut" aria-label="Afastar" title="Afastar">${icon('minus')}</button><button id="zMe"></button><button id="zKeys" aria-label="Atalhos de teclado" title="Atalhos de teclado (?)"><b>?</b></button>`;
    $('zIn').onclick = () => { app.sc.zoom = Math.min(2.4, app.sc.zoom * 1.25); this.renderZoom(); };
    $('zOut').onclick = () => { app.sc.zoom = Math.max(0.5, app.sc.zoom / 1.25); this.renderZoom(); };
    $('zMe').onclick = () => { app.followId = null; app.sc.toggleWhole(); this.renderZoom(); };
    $('zKeys').onclick = () => this.openShortcuts();
    this.renderZoom();
    $('hint').innerHTML = `<span><kbd>WASD</kbd> andar</span><span><kbd>E</kbd> usar</span><span><kbd>M</kbd> mic</span><span><kbd>V</kbd> câmera</span><span><kbd>Alt</kbd> nomes</span>`;
    $('searchIcon').innerHTML = icon('search');
  }

  readonly exitAsk = document.createElement('div');
  readonly keys = document.createElement('div');

  /** O botão de enquadramento diz o que faz agora: ver o ambiente inteiro ou voltar para a pessoa. */
  renderZoom() {
    const whole = this.app.sc.isWhole();
    const b = $('zMe');
    b.hidden = !this.app.sc.canWhole();
    const label = whole ? 'Voltar para você' : 'Ver o ambiente inteiro';
    b.innerHTML = icon(whole ? 'locate' : 'maximize');
    b.setAttribute('aria-label', label);
    b.title = label;
  }

  openShortcuts() {
    this.keys.hidden = !this.keys.hidden;
  }

  /** Fecha menu de status, reações, confirmação de saída e atalhos; diz se havia algum aberto. */
  closePopups() {
    const open = [$('statusMenu'), $('reactions'), this.exitAsk, this.keys].filter((el) => !el.hidden);
    open.forEach((el) => (el.hidden = true));
    return open.length > 0;
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
    this.renderMe();
    this.renderZoom();
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
    const html = `<span class="av" style="width:28px;height:28px">${this.avatarImg(app.me, 28)}</span><span class="sdot" style="background:${STATUS_COLOR[s]}"></span>${STATUS_LABEL[s]}${p?.note ? `<small>${esc(p.note)}</small>` : ''}${unread ? `<span class="count" title="Bilhetes não lidos">${unread}</span>` : ''}${icon('chev')}`;
    // roda a cada segundo: só refaz quando muda
    const el = $('me');
    if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  }

  private renderMenu() {
    const app = this.app;
    const p = app.myPresence;
    const opt = (s: 'disp' | 'foco' | 'afk', label: string) => `<button data-s="${s}"><span class="sdot" style="background:${STATUS_COLOR[s]}"></span>${label}${p?.status === s ? icon('check', 'tick') : ''}</button>`;
    const member = !app.guest;
    const unread = app.notes.filter((n) => !n.readAt).length;
    $('statusMenu').innerHTML =
      (member ? opt('disp', 'Disponível') + opt('foco', 'Em foco') + opt('afk', 'Ausente') +
        `<input id="statusNote" maxlength="80" placeholder="Mensagem curta de status (Enter)" value="${esc(p?.note ?? '')}"/>` +
        `<div class="presets-row">${PRESETS.map(([label], i) => `<button class="chipbtn" data-preset="${i}">${label}</button>`).join('')}</div>` +
        `<label class="until">Apagar a mensagem<select id="statusUntil">${UNTIL.map(([label, v]) => `<option value="${v}">${label}</option>`).join('')}</select></label>` +
        (p?.note && app.statusUntil ? `<small class="until-now">Some ${untilText(app.statusUntil)}</small>` : '') + '<hr/>' +
        `<button data-act="notes">${icon('note')}Meus bilhetes${unread ? ` <span class="count">${unread}</span>` : ''}</button>` +
        `<button data-act="avatar">${icon('user')}Personalizar avatar</button>` : '') +
      `<button data-act="devices">${icon('settings')}Microfone, câmera e som</button>` +
      (member ? `<button data-act="invite">${icon('userPlus')}Convidar visitante</button>` : '') +
      (app.role === 'admin' ? `<button data-act="admin">${icon('shield')}Administração</button>` : '') +
      `<hr/><button data-act="logout">${icon('logout')}Sair da conta</button>`;
    const m = $('statusMenu');
    const until = () => untilAt($<HTMLSelectElement>('statusUntil')?.value ?? '');
    m.onclick = (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      if (b.dataset.preset) {
        // mensagens prontas: já trazem o estado e um prazo que faz sentido
        const [, note, status, mins] = PRESETS[Number(b.dataset.preset)];
        app.setStatus(status, note, Date.now() + mins * 60000);
      }
      if (b.dataset.s) {
        const s = b.dataset.s as 'disp' | 'foco' | 'afk';
        const note = s === 'disp' ? '' : ($<HTMLInputElement>('statusNote').value.trim() || (s === 'afk' ? 'Volto já' : 'Em foco'));
        app.setStatus(s, note, note ? until() : 0);
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
      app.setStatus(app.myPresence?.status ?? 'disp', note, note ? until() : 0);
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
      // reunião de porta fechada: quem está fora vê antes de atravessar o hub
      const locked = a.id === 'reuniao' && !app.doorOpen;
      const sub = locked ? `<small class="locked" title="Porta fechada: é preciso bater">${icon('lock')}${n ? `${n} · ` : ''}fechada</small>` : `<small>${n || ''}</small>`;
      return `<button class="space-row${a.id === me ? ' on' : ''}" data-area="${a.id}" title="${esc(locked ? 'Porta fechada: para entrar, bata e espere alguém de dentro autorizar' : a.hint)}"><span class="sic">${icon(areaIcon[a.id] ?? 'building')}</span><b>${a.name}</b>${sub}</button>`;
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
      // ícone de conversa (não de microfone: estar em conversa não quer dizer microfone ligado)
      const live = on && inConv.has(id) && id !== app.me ? `<span class="live" title="Em conversa">${icon('chat')}</span>` : '';
      const hand = on && app.presence.get(id)?.hand ? '<span class="hand" title="Mão levantada">✋</span>' : '';
      const weak = app.presence.get(id)?.unstable ? `<span class="weak" title="Conexão instável">${icon('wifiOff')}</span>` : '';
      return `<button class="prow${id === app.me ? ' me' : ''}${on ? '' : ' off'}" data-id="${id}"><span class="av">${this.avatarImg(id)}<i class="sdot" style="background:${on ? STATUS_COLOR[s] : 'transparent'};${on ? '' : 'box-shadow: inset 0 0 0 2px var(--mut)'}"></i></span><span class="who"><b>${esc(app.name(id))}</b><small>${esc(sub)}</small></span>${hand}${weak}${live}</button>`;
    };
    const found = sorted.filter(match), foundOff = offline.filter(match);
    const html = found.map((id) => row(id, true)).join('') + (foundOff.length ? `<div class="sub-sec">Offline</div>${foundOff.map((id) => row(id, false)).join('')}` : '') +
      (q && !found.length && !foundOff.length ? `<p class="empty people-empty">Ninguém encontrado para “${esc(q)}”.</p>` : '');
    const el = $('people');
    if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
    $('count').textContent = `${online.filter((id) => app.users.get(id)?.role !== 'guest').length} online`;
  }

  renderDock() {
    const app = this.app;
    const m = app.media;
    const p = app.myPresence;
    const afk = p?.status === 'afk';
    // "Voltei" é para quem foi ao café; ausente pelo menu volta pelo próprio menu ou aqui, sem andar
    const coffee = afk && p?.note === 'Fui tomar café';
    const session = !!app.focus?.participants.includes(app.me);
    const solo = !session && p?.status === 'foco';
    const hand = !!p?.hand;
    const canShare = !!app.conv || m.screen;
    const b = (id: string, ic: string, tip: string, cls = '', text = '') => `<button class="db ${cls}" id="${id}" aria-label="${tip}">${icon(ic)}${text}<span class="tip">${tip}</span></button>`;
    const busy = m.state === 'connecting' ? ' busy' : '';
    $('dock').innerHTML =
      // desligado é o normal do dia: cinza; vermelho só para quem está mudo dentro de uma conversa
      b('dMic', m.mic ? 'mic' : 'micOff', m.mic ? 'Desligar microfone (M)' : app.conv ? 'Você está sem microfone nesta conversa. Ligar (M)' : 'Ligar microfone (M)', (m.mic ? 'on' : app.conv ? 'off alert' : 'off') + busy) +
      b('dCam', m.cam ? 'cam' : 'camOff', m.cam ? 'Desligar câmera (V)' : 'Ligar câmera (V)', (m.cam ? 'on' : 'off') + busy) +
      b('dShare', 'screen', m.screen ? 'Parar de compartilhar' : canShare ? 'Compartilhar tela' : 'Entre numa conversa para apresentar', (m.screen ? 'active' : '') + (canShare ? '' : ' disabled')) +
      b('dDev', 'settings', 'Dispositivos') +
      '<span class="div"></span>' +
      b('dHand', 'hand', hand ? 'Baixar a mão' : 'Levantar a mão', hand ? 'active' : '') + b('dReact', 'smile', 'Reações') +
      (app.guest ? '' : '<span class="div"></span>' +
        b('dCafe', 'coffee', coffee ? 'Voltar para a mesa' : afk ? 'Ficar disponível' : 'Fui tomar café', afk ? 'active' : '', coffee ? 'Voltei' : afk ? 'Disponível' : 'Café') +
        (session
          ? b('dFocus', 'focus', 'Na sessão de foco coletivo: sair pelo topo', 'focus-on', 'Na sessão')
          : b('dFocus', 'lock', solo ? 'Sair do "Em foco"' : 'Em foco (só você): ninguém entra em conversa automática', solo ? 'focus-on' : '', 'Em foco'))) +
      '<span class="div"></span>' + b('dExit', 'exit', 'Sair do escritório', 'exit');
    $('dMic').onclick = () => void app.toggleMic();
    $('dCam').onclick = () => void app.toggleCam();
    $('dShare').onclick = () => void app.toggleScreen();
    $('dDev').onclick = () => void app.panels.openDevices();
    $('dHand').onclick = () => app.raiseHand();
    $('dReact').onclick = () => this.toggleReactions();
    $('dExit').onclick = () => this.askExit();
    if (!app.guest) {
      $('dCafe').onclick = () => (coffee ? app.back() : afk ? app.setStatus('disp') : app.goAfk());
      $('dFocus').onclick = () => app.toggleFocus();
    }
    if (m.needsAudioUnlock) app.notify.audioUnlock();
  }

  /** Sair derruba conversa, rádio e presença: no meio de uma, pergunta antes. */
  private askExit() {
    const app = this.app;
    const others = (app.conv?.members ?? []).filter((id) => id !== app.me);
    const radio = app.radioPlayer.listening;
    if (!others.length && !radio) return app.leaveOffice();
    const what = others.length ? `Você sai da conversa com ${others.length > 2 ? `${others.length} pessoas` : others.map((id) => app.shortName(id)).join(' e ')}${radio ? ' e a rádio para' : ''}.` : 'A rádio para de tocar para você.';
    const a = this.exitAsk;
    a.innerHTML = `<div><b>Sair do escritório?</b><small>${esc(what)}</small></div><button class="btn soft" id="exitNo">Ficar</button><button class="btn danger" id="exitYes">${icon('exit')}Sair</button>`;
    a.hidden = false;
    $('reactions').hidden = true;
    $('exitNo').onclick = () => (a.hidden = true);
    $('exitYes').onclick = () => { a.hidden = true; app.leaveOffice(); };
    $('exitYes').focus();
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
    if (!app.guest) $('focusJoin').onclick = () => (joined ? app.focusLeave() : app.focusJoin());
  }

  renderConnection() {
    const app = this.app;
    const s = app.netState;
    const media = app.media.state;
    const el = $('conn');
    // a falha de áudio e vídeo só importa para quem está numa conversa, e pode ser dispensada
    if (media !== 'failed') this.mediaDismissed = false;
    const failed = media === 'failed' && !!app.conv && !this.mediaDismissed;
    const msg = s === 'reconnecting' ? 'Conexão perdida. Tentando reconectar…' : media === 'reconnecting' && app.conv ? 'Áudio e vídeo reconectando…' : failed ? 'Não foi possível conectar o áudio e o vídeo.' : '';
    const html = msg ? `${icon('wifiOff')}<span>${msg}</span>${failed && s !== 'reconnecting' ? `<button class="conn-btn" id="connRetry">Tentar de novo</button><button class="conn-x" id="connX" aria-label="Fechar">${icon('x')}</button>` : ''}` : '';
    el.hidden = !msg;
    if (el.dataset.html !== html) {
      el.innerHTML = html;
      el.dataset.html = html;
      document.getElementById('connRetry')?.addEventListener('click', () => void app.media.ensure().catch(() => {}));
      document.getElementById('connX')?.addEventListener('click', () => { this.mediaDismissed = true; this.renderConnection(); });
    }
    if (s === 'replaced') this.screen('replaced');
    if (s === 'forbidden') this.screen('forbidden');
  }

  private mediaDismissed = false;

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

/** Mensagens prontas: texto, estado e minutos até sumir. */
const PRESETS: [string, string, 'disp' | 'foco' | 'afk', number][] = [
  ['Almoço', 'Almoçando', 'afk', 60],
  ['Em call externa', 'Em call externa', 'foco', 60],
  ['Volto em 15 min', 'Volto em 15 min', 'afk', 15],
];
const UNTIL: [string, string][] = [['Não apagar', ''], ['Em 30 minutos', '30'], ['Em 1 hora', '60'], ['Em 2 horas', '120'], ['No fim do dia', 'day']];
function untilAt(v: string) {
  if (!v) return 0;
  if (v === 'day') { const d = new Date(); d.setHours(23, 59, 0, 0); return d.getTime(); }
  return Date.now() + Number(v) * 60000;
}
function untilText(t: number) {
  const d = new Date(t);
  return d.toDateString() === new Date().toDateString() ? `às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'amanhã';
}

const areaIcon: Record<string, string> = {
  sala: 'users', hub: 'coffee', reuniao: 'screen',
};
