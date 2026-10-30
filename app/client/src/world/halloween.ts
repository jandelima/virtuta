import * as THREE from 'three';
import type { Rect } from '../../../shared/layout';
import type { Space } from './space';
import { drawn } from './textures';

// Decoração de Halloween: abóboras iluminadas, teias com aranhas, lápides e velas no gramado,
// caldeirão no hub, morcegos e fantasmas. Tudo fica num grupo próprio em cada ambiente, que
// aparece só enquanto o tema está ativo; as peças paradas são juntadas como o resto do cenário
// e só morcegos, fantasmas, aranhas, velas e bolhas se mexem (a cena já desenha a 30 quadros).

type Anim = (t: number) => void;
interface Part { space: Space; group: THREE.Group; anims: Anim[]; blocks: Rect[] }
const parts: Part[] = [];

const mat = (color: string, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...o });
const M = {
  pumpkin: mat('#e8761c', { roughness: 0.55 }),
  stem: mat('#5b4a1e'),
  carved: new THREE.MeshBasicMaterial({ color: '#ffcf4a' }),
  stone: mat('#8d939b', { roughness: 0.9 }),
  stoneDark: mat('#6b7179', { roughness: 0.9 }),
  candle: mat('#efe6d2'),
  flame: new THREE.MeshBasicMaterial({ color: '#ffb52e' }),
  black: mat('#1b1a20', { roughness: 0.5 }),
  pot: mat('#24272d', { roughness: 0.35, metalness: 0.6 }),
  brew: new THREE.MeshBasicMaterial({ color: '#7dff6a' }),
  ghost: new THREE.MeshStandardMaterial({ color: '#f4f6fb', roughness: 0.4, emissive: '#cfd8ff', emissiveIntensity: 0.25, transparent: true, opacity: 0.82, depthWrite: false }),
  eye: new THREE.MeshBasicMaterial({ color: '#15161c' }),
  thread: new THREE.MeshBasicMaterial({ color: '#d9dde3', transparent: true, opacity: 0.6 }),
};
/** De frente para a câmera isométrica (que olha de sudeste). */
const FACING = Math.PI / 4;

function part(sp: Space): Part {
  let p = parts.find((x) => x.space === sp);
  if (!p) {
    const group = new THREE.Group();
    group.userData.dynamic = true;
    group.visible = false;
    sp.group.add(group);
    p = { space: sp, group, anims: [], blocks: [] };
    parts.push(p);
  }
  return p;
}

// ---------- peças ----------
/** Abóbora com rosto entalhado; o rosto é iluminado por dentro (não depende da luz da cena). */
export function pumpkin(r: number) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), M.pumpkin);
  body.scale.set(1, 0.78, 1);
  body.position.y = r * 0.78;
  body.castShadow = true;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.1, r * 0.15, r * 0.4, 6), M.stem);
  stem.position.y = r * 1.6;
  stem.rotation.z = 0.25;
  g.add(body, stem);
  const tri = (pts: number[][]) => new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * r, y * r))));
  const face = [
    tri([[-0.55, 0.15], [-0.2, 0.15], [-0.37, 0.45]]),
    tri([[0.2, 0.15], [0.55, 0.15], [0.37, 0.45]]),
    tri([[-0.08, -0.02], [0.08, -0.02], [0, 0.12]]),
    tri([[-0.6, -0.15], [0.6, -0.15], [0.45, -0.38], [0.2, -0.28], [0, -0.42], [-0.2, -0.28], [-0.45, -0.38]]),
  ];
  for (const geo of face) {
    const m = new THREE.Mesh(geo, M.carved);
    m.position.set(0, r * 0.78, r * 0.98);
    g.add(m);
  }
  g.rotation.y = FACING;
  return g;
}

function webTex(flip: boolean) {
  return drawn(256, 256, (c) => {
    c.clearRect(0, 0, 256, 256);
    if (flip) { c.translate(256, 0); c.scale(-1, 1); }
    // cinza médio: aparece na parede clara de dia e na escura à noite
    c.strokeStyle = 'rgba(120,124,134,0.85)';
    c.lineWidth = 2.6;
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * (Math.PI / 2);
      c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * 250, Math.sin(a) * 250); c.stroke();
    }
    c.lineWidth = 2;
    for (let k = 1; k <= 7; k++) {
      const rr = k * 33;
      c.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * (Math.PI / 2);
        // fios que cedem entre os raios, como numa teia de verdade
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        if (i === 0) c.moveTo(x, y);
        else {
          const am = ((i - 0.5) / n) * (Math.PI / 2);
          c.quadraticCurveTo(Math.cos(am) * rr * 0.9, Math.sin(am) * rr * 0.9, x, y);
        }
      }
      c.stroke();
    }
  });
}
const WEB_L = webTex(false), WEB_R = webTex(true);
const webMat = (flip: boolean) => new THREE.MeshBasicMaterial({ map: flip ? WEB_R : WEB_L, transparent: true, depthWrite: false, side: THREE.DoubleSide });
const WEB_MAT_L = webMat(false), WEB_MAT_R = webMat(true);

