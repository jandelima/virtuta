import type { BoardElement, GameState } from '../../../shared/protocol';
import { drawn } from './textures';

// Texturas que mostram o estado real: miniatura dos quadros, TV da reunião e tabuleiro do jogo.

/** Desenha os elementos de um quadro, enquadrados, numa textura de lousa. */
export function paintBoard(c: CanvasRenderingContext2D, w: number, h: number, elements: BoardElement[]) {
  c.fillStyle = '#fbfbfa';
  c.fillRect(0, 0, w, h);
  if (!elements.length) {
    c.fillStyle = 'rgba(40,46,56,0.28)';
    c.font = `600 ${Math.round(h * 0.07)}px Geist, sans-serif`;
    c.textAlign = 'center';
    c.fillText('Quadro em branco', w / 2, h / 2);
    c.textAlign = 'start';
    return;
  }
  // enquadra todo o conteúdo com margem
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const e of elements) {
    const pts = e.points ?? [];
    const xs = pts.length ? pts.filter((_, i) => i % 2 === 0).map((v) => v + e.x) : [e.x, e.x + (e.w ?? 0)];
    const ys = pts.length ? pts.filter((_, i) => i % 2 === 1).map((v) => v + e.y) : [e.y, e.y + (e.h ?? 0)];
    x1 = Math.min(x1, ...xs); x2 = Math.max(x2, ...xs); y1 = Math.min(y1, ...ys); y2 = Math.max(y2, ...ys);
  }
  const s = Math.min((w * 0.9) / Math.max(1, x2 - x1), (h * 0.86) / Math.max(1, y2 - y1), 1.4);
  c.save();
  c.translate((w - (x2 - x1) * s) / 2 - x1 * s, (h - (y2 - y1) * s) / 2 - y1 * s);
  c.scale(s, s);
  drawElements(c, [...elements].sort((a, b) => a.z - b.z));
  c.restore();
}

export function drawElements(c: CanvasRenderingContext2D, elements: BoardElement[]) {
  c.lineCap = 'round';
  c.lineJoin = 'round';
  for (const e of elements) {
    c.strokeStyle = e.color;
    c.fillStyle = e.color;
    c.lineWidth = e.size ?? 3;
    if (e.kind === 'stroke' && e.points) {
      c.beginPath();
      for (let i = 0; i < e.points.length; i += 2) {
        const px = e.x + e.points[i], py = e.y + e.points[i + 1];
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.stroke();
    } else if (e.kind === 'rect') {
      c.strokeRect(e.x, e.y, e.w ?? 0, e.h ?? 0);
    } else if (e.kind === 'ellipse') {
      c.beginPath();
      c.ellipse(e.x + (e.w ?? 0) / 2, e.y + (e.h ?? 0) / 2, Math.abs(e.w ?? 0) / 2, Math.abs(e.h ?? 0) / 2, 0, 0, Math.PI * 2);
      c.stroke();
    } else if (e.kind === 'arrow' && e.points) {
      const [ax, ay, bx, by] = e.points;
      const x0 = e.x + ax, y0 = e.y + ay, x1 = e.x + bx, y1 = e.y + by;
      const a = Math.atan2(y1 - y0, x1 - x0), hl = 10 + (e.size ?? 3) * 2;
      c.beginPath();
      c.moveTo(x0, y0); c.lineTo(x1, y1);
      c.moveTo(x1, y1); c.lineTo(x1 - hl * Math.cos(a - 0.45), y1 - hl * Math.sin(a - 0.45));
      c.moveTo(x1, y1); c.lineTo(x1 - hl * Math.cos(a + 0.45), y1 - hl * Math.sin(a + 0.45));
      c.stroke();
    } else if (e.kind === 'sticky') {
      const w = e.w ?? 160, h = e.h ?? 160;
      c.fillStyle = 'rgba(0,0,0,0.10)';
      c.fillRect(e.x + 3, e.y + 5, w, h);
      c.fillStyle = e.color;
      c.fillRect(e.x, e.y, w, h);
      c.fillStyle = '#1f2329';
      c.font = '500 18px Geist, sans-serif';
      wrap(c, e.text ?? '', e.x + 12, e.y + 28, w - 24, 22, Math.floor((h - 20) / 22));
    } else if (e.kind === 'text') {
      c.font = `600 ${e.size ?? 24}px Geist, sans-serif`;
      wrap(c, e.text ?? '', e.x, e.y + (e.size ?? 24), e.w ?? 600, (e.size ?? 24) * 1.25, 40);
    }
  }
}

function wrap(c: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines: number) {
  let line = '', n = 0;
  for (const para of text.split('\n')) {
    for (const word of para.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (c.measureText(test).width > maxW && line) {
        c.fillText(line, x, y + n * lh);
        line = word;
        if (++n >= maxLines) return;
      } else line = test;
    }
    c.fillText(line, x, y + n * lh);
    line = '';
    if (++n >= maxLines) return;
  }
}

export function boardTex(elements: BoardElement[], w = 1024) {
  const h = Math.round(w * 0.32);
  return drawn(w, h, (c) => paintBoard(c, w, h, elements));
}

export function tvTex(title: string, sub: string, accent = '#5b8cff') {
  return drawn(1024, 576, (c) => {
    const g = c.createLinearGradient(0, 0, 1024, 576);
    g.addColorStop(0, '#111827'); g.addColorStop(1, '#1f2a44');
    c.fillStyle = g; c.fillRect(0, 0, 1024, 576);
    c.fillStyle = accent; c.beginPath(); c.arc(84, 120, 14, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffffff'; c.font = '700 60px Geist, sans-serif'; c.fillText(title, 118, 140);
    c.fillStyle = '#9aa7c0'; c.font = '500 34px Geist, sans-serif'; c.fillText(sub, 70, 230);
  });
}

export function gameTex(game: GameState | null, status: string) {
  return drawn(512, 512, (c) => {
    c.fillStyle = '#f4efe6'; c.fillRect(0, 0, 512, 512);
    c.strokeStyle = '#3a3f48'; c.lineWidth = 10; c.lineCap = 'round';
    for (const p of [176, 336]) {
      c.beginPath(); c.moveTo(p, 40); c.lineTo(p, 472); c.stroke();
      c.beginPath(); c.moveTo(40, p); c.lineTo(472, p); c.stroke();
    }
    game?.board.forEach((v, i) => {
      const cx = 96 + (i % 3) * 160, cy = 96 + Math.floor(i / 3) * 160;
      c.lineWidth = 16;
      if (v === 'X') {
        c.strokeStyle = '#d6453d';
        c.beginPath(); c.moveTo(cx - 42, cy - 42); c.lineTo(cx + 42, cy + 42); c.moveTo(cx + 42, cy - 42); c.lineTo(cx - 42, cy + 42); c.stroke();
      } else if (v === 'O') {
        c.strokeStyle = '#3b5bdb';
        c.beginPath(); c.arc(cx, cy, 44, 0, Math.PI * 2); c.stroke();
      }
    });
    if (status) {
      c.fillStyle = 'rgba(32,36,44,0.82)'; c.fillRect(0, 452, 512, 60);
      c.fillStyle = '#fff'; c.font = '600 28px Geist, sans-serif'; c.textAlign = 'center'; c.fillText(status, 256, 492);
    }
  });
}
