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
    // em telas menores fica só o essencial, numa linha
    $('hint').innerHTML = `<span><kbd>WASD</kbd> andar</span><span class="opt"><kbd>E</kbd> usar</span><span><kbd>M</kbd> mic</span><span><kbd>V</kbd> câmera</span><span class="opt"><kbd>Alt</kbd> nomes</span><span><kbd>?</kbd> atalhos</span>`;
    $('searchIcon').innerHTML = icon('search');
  }

  readonly exitAsk = document.createElement('div');
  private announceEl = document.createElement('div');

  /** Faixa no alto da cena enquanto alguém fala para o ambiente. */
  renderAnnounce() {
    const app = this.app, a = app.announce;
    const el = this.announceEl;
    if (!el.parentElement) { el.className = 'announce-bar'; $('stage').appendChild(el); }
    const here = !!a && app.here === a.space;
    el.hidden = !here;
    if (!a || !here) return;
    const mine = a.by === app.me;
    const left = Math.max(0, Math.ceil((a.until - app.now()) / 1000));
    el.innerHTML = `${icon('volume')}<span>${mine ? `Você está falando para ${a.space === 'sala' ? 'a sala toda' : 'o hub todo'}` : `${esc(app.shortName(a.by))} está falando para ${a.space === 'sala' ? 'a sala' : 'o hub'}`} · ${left} s</span>${mine ? '<button id="annStop">Encerrar</button>' : ''}`;
    document.getElementById('annStop')?.addEventListener('click', () => app.toggleAnnounce());
  }
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
    this.renderTop();
    if (this.app.announce) this.renderAnnounce();
    this.app.notify.tick();
    const me = this.app.myPresence;
    $('crumb').textContent = me ? areaAt(me.x, me.z)?.name ?? '' : '';
  }

  /** Pedidos esperando resposta mais bilhetes não lidos: o que precisa da pessoa. */
  pendingCount() {
    return this.app.notify.pending.length + this.app.notes.filter((n) => !n.readAt).length;
  }

  renderTop() {
    const app = this.app;
    $('officeName').textContent = app.settings.officeName;
    const night = app.sc.theme === 'night';
    $('themeBtn').innerHTML = icon(night ? 'sun' : 'moon');
    $('themeBtn').title = night ? 'Modo claro' : 'Modo escuro';
    $('themeBtn').setAttribute('aria-label', night ? 'Modo claro' : 'Modo escuro');
    // um contador só, com número: pedidos abertos e bilhetes não lidos; o ponto é novidade sem número
    const n = this.pendingCount();
    $('bell').innerHTML = `${icon('bell')}${n ? `<i class="badge num">${n > 9 ? '9+' : n}</i>` : app.notify.unread ? '<i class="badge"></i>' : ''}`;
    $('bell').title = n ? `${n} ${n === 1 ? 'pendência' : 'pendências'}` : 'Avisos';
    // com a aba escondida, o título e o ícone da aba mostram que há algo esperando
    const first = app.notify.pending[0]?.text;
    document.title = n ? `(${n}) ${app.settings.officeName}${first ? ` · ${first}` : ''}` : app.settings.officeName;
    setFavicon(n > 0);
  }

  avatarImg(id: string, size = 32) {
    const u = this.app.users.get(id);
    return `<img src="${this.app.portraits[id] ?? ''}" width="${size}" height="${size}" alt="" style="background:${u?.color ?? '#888'}22"/>`;
  }

  renderMe() {
    const app = this.app;
    const s = app.displayStatus(app.me);
    const p = app.myPresence;
    const html = `<span class="av" style="width:28px;height:28px">${this.avatarImg(app.me, 28)}</span><span class="sdot" style="background:${STATUS_COLOR[s]}"></span>${STATUS_LABEL[s]}${p?.note ? `<small>${esc(p.note)}</small>` : ''}${icon('chev')}`;
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
        `<div class="note-row"><input id="statusNote" maxlength="80" placeholder="Mensagem curta de status" value="${esc(p?.note ?? '')}"/><button class="chipbtn save" id="statusSave">Salvar</button></div>` +
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
    const saveNote = () => {
      const note = $<HTMLInputElement>('statusNote').value.trim();
      app.setStatus(app.myPresence?.status ?? 'disp', note, note ? until() : 0);
      m.hidden = true;
    };
    $<HTMLInputElement>('statusNote')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveNote(); });
    document.getElementById('statusSave')?.addEventListener('click', (e) => { e.stopPropagation(); saveNote(); });
  }

  /** Abre o criador de avatar; `welcome` é a primeira entrada de quem ainda não tem um. */
  editAvatar(welcome = false) {
    const app = this.app;
    const u = app.users.get(app.me)!;
    // na primeira entrada, depois do avatar vem o guia rápido
    openAvatarEditor(resolveLook(u.look, u.model), u.name, (look) => app.saveLook(look).then(() => { if (welcome) setTimeout(() => this.guide(), 700); }), { welcome });
  }

  /**
   * Guia de primeira entrada, apontando para os elementos de verdade; termina oferecendo os
   * avisos fora da página. Aparece uma vez (fica guardado no navegador).
   */
  guide() {
    try { if (localStorage.getItem(GUIDE_KEY)) return; } catch { /* sem armazenamento: mostra */ }
    const app = this.app;
    const canNotify = 'Notification' in window && Notification.permission === 'default';
    const steps: { at: string; title: string; text: string; notify?: boolean }[] = [
      { at: '#viewport', title: 'Chegue perto de alguém para conversar', text: 'A conversa abre sozinha quando duas pessoas param uma ao lado da outra. Clique no chão para andar, ou use WASD.' },
      { at: '#dock', title: 'Microfone e câmera começam desligados', text: 'Ligue quando estiver numa conversa: botões aqui embaixo, ou as teclas M e V.' },
      { at: '#viewport', title: 'Clique nos objetos', text: 'Quadro, rádio, café, jogo e portas mostram o que fazem quando o mouse passa por cima.' },
      { at: '#spaces', title: 'Lugares leva você aonde quiser', text: 'Hub (café, jogo e sugestões) e sala de reunião. Clique e o boneco vai sozinho pelas portas. A tecla ? mostra os atalhos.' },
      ...(canNotify ? [{ at: '#bell', title: 'Quer ser avisado com a aba escondida?', text: 'Quando alguém pedir para falar, bater na porta ou deixar um bilhete, o navegador avisa mesmo com o Virtuta em segundo plano.', notify: true }] : []),
    ];
    const card = document.createElement('div');
    card.className = 'guide';
    document.body.appendChild(card);
    let i = 0;
    const done = () => { card.remove(); try { localStorage.setItem(GUIDE_KEY, '1'); } catch { /* vale só agora */ } };
    const show = () => {
      const st = steps[i];
      const last = i === steps.length - 1;
      card.innerHTML = `<small>${i + 1} de ${steps.length}</small><b>${st.title}</b><p>${st.text}</p><div class="row">${st.notify
        ? '<button class="btn soft" data-g="skip">Agora não</button><button class="btn primary" data-g="notify">Ativar avisos</button>'
        : `<button class="btn soft" data-g="skip">Pular</button><button class="btn primary" data-g="next">${last ? 'Começar' : 'Próximo'}</button>`}</div>`;
      // ao lado do elemento apontado, sem sair da tela
      const r = document.querySelector(st.at)!.getBoundingClientRect();
      const w = 320, h = card.offsetHeight;
      let x = r.left + r.width / 2 - w / 2, y = r.top + r.height / 2 - h / 2;
      if (st.at === '#dock') y = r.top - h - 14;
      if (st.at === '#spaces') { x = r.right + 14; y = r.top; }
      if (st.at === '#bell') { x = r.right - w; y = r.bottom + 12; }
      card.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, x))}px`;
      card.style.top = `${Math.max(12, Math.min(innerHeight - h - 12, y))}px`;
      card.dataset.at = st.at.slice(1);
      card.querySelector<HTMLButtonElement>('.btn.primary')!.focus();
    };
    card.addEventListener('click', async (e) => {
      const g = (e.target as HTMLElement).closest<HTMLElement>('[data-g]')?.dataset.g;
      if (!g) return;
      if (g === 'notify') await app.notify.enableBrowser();
      if (g === 'next' && i < steps.length - 1) { i++; return show(); }
      done();
    });
    show();
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
      return `<button class="prow${id === app.me ? ' me' : ''}${on ? '' : ' off'}" data-id="${id}" title="${esc(app.name(id))} · ${esc(sub)}"><span class="av">${this.avatarImg(id)}<i class="sdot" style="background:${on ? STATUS_COLOR[s] : 'transparent'};${on ? '' : 'box-shadow: inset 0 0 0 2px var(--mut)'}"></i></span><span class="who"><b>${esc(app.name(id))}</b><small>${esc(sub)}</small></span>${hand}${weak}${live}</button>`;
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
    const annMine = app.announce?.by === app.me, annOther = !!app.announce && !annMine;
    const b = (id: string, ic: string, tip: string, cls = '', text = '') => `<button class="db ${cls}" id="${id}" aria-label="${tip}">${icon(ic)}${text ? `<span class="lbl">${text}</span>` : ''}<span class="tip">${tip}</span></button>`;
    const busy = m.state === 'connecting' ? ' busy' : '';
    $('dock').innerHTML =
      // desligado é o normal do dia: cinza; vermelho só para quem está mudo dentro de uma conversa
      b('dMic', m.mic ? 'mic' : 'micOff', m.mic ? 'Desligar microfone (M)' : app.conv ? 'Você está sem microfone nesta conversa. Ligar (M)' : 'Ligar microfone (M)', (m.mic ? 'on' : app.conv ? 'off alert' : 'off') + busy) +
      b('dCam', m.cam ? 'cam' : 'camOff', m.cam ? 'Desligar câmera (V)' : 'Ligar câmera (V)', (m.cam ? 'on' : 'off') + busy) +
      b('dShare', 'screen', m.screen ? 'Parar de compartilhar' : canShare ? 'Compartilhar tela' : 'Entre numa conversa para apresentar', (m.screen ? 'active' : '') + (canShare ? '' : ' disabled')) +
      b('dDev', 'settings', 'Dispositivos') +
      '<span class="div"></span>' +
      b('dHand', 'hand', hand ? 'Baixar a mão' : 'Levantar a mão', hand ? 'active' : '') + b('dReact', 'smile', 'Reações') +
      (!app.guest && (app.here === 'sala' || app.here === 'hub') ? b('dAnn', 'volume', annMine ? 'Encerrar o anúncio' : annOther ? `${app.shortName(app.announce!.by)} está falando para ${app.announce!.space === 'sala' ? 'a sala' : 'o hub'}` : `Falar para ${app.here === 'sala' ? 'a sala toda' : 'o hub todo'} (até 1 min)`, annMine ? 'active' : annOther ? 'disabled' : '') : '') +
      (app.guest ? '' : '<span class="div"></span>' +
        b('dCafe', 'coffee', coffee ? 'Voltar para a mesa' : afk ? 'Ficar disponível' : 'Fui tomar café', afk ? 'active' : '', coffee ? 'Voltei' : afk ? 'Disponível' : 'Café') +
        // durante a sessão coletiva, o foco individual não se aplica (a sessão se controla no topo)
        (session
          ? b('dFocus', 'focus', 'Você está na sessão de foco coletivo (controle no topo)', 'focus-on disabled', 'Na sessão coletiva')
          : b('dFocus', 'lock', solo ? 'Sair do "Foco só meu"' : 'Foco só meu: ninguém entra em conversa automática', solo ? 'focus-on' : '', 'Foco só meu'))) +
      '<span class="div"></span>' + b('dExit', 'exit', 'Sair do escritório', 'exit');
    $('dMic').onclick = () => void app.toggleMic();
    $('dCam').onclick = () => void app.toggleCam();
    $('dShare').onclick = () => void app.toggleScreen();
    $('dDev').onclick = () => void app.panels.openDevices();
    $('dHand').onclick = () => app.raiseHand();
    document.getElementById('dAnn')?.addEventListener('click', () => app.toggleAnnounce());
    $('dReact').onclick = () => this.toggleReactions();
    $('dExit').onclick = () => this.askExit();
    if (!app.guest) {
      $('dCafe').onclick = () => (coffee ? app.back() : afk ? app.setStatus('disp') : app.goAfk());
      $('dFocus').onclick = () => { if (!session) app.toggleFocus(); };
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
    // conta só os blocos de foco ("Foco 1 de 4"); a pausa aparece à parte
    const focos = f.blocks.filter((x) => x.kind === 'foco').length;
    const nth = f.blocks.slice(0, (b?.index ?? 0) + 1).filter((x) => x.kind === 'foco').length;
    const label = pause ? `Pausa · depois, foco ${nth + 1} de ${focos}` : `Foco coletivo · ${nth} de ${focos}`;
    pill.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" stroke-opacity=".18" stroke-width="2.4"/><circle cx="9" cy="9" r="7" fill="none" stroke="${pause ? '#22c55e' : '#8b5cf6'}" stroke-width="2.4" stroke-dasharray="44" stroke-dashoffset="${(44 * (left / total)).toFixed(1)}" transform="rotate(-90 9 9)" stroke-linecap="round"/></svg><span class="lbl">${label}</span><span class="t">${mm}:${String(ss).padStart(2, '0')}</span><span class="faces">${faces}</span>${app.guest ? '' : `<button class="pill-btn${joined ? ' quiet' : ''}" id="focusJoin">${joined ? 'Sair' : 'Participar'}</button>`}`;
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
    if (s === 'expired') this.screen('expired');
  }

  private mediaDismissed = false;

  /** Telas que cobrem o escritório: aguardando entrada, outra aba, saída. */
  screen(kind: 'waiting' | 'replaced' | 'left' | 'refused' | 'forbidden' | 'expired' | null) {
    const el = $('screen');
    if (!kind) { el.hidden = true; return; }
    const app = this.app;
    const t: Record<string, [string, string, string]> = {
      waiting: ['Aguardando o anfitrião', 'Avisamos quem convidou você. Assim que for admitido, você entra no escritório.', ''],
      replaced: ['O escritório está aberto em outra aba', 'Para não duplicar sua presença, só uma aba fica conectada.', '<button class="btn primary" id="scrAgain">Usar nesta aba</button>'],
      left: ['Você saiu do escritório', 'Seu avatar foi removido do mapa. Bilhetes deixados na sua mesa continuam guardados.', '<button class="btn primary" id="scrAgain">Entrar de novo</button>'],
      refused: ['Entrada não autorizada', 'O anfitrião não pôde receber você agora.', ''],
      forbidden: ['Acesso indisponível', 'Seu acesso a este escritório foi removido ou expirou.', '<button class="btn primary" id="scrAgain">Voltar ao início</button>'],
      expired: ['Sua sessão terminou', 'Por segurança, é preciso entrar de novo.', '<button class="btn primary" id="scrAgain">Entrar de novo</button>'],
    };
    const [title, sub, act] = t[kind];
    el.innerHTML = `<div class="screen-card"><span class="logo">${icon(kind === 'waiting' ? 'door' : kind === 'left' ? 'exit' : 'users')}</span><h2>${title}</h2><p>${sub}</p>${act}</div>`;
    el.hidden = false;
    document.getElementById('scrAgain')?.addEventListener('click', () => (kind === 'expired' ? (location.href = '/') : location.reload()));
    void app;
  }
}

const GUIDE_KEY = 'virtuta.guide';

/** Ícone da aba com um ponto vermelho quando há pendências. */
let faviconOn: boolean | null = null;
function setFavicon(on: boolean) {
  if (faviconOn === on) return;
  faviconOn = on;
  const dot = on ? "%3Ccircle cx='19' cy='5' r='5' fill='%23e5484d' stroke='white' stroke-width='1.5'/%3E" : '';
  const href = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='7' fill='%233b5bdb'/%3E%3Cpath d='M7 8l5 9 5-9' stroke='white' stroke-width='2.4' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E${dot}%3C/svg%3E`;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) link.href = href;
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