/**
 * Teia num canto alto: `wall` é a parede (n: z fixo; w: x fixo), `at` o ponto do canto e
 * `dir` para que lado ela se abre ao longo da parede.
 */
function web(p: Part, wall: 'n' | 'w', x: number, z: number, top: number, size: number, dir: 1 | -1) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), dir > 0 ? WEB_MAT_L : WEB_MAT_R);
  if (wall === 'n') m.position.set(x + (dir * size) / 2, top - size / 2, z + 0.03);
  else { m.rotation.y = Math.PI / 2; m.position.set(x + 0.03, top - size / 2, z + (dir * size) / 2); m.material = dir > 0 ? WEB_MAT_R : WEB_MAT_L; }
  m.renderOrder = 2;
  p.group.add(m);
}

/** Aranha pendurada num fio, subindo e descendo devagar. */
function spider(p: Part, x: number, z: number, top: number, drop: number, phase: number) {
  const g = new THREE.Group();
  g.userData.dynamic = true;
  const thread = new THREE.Mesh(new THREE.BoxGeometry(0.006, 1, 0.006), M.thread);
  const body = new THREE.Group();
  const abd = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), M.black);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), M.black);
  head.position.y = 0.05;
  body.add(abd, head);
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.008, 0.008), M.black);
    leg.position.set(sx * 0.06, 0.03 - i * 0.02, 0);
    leg.rotation.z = sx * (0.5 - i * 0.3);
    body.add(leg);
  }
  g.add(thread, body);
  g.position.set(x, 0, z);
  p.group.add(g);
  p.anims.push((t) => {
    const y = top - drop * (0.75 + 0.25 * Math.sin(t * 0.6 + phase));
    body.position.y = y;
    thread.scale.y = top - y;
    thread.position.y = (top + y) / 2;
    body.rotation.y = Math.sin(t * 0.4 + phase) * 0.6;
  });
}

function tombstone(p: Part, x: number, z: number, y: number, tilt: number) {
  const g = new THREE.Group();
  const slab = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.09), M.stone);
  slab.position.y = 0.21;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.09, 12, 1, false, 0, Math.PI), M.stone);
  top.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  top.position.y = 0.42;
  const cross1 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.01), M.stoneDark);
  cross1.position.set(0, 0.32, 0.05);
  const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.01), M.stoneDark);
  cross2.position.set(0, 0.35, 0.05);
  for (const m of [slab, top]) m.castShadow = true;
  g.add(slab, top, cross1, cross2);
  g.position.set(x, y, z);
  g.rotation.set(tilt, FACING, tilt * 0.5);
  p.group.add(g);
}

/** Vela com chama que tremula. */
function candle(p: Part, x: number, y: number, z: number, h: number, phase: number) {
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, h, 8), M.candle);
  body.position.set(x, y + h / 2, z);
  p.group.add(body);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 6), M.flame);
  flame.userData.dynamic = true;
  flame.position.set(x, y + h + 0.03, z);
  p.group.add(flame);
  p.anims.push((t) => {
    const f = 1 + Math.sin(t * 9 + phase) * 0.12 + Math.sin(t * 23 + phase * 2) * 0.08;
    flame.scale.set(1, f, 1);
  });
}

