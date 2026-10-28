import * as THREE from 'three';
import type { Space } from './space';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { carpet, drawn } from './textures';

// Objetos que não existem no kit: mesa de pingue-pongue, pufes, quadros, telas e placas.

const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });

export function pingPong(sp: Space, x: number, z: number) {
  const w = 2.5, d = 1.4, h = 0.5;
  const top = sp.box(x, h - 0.05, z, w, 0.05, d, std('#2f6aa8', { roughness: 0.5 }));
  top.name = 'pingpong';
  const white = std('#f4f6f8');
  sp.box(x, h, z, w, 0.004, 0.03, white, false);
  sp.box(x - w / 2 + 0.02, h, z, 0.03, 0.004, d, white, false);
  sp.box(x + w / 2 - 0.02, h, z, 0.03, 0.004, d, white, false);
  sp.box(x, h, z - d / 2 + 0.02, w, 0.004, 0.03, white, false);
  sp.box(x, h, z + d / 2 - 0.02, w, 0.004, 0.03, white, false);
  sp.box(x, h, z, 0.02, 0.14, d + 0.12, std('#e8ecef', { transparent: true, opacity: 0.85 }));
  const leg = std('#2b2f37', { metalness: 0.4 });
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) sp.box(x + dx * (w / 2 - 0.2), 0, z + dz * (d / 2 - 0.2), 0.06, h - 0.05, 0.06, leg);
  const paddle = (px: number, pz: number, color: string, rot: number) => {
    const g = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.02, 24), std(color));
    g.position.set(px, h + 0.01, pz);
    g.castShadow = true;
    sp.group.add(g);
    const handle = sp.box(px + Math.cos(rot) * 0.15, h + 0.005, pz + Math.sin(rot) * 0.15, 0.12, 0.02, 0.04, std('#8a5a34'));
    handle.rotation.y = -rot;
  };
  paddle(x - 0.8, z + 0.25, '#c8323a', 0.4);
  paddle(x + 0.75, z - 0.2, '#22262c', 3.4);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 12), std('#ffffff'));
  ball.position.set(x + 0.3, h + 0.03, z + 0.1);
  sp.group.add(ball);
  sp.nav.block(x - w / 2 - 0.25, z - d / 2 - 0.25, x + w / 2 + 0.25, z + d / 2 + 0.25);
}

/** Painel plano com textura, preso a uma parede ou num cavalete. */
export function panel(sp: Space, x: number, y: number, z: number, w: number, h: number, rot: number, tex: THREE.Texture, opts: { glow?: boolean; frame?: string; depth?: number } = {}) {
  const g = new THREE.Group();
  const depth = opts.depth ?? 0.04;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, depth), std(opts.frame ?? '#2b2f37', { metalness: 0.3 }));
  frame.castShadow = true;
  g.add(frame);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: opts.glow ? 0.35 : 0.8, emissive: opts.glow ? '#ffffff' : '#000000', emissiveMap: opts.glow ? tex : null, emissiveIntensity: opts.glow ? 0.55 : 0 });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  face.position.z = depth / 2 + 0.002;
  g.add(face);
  g.position.set(x, y, z);
  g.rotation.y = rot;
  sp.group.add(g);
  if (opts.glow) sp.glowMats.push(mat);
  return { mat, obj: g };
}

export function easel(sp: Space, x: number, z: number, rot: number, tex: THREE.Texture) {
  const legMat = std('#3a3f48', { metalness: 0.4 });
  const g = new THREE.Group();
  for (const dx of [-0.75, 0.75]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.7, 0.05), legMat);
    leg.position.set(dx, 0.85, 0);
    leg.castShadow = true;
    g.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.5), legMat);
    foot.position.set(dx, 0.02, 0);
    g.add(foot);
  }
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.03), std('#d8dce2', { metalness: 0.2 }));
  board.position.set(0, 1.1, 0);
  board.castShadow = true;
  g.add(board);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.54, 0.94), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  face.position.set(0, 1.1, 0.017);
  g.add(face);
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  sp.group.add(g);
  const c = Math.abs(Math.cos(rot)) > 0.5;
  sp.nav.block(x - (c ? 0.95 : 0.4), z - (c ? 0.4 : 0.95), x + (c ? 0.95 : 0.4), z + (c ? 0.4 : 0.95));
  return { mat: face.material as THREE.MeshStandardMaterial, obj: g };
}

