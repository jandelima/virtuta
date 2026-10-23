import * as THREE from 'three';
import type { Avatar } from '../avatar';
import { STATUS_COLOR } from '../people';
import type { Space } from '../world/space';

const PAD = 14;

function frame(sp: Space, c: HTMLCanvasElement) {
  const s = Math.min((c.width - PAD * 2) / sp.w, (c.height - PAD * 2) / sp.d);
  const ox = (c.width - sp.w * s) / 2, oz = (c.height - sp.d * s) / 2;
  return { s, ox, oz };
}

export function minimapToWorld(sp: Space, c: HTMLCanvasElement, fx: number, fy: number) {
  const { s, ox, oz } = frame(sp, c);
  const x = (fx * c.width - ox) / s, z = (fy * c.height - oz) / s;
  if (x < 0 || z < 0 || x > sp.w || z > sp.d) return null;
  return new THREE.Vector2(x, z);
}

export function drawMinimap(c: HTMLCanvasElement, sp: Space, avatars: Avatar[], me: Avatar, accent: string, night: boolean) {
  const g = c.getContext('2d')!;
  const { s, ox, oz } = frame(sp, c);
  g.clearRect(0, 0, c.width, c.height);
  g.save();
  g.translate(ox, oz);
  g.fillStyle = night ? '#232830' : '#ece8e1';
  g.fillRect(0, 0, sp.w * s, sp.d * s);
  for (const z of sp.zones) {
    g.fillStyle = night ? '#232830' : '#ece8e1';
    g.globalAlpha = 1;
    g.fillRect(z.x1 * s, z.z1 * s, (z.x2 - z.x1) * s, (z.z2 - z.z1) * s);
    g.fillStyle = z.tint;
    g.globalAlpha = night ? 0.28 : 0.55;
    g.fillRect(z.x1 * s, z.z1 * s, (z.x2 - z.x1) * s, (z.z2 - z.z1) * s);
  }
  g.globalAlpha = 1;
  g.lineCap = 'round';
  for (const w of sp.walls) {
    g.strokeStyle = w.kind === 'glass' ? (night ? '#5d86b8' : '#7aa7d6') : night ? '#8a93a3' : '#5b6371';
    g.lineWidth = w.kind === 'low' ? 2 : 3;
    g.beginPath();
    g.moveTo(w.x1 * s, w.z1 * s);
    g.lineTo(w.x2 * s, w.z2 * s);
    g.stroke();
  }
  g.fillStyle = night ? 'rgba(230,234,242,0.7)' : 'rgba(30,36,46,0.6)';
  for (const z of sp.zones) {
    const room = (z.x2 - z.x1) * s - 12;
    if (z.id === 'corredor' || room < 48) continue;
    g.fillText(fit(g, z.name, room), z.x1 * s + 6, z.z1 * s + 18);
  }
  for (const a of avatars) {
    if (a.spaceId !== sp.id || a === me) continue;
    g.fillStyle = STATUS_COLOR[a.person.status];
    g.strokeStyle = night ? '#15181d' : '#ffffff';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(a.pos.x * s, a.pos.z * s, 5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  g.fillStyle = accent;
  g.strokeStyle = night ? '#15181d' : '#ffffff';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(me.pos.x * s, me.pos.z * s, 8, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.restore();
}

/** Nome da área no espaço disponível: diminui a letra e, se ainda não couber, abrevia. */
function fit(g: CanvasRenderingContext2D, text: string, max: number) {
  for (const px of [15, 13, 12]) {
    g.font = `600 ${px}px Geist, sans-serif`;
    if (g.measureText(text).width <= max) return text;
  }
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}