/** Morcegos voando em volta do ambiente, por cima das paredes. */
function bats(p: Part, r: Rect, n: number) {
  const cx = (r.x1 + r.x2) / 2, cz = (r.z1 + r.z2) / 2;
  const wing = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.2, 0.06), new THREE.Vector2(0.17, -0.02), new THREE.Vector2(0.12, 0.01), new THREE.Vector2(0.08, -0.03), new THREE.Vector2(0.03, -0.01)]));
  for (let i = 0; i < n; i++) {
    const g = new THREE.Group();
    g.userData.dynamic = true;
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), M.black);
    body.scale.set(1, 0.8, 1.5);
    const wl = new THREE.Mesh(wing, M.black), wr = new THREE.Mesh(wing, M.black);
    (wl.material as THREE.Material).side = THREE.DoubleSide;
    wr.scale.x = -1;
    g.add(body, wl, wr);
    p.group.add(g);
    const rx = (r.x2 - r.x1) * (0.45 + Math.random() * 0.25), rz = (r.z2 - r.z1) * (0.45 + Math.random() * 0.25);
    const speed = (0.18 + Math.random() * 0.12) * (i % 2 ? 1 : -1), phase = Math.random() * 6.28, h = 2.7 + Math.random() * 0.7;
    p.anims.push((t) => {
      const a = t * speed + phase;
      g.position.set(cx + Math.cos(a) * rx, h + Math.sin(t * 1.3 + phase) * 0.15, cz + Math.sin(a) * rz);
      g.rotation.y = -a + (speed > 0 ? 0 : Math.PI);
      const flap = Math.sin(t * 14 + phase) * 0.9;
      wl.rotation.z = flap; wr.rotation.z = -flap;
    });
  }
}

/** Fantasma flutuando devagar pelo gramado. */
function ghost(p: Part, x: number, z0: number, z1: number, phase: number) {
  const g = new THREE.Group();
  g.userData.dynamic = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.ghost);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.32, 14, 1, true), M.ghost);
  skirt.position.y = -0.16;
  const eyes = [-0.07, 0.07].map((ex) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), M.eye);
    e.position.set(ex, 0.06, 0.18);
    return e;
  });
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), M.eye);
  mouth.scale.set(0.8, 1.3, 0.5);
  mouth.position.set(0, -0.03, 0.19);
  g.add(head, skirt, ...eyes, mouth);
  g.rotation.y = FACING;
  p.group.add(g);
  p.anims.push((t) => {
    const k = (Math.sin(t * 0.15 + phase) + 1) / 2;
    g.position.set(x + Math.sin(t * 0.3 + phase) * 0.4, 0.75 + Math.sin(t * 1.1 + phase) * 0.12, z0 + (z1 - z0) * k);
    g.rotation.z = Math.sin(t * 0.9 + phase) * 0.08;
  });
}

/** Caldeirão borbulhando, sobre um fogo baixo. */
function cauldron(p: Part, x: number, z: number) {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.7), M.pot);
  pot.position.y = 0.36;
  pot.castShadow = true;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.035, 8, 20), M.pot);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.62;
  const brew = new THREE.Mesh(new THREE.CircleGeometry(0.25, 20), M.brew);
  brew.rotation.x = -Math.PI / 2;
  brew.position.y = 0.6;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.04), M.pot);
    leg.position.set(Math.cos(a) * 0.2, 0.08, Math.sin(a) * 0.2);
    g.add(leg);
  }
  const logs = [0.4, -0.4].map((ry) => {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), mat('#5a3b22'));
    l.rotation.set(Math.PI / 2, ry, 0);
    l.position.y = 0.03;
    return l;
  });
  g.add(pot, rim, brew, ...logs);
  g.position.set(x, 0, z);
  p.group.add(g);
  p.blocks.push({ x1: x - 0.4, z1: z - 0.4, x2: x + 0.4, z2: z + 0.4 });
  // bolhas e chamas se mexem
  const live = new THREE.Group();
  live.userData.dynamic = true;
  live.position.set(x, 0, z);
  p.group.add(live);
  const bubbles = [0, 1, 2, 3, 4].map((i) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.035 + (i % 2) * 0.015, 8, 6), M.brew);
    live.add(b);
    return { b, ox: Math.cos(i * 1.7) * 0.13, oz: Math.sin(i * 1.7) * 0.13, ph: i * 0.37 };
  });
  const flames = [0, 1, 2].map((i) => {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), M.flame);
    f.position.set(Math.cos(i * 2.1) * 0.08, 0.1, Math.sin(i * 2.1) * 0.08);
    live.add(f);
    return f;
  });
  p.anims.push((t) => {
    for (const { b, ox, oz, ph } of bubbles) {
      const k = (t * 0.8 + ph) % 1;
      b.position.set(ox, 0.6 + k * 0.18, oz);
      b.scale.setScalar(1 - k * 0.6);
    }
    flames.forEach((f, i) => f.scale.set(1, 0.8 + Math.sin(t * 11 + i * 2) * 0.25, 1));
  });
}