export function arcade(sp: Space, x: number, z: number, rot: number) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.45, 0.6), std('#23272f'));
  body.position.y = 0.725;
  body.castShadow = true;
  g.add(body);
  const side = std('#7c4dff');
  for (const dx of [-0.32, 0.32]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.45, 0.62), side);
    s.position.set(dx, 0.725, 0);
    g.add(s);
  }
  const tex = drawn(128, 128, (c) => {
    c.fillStyle = '#0b1020'; c.fillRect(0, 0, 128, 128);
    const cols = ['#ff5d73', '#ffd166', '#06d6a0', '#4cc9f0'];
    for (let r = 0; r < 4; r++) for (let k = 0; k < 7; k++) { c.fillStyle = cols[r]; c.fillRect(10 + k * 16, 14 + r * 12, 12, 8); }
    c.fillStyle = '#ffffff'; c.fillRect(56, 104, 18, 6); c.fillRect(70, 86, 5, 5);
  });
  const scr = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.8 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.4), scr);
  screen.position.set(0, 1.1, 0.305);
  g.add(screen);
  sp.glowMats.push(scr);
  const desk = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.25), std('#30343d'));
  desk.position.set(0, 0.82, 0.38);
  g.add(desk);
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  sp.group.add(g);
  sp.nav.block(x - 0.5, z - 0.5, x + 0.5, z + 0.5);
}


// ---------- texturas com conteúdo ----------

export function whiteboardTex(w = 1024) {
  return drawn(w, 512, (c) => {
    c.fillStyle = '#fbfbfa'; c.fillRect(0, 0, w, 512);
    c.fillStyle = '#20242c'; c.font = '600 34px Geist, sans-serif'; c.fillText('Sprint 42 · Retrospectiva', 40, 62);
    c.font = '500 22px Geist, sans-serif'; c.fillStyle = '#5b6371';
    ['Funcionou bem', 'Melhorar', 'Ações'].forEach((t, i) => c.fillText(t, 40 + i * 330, 118));
    c.strokeStyle = '#d5d9df'; c.lineWidth = 3;
    [350, 680].forEach((x) => { c.beginPath(); c.moveTo(x, 96); c.lineTo(x, 480); c.stroke(); });
    const notes = [['#ffe27a', 0], ['#ffe27a', 1], ['#ffb3c4', 0], ['#a8e6c1', 1], ['#a8e6c1', 2], ['#9fd0ff', 2], ['#ffe27a', 2], ['#ffb3c4', 1]] as const;
    const pos = [[44, 140], [190, 150], [52, 300], [372, 142], [520, 148], [712, 142], [860, 150], [380, 300]];
    notes.forEach(([col], i) => {
      const [x, y] = pos[i];
      c.save(); c.translate(x + 60, y + 60); c.rotate((i % 3 - 1) * 0.04); c.translate(-60, -60);
      c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(4, 6, 120, 120);
      c.fillStyle = col; c.fillRect(0, 0, 120, 120);
      c.fillStyle = 'rgba(30,30,30,0.55)';
      for (let l = 0; l < 3; l++) c.fillRect(14, 22 + l * 22, 70 + ((i * 13 + l * 29) % 30), 6);
      c.restore();
    });
    c.strokeStyle = '#2f6fd6'; c.lineWidth = 4;
    c.strokeRect(720, 320, 110, 60); c.strokeRect(870, 320, 110, 60);
    c.beginPath(); c.moveTo(830, 350); c.lineTo(868, 350); c.lineTo(858, 342); c.moveTo(868, 350); c.lineTo(858, 358); c.stroke();
    c.strokeStyle = '#d0423a'; c.beginPath(); c.moveTo(60, 470); c.bezierCurveTo(140, 440, 220, 490, 300, 455); c.stroke();
  });
}

export function slideTex() {
  return drawn(1024, 576, (c) => {
    const g = c.createLinearGradient(0, 0, 1024, 576);
    g.addColorStop(0, '#111827'); g.addColorStop(1, '#1f2a44');
    c.fillStyle = g; c.fillRect(0, 0, 1024, 576);
    c.fillStyle = '#ffffff'; c.font = '700 54px Geist, sans-serif'; c.fillText('Roadmap Q4', 64, 110);
    c.fillStyle = '#9aa7c0'; c.font = '500 26px Geist, sans-serif'; c.fillText('Prioridades por trimestre', 64, 156);
    const bars = [['Presença', 0.9, '#5b8cff'], ['Proximidade', 0.72, '#22c55e'], ['Reuniões', 0.55, '#f2b443'], ['Quadros', 0.38, '#c084fc']] as const;
    bars.forEach(([name, v, col], i) => {
      const y = 230 + i * 78;
      c.fillStyle = '#cdd5e3'; c.font = '500 26px Geist, sans-serif'; c.fillText(name, 64, y + 30);
      c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(300, y, 640, 40);
      c.fillStyle = col; c.fillRect(300, y, 640 * v, 40);
    });
  });
}

