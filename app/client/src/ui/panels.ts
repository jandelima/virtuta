import type { OfficeApp } from '../app';
import { REUNIAO, inside } from '../../../shared/layout';
import type { FocusBlock, RadioItem, Suggestion, SuggestionKind } from '../../../shared/protocol';
import { STATUS_COLOR } from '../people';
import { icon } from './icons';
import { ago, esc } from './dom';
import { api } from '../api';

// Gaveta lateral com o painel de cada objeto ou função do escritório.

type Kind = 'porta' | 'recepcao' | 'radio' | 'cafe' | 'jogo' | 'foco' | 'sugestoes' | 'pessoa' | 'mesa' | 'bilhetes' | 'outro';

const head = (ic: string, title: string, sub: string) =>
  `<div class="dh"><span class="dic">${icon(ic)}</span><div><b>${esc(title)}</b><small>${esc(sub)}</small></div><button class="iconbtn" data-close aria-label="Fechar">${icon('x')}</button></div>`;

export const SG_KIND: Record<SuggestionKind, string> = { ideia: 'Ideia', melhoria: 'Melhoria', bug: 'Problema' };
const SG_HINT: Record<SuggestionKind, string> = {
  ideia: 'Uma ideia nova para o escritório…',
  melhoria: 'O que poderia funcionar melhor, e como?',
  bug: 'O que aconteceu, onde você estava e o que esperava que acontecesse?',
};
export const sgStatus = (x: Suggestion) => x.status === 'feita' ? '<span class="chip on">Feita</span>' : x.status === 'descartada' ? '<span class="chip">Descartada</span>' : '<span class="chip open">Aberta</span>';

export class Panels {
  private d = document.getElementById('drawer')!;
  private kind: Kind | null = null;
  private arg: string | number | null = null;

