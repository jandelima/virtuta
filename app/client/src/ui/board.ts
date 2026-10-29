import type { OfficeApp } from '../app';
import type { BoardCopy, BoardElement, BoardSummary, ServerMsg } from '../../../shared/protocol';
import { drawElements, paintBoard } from '../world/live';
import { icon } from './icons';
import { ago, esc } from './dom';

// Quadro branco colaborativo: desenho, post-its, texto e formas, editados ao mesmo tempo
// por quem está com o quadro aberto. O servidor salva sozinho; cópias nomeadas guardam momentos.

type Tool = 'select' | 'pen' | 'sticky' | 'text' | 'rect' | 'ellipse' | 'arrow' | 'eraser' | 'hand';
const TOOLS: [Tool, string, string, string][] = [
  ['select', 'pointer', 'Selecionar e mover (Shift soma à seleção)', 'S'], ['hand', 'move', 'Mover o quadro', 'H'], ['pen', 'pen', 'Caneta', 'P'],
  ['sticky', 'sticky', 'Post-it', 'N'], ['text', 'text', 'Texto', 'T'], ['rect', 'rect', 'Retângulo', 'R'],
  ['ellipse', 'ellipse', 'Elipse', 'O'], ['arrow', 'arrow', 'Seta', 'A'], ['eraser', 'eraser', 'Borracha', 'E'],
];
const INK = ['#1f2329', '#d6453d', '#2f6fd6', '#2f9e6a', '#e08a1e', '#8b5cf6'];
const PAPER = ['#ffe27a', '#ffb3c4', '#a8e6c1', '#9fd0ff', '#f6c28b'];

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function openBoard(app: OfficeApp, boardId: string) {
  let id = boardId;
  let title = 'Quadro';
  const els = new Map<string, BoardElement>();
  let copies: BoardCopy[] = [];
  let boards: BoardSummary[] = [];
  let editors: string[] = [];
  const cursors = new Map<string, { x: number; y: number; at: number }>();
  let tool: Tool = 'pen';
  let ink = INK[0], paper = PAPER[0], size = 3;
  let view = { x: 0, y: 0, s: 1 };
  /** Itens selecionados: clique escolhe um, Shift+clique soma, arrastar no vazio seleciona uma área. */
  let selected = new Set<string>();
  /** Post-it e texto voltam para Selecionar depois de criados, a menos que a ferramenta esteja presa. */
  let keep = false;
  let dirty = true;
  const undo: { put: BoardElement[]; del: string[] }[] = [];
  let loaded = false;

  const host = document.createElement('div');
  host.className = 'board-modal';
  document.body.appendChild(host);
  document.body.classList.add('modal-open');
  app.sceneSide('board', true);
  host.innerHTML = `<div class="bd-top"><span class="dic">${icon('board')}</span><div class="bd-title"><b id="bdTitle">Carregando…</b><small id="bdSub">Salvo automaticamente</small></div>
    <div class="bd-people" id="bdPeople"></div>
    <span class="bd-copy-wrap"><button class="btn soft" id="bdCopy">${icon('copy')}Salvar cópia</button><form class="bd-pop" id="bdCopyForm" hidden><label for="bdCopyName">Nome da cópia</label><input id="bdCopyName" maxlength="60"/><span class="row"><button type="button" class="btn soft" id="bdCopyNo">Cancelar</button><button class="btn primary">Salvar</button></span></form></span>
    <button class="btn soft" id="bdSaved">${icon('folder')}Cópias e quadros</button>
    <button class="btn soft" id="bdPng">${icon('screen')}Baixar imagem</button>
    <button class="btn primary" id="bdClose">Fechar</button></div>
    <div class="bd-tools" id="bdTools"></div>
    <canvas class="bd-canvas" id="bdCanvas"></canvas>
    <div class="bd-side" id="bdSide" hidden></div>
    <div class="bd-zoom"><button id="bdOut" aria-label="Afastar">${icon('minus')}</button><span id="bdPct">100%</span><button id="bdIn" aria-label="Aproximar">${icon('plus')}</button><button id="bdFit" aria-label="Enquadrar tudo">${icon('maximize')}</button></div>`;
  const cv = host.querySelector<HTMLCanvasElement>('#bdCanvas')!;
  const g = cv.getContext('2d')!;
  const $ = <T extends HTMLElement>(q: string) => host.querySelector<T>(q)!;

  // ---------- servidor ----------
  const send = (put: BoardElement[], del: string[] = [], record = true, prev?: BoardElement[]) => {
    if (!put.length && !del.length) return;
    app.send({ t: 'boardOp', id, put, del });
    if (record) {
      // o inverso de cada operação, para desfazer
      const inv = { put: [...(prev ?? []), ...del.map((d) => removed.get(d)).filter((e): e is BoardElement => !!e)], del: put.filter((p) => !prev?.some((x) => x.id === p.id)).map((p) => p.id) };
      undo.push(inv);
      if (undo.length > 100) undo.shift();
    }
    app.setWall(id, [...els.values()]);
  };
  const removed = new Map<string, BoardElement>();

  app.boardListener = (m: ServerMsg) => {
    if ('id' in m && m.id !== id) {
      // a recuperação de uma cópia abre outro quadro: passa a acompanhar o novo
      if (m.t === 'board') id = m.id; else return;
    }
    switch (m.t) {
      case 'board':
        title = m.title;
        els.clear();
        m.elements.forEach((e) => els.set(e.id, e));
        copies = m.copies;
        editors = m.editors;
        undo.length = 0;
        if (!loaded) { loaded = true; fit(); }
        renderTop();
        break;
      case 'boardOp':
        m.del?.forEach((d) => els.delete(d));
        m.put?.forEach((e) => els.set(e.id, e));
        break;
      case 'boardCursor':
        cursors.set(m.by, { x: m.x, y: m.y, at: Date.now() });
        break;
      case 'boardEditors':
        editors = m.editors;
        renderTop();
        break;
      case 'boardCopies':
        copies = m.copies;
        if (!$('#bdSide').hidden) renderSide();
        break;
      case 'boards':
        boards = m.boards;
        if (!$('#bdSide').hidden) renderSide();
        break;
    }
    dirty = true;
  };
  app.send({ t: 'boardOpen', id });

  // ---------- interface ----------
  const renderTop = () => {
    $('#bdTitle').textContent = title;
    $('#bdPeople').innerHTML = editors.map((e) => `<span class="av" title="${esc(app.name(e))}" style="width:28px;height:28px">${app.shell.avatarImg(e, 28)}</span>`).join('');
    $('#bdSub').textContent = editors.length > 1 ? `${editors.length} pessoas editando · salvo automaticamente` : 'Salvo automaticamente';
  };
  const renderTools = () => {
    $('#bdTools').innerHTML = TOOLS.map(([t, ic, label, key]) => `<button class="${tool === t ? 'on' : ''}" data-tool="${t}" title="${label} (${key})">${icon(ic)}</button>`).join('') +
      '<span class="div"></span>' +
      (tool === 'sticky' ? PAPER : INK).map((c) => `<button class="sw${(tool === 'sticky' ? paper : ink) === c ? ' on' : ''}" data-color="${c}" style="--c:${c}" aria-label="Cor"></button>`).join('') +
      (tool === 'pen' || tool === 'rect' || tool === 'ellipse' || tool === 'arrow' ? `<span class="div"></span>${[2, 4, 8].map((s) => `<button class="size${size === s ? ' on' : ''}" data-size="${s}" title="Espessura"><i style="width:${s + 2}px;height:${s + 2}px"></i></button>`).join('')}` : '') +
      `<span class="div"></span><button data-keep class="${keep ? 'on' : ''}" title="${keep ? 'Ferramenta presa: continua ativa depois de usar' : 'Prender a ferramenta (continua ativa depois de usar)'}" aria-pressed="${keep}">${icon('lock')}</button>` +
      `<button data-undo title="Desfazer (Ctrl+Z)">${icon('undo')}</button>${selected.size ? `<button data-del title="${selected.size > 1 ? `Apagar ${selected.size} itens` : 'Apagar seleção'} (Delete)">${icon('trash')}</button>` : ''}`;
  };
  $('#bdTools').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.tool) { tool = b.dataset.tool as Tool; selected.clear(); }
    if (b.dataset.keep !== undefined) keep = !keep;
    if (b.dataset.color) { if (tool === 'sticky') paper = b.dataset.color; else ink = b.dataset.color; recolorSelected(b.dataset.color); }
    if (b.dataset.size) size = Number(b.dataset.size);
    if (b.dataset.undo !== undefined) doUndo();
    if (b.dataset.del !== undefined) deleteSelected();
    renderTools();
    dirty = true;
  });

  const renderSide = () => {
    const side = $('#bdSide');
    side.innerHTML = `<div class="dh"><div><b>Cópias e quadros</b><small>“Pôr no quadro” traz a cópia de volta para este quadro e guarda o que está nele agora como cópia. “Abrir à parte” abre a cópia num quadro novo.</small></div><button class="iconbtn" id="bdSideX" aria-label="Fechar">${icon('x')}</button></div>
      <h4>Cópias deste quadro</h4><div class="list">${copies.map((c) => `<div class="li copy"><span class="lic">${icon('copy')}</span><div><b>${esc(c.name)}</b><small>${esc(c.createdBy)} · ${ago(c.createdAt)}</small><span class="row"><button class="btn primary" data-wall="${c.id}">Pôr no quadro</button><button class="btn soft" data-restore="${c.id}">Abrir à parte</button></span></div></div>`).join('') || '<p class="empty">Nenhuma cópia salva.</p>'}</div>
      <h4>Outros quadros</h4><div class="list">${boards.filter((b) => b.id !== id).map((b) => `<div class="li"><span class="lic">${icon('board')}</span><div><b>${esc(b.title)}</b><small>${b.updatedBy ? `${esc(b.updatedBy)} · ` : ''}${ago(b.updatedAt)}</small></div><button class="btn soft" data-open="${esc(b.id)}">Abrir</button></div>`).join('') || '<p class="empty">Nenhum outro quadro.</p>'}</div>`;
    side.querySelector('#bdSideX')!.addEventListener('click', () => (side.hidden = true));
    side.querySelectorAll<HTMLElement>('[data-restore]').forEach((b) => b.addEventListener('click', () => { switchTo(null); app.send({ t: 'boardRestore', copyId: Number(b.dataset.restore), mode: 'new' }); side.hidden = true; }));
    side.querySelectorAll<HTMLElement>('[data-wall]').forEach((b) => b.addEventListener('click', () => {
      app.send({ t: 'boardRestore', copyId: Number(b.dataset.wall), mode: 'wall' });
      app.notify.toast('A cópia voltou para o quadro. O que estava nele ficou guardado como cópia.', { log: false });
      side.hidden = true;
    }));
    side.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => b.addEventListener('click', () => { switchTo(b.dataset.open!); side.hidden = true; }));
  };
  const switchTo = (next: string | null) => {
    app.send({ t: 'boardClose', id });
    loaded = false;
    els.clear();
    if (next) { id = next; app.send({ t: 'boardOpen', id }); }
  };

  // nome da cópia num campo próprio (o prompt() do navegador destoava e travava a página)
  const copyForm = $<HTMLFormElement>('#bdCopyForm');
  const copyName = $<HTMLInputElement>('#bdCopyName');
  $('#bdCopy').addEventListener('click', () => {
    copyForm.hidden = !copyForm.hidden;
    if (copyForm.hidden) return;
    copyName.value = `${title} · ${new Date().toLocaleDateString('pt-BR')}`;
    copyName.focus();
    copyName.select();
  });
  $('#bdCopyNo').addEventListener('click', () => (copyForm.hidden = true));
  copyForm.addEventListener('submit', (e) => {
    e.preventDefault();
    app.send({ t: 'boardCopy', id, name: copyName.value.trim() });
    copyForm.hidden = true;
    app.notify.toast('Cópia salva. Ela fica em “Cópias e quadros”.', { log: false });
  });
  copyName.addEventListener('keydown', (e) => { if (e.key === 'Escape') { copyForm.hidden = true; e.stopPropagation(); } });
  $('#bdSaved').addEventListener('click', () => { const s = $('#bdSide'); s.hidden = !s.hidden; if (!s.hidden) renderSide(); });
  $('#bdPng').addEventListener('click', () => {
    const c = document.createElement('canvas');
    c.width = 2400; c.height = 1500;
    paintBoard(c.getContext('2d')!, c.width, c.height, [...els.values()]);
    const a = document.createElement('a');
    a.download = `${title}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
  });
  $('#bdIn').addEventListener('click', () => zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1.25));
  $('#bdOut').addEventListener('click', () => zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 0.8));
  $('#bdFit').addEventListener('click', () => fit());
  const close = () => {
    app.send({ t: 'boardClose', id });
    app.boardListener = null;
    cancelAnimationFrame(raf);
    removeEventListener('keydown', onKey);
    removeEventListener('keyup', onKeyUp);
    host.remove();
    document.body.classList.remove('modal-open');
    app.sceneSide('board', false);
  };
  $('#bdClose').addEventListener('click', close);

  // ---------- coordenadas ----------
  const toBoard = (cx: number, cy: number) => {
    const r = cv.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.s, y: (cy - r.top - view.y) / view.s };
  };
  const zoomAt = (sx: number, sy: number, f: number) => {
    const s = Math.min(4, Math.max(0.15, view.s * f));
    view.x = sx - ((sx - view.x) * s) / view.s;
    view.y = sy - ((sy - view.y) * s) / view.s;
    view.s = s;
    dirty = true;
  };
  const bounds = (e: BoardElement) => {
    if (e.points?.length) {
      const xs = e.points.filter((_, i) => i % 2 === 0), ys = e.points.filter((_, i) => i % 2 === 1);
      return { x1: e.x + Math.min(...xs), y1: e.y + Math.min(...ys), x2: e.x + Math.max(...xs), y2: e.y + Math.max(...ys) };
    }
    const w = e.w ?? (e.kind === 'text' ? Math.max(40, (e.text ?? '').length * (e.size ?? 24) * 0.55) : 0);
    const h = e.h ?? (e.size ?? 24) * 1.3 * Math.max(1, (e.text ?? '').split('\n').length);
    return { x1: Math.min(e.x, e.x + w), y1: Math.min(e.y, e.y + h), x2: Math.max(e.x, e.x + w), y2: Math.max(e.y, e.y + h) };
  };
  function fit() {
    const all = [...els.values()];
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!all.length) { view = { x: w / 2 - 600, y: h / 2 - 350, s: 1 }; dirty = true; return; }
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const e of all) { const b = bounds(e); x1 = Math.min(x1, b.x1); y1 = Math.min(y1, b.y1); x2 = Math.max(x2, b.x2); y2 = Math.max(y2, b.y2); }
    const s = Math.min(2, (w * 0.85) / Math.max(200, x2 - x1), (h * 0.8) / Math.max(150, y2 - y1));
    view = { s, x: w / 2 - ((x1 + x2) / 2) * s, y: h / 2 - ((y1 + y2) / 2) * s };
    dirty = true;
  }
  const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  const hitTest = (x: number, y: number) => {
    const tol = 8 / view.s;
    const list = [...els.values()].sort((a, b) => b.z - a.z);
    for (const e of list) {
      if (e.points && (e.kind === 'stroke' || e.kind === 'arrow')) {
        for (let i = 2; i < e.points.length; i += 2) {
          if (segDist(x, y, e.x + e.points[i - 2], e.y + e.points[i - 1], e.x + e.points[i], e.y + e.points[i + 1]) < tol + (e.size ?? 3)) return e;
        }
        if (e.points.length === 2 && Math.hypot(x - e.x - e.points[0], y - e.y - e.points[1]) < tol) return e;
      } else {
        const b = bounds(e);
        if (x >= b.x1 - tol && x <= b.x2 + tol && y >= b.y1 - tol && y <= b.y2 + tol) return e;
      }
    }
    return null;
  };
  const topZ = () => Math.max(0, ...[...els.values()].map((e) => e.z)) + 1;

  // ---------- edição ----------
  const picked = () => [...selected].map((s) => els.get(s)).filter((e): e is BoardElement => !!e);
  const recolorSelected = (c: string) => {
    const list = picked();
    if (!list.length) return;
    const next = list.map((e) => ({ ...e, color: c }));
    next.forEach((e) => els.set(e.id, e));
    send(next, [], true, list.map((e) => ({ ...e })));
  };
  const deleteSelected = () => {
    const list = picked();
    if (!list.length) return;
    for (const e of list) { removed.set(e.id, e); els.delete(e.id); }
    selected.clear();
    send([], list.map((e) => e.id));
    renderTools();
  };
  /** Formas e post-its se redimensionam pelas quatro quinas. */
  const resizable = (e: BoardElement) => e.kind === 'sticky' || e.kind === 'rect' || e.kind === 'ellipse';
  const handleAt = (x: number, y: number) => {
    const list = picked();
    if (list.length !== 1 || !resizable(list[0])) return null;
    const b = bounds(list[0]), tol = 9 / view.s;
    const corners: [number, number, number, number][] = [[b.x1, b.y1, b.x2, b.y2], [b.x2, b.y1, b.x1, b.y2], [b.x1, b.y2, b.x2, b.y1], [b.x2, b.y2, b.x1, b.y1]];
    const c = corners.find(([cx, cy]) => Math.abs(x - cx) < tol && Math.abs(y - cy) < tol);
    return c ? { e: list[0], fx: c[2], fy: c[3] } : null;
  };
  const doUndo = () => {
    const op = undo.pop();
    if (!op) return;
    op.del.forEach((d) => { const e = els.get(d); if (e) removed.set(d, e); els.delete(d); });
    op.put.forEach((e) => els.set(e.id, e));
    send(op.put, op.del, false);
    dirty = true;
  };
  const editText = (e: BoardElement) => {
    const r = cv.getBoundingClientRect();
    const ta = document.createElement('textarea');
    ta.className = `bd-edit ${e.kind}`;
    ta.value = e.text ?? '';
    const sx = r.left + view.x + e.x * view.s, sy = r.top + view.y + e.y * view.s;
    Object.assign(ta.style, {
      left: `${sx}px`, top: `${sy}px`,
      width: `${(e.w ?? 420) * view.s}px`, height: `${(e.h ?? (e.size ?? 24) * 2.6) * view.s}px`,
      fontSize: `${(e.kind === 'sticky' ? 18 : e.size ?? 24) * view.s}px`,
      background: e.kind === 'sticky' ? e.color : 'rgba(255,255,255,0.92)', color: e.kind === 'sticky' ? '#1f2329' : e.color,
    });
    host.appendChild(ta);
    ta.focus();
    const done = () => {
      ta.remove();
      const text = ta.value.trimEnd();
      if (!text && e.kind === 'text') { els.delete(e.id); send([], [e.id], false); return; }
      const prev = els.get(e.id);
      const next = { ...e, text };
      els.set(e.id, next);
      send([next], [], true, prev ? [prev] : undefined);
      dirty = true;
    };
    ta.addEventListener('blur', done, { once: true });
    ta.addEventListener('keydown', (k) => { if (k.key === 'Escape' || (k.key === 'Enter' && (k.ctrlKey || k.metaKey))) ta.blur(); k.stopPropagation(); });
  };

  // ---------- ponteiro ----------
  let drag: null | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
    | { kind: 'move'; items: BoardElement[]; prev: BoardElement[]; sx: number; sy: number }
    | { kind: 'resize'; e: BoardElement; prev: BoardElement; fx: number; fy: number }
    | { kind: 'marquee'; x1: number; y1: number; x2: number; y2: number; add: boolean }
    | { kind: 'draw'; e: BoardElement; ox: number; oy: number } | { kind: 'erase' } = null;
  let space = false;
  let lastLive = 0, lastCursor = 0;

  cv.addEventListener('pointerdown', (ev) => {
    // um clique fora encerra a edição de texto em andamento
    const editing = host.querySelector<HTMLTextAreaElement>('.bd-edit');
    if (editing) { editing.blur(); return; }
    // impede o navegador de tirar o foco da caixa de texto recém-criada
    ev.preventDefault();
    cv.setPointerCapture(ev.pointerId);
    const p = toBoard(ev.clientX, ev.clientY);
    if (tool === 'hand' || space || ev.button === 1) { drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y }; return; }
    if (tool === 'select') {
      dirty = true;
      const h = handleAt(p.x, p.y);
      if (h) { drag = { kind: 'resize', e: h.e, prev: { ...h.e }, fx: h.fx, fy: h.fy }; return; }
      const e = hitTest(p.x, p.y);
      if (ev.shiftKey && e) {
        if (selected.has(e.id)) selected.delete(e.id); else selected.add(e.id);
        renderTools();
        return;
      }
      if (!e) {
        // arrastar no vazio seleciona tudo o que ficar dentro do retângulo
        if (!ev.shiftKey) selected.clear();
        drag = { kind: 'marquee', x1: p.x, y1: p.y, x2: p.x, y2: p.y, add: ev.shiftKey };
        renderTools();
        return;
      }
      if (!selected.has(e.id)) selected = new Set([e.id]);
      const items = picked();
      drag = { kind: 'move', items, prev: items.map((x) => ({ ...x })), sx: p.x, sy: p.y };
      renderTools();
      return;
    }
    if (tool === 'eraser') {
      drag = { kind: 'erase' };
      const e = hitTest(p.x, p.y);
      if (e) { removed.set(e.id, e); els.delete(e.id); send([], [e.id]); }
      return;
    }
    if (tool === 'sticky' || tool === 'text') {
      const e: BoardElement = tool === 'sticky'
        ? { id: uid(), kind: 'sticky', x: p.x - 80, y: p.y - 80, w: 160, h: 160, color: paper, text: '', z: topZ(), by: '' }
        : { id: uid(), kind: 'text', x: p.x, y: p.y - 14, w: 420, color: ink, size: 24, text: '', z: topZ(), by: '' };
      els.set(e.id, e);
      send([e]);
      editText(e);
      if (!keep) tool = 'select';
      selected = new Set([e.id]);
      renderTools();
      return;
    }
    const e: BoardElement = { id: uid(), kind: tool === 'pen' ? 'stroke' : tool, x: p.x, y: p.y, points: tool === 'pen' || tool === 'arrow' ? [0, 0, ...(tool === 'arrow' ? [0, 0] : [])] : undefined, w: 0, h: 0, color: ink, size, z: topZ(), by: '' };
    if (tool === 'pen' || tool === 'arrow') { delete e.w; delete e.h; }
    els.set(e.id, e);
    drag = { kind: 'draw', e, ox: p.x, oy: p.y };
  });
  cv.addEventListener('pointermove', (ev) => {
    const p = toBoard(ev.clientX, ev.clientY);
    const t = performance.now();
    if (t - lastCursor > 80) { lastCursor = t; app.send({ t: 'boardCursor', id, x: p.x, y: p.y }); }
    if (!drag) return;
    dirty = true;
    if (drag.kind === 'pan') { view.x = drag.vx + ev.clientX - drag.sx; view.y = drag.vy + ev.clientY - drag.sy; return; }
    if (drag.kind === 'erase') {
      const e = hitTest(p.x, p.y);
      if (e) { removed.set(e.id, e); els.delete(e.id); send([], [e.id]); }
      return;
    }
    if (drag.kind === 'marquee') { drag.x2 = p.x; drag.y2 = p.y; return; }
    if (drag.kind === 'move') {
      const dx = p.x - drag.sx, dy = p.y - drag.sy;
      drag.items = drag.prev.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy }));
      drag.items.forEach((e) => els.set(e.id, e));
    } else if (drag.kind === 'resize') {
      // a quina oposta fica parada; o tamanho tem um mínimo para não sumir
      const min = drag.e.kind === 'sticky' ? 60 : 8;
      const x1 = Math.min(drag.fx, p.x), x2 = Math.max(drag.fx, p.x), y1 = Math.min(drag.fy, p.y), y2 = Math.max(drag.fy, p.y);
      const e = { ...drag.e, x: x1, y: y1, w: Math.max(min, x2 - x1), h: Math.max(min, y2 - y1) };
      drag.e = e;
      els.set(e.id, e);
    } else {
      const e = drag.e;
      if (e.kind === 'stroke') e.points!.push(Math.round((p.x - e.x) * 10) / 10, Math.round((p.y - e.y) * 10) / 10);
      else if (e.kind === 'arrow') { e.points![2] = p.x - e.x; e.points![3] = p.y - e.y; }
      else { e.w = p.x - drag.ox; e.h = p.y - drag.oy; }
    }
    // mostra o traço aos outros enquanto ele é feito
    if (t - lastLive > 120) { lastLive = t; app.send({ t: 'boardOp', id, put: drag.kind === 'move' ? drag.items : [drag.e] }); }
  });
  const up = () => {
    if (!drag) return;
    if (drag.kind === 'move') { const d = drag; if (d.items.some((e, i) => e.x !== d.prev[i].x || e.y !== d.prev[i].y)) send(d.items, [], true, d.prev); }
    else if (drag.kind === 'resize') send([drag.e], [], true, [drag.prev]);
    else if (drag.kind === 'marquee') {
      const x1 = Math.min(drag.x1, drag.x2), x2 = Math.max(drag.x1, drag.x2), y1 = Math.min(drag.y1, drag.y2), y2 = Math.max(drag.y1, drag.y2);
      if (x2 - x1 > 3 / view.s || y2 - y1 > 3 / view.s) {
        for (const e of els.values()) {
          const b = bounds(e);
          if (b.x1 >= x1 && b.x2 <= x2 && b.y1 >= y1 && b.y2 <= y2) selected.add(e.id);
        }
      }
      renderTools();
    }
    else if (drag.kind === 'draw') {
      const e = drag.e;
      // retângulos e elipses sempre com largura e altura positivas
      // clique sem arrastar não cria seta nem forma vazia
      if (e.kind === 'arrow' && Math.hypot(e.points![2], e.points![3]) < 6) { els.delete(e.id); app.send({ t: 'boardOp', id, del: [e.id] }); drag = null; dirty = true; return; }
      if (e.w !== undefined && e.h !== undefined) {
        if (e.w < 0) { e.x += e.w; e.w = -e.w; }
        if (e.h < 0) { e.y += e.h; e.h = -e.h; }
        if (e.w < 4 && e.h < 4) { els.delete(e.id); app.send({ t: 'boardOp', id, del: [e.id] }); drag = null; return; }
      }
      send([e]);
    }
    drag = null;
    dirty = true;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('dblclick', (ev) => {
    const p = toBoard(ev.clientX, ev.clientY);
    const e = hitTest(p.x, p.y);
    if (e && (e.kind === 'sticky' || e.kind === 'text')) editText(e);
  });
  cv.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = cv.getBoundingClientRect();
    if (ev.ctrlKey || ev.metaKey || Math.abs(ev.deltaY) > 40) zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * 0.0015));
    else { view.x -= ev.deltaX; view.y -= ev.deltaY; dirty = true; }
  }, { passive: false });

  const onKey = (ev: KeyboardEvent) => {
    if ((ev.target as HTMLElement).tagName === 'TEXTAREA' || (ev.target as HTMLElement).tagName === 'INPUT') return;
    if (ev.key === ' ') { space = true; ev.preventDefault(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); doUndo(); return; }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { deleteSelected(); return; }
    // Esc só desfaz a seleção; o quadro fecha pelo botão Fechar
    if (ev.key === 'Escape') { if (selected.size) { selected.clear(); renderTools(); dirty = true; } return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'a') { ev.preventDefault(); selected = new Set(els.keys()); tool = 'select'; renderTools(); dirty = true; return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    // microfone e câmera continuam no teclado com o quadro aberto
    if (ev.key.toLowerCase() === 'm') { void app.toggleMic(); return; }
    if (ev.key.toLowerCase() === 'v') { void app.toggleCam(); return; }
    const t = TOOLS.find(([, , , k]) => k.toLowerCase() === ev.key.toLowerCase());
    if (t) { tool = t[0]; selected.clear(); renderTools(); }
  };
  addEventListener('keydown', onKey);
  const onKeyUp = (ev: KeyboardEvent) => { if (ev.key === ' ') space = false; };
  addEventListener('keyup', onKeyUp);

  // ---------- desenho ----------
  const faces = new Map<string, HTMLImageElement>();
  const face = (who: string) => {
    let img = faces.get(who);
    if (!img) {
      img = new Image();
      img.onload = () => (dirty = true);
      img.src = app.portraits[who] ?? '';
      faces.set(who, img);
    }
    return img;
  };
  let raf = 0;
  const paint = () => {
    raf = requestAnimationFrame(paint);
    const now = Date.now();
    const anyCursor = [...cursors.values()].some((c) => now - c.at < 3000);
    if (!dirty && !anyCursor) return;
    dirty = false;
    const dpr = Math.min(devicePixelRatio, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#fbfbfa';
    g.fillRect(0, 0, w, h);
    // pontilhado de fundo, que acompanha o zoom
    const step = 32 * view.s;
    if (step > 8) {
      g.fillStyle = 'rgba(40,46,56,0.12)';
      for (let x = view.x % step; x < w; x += step) for (let y = view.y % step; y < h; y += step) g.fillRect(x, y, 1.5, 1.5);
    }
    g.save();
    g.translate(view.x, view.y);
    g.scale(view.s, view.s);
    drawElements(g, [...els.values()].sort((a, b) => a.z - b.z));
    const sel = picked();
    g.strokeStyle = '#3b5bdb';
    g.lineWidth = 1.5 / view.s;
    for (const e of sel) {
      const b = bounds(e);
      g.setLineDash([6 / view.s, 4 / view.s]);
      g.strokeRect(b.x1 - 6 / view.s, b.y1 - 6 / view.s, b.x2 - b.x1 + 12 / view.s, b.y2 - b.y1 + 12 / view.s);
      g.setLineDash([]);
    }
    // alças de redimensionar nas quinas, quando há um item só selecionado
    if (sel.length === 1 && resizable(sel[0])) {
      const b = bounds(sel[0]), r = 5 / view.s;
      g.fillStyle = '#ffffff';
      for (const [x, y] of [[b.x1, b.y1], [b.x2, b.y1], [b.x1, b.y2], [b.x2, b.y2]]) { g.fillRect(x - r, y - r, r * 2, r * 2); g.strokeRect(x - r, y - r, r * 2, r * 2); }
    }
    if (drag?.kind === 'marquee') {
      g.fillStyle = 'rgba(59,91,219,0.08)';
      const x = Math.min(drag.x1, drag.x2), y = Math.min(drag.y1, drag.y2), w = Math.abs(drag.x2 - drag.x1), h = Math.abs(drag.y2 - drag.y1);
      g.fillRect(x, y, w, h);
      g.strokeRect(x, y, w, h);
    }
    g.restore();
    // cursor de cada pessoa com o rosto do avatar dela e o nome
    for (const [who, c] of cursors) {
      if (now - c.at > 3000) continue;
      const x = view.x + c.x * view.s, y = view.y + c.y * view.s;
      const color = app.users.get(who)?.color ?? '#3b5bdb';
      g.fillStyle = color;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 4, y + 16); g.lineTo(x + 8, y + 10); g.lineTo(x + 15, y + 9); g.closePath(); g.fill();
      g.font = '600 12px Geist, sans-serif';
      const label = app.name(who).split(' ')[0];
      const tw = g.measureText(label).width;
      const px = x + 12, py = y + 12, ph = 28;
      g.beginPath(); g.roundRect(px, py, tw + 44, ph, ph / 2); g.fill();
      const img = face(who);
      g.save();
      g.beginPath(); g.arc(px + ph / 2, py + ph / 2, ph / 2 - 3, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill(); g.clip();
      if (img.complete && img.naturalWidth) g.drawImage(img, px + 3, py + 3, ph - 6, ph - 6);
      g.restore();
      g.fillStyle = '#fff';
      g.fillText(label, px + ph + 4, py + 18);
    }
    $('#bdPct').textContent = `${Math.round(view.s * 100)}%`;
  };
  new ResizeObserver(() => (dirty = true)).observe(cv);
  renderTools();
  paint();
}