export function pinboardTex(title: string, accent: string) {
  return drawn(768, 480, (c) => {
    c.fillStyle = '#f4f5f7'; c.fillRect(0, 0, 768, 480);
    c.fillStyle = accent; c.fillRect(0, 0, 768, 70);
    c.fillStyle = '#ffffff'; c.font = '700 34px Geist, sans-serif'; c.fillText(title, 28, 47);
    const cols = ['A fazer', 'Fazendo', 'Feito'];
    cols.forEach((t, i) => {
      const x = 24 + i * 248;
      c.fillStyle = '#5b6371'; c.font = '600 20px Geist, sans-serif'; c.fillText(t, x, 108);
      for (let k = 0; k < 3 - (i === 2 ? 1 : 0); k++) {
        c.fillStyle = '#ffffff'; c.fillRect(x, 124 + k * 106, 224, 92);
        c.fillStyle = 'rgba(0,0,0,0.06)'; c.fillRect(x, 214 + k * 106, 224, 2);
        c.fillStyle = '#2b303a'; c.fillRect(x + 14, 144 + k * 106, 150 - k * 18, 10);
        c.fillStyle = '#a3abb8'; c.fillRect(x + 14, 166 + k * 106, 110, 8);
        c.fillStyle = [accent, '#22c55e', '#f2b443'][(k + i) % 3]; c.fillRect(x + 14, 188 + k * 106, 46, 12);
      }
    });
  });
}

export function signTex(text: string, sub: string) {
  return drawn(1024, 256, (c) => {
    c.fillStyle = '#20242c'; c.fillRect(0, 0, 1024, 256);
    c.fillStyle = '#f2b443';
    c.beginPath(); c.roundRect(60, 64, 128, 128, 30); c.fill();
    c.strokeStyle = '#20242c'; c.lineWidth = 16; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(94, 100); c.lineTo(124, 158); c.lineTo(154, 100); c.stroke();
    c.fillStyle = '#ffffff'; c.font = '700 84px Geist, sans-serif'; c.fillText(text, 226, 150);
    c.fillStyle = '#9aa3b2'; c.font = '500 30px Geist, sans-serif'; c.fillText(sub, 230, 200);
  });
}

export function nameplateTex(name: string) {
  return drawn(256, 64, (c) => {
    c.fillStyle = '#ffffff'; c.beginPath(); c.roundRect(0, 0, 256, 64, 14); c.fill();
    c.fillStyle = '#20242c'; c.font = '600 34px Geist, sans-serif'; c.textAlign = 'center'; c.fillText(name, 128, 44);
  });
}

export function nameplate(sp: Space, x: number, y: number, z: number, rot: number, name: string) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.085), new THREE.MeshStandardMaterial({ map: nameplateTex(name), roughness: 0.6 }));
  m.userData.dynamic = true;
  m.rotation.set(-Math.PI / 2 + 0.5, 0, 0, 'YXZ');
  m.rotation.y = rot;
  m.position.set(x, y + 0.03, z);
  sp.group.add(m);
  return m;
}

const noteMat = new THREE.MeshStandardMaterial({ color: '#ffd84d', roughness: 0.8 });
export function stickyNote(sp: Space, x: number, y: number, z: number, rot: number) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), noteMat);
  m.rotation.set(-Math.PI / 2, 0, rot);
  m.position.set(x, y + 0.004, z);
  m.receiveShadow = true;
  m.userData.dynamic = true;
  sp.group.add(m);
  return m;
}