  constructor(private app: OfficeApp) {
    this.d.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-close]')) this.close(); });
  }

  /** Mostra um conteúdo qualquer na gaveta. */
  show(html: string, bind?: (d: HTMLElement) => void, kind: Kind = 'outro', arg: string | number | null = null) {
    this.runCleanup();
    this.kind = kind;
    this.arg = arg;
    this.d.innerHTML = html;
    this.d.hidden = false;
    bind?.(this.d);
  }

  close() {
    this.runCleanup();
    this.d.hidden = true;
    this.kind = null;
  }

  /** Função chamada quando o painel atual sai (ex.: desligar a câmera de teste). */
  onLeave(fn: () => void) { this.cleanup = fn; }
  private cleanup: (() => void) | null = null;
  private runCleanup() {
    const fn = this.cleanup;
    this.cleanup = null;
    fn?.();
  }

  /**
   * Atualiza o painel aberto quando o estado dele muda no servidor, sem perder o que a pessoa
   * está digitando: os campos voltam com o texto, o foco e a posição do cursor.
   */
  refresh(kind: Kind) {
    if (this.kind !== kind || this.d.hidden) return;
    const fields = [...this.d.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[id], textarea[id]')].map((f) => ({ id: f.id, value: f.value, focus: document.activeElement === f, a: f.selectionStart, b: f.selectionEnd }));
    const scroll = this.d.querySelector('.db2')?.scrollTop ?? 0;
    if (kind === 'pessoa') this.openPerson(String(this.arg));
    else this.open(kind);
    for (const f of fields) {
      const el = this.d.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${f.id}`);
      if (!el || el.type === 'checkbox' || el.type === 'range') continue;
      el.value = f.value;
      if (f.focus) { el.focus(); try { el.setSelectionRange(f.a, f.b); } catch { /* campo sem cursor */ } }
    }
    const body = this.d.querySelector('.db2');
    if (body) body.scrollTop = scroll;
  }

  open(kind: string) {
    const fn: Record<string, () => void> = {
      porta: () => this.door(), recepcao: () => this.reception(), radio: () => this.radio(), cafe: () => this.cafe(),
      jogo: () => this.game(), foco: () => this.focus(), sugestoes: () => void this.suggestions(),
    };
    fn[kind]?.();
  }

  // ---------- pessoa ----------
  openPerson(id: string) {
    const app = this.app;
    const u = app.users.get(id);
    if (!u) return;
    const online = app.presence.has(id);
    const s = online ? app.displayStatus(id) : 'afk';
    const member = !app.guest && u.role !== 'guest';
    const busy = s === 'foco' || s === 'afk';
    const first = esc(u.name.split(' ')[0]);
    const hand = online && app.presence.get(id)?.hand;
    // o cabeçalho já traz nome e situação; o retrato ganha só o que o cabeçalho não diz
    this.show(`<div class="dh"><span class="av" style="width:40px;height:40px">${app.shell.avatarImg(id, 40)}<i class="sdot" style="background:${online ? STATUS_COLOR[s] : 'transparent'};${online ? '' : 'box-shadow: inset 0 0 0 2px var(--mut)'}"></i></span><div><b>${esc(u.name)}</b><small>${esc(app.statusLine(id))}</small></div>${u.role === 'guest' ? '<span class="chip">Visitante</span>' : ''}${hand ? '<span class="chip open">✋ Mão levantada</span>' : ''}<button class="iconbtn" data-close aria-label="Fechar">${icon('x')}</button></div>
      <div class="db2">
        ${online && busy ? `<p class="hint-box">${icon(s === 'foco' ? 'focus' : 'coffee')}${s === 'foco' ? 'Em foco: o pedido chega sem som e pode ser recusado.' : 'Ausente no momento.'}</p>` : ''}
        ${online ? `<h4>Posso falar?</h4>
        <div class="form inline"><input id="knockText" maxlength="120" placeholder="Assunto (opcional)"/><button class="btn primary" id="knock">${icon('hand')}Pedir para falar</button></div>
        <button class="btn soft wide" id="goto">${icon('locate')}Ir até ${first}</button>` : `<p class="hint-box">${icon('note')}${first} está offline. Um bilhete na mesa fica guardado até a volta.</p>`}
        ${member ? `<h4>Bilhete na mesa</h4>${online ? '<p class="muted">Fica guardado na mesa, mesmo se a pessoa sair.</p>' : ''}<textarea id="noteText" maxlength="600" placeholder="Escreva um bilhete para ${first}"></textarea><button class="btn ${online ? 'soft' : 'primary'}" id="sendNote">${icon('note')}Deixar bilhete</button>` : ''}
      </div>`, (d) => {
      const knock = () => {
        app.send({ t: 'knock', to: id, text: d.querySelector<HTMLInputElement>('#knockText')!.value.trim() });
        app.notify.toast(`Pedido enviado para ${u.name}.`, { log: false });
        this.close();
      };
      d.querySelector('#knock')?.addEventListener('click', knock);
      d.querySelector('#knockText')?.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') knock(); });
      d.querySelector('#goto')?.addEventListener('click', () => {
        const p = app.presence.get(id);
        if (p) app.walkTo(p.x + 0.7, p.z + 0.4);
        this.close();
      });
      d.querySelector('#sendNote')?.addEventListener('click', () => this.sendNote(id, d));
      // a caixa da ação principal já recebe o cursor
      d.querySelector<HTMLElement>(online ? '#knockText' : '#noteText')?.focus();
    }, 'pessoa', id);
  }

  private sendNote(to: string, d: HTMLElement) {
    const t = d.querySelector<HTMLTextAreaElement>('#noteText');
    const text = t?.value.trim();
    if (!text) return t?.focus();
    this.app.send({ t: 'note', to, text });
    this.app.notify.toast(`Bilhete deixado na mesa de ${this.app.name(to)}.`, { log: false });
    this.close();
  }

  // ---------- mesas e bilhetes ----------
  openDesk(index: number) {
    const app = this.app;
    const owner = [...app.users.values()].find((u) => u.desk === index);
    if (owner?.id === app.me) return this.openMyNotes();
    if (!owner) {
      return this.show(`${head('users', 'Mesa livre', 'Sala da equipe')}<div class="db2"><p class="muted">Esta mesa ainda não tem dono. A administração define as mesas de cada integrante.</p></div>`, undefined, 'mesa', index);
    }
    const unread = app.noteCounts[owner.id] ?? 0;
    this.show(`${head('note', `Mesa de ${owner.name}`, app.presence.has(owner.id) ? app.statusLine(owner.id) : 'Offline')}
      <div class="db2">
        ${unread ? `<p class="hint-box">${icon('note')}${unread === 1 ? 'Há 1 bilhete esperando' : `Há ${unread} bilhetes esperando`} ${esc(owner.name.split(' ')[0])}.</p>` : ''}
        <h4>Deixar bilhete</h4>
        <textarea id="noteText" maxlength="600" placeholder="Escreva um bilhete para ${esc(owner.name.split(' ')[0])}"></textarea>
        <button class="btn primary" id="sendNote">${icon('note')}Deixar bilhete na mesa</button>
      </div>`, (d) => {
      d.querySelector('#sendNote')!.addEventListener('click', () => this.sendNote(owner.id, d));
      d.querySelector<HTMLElement>('#noteText')!.focus();
    }, 'mesa', index);
  }

  openMyNotes() {
    const app = this.app;
    const notes = app.notes;
    const unread = notes.filter((n) => !n.readAt).length;
    // quem abriu os bilhetes já viu o aviso de bilhete novo
    app.notify.dismiss('note-', true);
    const sub = !notes.length ? 'Nenhum bilhete' : unread ? (unread === 1 ? '1 não lido' : `${unread} não lidos`) : 'Todos lidos';
    this.show(`${head('note', 'Bilhetes na sua mesa', sub)}
      <div class="db2">${unread > 1 ? `<button class="btn soft" id="readAll">${icon('check')}Marcar todos como lidos</button>` : ''}<div class="notes">${notes.length ? notes.map((n) => `<div class="note${n.readAt ? ' read' : ''}" data-id="${n.id}"><p>${esc(n.text)}</p><small>${esc(n.fromName)} · ${ago(n.createdAt)}</small><div class="row">${n.readAt ? `<button class="btn soft" data-del="${n.id}">${icon('trash')}Apagar</button>` : `<button class="btn soft" data-read="${n.id}">${icon('check')}Lido</button>`}${app.users.has(n.from) ? `<button class="btn soft" data-reply="${n.from}">${icon('send')}Responder</button>` : ''}</div></div>`).join('') : '<p class="empty">Quando alguém deixar um bilhete na sua mesa, ele aparece aqui.</p>'}</div></div>`, (d) => {
      const done = () => { app.shell.renderMe(); this.openMyNotes(); };
      d.querySelectorAll<HTMLElement>('[data-read]').forEach((b) => b.addEventListener('click', () => {
        const id = Number(b.dataset.read);
        app.send({ t: 'noteRead', id });
        const n = app.notes.find((x) => x.id === id);
        if (n) n.readAt = Date.now();
        done();
      }));
      d.querySelector('#readAll')?.addEventListener('click', () => {
        app.send({ t: 'noteReadAll' });
        for (const n of app.notes) n.readAt ??= Date.now();
        done();
      });
      d.querySelectorAll<HTMLElement>('[data-del]').forEach((b) => b.addEventListener('click', () => {
        const id = Number(b.dataset.del);
        app.send({ t: 'noteDelete', id });
        app.notes = app.notes.filter((x) => x.id !== id);
        done();
      }));
      // responde no painel da pessoa (quem não tem mesa também recebe bilhete)
      d.querySelectorAll<HTMLElement>('[data-reply]').forEach((b) => b.addEventListener('click', () => this.openPerson(b.dataset.reply!)));
    }, 'bilhetes');
  }

  // ---------- quadros ----------
  async openBoard(id: string) {
    this.close();
    const { openBoard } = await import('./board');
    openBoard(this.app, id);
  }

  // ---------- porta da sala de reunião ----------
  private door() {
    const app = this.app;
    const me = app.myPresence;
    const insideRoom = !!me && inside(REUNIAO, me.x, me.z);
    const open = app.doorOpen;
    this.show(`${head(open ? 'unlock' : 'lock', 'Porta da sala de reunião', open ? 'Aberta: quem entra participa da chamada' : 'Fechada: para entrar, é preciso pedir')}
      <div class="db2">
        <p class="muted">${insideRoom ? 'Quem está dentro pode fechar a porta. Com ela fechada, quem chegar bate e alguém de dentro autoriza.' : open ? 'Entre para participar da chamada da sala.' : app.doorAllowed ? 'Sua entrada foi autorizada.' : 'A reunião está com a porta fechada.'}</p>
        ${insideRoom ? `<button class="btn primary wide" id="doorToggle">${icon(open ? 'lock' : 'unlock')}${open ? 'Fechar a porta' : 'Abrir a porta'}</button><button class="btn soft wide" id="doorOut">${icon('exit')}Sair para o hub</button>` : !open && !app.doorAllowed ? `<button class="btn primary wide" id="doorKnock">${icon('hand')}Bater na porta</button>` : `<button class="btn primary wide" id="doorIn">${icon('door')}Entrar</button>`}
      </div>`, (d) => {
      d.querySelector('#doorToggle')?.addEventListener('click', () => app.send({ t: 'door', open: !open }));
      d.querySelector('#doorOut')?.addEventListener('click', () => { app.travel('hub'); this.close(); });
      d.querySelector('#doorKnock')?.addEventListener('click', () => { app.send({ t: 'doorKnock' }); app.notify.toast('Você bateu na porta. Aguarde a resposta de quem está na sala.', { key: 'door-wait', ttl: 60000, log: false, ic: 'door' }); this.close(); });
      d.querySelector('#doorIn')?.addEventListener('click', () => { app.travel('reuniao'); this.close(); });
    }, 'porta');
  }

  // ---------- recepção e convites ----------
  private reception() {
    const app = this.app;
    const waiting = [...app.presence.values()].filter((p) => p.waiting);
    this.show(`${head('door', 'Recepção', 'Visitantes com convite temporário')}
      <div class="db2">
        <h4>Aguardando entrada</h4>
        <div class="list">${waiting.length ? waiting.map((p) => `<div class="li"><span class="lic">${icon('user')}</span><div><b>${esc(app.name(p.id))}</b><small>Na entrada do hub</small></div><button class="btn soft" data-admit="${p.id}">Admitir</button><button class="btn soft" data-refuse="${p.id}">Recusar</button></div>`).join('') : '<p class="empty">Ninguém aguardando.</p>'}</div>
        <h4>Convidar visitante</h4>
        <p class="muted">O visitante entra pelo link, chega à entrada do hub e você é avisado para admitir. Ele só circula pelo hub e pela sala de reunião, e só usa o quadro da reunião.</p>
        <div class="form">
          <input id="gName" maxlength="40" placeholder="Nome do visitante"/>
          <select id="gHours"><option value="2">Vale por 2 horas</option><option value="8" selected>Vale por 8 horas</option><option value="24">Vale por 1 dia</option><option value="72">Vale por 3 dias</option></select>
          <button class="btn primary" id="gCreate">${icon('link')}Gerar convite</button>
        </div>
        <div id="gLink"></div>
      </div>`, (d) => {
      d.querySelectorAll<HTMLElement>('[data-admit]').forEach((b) => b.addEventListener('click', () => app.send({ t: 'admit', guest: b.dataset.admit!, accept: true })));
      d.querySelectorAll<HTMLElement>('[data-refuse]').forEach((b) => b.addEventListener('click', () => app.send({ t: 'admit', guest: b.dataset.refuse!, accept: false })));
      d.querySelector('#gCreate')?.addEventListener('click', async () => {
        const name = d.querySelector<HTMLInputElement>('#gName')!.value.trim() || 'Visitante';
        const r = await api.invite(name, Number(d.querySelector<HTMLSelectElement>('#gHours')!.value));
        d.querySelector('#gLink')!.innerHTML = `<div class="linkbox"><input readonly value="${esc(r.url)}"/><button class="btn soft" id="gCopy">${icon('copy')}Copiar</button></div><small class="muted">Válido até ${new Date(r.expiresAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}.</small>`;
        d.querySelector('#gCopy')!.addEventListener('click', () => { void navigator.clipboard.writeText(r.url); app.notify.toast('Link copiado.'); });
      });
    }, 'recepcao');
  }

  // ---------- rádio ----------
  private radio() {
    const app = this.app;
    const r = app.radio;
    const listening = app.radioPlayer.wanted;
    // quem adicionou (ou a administração) pode tirar o item da programação
    const mine = (q: RadioItem) => q.addedById === app.me || app.role === 'admin';
    const del = (q: RadioItem) => (mine(q) ? `<button class="iconbtn sm show" data-rdel="${q.id}" aria-label="Tirar da programação" title="Tirar da programação">${icon('trash')}</button>` : '');
    this.show(`${head('radio', 'Rádio da equipe', `${r.listeners.length ? `${r.listeners.length} ${r.listeners.length === 1 ? 'pessoa ouvindo' : 'pessoas ouvindo'}` : 'Ninguém ouvindo'} · YouTube`)}
      <div class="db2">
        <h4>Tocando agora</h4>
        <div class="list">${r.current ? `<div class="li"><span class="lic">${icon('play')}</span><div><b>${esc(r.current.title)}</b><small>Adicionado por ${esc(r.current.addedBy)}</small></div>${del(r.current)}</div>` : '<p class="empty">Nada tocando. Adicione um link do YouTube.</p>'}</div>
        <h4>Próximas</h4>
        <div class="list">${r.queue.map((q) => `<div class="li"><span class="lic">${icon('radio')}</span><div><b>${esc(q.title)}</b><small>Adicionado por ${esc(q.addedBy)}</small></div>${del(q)}</div>`).join('') || '<p class="empty">Fila vazia.</p>'}</div>
        <h4>Adicionar à programação</h4>
        <div class="form"><input id="rUrl" placeholder="Link de vídeo ou transmissão do YouTube"/><button class="btn soft" id="rAdd">${icon('plus')}Adicionar</button></div>
        <p class="muted">A rádio toca dentro da sala da equipe, para quem ligou "Ouvir": todos na mesma música, no mesmo ponto, cada um com o seu volume. Ao sair da sala ela para e, ao voltar, retoma.</p>
      </div>
      <div class="df">${listening ? `<button class="btn soft" id="rSkip">${icon('skip')}Pular</button><button class="btn primary" id="rLeave">Desligar a rádio</button>` : `<button class="btn primary" id="rJoin">${icon('play')}Ouvir a rádio</button>`}</div>`, (d) => {
      d.querySelector('#rAdd')!.addEventListener('click', () => {
        const url = d.querySelector<HTMLInputElement>('#rUrl')!.value.trim();
        if (url) app.send({ t: 'radioAdd', url });
      });
      d.querySelectorAll<HTMLElement>('[data-rdel]').forEach((b) => b.addEventListener('click', () => app.send({ t: 'radioRemove', itemId: Number(b.dataset.rdel) })));
      d.querySelector('#rJoin')?.addEventListener('click', () => app.radioPlayer.join());
      d.querySelector('#rLeave')?.addEventListener('click', () => app.radioPlayer.leave());
      d.querySelector('#rSkip')?.addEventListener('click', () => r.current && app.send({ t: 'radioSkip', itemId: r.current.id }));
    }, 'radio');
  }

  // ---------- café ----------
  private cafe() {
    const app = this.app;
    // o mesmo critério do servidor: disponível, fora da reunião e fora de conversa
    const talking = new Set(app.convs.flatMap((c) => c.members));
    const free = [...app.presence.values()].filter((p) => p.id !== app.me && app.users.get(p.id)?.role !== 'guest' && app.displayStatus(p.id) === 'disp' && !p.waiting && !talking.has(p.id)).length;
    this.show(`${head('coffee', 'Café', 'Uma pausa com a equipe ou um tempo ausente')}
      <div class="db2">
        <button class="btn primary wide" id="invitePause">${icon('users')}Convidar a equipe para uma pausa</button>
        <small class="muted">${free ? `${free} ${free === 1 ? 'pessoa disponível recebe' : 'pessoas disponíveis recebem'} o convite. Na pausa você continua disponível: quem chegar perto entra na conversa.` : 'No momento não há ninguém disponível para receber o convite.'}</small>
        <button class="btn soft wide" id="goAfk">${icon('coffee')}Fui tomar café (ficar ausente)</button>
        <small class="muted">Ausente, ninguém entra em conversa com você até você voltar.</small>
      </div>`, (d) => {
      d.querySelector('#invitePause')!.addEventListener('click', () => {
        app.send({ t: 'pauseInvite' });
        app.notify.toast('Convite enviado. Sente-se enquanto o pessoal chega.', { log: false });
        app.goPause();
        this.close();
      });
      d.querySelector('#goAfk')!.addEventListener('click', () => { app.goAfk(); this.close(); });
    }, 'cafe');
  }

  // ---------- jogo da velha ----------
  private game() {
    const app = this.app;
    const g = app.game;
    const [a, b] = g.players;
    const mine = g.players.indexOf(app.me);
    const myTurn = mine >= 0 && mine === g.turn && !g.winner && !g.draw && !!a && !!b;
    const status = g.winner ? `${app.name(g.winner)} venceu!` : g.draw ? 'Empate.' : a && b ? (myTurn ? 'Sua vez.' : `Vez de ${app.name(g.players[g.turn]!)}.`) : 'Esperando o segundo jogador.';
    this.show(`${head('smile', 'Jogo da velha', 'Lazer · partidas rápidas')}
      <div class="db2">
        <div class="players"><span class="x">X · ${a ? esc(app.name(a)) : 'livre'}</span><span class="o">O · ${b ? esc(app.name(b)) : 'livre'}</span></div>
        <div class="ttt${myTurn ? ' turn' : ''}">${Array.from({ length: 9 }, (_, i) => `<button data-c="${i}" class="${(g.board[i] || '').toLowerCase()}" ${myTurn && !g.board[i] ? '' : 'disabled'}>${g.board[i] || ''}</button>`).join('')}</div>
        <p class="status">${esc(status)}</p>
      </div>
      <div class="df">${mine < 0 ? `<button class="btn primary" id="gJoin" ${a && b ? 'disabled' : ''}>Jogar</button>` : `<button class="btn soft" id="gLeave">Sair da mesa</button><button class="btn primary" id="gReset">Nova partida</button>`}</div>`, (d) => {
      d.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((btn) => btn.addEventListener('click', () => app.send({ t: 'gameMove', cell: Number(btn.dataset.c) })));
      d.querySelector('#gJoin')?.addEventListener('click', () => {
        app.send({ t: 'gameJoin' });
        app.sitOn(a ? 'jogo-1' : 'jogo-0');
      });
      d.querySelector('#gLeave')?.addEventListener('click', () => { app.send({ t: 'gameLeave' }); app.standUp(); this.close(); });
      d.querySelector('#gReset')?.addEventListener('click', () => app.send({ t: 'gameReset' }));
    }, 'jogo');
  }

  // ---------- foco coletivo ----------
  private focus() {
    const app = this.app;
    const f = app.focus;
    if (f) {
      const b = app.focusBlock();
      const joined = f.participants.includes(app.me);
      return this.show(`${head('focus', 'Foco coletivo', `Iniciado por ${app.name(f.owner)}`)}
        <div class="db2">
          <div class="blocks">${f.blocks.map((x, i) => `<span class="blk ${x.kind}${i === b?.index ? ' now' : ''}${b && i < b.index ? ' done' : ''}">${x.kind === 'foco' ? 'Foco' : 'Pausa'} · ${x.minutes} min</span>`).join('')}</div>
          <h4>Participando (${f.participants.length})</h4>
          <div class="faces big">${f.participants.map((id) => `<span title="${esc(app.name(id))}">${app.shell.avatarImg(id, 34)}</span>`).join('')}</div>
          <p class="muted">Durante os blocos de foco, quem participa fica protegido de conversas automáticas.</p>
        </div>
        <div class="df">${f.owner === app.me && f.participants.length > 1 ? `<button class="btn soft" id="fEnd">Encerrar para todos</button>` : ''}<button class="btn primary" id="fJoin">${joined ? 'Sair da sessão' : 'Participar'}</button></div>`, (d) => {
        d.querySelector('#fJoin')!.addEventListener('click', () => { if (joined) app.focusLeave(); else app.focusJoin(); });
        d.querySelector('#fEnd')?.addEventListener('click', () => { app.focusEnd(); this.close(); });
      }, 'foco');
    }
    const presets: [string, FocusBlock[]][] = [
      ['Pomodoro · 4 × 25 min com pausas de 5', [...Array(4)].flatMap((_, i) => [{ kind: 'foco', minutes: 25 }, ...(i < 3 ? [{ kind: 'pausa', minutes: 5 }] : [])] as FocusBlock[])],
      ['Blocos longos · 2 × 50 min com pausa de 10', [{ kind: 'foco', minutes: 50 }, { kind: 'pausa', minutes: 10 }, { kind: 'foco', minutes: 50 }]],
      ['Uma hora seguida', [{ kind: 'foco', minutes: 60 }]],
    ];
    this.show(`${head('focus', 'Foco coletivo', 'Concentração em grupo, com tempo compartilhado')}
      <div class="db2">
        <p class="muted">Anuncie uma sessão e quem quiser adere. Todos veem o mesmo temporizador e quem participa e, nos blocos de foco, ninguém é puxado para conversas.</p>
        <div class="presets">${presets.map(([label], i) => `<button class="preset" data-i="${i}">${icon('focus')}${label}</button>`).join('')}</div>
        <h4>Ou escolha a duração</h4>
        <div class="form"><input id="fMin" type="number" min="5" max="180" value="45"/><span class="muted">minutos de foco</span><button class="btn soft" id="fCustom">Começar</button></div>
      </div>`, (d) => {
      d.querySelectorAll<HTMLElement>('[data-i]').forEach((b) => b.addEventListener('click', () => { app.send({ t: 'focusStart', blocks: presets[Number(b.dataset.i)][1] }); this.close(); }));
      d.querySelector('#fCustom')!.addEventListener('click', () => {
        const m = Math.min(180, Math.max(5, Number(d.querySelector<HTMLInputElement>('#fMin')!.value) || 45));
        app.send({ t: 'focusStart', blocks: [{ kind: 'foco', minutes: m }] });
        this.close();
      });
    }, 'foco');
  }

  // ---------- caixa de sugestões ----------
  private sgKind: SuggestionKind = 'ideia';
  private async suggestions() {
    const app = this.app;
    let mine: Suggestion[] = [];
    try { mine = (await api.mySuggestions()).suggestions; } catch { /* a lista é só um complemento */ }
    const kind = this.sgKind;
    this.show(`${head('bulb', 'Caixa de sugestões', 'Ideias, melhorias e problemas do Virtuta')}
      <div class="db2">
        <p class="muted">Escreva um bilhete e coloque na caixa. A administração lê tudo, e você acompanha aqui o que já foi resolvido.</p>
        <div class="seg">${(Object.keys(SG_KIND) as SuggestionKind[]).map((k) => `<button data-k="${k}" class="${k === kind ? 'on' : ''}">${SG_KIND[k]}</button>`).join('')}</div>
        <textarea id="sgText" maxlength="2000" placeholder="${SG_HINT[kind]}"></textarea>
        <button class="btn primary" id="sgSend">${icon('send')}Colocar na caixa</button>
        <h4>Seus bilhetes</h4>
        <div class="list">${mine.length ? mine.map((x) => `<div class="li sg"><span class="lic">${icon(x.kind === 'bug' ? 'bug' : 'bulb')}</span><div><b>${esc(x.text)}</b><small>${SG_KIND[x.kind]} · ${ago(x.createdAt)}</small></div>${sgStatus(x)}</div>`).join('') : '<p class="empty">Você ainda não deixou nenhum bilhete.</p>'}</div>
      </div>`, (d) => {
      const text = d.querySelector<HTMLTextAreaElement>('#sgText')!;
      d.querySelectorAll<HTMLElement>('[data-k]').forEach((b) => b.addEventListener('click', () => {
        this.sgKind = b.dataset.k as SuggestionKind;
        d.querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('on', x === b));
        text.placeholder = SG_HINT[this.sgKind];
        text.focus();
      }));
      d.querySelector('#sgSend')!.addEventListener('click', async () => {
        if (text.value.trim().length < 3) return text.focus();
        try {
          await api.suggest(this.sgKind, text.value.trim());
          app.notify.toast(this.sgKind === 'bug' ? 'Problema registrado. Obrigado por avisar!' : 'Sugestão na caixa. Obrigado!');
          void this.suggestions();
        } catch (e) { app.notify.toast((e as Error).message); }
      });
    }, 'sugestoes');
  }

  // ---------- dispositivos e administração (carregados sob demanda) ----------
  async openDevices() {
    const { devicesPanel } = await import('./devices');
    devicesPanel(this.app, this);
  }

  async openAdmin() {
    const { openAdmin } = await import('./admin');
    openAdmin(this.app);
  }
}