// ---------- placar da caça às abóboras ----------
let placarMat: THREE.MeshStandardMaterial | null = null;
export function placarTex(rows: [string, number][]) {
  return drawn(768, 480, (c) => {
    c.fillStyle = '#1b1422'; c.fillRect(0, 0, 768, 480);
    c.fillStyle = '#e8761c'; c.fillRect(0, 0, 768, 96);
    c.fillStyle = '#1b1422'; c.font = '700 46px Geist, sans-serif'; c.textBaseline = 'middle';
    c.fillText('Caça às abóboras', 36, 50);
    c.font = '600 30px Geist, sans-serif';
    if (!rows.length) {
      c.fillStyle = '#c9bfd6';
      c.fillText('Ninguém pegou nenhuma ainda.', 36, 180);
      c.fillText('Fique de olho: elas aparecem', 36, 236);
      c.fillText('na sala e no hub.', 36, 278);
      return;
    }
    rows.slice(0, 5).forEach(([name, n], i) => {
      const y = 150 + i * 64;
      c.fillStyle = i === 0 ? '#ffcf4a' : '#efe6f7';
      c.fillText(`${i + 1}. ${name}`, 36, y);
      c.textAlign = 'right';
      c.fillText(`${n} 🎃`, 730, y);
      c.textAlign = 'left';
    });
  });
}
export function setPlacar(rows: [string, number][]) {
  if (!placarMat) return;
  placarMat.map?.dispose();
  placarMat.map = placarTex(rows);
  placarMat.needsUpdate = true;
}

/** Quadro do placar num cavalete; o clique abre o ranking completo. */
function placar(p: Part, sp: Space, x: number, z: number) {
  const g = new THREE.Group();
  const leg = mat('#3a2a1e');
  for (const dx of [-0.62, 0.62]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.6, 0.05), leg);
    l.position.set(dx, 0.8, 0);
    l.castShadow = true;
    g.add(l);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.4), leg);
    foot.position.set(dx, 0.02, 0);
    g.add(foot);
  }
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.86, 0.04), mat('#2a1e2e'));
  frame.position.set(0, 1.12, 0);
  g.add(frame);
  placarMat = new THREE.MeshStandardMaterial({ map: placarTex([]), roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0.15 });
  placarMat.emissiveMap = placarMat.map;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.28, 0.8), placarMat);
  face.position.set(0, 1.12, 0.022);
  face.userData.dynamic = true;
  g.add(face);
  const top = pumpkin(0.11);
  top.position.set(0.5, 1.55, 0);
  g.add(top);
  g.position.set(x, 0, z);
  p.group.add(g);
  p.blocks.push({ x1: x - 0.75, z1: z - 0.3, x2: x + 0.75, z2: z + 0.3 });
  sp.interactive('placar', 'Caça às abóboras', 'Ver o placar', [g]);
}

// ---------- ambientes ----------
const LAWN = -0.395;

export function decorateSala(sp: Space, r: Rect, cabinetTop: number) {
  const p = part(sp);
  for (const [x, z, s] of [[0.45, 0.45, 0.16], [6.0, 0.45, 0.13], [7.95, 1.5, 0.14], [2.9, 15.25, 0.15], [5.4, 15.2, 0.12]] as const) {
    const k = pumpkin(s);
    k.position.set(x, 0, z);
    p.group.add(k);
  }
  // em cima dos armários, perto da porta
  for (const z of [3.6, 5.7]) { const k = pumpkin(0.12); k.position.set(r.x2 - 0.3, cabinetTop, z); p.group.add(k); }
  candle(p, r.x2 - 0.3, cabinetTop, 4.7, 0.14, 0.3);
  candle(p, r.x2 - 0.26, cabinetTop, 4.86, 0.09, 1.7);
  web(p, 'n', 0, 0, 2.38, 0.95, 1);
  web(p, 'w', 0, 0, 2.38, 0.95, 1);
  web(p, 'w', 0, 5.0, 2.1, 0.55, -1);
  web(p, 'w', 0, 9.6, 2.1, 0.55, 1);
  spider(p, 0.6, 0.12, 2.3, 0.7, 0);
  spider(p, 0.1, 10.0, 2.1, 0.55, 2.1);
  for (const [dz, dx, tilt] of [[5.2, 3.7, 0.05], [8.4, 4.1, -0.08], [12.9, 3.6, 0.1], [6.4, 4.6, -0.04]] as const) tombstone(p, r.x1 - dx, r.z1 + dz, LAWN, tilt);
  candle(p, r.x1 - 3.35, LAWN, r.z1 + 5.45, 0.12, 0.9);
  candle(p, r.x1 - 3.7, LAWN, r.z1 + 8.7, 0.16, 2.4);
  const lk = pumpkin(0.2); lk.position.set(r.x1 - 3.1, LAWN, r.z1 + 10.8); p.group.add(lk);
  ghost(p, r.x1 - 3.4, r.z1 + 2.5, r.z1 + 13, 0);
  ghost(p, r.x1 - 2.4, r.z1 + 11, r.z1 + 4, 2.6);
  bats(p, r, 4);
}