/** Árvore baixa-poligonal do lado de fora, com galhos que avançam na direção do prédio. */
export function tree(sp: Space, x: number, z: number, h: number, seed: number, lean = 1) {
  let k = seed * 9301 + 49297;
  const r = () => ((k = (k * 9301 + 49297) % 233280) / 233280);
  const g = new THREE.Group();
  const bark = std('#6b5140', { roughness: 1 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.15, h * 0.6, 7), bark);
  trunk.position.y = h * 0.3;
  trunk.castShadow = true;
  g.add(trunk);
  const leaves = ['#6a9f5b', '#578d4c', '#7bb06a', '#4d7f45'].map((c) => std(c, { flatShading: true, roughness: 0.9 }));
  for (let i = 0; i < 5; i++) {
    const len = 0.9 + r() * 0.9;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.05, len, 5), bark);
    const ang = (r() - 0.5) * 2.4;
    b.position.set(Math.cos(ang) * len * 0.4 * lean, h * (0.45 + r() * 0.25), Math.sin(ang) * len * 0.4);
    b.rotation.set(Math.sin(ang) * 0.9, 0, -Math.cos(ang) * 0.9 * lean);
    b.castShadow = true;
    g.add(b);
    const tuft = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28 + r() * 0.18, 0), leaves[i % leaves.length]);
    tuft.position.set(Math.cos(ang) * len * 0.85 * lean, b.position.y + len * 0.35, Math.sin(ang) * len * 0.85);
    tuft.castShadow = true;
    g.add(tuft);
  }
  for (let i = 0; i < 8; i++) {
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45 + r() * 0.4, 0), leaves[i % leaves.length]);
    c.position.set((r() - 0.5) * 1.3, h * 0.72 + r() * h * 0.28, (r() - 0.5) * 1.3);
    c.rotation.set(r() * 3, r() * 3, 0);
    c.castShadow = true;
    g.add(c);
  }
  g.position.set(x, -0.4, z);
  g.userData.noDim = true;
  sp.group.add(g);
}

// --- cadeira de escritório estofada (base de cinco pés com rodízios, encosto alto e braços em T)

let chairParts: { cushion: THREE.BufferGeometry; back: THREE.BufferGeometry; caster: THREE.BufferGeometry; plastic: THREE.MeshStandardMaterial } | null = null;
const fabricMats = new Map<string, THREE.MeshStandardMaterial>();

function fabric(color: string) {
  let m = fabricMats.get(color);
  if (!m) {
    const map = carpet('#ffffff', '#000000', 5);
    map.repeat.set(3, 3);
    m = new THREE.MeshStandardMaterial({ color, map, roughness: 0.95 });
    fabricMats.set(color, m);
  }
  return m;
}

/**
 * Cadeira virada para `rot` (quem senta olha nessa direção); o encosto fica atrás.
 * Proporções ajustadas aos personagens, que têm pernas curtas: assento a 0,31 m.
 */
export function officeChair(sp: Space, x: number, z: number, rot: number, color: string) {
  chairParts ??= {
    cushion: new RoundedBoxGeometry(0.5, 0.08, 0.44, 3, 0.035),
    back: new RoundedBoxGeometry(0.46, 0.44, 0.07, 3, 0.03),
    caster: new THREE.SphereGeometry(0.028, 10, 8),
    plastic: std('#1d2026', { roughness: 0.45 }),
  };
  const { cushion, back, caster, plastic } = chairParts;
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number, rx = 0, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.order = 'YXZ';
    m.rotation.set(rx, ry, 0);
    m.position.set(px, py, pz);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const bar = (sx: number, sy: number, sz: number) => new THREE.BoxGeometry(sx, sy, sz);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 10;
    add(bar(0.045, 0.03, 0.26), plastic, Math.sin(a) * 0.13, 0.065, Math.cos(a) * 0.13, 0.12, a);
    add(caster, plastic, Math.sin(a) * 0.25, 0.028, Math.cos(a) * 0.25);
  }
  add(new THREE.CylinderGeometry(0.04, 0.045, 0.05, 14), plastic, 0, 0.085, 0);
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.13, 12), plastic, 0, 0.17, 0);
  add(bar(0.2, 0.035, 0.2), plastic, 0, 0.245, 0);
  add(cushion, fabric(color), 0, 0.27, 0.03);
  // haste do encosto e encosto levemente inclinado
  add(bar(0.07, 0.2, 0.03), plastic, 0, 0.33, -0.24, -0.08);
  add(back, fabric(color), 0, 0.62, -0.27, -0.1);
  for (const sx of [-1, 1]) {
    add(bar(0.08, 0.03, 0.04), plastic, sx * 0.25, 0.26, 0.03);
    add(bar(0.03, 0.15, 0.04), plastic, sx * 0.29, 0.33, 0.03);
    add(bar(0.06, 0.03, 0.2), plastic, sx * 0.29, 0.415, 0.05);
  }
  g.rotation.y = rot;
  g.position.set(x, 0, z);
  sp.group.add(g);
  sp.nav.block(x - 0.36, z - 0.36, x + 0.36, z + 0.36);
  return g;
}