export function decorateHub(sp: Space, r: Rect) {
  const p = part(sp);
  for (const [x, z, s] of [[20.4, 4.85, 0.14], [21.25, 6.62, 0.13], [22.75, 6.62, 0.13], [28.15, 0.42, 0.15], [25.75, 0.45, 0.11], [29.6, 5.7, 0.16]] as const) {
    const k = pumpkin(s);
    k.position.set(x, 0, z);
    p.group.add(k);
  }
  cauldron(p, 25.3, 5.75);
  placar(p, sp, 24.95, 1.1);
  web(p, 'n', r.x1, 0, 2.38, 0.85, 1);
  web(p, 'w', r.x1, 0, 2.38, 0.85, 1);
  web(p, 'n', r.x2, 0, 2.38, 0.7, -1);
  spider(p, r.x1 + 0.55, 0.1, 2.3, 0.6, 1.2);
  for (const [dz, dx, tilt] of [[2.0, 3.8, 0.06], [4.6, 4.2, -0.06]] as const) tombstone(p, r.x1 - dx, r.z1 + dz, LAWN, tilt);
  candle(p, r.x1 - 3.5, LAWN, r.z1 + 2.3, 0.13, 0.4);
  ghost(p, r.x1 - 3.2, r.z1 + 0.5, r.z1 + 6.5, 1.3);
  bats(p, r, 3);
}

export function decorateReuniao(sp: Space, r: Rect) {
  const p = part(sp);
  // mais discreta: nada que distraia uma chamada
  for (const [x, z, s] of [[r.x1 + 0.45, 6.3, 0.14], [r.x2 - 0.45, 6.3, 0.13], [r.x1 + 1.1, 0.45, 0.12]] as const) {
    const k = pumpkin(s);
    k.position.set(x, 0, z);
    p.group.add(k);
  }
  web(p, 'n', r.x1, 0, 2.38, 0.8, 1);
  web(p, 'w', r.x1, 0, 2.38, 0.8, 1);
  tombstone(p, r.x1 - 3.9, r.z1 + 2.6, LAWN, 0.05);
  ghost(p, r.x1 - 3.3, r.z1 + 0.8, r.z1 + 5.8, 3.4);
  bats(p, r, 2);
}

/** Junta as peças paradas de cada ambiente (uma vez, depois de montado). */
export function finishHalloween(merge: (g: THREE.Object3D) => void) {
  for (const p of parts) merge(p.group);
}

let active = false;
/** Liga ou desliga a decoração: grupos visíveis e o caminho bloqueado pelos objetos grandes. */
export function setHalloween(on: boolean) {
  if (on === active) return;
  active = on;
  for (const p of parts) {
    p.group.visible = on;
    for (const b of p.blocks) on ? p.space.nav.block(b.x1, b.z1, b.x2, b.z2) : p.space.nav.open(b.x1, b.z1, b.x2, b.z2);
  }
}

/** Anima as peças do ambiente que está na tela. */
export function animateHalloween(sp: Space, t: number) {
  if (!active) return;
  for (const p of parts) if (p.space === sp) for (const a of p.anims) a(t);
}

// ---------- caça às abóboras ----------
/** Abóbora da caça: maior, com um halo no chão para ser achada. */
export function huntPumpkin() {
  const g = new THREE.Group();
  const k = pumpkin(0.24);
  g.add(k);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.46, 32), new THREE.MeshBasicMaterial({ color: '#ffb52e', transparent: true, opacity: 0.75, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  g.add(ring);
  // facho de luz subindo, para a abóbora ser vista entre mesas e cadeiras
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.34, 2.4, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#ffb52e', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 1.2;
  g.add(beam);
  g.userData.bob = k;
  g.userData.ring = ring;
  return g;
}

/** Coroa de abóbora sobre a cabeça de quem lidera o placar. */
export function crown() {
  const g = new THREE.Group();
  const k = pumpkin(0.09);
  g.add(k);
  // pontas douradas em volta: uma coroa de abóbora
  const gold = new THREE.MeshBasicMaterial({ color: '#ffcf4a' });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.06, 4), gold);
    tip.position.set(Math.cos(a) * 0.08, 0.17, Math.sin(a) * 0.08);
    g.add(tip);
  }
  return g;
}
