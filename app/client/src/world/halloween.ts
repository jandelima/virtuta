import * as THREE from 'three';
import type { Rect } from '../../../shared/layout';
import type { Space } from './space';
import { drawn } from './textures';

// Decoração de Halloween. Cada ambiente ganha um grupo próprio, visível só durante o tema:
// teias (de canto, de janela e entre as árvores), aranhas, morcegos que pousam de cabeça para
// baixo nos cantos e voam de um canto a outro, fantasmas no gramado, lápides discretas, velas
// e, no hub, o caldeirão e o placar da caça. Abóbora, só a da caça (e a coroinha de quem lidera).
// As peças paradas são juntadas como o resto do cenário; o que se mexe é atualizado a cada
// quadro que a cena já desenha.

type Anim = (t: number, dt: number) => void;
interface Part { space: Space; group: THREE.Group; anims: Anim[]; blocks: Rect[] }
const parts: Part[] = [];

const std = (color: string, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });
const M = {
  batFur: std('#2b2330', { roughness: 0.95 }),
  batWing: std('#463a4f', { roughness: 0.85, side: THREE.DoubleSide }),
  batBone: std('#1d1722', { roughness: 0.7 }),
  batEye: new THREE.MeshBasicMaterial({ color: '#ffb347' }),
  spider: std('#141117', { roughness: 0.32, metalness: 0.15 }),
  spiderMark: std('#c2381f', { roughness: 0.4 }),
  spiderEye: new THREE.MeshBasicMaterial({ color: '#ff5a4a' }),
  thread: new THREE.LineBasicMaterial({ color: '#c9ccd3', transparent: true, opacity: 0.55 }),
  stone: std('#9aa0a6', { roughness: 0.95 }),
  moss: std('#6f7d5a', { roughness: 1 }),
  wax: std('#efe4cc', { roughness: 0.6 }),
  wick: std('#2a2420'),
  // pouco metal: sem reflexo do ambiente, o metal puro sai preto
  iron: std('#4a505a', { roughness: 0.5, metalness: 0.25, side: THREE.DoubleSide }),
  ironRim: std('#6b727d', { roughness: 0.35, metalness: 0.3 }),
  bark: std('#5c3d26', { roughness: 0.95 }),
  ember: new THREE.MeshBasicMaterial({ color: '#ff7a1f' }),
  ghost: new THREE.MeshStandardMaterial({ color: '#f6f8ff', roughness: 0.45, emissive: '#dde5ff', emissiveIntensity: 0.35, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  ghostFace: new THREE.MeshBasicMaterial({ color: '#23222c' }),
  wood: std('#7a5233', { roughness: 0.85 }),
  pumpkin: std('#e8761c', { roughness: 0.55 }),
  pumpkinStem: std('#4f5a2a', { roughness: 0.9 }),
  carved: new THREE.MeshBasicMaterial({ color: '#ffcf4a' }),
  gold: std('#e9b949', { roughness: 0.3, metalness: 0.8 }),
};

/** Ponto de luz suave (velas, chamas, vapor), sempre de frente para a câmera. */
const glowTex = drawn(64, 64, (c) => {
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
});
const flameTex = drawn(64, 128, (c) => {
  // gota de chama: miolo claro, borda laranja, ponta fina
  const g = c.createRadialGradient(32, 92, 2, 32, 80, 40);
  g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.35, 'rgba(255,200,90,0.95)'); g.addColorStop(0.75, 'rgba(255,120,30,0.5)'); g.addColorStop(1, 'rgba(255,90,20,0)');
  c.fillStyle = g;
  c.beginPath(); c.moveTo(32, 4); c.bezierCurveTo(52, 50, 58, 82, 32, 124); c.bezierCurveTo(6, 82, 12, 50, 32, 4); c.fill();
});
const sprite = (tex: THREE.Texture, color: string, opacity = 1) => new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));

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
const live = <T extends THREE.Object3D>(o: T) => { o.userData.dynamic = true; return o; };
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// =====================================================================
// Teias
// =====================================================================
/** Desenha uma teia de orbe: fios de ancoragem, raios e a espiral que cede entre eles. */
function drawOrb(c: CanvasRenderingContext2D, cx: number, cy: number, R: number, spokes: number, seed: number, anchors: [number, number][] = []) {
  let s = seed;
  const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  c.lineCap = 'round';
  c.strokeStyle = 'rgba(232,236,244,0.9)';
  c.shadowColor = 'rgba(255,255,255,0.35)'; c.shadowBlur = 2;
  c.lineWidth = 2.2;
  for (const [ax, ay] of anchors) { c.beginPath(); c.moveTo(cx, cy); c.lineTo(ax, ay); c.stroke(); }
  const ang = Array.from({ length: spokes }, (_, i) => (i / spokes) * Math.PI * 2 + (rand() - 0.5) * 0.22);
  const len = ang.map(() => R * (0.86 + rand() * 0.14));
  c.lineWidth = 1.8;
  ang.forEach((a, i) => { c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * len[i], cy + Math.sin(a) * len[i]); c.stroke(); });
  // espiral de captura: anéis que cedem para o centro entre um raio e outro, com falhas
  c.lineWidth = 1.25;
  const rings = 11;
  for (let k = 2; k <= rings; k++) {
    const f = k / rings;
    c.beginPath();
    let pen = false;
    for (let i = 0; i <= spokes; i++) {
      const a = ang[i % spokes], r = len[i % spokes] * f;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (!pen || rand() < 0.04) { c.moveTo(x, y); pen = true; continue; }
      const a0 = ang[(i - 1) % spokes], r0 = len[(i - 1) % spokes] * f;
      let am = (a0 + a) / 2; if (a < a0) am += Math.PI;
      const rm = ((r0 + r) / 2) * 0.9;
      c.quadraticCurveTo(cx + Math.cos(am) * rm, cy + Math.sin(am) * rm, x, y);
    }
    c.stroke();
  }
  c.lineWidth = 1;
  for (let k = 0; k < 3; k++) { c.beginPath(); c.arc(cx, cy, 4 + k * 4, 0, Math.PI * 2); c.stroke(); }
  c.shadowBlur = 0;
}

const ORB = [0, 1, 2].map((v) => drawn(512, 512, (c) => drawOrb(c, 256, 256, 228, 14 + v * 2, 17 + v * 31, [[256, 0], [0, 256], [512, 300], [240, 512]])));
/** Teia de canto: o centro fica perto do canto e os raios se abrem para as duas paredes. */
const CORNER = [0, 1].map((v) => drawn(512, 512, (c) => drawOrb(c, 150 + v * 20, 150, 340, 12, 101 + v * 7, [[0, 0], [512, 0], [0, 512], [0, 260], [300, 0]])));
const webMat = (tex: THREE.Texture) => new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.9 });
const WEB_ORB = ORB.map(webMat), WEB_CORNER = CORNER.map(webMat);

/**
 * Teia de canto em 3D: esticada na diagonal, presa nas duas paredes e descendo pelo canto
 * (de frente para a câmera nos cantos do fundo). `ux`/`uz` apontam para dentro do ambiente.
 */
function cornerWeb(p: Part, x: number, z: number, top: number, size: number, ux: 1 | -1, uz: 1 | -1, v = 0) {
  const o = 0.075;
  const B = [x + size * ux, top, z + o * uz];
  const C = [x + o * ux, top, z + size * uz];
  const D = [x + o * ux, top - size * 1.1, z + o * uz];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...B, ...C, ...D], 3));
  // o centro da teia cai no meio do triângulo; as bordas cortam os fios onde tocam as paredes
  g.setAttribute('uv', new THREE.Float32BufferAttribute([1.02, 0.8, -0.02, 0.8, 0.5, -0.1], 2));
  const m = new THREE.Mesh(g, WEB_ORB[v % 3]);
  m.renderOrder = 3;
  p.group.add(m);
  // fios do canto até a teia
  const mid = new THREE.Vector3((B[0] + C[0] + D[0]) / 3, (B[1] + C[1] + D[1]) / 3, (B[2] + C[2] + D[2]) / 3);
  strands(p, [[x + o * ux, top, z + o * uz], [mid.x, mid.y, mid.z]], 0.01);
  return mid;
}

/** Teia plana num canto de parede ou janela; `wall` n: parede de z fixo, w: de x fixo. */
function flatWeb(p: Part, wall: 'n' | 'w', x: number, y: number, z: number, size: number, along: 1 | -1, down: 1 | -1, v = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), WEB_CORNER[v % 2]);
  // o canto da textura (alto, à esquerda) vai para o canto da parede
  m.scale.set(along, down, 1);
  if (wall === 'n') m.position.set(x + (along * size) / 2, y - (down * size) / 2, z);
  else { m.rotation.y = Math.PI / 2; m.scale.x = -along; m.position.set(x, y - (down * size) / 2, z + (along * size) / 2); }
  m.renderOrder = 3;
  p.group.add(m);
}

/** Teia de orbe solta, de frente para a câmera (entre galhos, no gramado). */
function orbWeb(p: Part, x: number, y: number, z: number, size: number, v = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), WEB_ORB[v % 3]);
  m.position.set(x, y, z);
  m.rotation.y = Math.PI / 4;
  m.renderOrder = 3;
  p.group.add(m);
}

/** Fios soltos pendurados, curvados pelo próprio peso. */
function strands(p: Part, pts: [number, number, number][], sag: number) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = new THREE.Vector3(...pts[i]), b = new THREE.Vector3(...pts[i + 1]);
    const mid = a.clone().lerp(b, 0.5); mid.y -= sag;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    p.group.add(live(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(16)), M.thread)));
  }
}

// =====================================================================
// Aranha
// =====================================================================
/** Aranha: abdômen com marca, cefalotórax, olhos e oito pernas de três segmentos. */
function makeSpider(scale = 1) {
  const g = new THREE.Group();
  const abd = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), M.spider);
  abd.scale.set(0.95, 0.8, 1.2);
  abd.position.set(0, 0.035, -0.055);
  const mark = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), M.spiderMark);
  mark.scale.set(0.7, 0.35, 1.5);
  mark.position.set(0, 0.075, -0.06);
  const ceph = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 10), M.spider);
  ceph.scale.set(1, 0.72, 1.1);
  ceph.position.set(0, 0.028, 0.02);
  g.add(abd, mark, ceph);
  for (const [ex, ey] of [[-0.009, 0.044], [0.009, 0.044], [-0.017, 0.038], [0.017, 0.038]]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.005, 6, 4), M.spiderEye);
    e.position.set(ex, ey, 0.05);
    g.add(e);
  }
  for (const sx of [-1, 1]) {
    const fang = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.02, 5), M.spider);
    fang.rotation.x = Math.PI * 0.85;
    fang.position.set(sx * 0.008, 0.016, 0.054);
    g.add(fang);
  }
  // pernas: sobem até o joelho, descem até o chão, e a ponta curva para fora
  const legs: THREE.Group[] = [];
  const seg = (len: number, r: number) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, len, 6), M.spider); m.position.y = len / 2; return m; };
  [[-0.95, 0.075], [-0.35, 0.07], [0.3, 0.07], [0.9, 0.078]].forEach(([yaw, l1]) => {
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(sx * 0.022, 0.03, 0.02);
      hip.rotation.order = 'YXZ';
      hip.rotation.y = sx > 0 ? -Math.PI / 2 + yaw : Math.PI / 2 - yaw;
      const femur = new THREE.Group(); femur.rotation.x = -0.9; femur.add(seg(l1, 0.0055));
      const knee = new THREE.Group(); knee.position.y = l1; knee.rotation.x = 2.0;
      const tibia = new THREE.Group(); tibia.add(seg(l1 * 1.25, 0.0045));
      const ankle = new THREE.Group(); ankle.position.y = l1 * 1.25; ankle.rotation.x = 0.5; ankle.add(seg(l1 * 0.55, 0.0032));
      tibia.add(ankle); knee.add(tibia); femur.add(knee); hip.add(femur);
      g.add(hip);
      legs.push(femur);
    }
  });
  g.scale.setScalar(scale);
  g.userData.legs = legs;
  return g;
}

/** Aranha parada numa teia, mexendo as pernas de vez em quando. */
function webSpider(p: Part, x: number, y: number, z: number, faceY: number, scale: number) {
  const s = live(makeSpider(scale));
  s.position.set(x, y, z);
  // deitada no plano da teia, de cabeça para cima
  s.rotation.set(-Math.PI / 2, faceY, 0, 'YXZ');
  p.group.add(s);
  const legs = s.userData.legs as THREE.Group[];
  const base = legs.map((l) => l.rotation.x);
  const ph = Math.random() * 10;
  p.anims.push((t) => {
    const twitch = Math.max(0, Math.sin(t * 0.7 + ph) - 0.85) * 4;
    legs.forEach((l, i) => (l.rotation.x = base[i] + Math.sin(t * 9 + i) * 0.12 * twitch));
  });
}

/** Aranha descendo e subindo pelo fio, com pausas, a partir de um ponto no alto. */
function hangingSpider(p: Part, x: number, top: number, z: number, drop: number, scale: number) {
  const s = makeSpider(scale);
  const holder = live(new THREE.Group());
  holder.add(s);
  // pendurada de cabeça para baixo, de frente para a câmera, com as pernas recolhidas
  s.rotation.set(Math.PI / 2, Math.PI / 4, 0, 'YXZ');
  for (const l of s.userData.legs as THREE.Group[]) { l.rotation.x = -0.35; (l.children[1] as THREE.Group).rotation.x = 1.4; }
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1, 0)]);
  const thread = live(new THREE.Line(geo, M.thread));
  thread.position.set(x, top, z);
  holder.position.set(x, top, z);
  p.group.add(holder, thread);
  const legs = s.userData.legs as THREE.Group[];
  const base = legs.map((l) => l.rotation.x);
  const ph = Math.random() * 20;
  p.anims.push((t) => {
    // ciclo lento: desce, para um tempo, sobe um pouco, para de novo
    const k = (t * 0.05 + ph) % 1;
    const e = k < 0.3 ? k / 0.3 : k < 0.55 ? 1 : k < 0.75 ? 1 - ((k - 0.55) / 0.2) * 0.55 : 0.45;
    const y = top - 0.08 - drop * (e * e * (3 - 2 * e));
    holder.position.y = y;
    holder.rotation.y = Math.sin(t * 0.5 + ph) * 0.5;
    thread.scale.y = top - y - 0.02;
    legs.forEach((l, i) => (l.rotation.x = base[i] + Math.sin(t * 2 + i * 0.8) * 0.06));
  });
}

// =====================================================================
// Morcego
// =====================================================================
/** Asa: membrana interna (braço) e externa (mão, com três dedos e a borda recortada entre eles). */
function makeWing() {
  const arm = new THREE.Group();
  const flat = (shape: THREE.Shape) => { const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), M.batWing); m.rotation.x = -Math.PI / 2; return m; };
  /** Osso fino do ponto (x1, z1) ao (x2, z2), no plano da asa. */
  const bone = (x1: number, z1: number, x2: number, z2: number, r: number) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, len, 5), M.batBone);
    m.rotation.z = -Math.PI / 2;
    m.position.x = len / 2;
    const pivot = new THREE.Group();
    pivot.add(m);
    pivot.position.set(x1, 0.002, z1);
    pivot.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    return pivot;
  };
  const inner = new THREE.Shape();
  inner.moveTo(0, 0.012); inner.lineTo(0.13, 0.022); inner.lineTo(0.12, -0.005);
  inner.quadraticCurveTo(0.07, -0.03, 0.035, -0.075); inner.quadraticCurveTo(0.012, -0.05, 0, -0.06); inner.lineTo(0, 0.012);
  arm.add(flat(inner));
  arm.add(bone(0, -0.012, 0.13, -0.022, 0.006));
  const hand = new THREE.Group();
  hand.position.set(0.13, 0, -0.022);
  const outer = new THREE.Shape();
  outer.moveTo(0, 0.004); outer.lineTo(0.17, 0.045);
  outer.quadraticCurveTo(0.14, 0.0, 0.15, -0.04);
  outer.quadraticCurveTo(0.1, -0.03, 0.085, -0.085);
  outer.quadraticCurveTo(0.05, -0.05, 0.0, -0.06);
  outer.lineTo(-0.01, 0.02);
  hand.add(flat(outer));
  // dedos: do punho até cada ponta (dão o desenho da asa)
  for (const [tx, ty] of [[0.17, 0.045], [0.15, -0.04], [0.085, -0.085]]) hand.add(bone(0, 0, tx, -ty, 0.0034));
  const thumb = new THREE.Mesh(new THREE.ConeGeometry(0.005, 0.02, 4), M.batBone);
  thumb.rotation.x = -Math.PI / 2;
  thumb.position.set(0.005, 0.004, -0.03);
  hand.add(thumb);
  arm.add(hand);
  return { arm, hand };
}

function makeBat() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), M.batFur);
  torso.scale.set(0.8, 0.72, 1.25);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 10), M.batFur);
  head.position.set(0, 0.012, 0.068);
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), M.batFur);
  snout.scale.set(1, 0.8, 1.2); snout.position.set(0, 0.002, 0.098);
  body.add(torso, head, snout);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.05, 6), M.batFur);
    ear.position.set(sx * 0.018, 0.048, 0.064);
    ear.rotation.set(-0.25, 0, -sx * 0.35);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 6, 4), M.batEye);
    eye.position.set(sx * 0.014, 0.02, 0.095);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.004, 0.035, 4), M.batBone);
    foot.rotation.x = Math.PI / 2;
    foot.position.set(sx * 0.014, -0.01, -0.078);
    body.add(ear, eye, foot);
  }
  const shoulders: THREE.Group[] = [];
  const wings = [-1, 1].map((sx) => {
    const w = makeWing();
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.03, 0.01, 0.025);
    shoulder.scale.x = sx;
    shoulder.add(w.arm);
    body.add(shoulder);
    shoulders.push(shoulder);
    return w;
  });
  root.userData.wings = wings;
  root.userData.shoulders = shoulders;
  // pousado: as asas fecham em volta do corpo, como um casulo, com as nervuras dos dedos à vista
  const cloak = new THREE.Group();
  // o casulo vai dos pés até o pescoço; a cabeça, com as orelhas, fica para fora
  const prof = [[0.006, -0.105], [0.03, -0.095], [0.05, -0.06], [0.06, -0.015], [0.055, 0.02], [0.04, 0.042], [0.026, 0.048]].map(([r, y]) => new THREE.Vector2(r, y));
  const shell = new THREE.Mesh(new THREE.LatheGeometry(prof, 18), M.batWing);
  shell.rotation.x = -Math.PI / 2;
  shell.scale.set(1, 1, 0.85);
  cloak.add(shell);
  for (const a of [-0.9, -0.3, 0.3, 0.9]) {
    // nervura: corre por fora do casulo, do ombro até a ponta de baixo
    const pts = prof.slice(1, 6).map(([r, y]) => new THREE.Vector3(Math.sin(a) * (r + 0.002), Math.cos(a) * (r + 0.002) * 0.85, y));
    cloak.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.0028, 4), M.batBone));
  }
  cloak.position.z = -0.02;
  body.add(cloak);
  root.userData.cloak = cloak;
  // no tamanho dos móveis do kit, que são maiores que os de verdade
  root.scale.setScalar(1.6);
  return root;
}

interface Perch { pos: THREE.Vector3; n: THREE.Vector3; busy: boolean }

/**
 * Morcegos de um ambiente: cada um pousa de cabeça para baixo num poleiro (alto das paredes,
 * alto das janelas), espera um tempo, voa por uma curva só sua até outro poleiro livre e pousa.
 */
function bats(p: Part, perchList: Perch[], n: number) {
  const tmpM = new THREE.Matrix4();
  const hangQ = (pc: Perch) => {
    // cabeça para baixo, costas para a parede
    const f = new THREE.Vector3(0, -1, 0), up = pc.n.clone().negate();
    const xA = new THREE.Vector3().crossVectors(up, f).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, up, f));
  };
  const free = () => {
    const list = perchList.filter((x) => !x.busy);
    return list[Math.floor(Math.random() * list.length)];
  };
  const hangPos = (pc: Perch) => pc.pos.clone().add(new THREE.Vector3(0, -0.14, 0)).addScaledVector(pc.n, 0.05);
  for (let i = 0; i < n && perchList.some((x) => !x.busy); i++) {
    const bat = live(makeBat());
    const wings = bat.userData.wings as { arm: THREE.Group; hand: THREE.Group }[];
    const shoulders = bat.userData.shoulders as THREE.Group[];
    const cloak = bat.userData.cloak as THREE.Group;
    p.group.add(bat);
    let at = free(); at.busy = true;
    let from = at;
    let state: 'hang' | 'fly' = 'hang';
    let clock = 0, until = rnd(4, 30), t0 = 0, dur = 1;
    let curve: THREE.CubicBezierCurve3 | null = null;
    bat.position.copy(hangPos(at));
    bat.quaternion.copy(hangQ(at));
    const ph = Math.random() * 10;
    const sway = new THREE.Quaternion();
    const pose = (open: number, flap: number) => {
      // aberta: asas batendo (a mão acompanha o braço com atraso); fechada: o casulo toma o lugar
      const o = THREE.MathUtils.clamp(open, 0, 1);
      shoulders.forEach((s, i) => s.scale.set(i === 0 ? -Math.max(0.001, o) : Math.max(0.001, o), Math.max(0.001, o), Math.max(0.001, o)));
      cloak.scale.setScalar(Math.max(0.001, 1 - o));
      cloak.visible = o < 0.98;
      for (const { arm, hand } of wings) {
        arm.rotation.z = Math.sin(flap) * 0.85 * o;
        hand.rotation.z = Math.sin(flap - 0.7) * 0.55 * o;
      }
    };
    pose(0, 0);
    p.anims.push((t, dt) => {
      clock += dt;
      if (state === 'hang') {
        // pendurado: balança de leve e, de vez em quando, abre e fecha as asas
        const axis = new THREE.Vector3(-at.n.z, 0, at.n.x);
        sway.setFromAxisAngle(axis, Math.sin(t * 1.1 + ph) * 0.06);
        bat.quaternion.copy(sway).multiply(hangQ(at));
        // de vez em quando, abre um pouco as asas e fecha de novo
        const stretch = Math.max(0, Math.sin(t * 0.37 + ph) - 0.95) * 6;
        pose(stretch * 0.3, t * 6);
        if (clock < until) return;
        const to = free();
        if (!to) { until = clock + 5; return; }
        from = at; at = to; to.busy = true; from.busy = false;
        const a = hangPos(from), b = hangPos(to);
        // curva própria: cai do poleiro, sobe por cima do ambiente e chega por um lado
        const lift = rnd(0.5, 1.2);
        const side = new THREE.Vector3(rnd(-1.5, 1.5), 0, rnd(-1.5, 1.5));
        curve = new THREE.CubicBezierCurve3(a,
          a.clone().addScaledVector(from.n, rnd(0.8, 1.6)).add(new THREE.Vector3(0, lift - 0.3, 0)).add(side),
          b.clone().addScaledVector(to.n, rnd(0.8, 1.6)).add(new THREE.Vector3(0, lift * 0.6, 0)).sub(side), b);
        dur = THREE.MathUtils.clamp(curve.getLength() / rnd(1.6, 2.4), 2.5, 7);
        t0 = clock;
        state = 'fly';
        return;
      }
      const k = Math.min(1, (clock - t0) / dur);
      const e = k * k * (3 - 2 * k);
      const pos = curve!.getPoint(e);
      const dir = curve!.getPoint(Math.min(1, e + 0.02)).sub(pos);
      bat.position.copy(pos);
      // voando: olha para onde vai; ao sair e ao chegar, gira para a posição de pendurado
      if (dir.lengthSq() > 1e-8) {
        const fq = new THREE.Quaternion().setFromRotationMatrix(tmpM.lookAt(new THREE.Vector3(), dir.normalize().negate(), new THREE.Vector3(0, 1, 0)));
        const land = THREE.MathUtils.smoothstep(k, 0.82, 1), take = 1 - THREE.MathUtils.smoothstep(k, 0, 0.12);
        bat.quaternion.copy(fq.slerp(hangQ(at), land).slerp(hangQ(from), take));
      }
      const open = Math.min(THREE.MathUtils.smoothstep(k, 0, 0.1), 1 - THREE.MathUtils.smoothstep(k, 0.86, 1));
      pose(open, t * 15 + ph);
      if (k >= 1) { state = 'hang'; clock = 0; until = rnd(10, 40); pose(0, 0); }
    });
  }
}

// =====================================================================
// Fantasma
// =====================================================================
function ghost(p: Part, path: [number, number][], phase: number) {
  const g = live(new THREE.Group());
  // lençol: cúpula redonda que se abre numa barra ondulada
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) { const a = (i / 10) * (Math.PI / 2); prof.push(new THREE.Vector2(Math.max(0.001, Math.sin(a) * 0.21), 0.18 + Math.cos(a) * 0.21)); }
  prof.push(new THREE.Vector2(0.22, 0.05), new THREE.Vector2(0.24, -0.12), new THREE.Vector2(0.27, -0.24));
  const geo = new THREE.LatheGeometry(prof, 28);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const base = Float32Array.from(pos.array as Float32Array);
  g.add(new THREE.Mesh(geo, M.ghost));
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), M.ghost);
    arm.scale.set(1.3, 0.7, 0.8);
    arm.position.set(sx * 0.22, 0.05, 0.03);
    arm.rotation.z = sx * 0.6;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), M.ghostFace);
    eye.scale.set(0.75, 1.15, 0.4);
    eye.position.set(sx * 0.072, 0.27, 0.19);
    g.add(arm, eye);
  }
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), M.ghostFace);
  mouth.scale.set(0.8, 1.2, 0.4);
  mouth.position.set(0, 0.17, 0.205);
  const halo = sprite(glowTex, '#c9d6ff', 0.35);
  halo.scale.setScalar(0.9);
  halo.position.y = 0.1;
  g.add(mouth, halo);
  g.scale.setScalar(1.3);
  p.group.add(g);
  const curve = new THREE.CatmullRomCurve3(path.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  p.anims.push((t) => {
    // a barra do lençol ondula
    for (let i = 0; i < pos.count; i++) {
      const y0 = base[i * 3 + 1];
      if (y0 > 0.06) continue;
      const x0 = base[i * 3], z0 = base[i * 3 + 2];
      const a = Math.atan2(z0, x0);
      const w = Math.sin(a * 5 + t * 3 + phase) * 0.025 * (0.06 - y0) * 5;
      pos.setXYZ(i, x0 * (1 + w), y0 + Math.sin(a * 3 - t * 2) * 0.012, z0 * (1 + w));
    }
    pos.needsUpdate = true;
    const k = ((t * 0.012 + phase) % 1 + 1) % 1;
    const at = curve.getPointAt(k), next = curve.getPointAt((k + 0.01) % 1);
    g.position.set(at.x, 0.55 + Math.sin(t * 1.2 + phase) * 0.1, at.z);
    // olha para onde vai, sem dar as costas para a câmera
    const yaw = Math.atan2(next.x - at.x, next.z - at.z);
    g.rotation.y = Math.PI / 4 + Math.sin(yaw - Math.PI / 4) * 0.5;
    g.rotation.z = Math.sin(t * 0.9 + phase) * 0.06;
  });
}

// =====================================================================
// Lápides, velas, caldeirão
// =====================================================================
/** Lápide discreta: pedra baixa e gasta, meio afundada e um pouco torta, com musgo na base. */
function tombstone(p: Part, x: number, z: number, y: number, h: number, tilt: number, cross = false) {
  const g = new THREE.Group();
  if (cross) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.05), M.stone); v.position.y = h / 2;
    const hz = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.055, 0.05), M.stone); hz.position.y = h * 0.68;
    v.castShadow = hz.castShadow = true;
    g.add(v, hz);
  } else {
    const w = h * 0.72;
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0); s.lineTo(-w / 2, h - w / 2); s.absarc(0, h - w / 2, w / 2, Math.PI, 0, true); s.lineTo(w / 2, 0); s.lineTo(-w / 2, 0);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 14 });
    geo.translate(0, 0, -0.03);
    const m = new THREE.Mesh(geo, M.stone);
    m.castShadow = true;
    g.add(m);
  }
  const moss = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 6), M.moss);
  moss.scale.set(1, 0.18, 0.6);
  moss.position.y = 0.01;
  g.add(moss);
  g.position.set(x, y - 0.03, z);
  g.rotation.set(tilt, Math.PI / 4 + tilt * 2, tilt * 0.6);
  p.group.add(g);
}

/** Grupo de velas de alturas diferentes, com cera escorrida e chama que tremula. */
function candles(p: Part, x: number, y: number, z: number, hs: number[]) {
  hs.forEach((h, i) => {
    const a = (i / hs.length) * Math.PI * 2 + 0.6, r = hs.length > 1 ? 0.045 : 0;
    const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, h, 12), M.wax);
    c.position.set(cx, y + h / 2, cz);
    p.group.add(c);
    for (let d = 0; d < 3; d++) {
      const drip = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), M.wax);
      const da = d * 2.1 + i;
      drip.scale.set(1, 2.2, 1);
      drip.position.set(cx + Math.cos(da) * 0.023, y + h - 0.012 - d * 0.006, cz + Math.sin(da) * 0.023);
      p.group.add(drip);
    }
    const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.014, 4), M.wick);
    wick.position.set(cx, y + h + 0.007, cz);
    p.group.add(wick);
    const flame = live(sprite(flameTex, '#ffffff'));
    flame.scale.set(0.035, 0.07, 1);
    flame.position.set(cx, y + h + 0.045, cz);
    const glow = live(sprite(glowTex, '#ffae42', 0.55));
    glow.scale.setScalar(0.22);
    glow.position.copy(flame.position);
    p.group.add(flame, glow);
    const ph = Math.random() * 10;
    p.anims.push((t) => {
      const f = 1 + Math.sin(t * 11 + ph) * 0.1 + Math.sin(t * 27 + ph * 2) * 0.06;
      flame.scale.set(0.035 * (1 + Math.sin(t * 7 + ph) * 0.06), 0.07 * f, 1);
      glow.material.opacity = 0.45 + Math.sin(t * 9 + ph) * 0.08;
    });
  });
}

/** Caldeirão de ferro com a poção borbulhando, vapor verde e fogo de lenha embaixo. */
function cauldron(p: Part, x: number, z: number) {
  const g = new THREE.Group();
  const prof = [[0.0, 0.14], [0.14, 0.13], [0.24, 0.17], [0.31, 0.26], [0.33, 0.37], [0.31, 0.48], [0.26, 0.55], [0.245, 0.58], [0.275, 0.6], [0.28, 0.625], [0.25, 0.63], [0.235, 0.6]].map(([a, b]) => new THREE.Vector2(a, b));
  const pot = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), M.iron);
  pot.castShadow = true;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.262, 0.018, 8, 32), M.ironRim);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.625;
  g.add(pot, lip);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.17, 8), M.iron);
    leg.position.set(Math.cos(a) * 0.19, 0.085, Math.sin(a) * 0.19);
    leg.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
    g.add(leg);
  }
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 6, 12), M.iron);
    ear.position.set(sx * 0.3, 0.52, 0);
    ear.rotation.y = Math.PI / 2;
    g.add(ear);
  }
  // lenha cruzada e brasas
  for (const [ry, dz] of [[0.5, 0.02], [-0.6, -0.02], [1.5, 0]]) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.42, 7), M.bark);
    log.rotation.set(Math.PI / 2, 0, ry);
    log.position.set(0, 0.03, dz);
    g.add(log);
  }
  for (let i = 0; i < 7; i++) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.015, 5, 4), M.ember);
    e.position.set(rnd(-0.12, 0.12), 0.015, rnd(-0.12, 0.12));
    g.add(e);
  }
  g.position.set(x, 0, z);
  g.scale.setScalar(1.25);
  p.group.add(g);
  p.blocks.push({ x1: x - 0.5, z1: z - 0.5, x2: x + 0.5, z2: z + 0.5 });

  const fx = live(new THREE.Group());
  fx.position.set(x, 0, z);
  fx.scale.setScalar(1.25);
  p.group.add(fx);
  // poção: superfície que ondula, mais clara no meio
  const brewTex = drawn(128, 128, (c) => {
    const gr = c.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, '#d8ff9a'); gr.addColorStop(0.5, '#7dff6a'); gr.addColorStop(1, '#2fa33c');
    c.fillStyle = gr; c.fillRect(0, 0, 128, 128);
  });
  const brewGeo = new THREE.CircleGeometry(0.245, 28, 0);
  const brew = new THREE.Mesh(brewGeo, new THREE.MeshBasicMaterial({ map: brewTex }));
  brew.rotation.x = -Math.PI / 2;
  brew.position.y = 0.575;
  fx.add(brew);
  const bpos = brewGeo.attributes.position as THREE.BufferAttribute;
  const bbase = Float32Array.from(bpos.array as Float32Array);
  const bubbles = Array.from({ length: 7 }, (_, i) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), new THREE.MeshBasicMaterial({ color: '#b6ff8c', transparent: true, opacity: 0.9 }));
    fx.add(b);
    return { b, ox: Math.cos(i * 2.4) * rnd(0.03, 0.17), oz: Math.sin(i * 2.4) * rnd(0.03, 0.17), ph: i / 7, sp: rnd(0.5, 0.9) };
  });
  const steam = Array.from({ length: 6 }, (_, i) => {
    const s = sprite(glowTex, '#9dff8a', 0.25);
    fx.add(s);
    return { s, ph: i / 6, ox: rnd(-0.08, 0.08), oz: rnd(-0.08, 0.08) };
  });
  const flames = Array.from({ length: 5 }, (_, i) => {
    const f = sprite(flameTex, '#ffffff');
    f.position.set(Math.cos(i * 1.3) * 0.09, 0.09, Math.sin(i * 1.3) * 0.09);
    fx.add(f);
    return { f, ph: i * 1.7 };
  });
  const fireGlow = sprite(glowTex, '#ff8a2a', 0.6);
  fireGlow.scale.setScalar(0.9);
  fireGlow.position.y = 0.08;
  fx.add(fireGlow);
  p.anims.push((t) => {
    for (let i = 0; i < bpos.count; i++) {
      const x0 = bbase[i * 3], y0 = bbase[i * 3 + 1];
      bpos.setZ(i, Math.sin(x0 * 30 + t * 3) * Math.cos(y0 * 26 - t * 2.4) * 0.006);
    }
    bpos.needsUpdate = true;
    for (const { b, ox, oz, ph, sp } of bubbles) {
      // a bolha cresce na superfície e estoura
      const k = (t * sp + ph) % 1;
      b.position.set(ox, 0.575 + k * 0.03, oz);
      b.scale.setScalar(0.4 + k * 0.9);
      (b.material as THREE.MeshBasicMaterial).opacity = k > 0.9 ? (1 - k) * 9 : 0.9;
    }
    for (const { s, ph, ox, oz } of steam) {
      const k = (t * 0.22 + ph) % 1;
      s.position.set(ox + Math.sin(t + ph * 6) * 0.05 * k, 0.62 + k * 0.7, oz);
      s.scale.setScalar(0.12 + k * 0.35);
      s.material.opacity = 0.28 * Math.sin(k * Math.PI);
    }
    for (const { f, ph } of flames) {
      const h = 0.13 + Math.sin(t * 10 + ph) * 0.03 + Math.sin(t * 23 + ph) * 0.015;
      f.scale.set(0.07, h, 1);
      f.position.y = 0.05 + h / 2;
    }
    fireGlow.material.opacity = 0.5 + Math.sin(t * 8) * 0.08;
  });
}

// =====================================================================
// Placar da caça às abóboras: lousa num cavalete de madeira
// =====================================================================
let placarMat: THREE.MeshStandardMaterial | null = null;
export function placarTex(rows: [string, number][]) {
  return drawn(768, 512, (c) => {
    const bg = c.createLinearGradient(0, 0, 768, 512);
    bg.addColorStop(0, '#26302b'); bg.addColorStop(1, '#1b221f');
    c.fillStyle = bg; c.fillRect(0, 0, 768, 512);
    // marcas de giz apagado
    let s = 7;
    const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    c.fillStyle = 'rgba(255,255,255,0.035)';
    for (let i = 0; i < 40; i++) c.fillRect(rand() * 768, rand() * 512, 60 + rand() * 120, 6 + rand() * 10);
    // abóbora desenhada a giz
    c.save(); c.translate(70, 72);
    c.strokeStyle = '#f2994a'; c.lineWidth = 4;
    c.beginPath(); c.ellipse(0, 6, 36, 28, 0, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.ellipse(0, 6, 14, 28, 0, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = '#8fbf5a'; c.beginPath(); c.moveTo(0, -22); c.quadraticCurveTo(4, -36, 12, -38); c.stroke();
    c.restore();
    c.fillStyle = '#f2994a'; c.font = '700 48px Geist, sans-serif'; c.textBaseline = 'middle';
    c.fillText('Caça às abóboras', 124, 78);
    c.strokeStyle = 'rgba(242,153,74,0.55)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(124, 112); c.lineTo(700, 108); c.stroke();
    c.font = '600 34px Geist, sans-serif';
    if (!rows.length) {
      c.fillStyle = 'rgba(240,238,230,0.9)';
      c.fillText('Ninguém pegou nenhuma ainda.', 60, 200);
      c.fillStyle = 'rgba(240,238,230,0.65)'; c.font = '500 28px Geist, sans-serif';
      c.fillText('Elas aparecem na sala e no hub.', 60, 258);
      c.fillText('Quem clicar primeiro leva o ponto.', 60, 300);
      return;
    }
    rows.slice(0, 5).forEach(([name, n], i) => {
      const y = 172 + i * 64;
      c.fillStyle = i === 0 ? '#ffd27a' : 'rgba(240,238,230,0.92)';
      c.textAlign = 'left'; c.fillText(`${i + 1}.  ${name}`, 60, y);
      c.textAlign = 'right'; c.fillText(String(n), 700, y);
    });
    c.textAlign = 'left';
  });
}
export function setPlacar(rows: [string, number][]) {
  if (!placarMat) return;
  placarMat.map?.dispose();
  placarMat.map = placarTex(rows);
  placarMat.emissiveMap = placarMat.map;
  placarMat.needsUpdate = true;
}

function placar(p: Part, sp: Space, x: number, z: number) {
  const g = new THREE.Group();
  // cavalete em A: duas pernas da frente inclinadas e uma de trás
  for (const dx of [-0.6, 0.6]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.75, 0.05), M.wood);
    leg.position.set(dx, 0.86, 0.04);
    leg.rotation.x = -0.08;
    leg.castShadow = true;
    g.add(leg);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.7, 0.05), M.wood);
  back.position.set(0, 0.82, -0.28); back.rotation.x = 0.28;
  const tray = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.04, 0.09), M.wood);
  tray.position.set(0, 0.66, 0.1);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.92, 0.05), M.wood);
  frame.position.set(0, 1.14, 0.07);
  frame.rotation.x = -0.08;
  g.add(back, tray, frame);
  placarMat = new THREE.MeshStandardMaterial({ map: placarTex([]), roughness: 0.9, emissive: '#ffffff', emissiveIntensity: 0.12 });
  placarMat.emissiveMap = placarMat.map;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 0.82), placarMat);
  face.position.set(0, 1.14, 0.098);
  face.rotation.x = -0.08;
  face.userData.dynamic = true;
  g.add(face);
  // giz na bandeja
  for (const [cx, col] of [[-0.3, '#f4f1e8'], [-0.22, '#f2994a']] as const) {
    const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 6), std(col));
    ch.rotation.z = Math.PI / 2; ch.position.set(cx, 0.69, 0.11);
    g.add(ch);
  }
  g.position.set(x, 0, z);
  p.group.add(g);
  p.blocks.push({ x1: x - 0.72, z1: z - 0.4, x2: x + 0.72, z2: z + 0.25 });
  sp.interactive('placar', 'Caça às abóboras', 'Ver o placar', [g]);
}

// =====================================================================
// Ambientes
// =====================================================================
const LAWN = -0.395;
const WALL = 0.07;
const perch = (x: number, y: number, z: number, nx: number, nz: number): Perch => ({ pos: new THREE.Vector3(x, y, z), n: new THREE.Vector3(nx, 0, nz), busy: false });
/** Poleiros no alto da parede do fundo e da esquerda, e no alto das janelas. */
function perches(r: Rect, north: number[], west: number[], winN: number[], winW: number[]) {
  return [
    ...north.map((x) => perch(x, 2.4, r.z1 + WALL, 0, 1)),
    ...west.map((z) => perch(r.x1 + WALL, 2.4, z, 1, 0)),
    ...winN.map((x) => perch(x, 1.85, r.z1 + WALL + 0.02, 0, 1)),
    ...winW.map((z) => perch(r.x1 + WALL + 0.02, 1.85, z, 1, 0)),
  ];
}

export function decorateSala(sp: Space, r: Rect, cabinetTop: number) {
  const p = part(sp);
  // teias: canto do fundo, cantos das janelas, ponta da parede e um canto baixo
  const cw = cornerWeb(p, r.x1, r.z1, 2.4, 1.1, 1, 1, 0);
  flatWeb(p, 'w', r.x1 + 0.09, 1.85, 1.8, 0.5, 1, 1, 1);
  flatWeb(p, 'w', r.x1 + 0.09, 1.85, 5.0, 0.42, -1, 1, 0);
  flatWeb(p, 'w', r.x1 + 0.09, 1.85, 12.8, 0.5, -1, 1, 1);
  flatWeb(p, 'w', r.x1 + 0.09, 0.7, 9.6, 0.36, 1, -1, 0);
  flatWeb(p, 'n', r.x2 - 0.05, 2.4, r.z1 + WALL + 0.01, 0.7, -1, 1, 1);
  flatWeb(p, 'w', r.x1 + WALL + 0.01, 0.55, r.z2 - 0.05, 0.5, -1, -1, 0);
  strands(p, [[r.x1 + 1.3, 2.4, r.z1 + 0.08], [r.x1 + 2.1, 2.4, r.z1 + 0.08], [r.x1 + 2.6, 2.4, r.z1 + 0.08]], 0.18);
  strands(p, [[r.x1 + 0.08, 2.4, 7.2], [r.x1 + 0.08, 2.4, 8.4]], 0.22);
  webSpider(p, cw.x + 0.02, cw.y, cw.z + 0.02, Math.PI / 4, 1.3);
  hangingSpider(p, r.x1 + 3.2, 2.4, r.z1 + 0.1, 0.9, 1.15);
  hangingSpider(p, r.x1 + 0.1, 2.4, 14.0, 0.7, 1.0);
  // fora: teias entre as árvores, lápides discretas, velas e o fantasma
  orbWeb(p, r.x1 - 2.2, 1.1, r.z1 + 5.6, 0.9, 0);
  orbWeb(p, r.x1 - 2.0, 1.3, r.z1 + 12.6, 0.75, 2);
  tombstone(p, r.x1 - 3.6, r.z1 + 5.0, LAWN, 0.36, 0.06);
  tombstone(p, r.x1 - 4.2, r.z1 + 5.9, LAWN, 0.28, -0.1, true);
  tombstone(p, r.x1 - 3.4, r.z1 + 13.4, LAWN, 0.3, 0.09);
  candles(p, r.x1 - 3.35, LAWN, r.z1 + 5.35, [0.1, 0.07]);
  ghost(p, [[r.x1 - 3.2, r.z1 + 2.5], [r.x1 - 4.0, r.z1 + 7.5], [r.x1 - 3.0, r.z1 + 12.5], [r.x1 - 3.8, r.z1 + 9.5]], 0);
  // dentro: velas em cima dos armários, perto da porta
  candles(p, r.x2 - 0.3, cabinetTop, 4.8, [0.16, 0.11, 0.08]);
  // poleiros longe dos ar-condicionados da parede esquerda
  bats(p, perches(r, [0.7, 2.6, 6.2, 7.9], [1.0, 7.4, 8.6, 14.9], [], [3.4, 11.2]), 4);
}

export function decorateHub(sp: Space, r: Rect) {
  const p = part(sp);
  const cw = cornerWeb(p, r.x1, r.z1, 2.4, 1.0, 1, 1, 1);
  flatWeb(p, 'n', 24.5, 1.85, r.z1 + 0.09, 0.42, 1, 1, 0);
  flatWeb(p, 'n', 25.7, 1.85, r.z1 + 0.09, 0.36, -1, 1, 1);
  flatWeb(p, 'w', r.x1 + 0.09, 1.85, 4.4, 0.45, -1, 1, 0);
  flatWeb(p, 'n', r.x2 - 0.02, 2.4, r.z1 + WALL + 0.01, 0.75, -1, 1, 0);
  strands(p, [[r.x1 + 2.0, 2.4, r.z1 + 0.08], [r.x1 + 3.2, 2.4, r.z1 + 0.08]], 0.2);
  webSpider(p, cw.x + 0.02, cw.y, cw.z + 0.02, Math.PI / 4, 1.25);
  hangingSpider(p, 28.6, 2.4, r.z1 + 0.1, 0.8, 1.1);
  orbWeb(p, r.x1 - 2.3, 1.2, r.z1 + 2.1, 0.85, 1);
  tombstone(p, r.x1 - 3.7, r.z1 + 4.4, LAWN, 0.32, 0.07);
  tombstone(p, r.x1 - 4.3, r.z1 + 1.9, LAWN, 0.26, -0.08, true);
  ghost(p, [[r.x1 - 3.2, r.z1 + 0.4], [r.x1 - 4.0, r.z1 + 3.5], [r.x1 - 3.1, r.z1 + 6.4]], 1.7);
  cauldron(p, 25.3, 5.75);
  placar(p, sp, 24.95, 1.15);
  bats(p, perches(r, [20.7, 22.6, 28.7, 29.8], [0.6, 5.2, 6.6], [25.1], [3.6]), 3);
}

export function decorateReuniao(sp: Space, r: Rect) {
  const p = part(sp);
  // mais discreta: nada perto da mesa nem da tela
  const cw = cornerWeb(p, r.x1, r.z1, 2.4, 0.9, 1, 1, 0);
  flatWeb(p, 'w', r.x1 + 0.09, 1.85, 1.6, 0.4, 1, 1, 1);
  flatWeb(p, 'n', r.x2 - 0.6, 1.85, r.z1 + 0.09, 0.36, -1, 1, 0);
  webSpider(p, cw.x + 0.02, cw.y, cw.z + 0.02, Math.PI / 4, 1.15);
  tombstone(p, r.x1 - 3.9, r.z1 + 2.6, LAWN, 0.3, 0.05);
  ghost(p, [[r.x1 - 3.3, r.z1 + 0.8], [r.x1 - 3.9, r.z1 + 3.6], [r.x1 - 3.2, r.z1 + 5.8]], 3.4);
  bats(p, perches(r, [40.7, 47.8], [0.7, 5.6], [47.2], [2.5]), 2);
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

let lastT = 0;
/** Anima as peças do ambiente que está na tela. */
export function animateHalloween(sp: Space, t: number) {
  const dt = Math.min(0.1, Math.max(0, t - (lastT || t)));
  lastT = t;
  if (!active) return;
  for (const p of parts) if (p.space === sp) for (const a of p.anims) a(t, dt);
}

// =====================================================================
// Abóbora (só a da caça e a da coroinha)
// =====================================================================
/** Abóbora de gomos, com cabinho curvo, folha e gavinha; o rosto entalhado brilha por dentro. */
export function pumpkin(r: number, carved = true) {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(r, 32, 20);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const rib = 1 - (0.07 * (1 - Math.cos(a * 8))) / 2;
    // achatada, com um afundado em cima e embaixo
    const dimple = 1 - 0.18 * Math.pow(Math.abs(y / r), 6);
    pos.setXYZ(i, x * rib * 1.08, y * 0.8 * dimple, z * rib * 1.08);
  }
  geo.computeVertexNormals();
  const body = new THREE.Mesh(geo, M.pumpkin);
  body.position.y = r * 0.8;
  body.castShadow = true;
  g.add(body);
  const stemCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.02 * r, 0.25 * r, 0), new THREE.Vector3(0.12 * r, 0.42 * r, 0.04 * r)]);
  const stem = new THREE.Mesh(new THREE.TubeGeometry(stemCurve, 8, 0.09 * r, 6), M.pumpkinStem);
  stem.position.y = r * 1.45;
  g.add(stem);
  const vine = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 14 }, (_, i) => {
    const a = i * 0.7;
    return new THREE.Vector3(-0.05 * r - i * 0.018 * r, 0.04 * r * Math.sin(a), Math.cos(a) * 0.08 * r);
  })), 24, 0.018 * r, 4), M.pumpkinStem);
  vine.position.y = r * 1.5;
  g.add(vine);
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0); leafShape.quadraticCurveTo(0.3 * r, 0.18 * r, 0.42 * r, 0); leafShape.quadraticCurveTo(0.3 * r, -0.16 * r, 0, 0);
  const leaf = new THREE.Mesh(new THREE.ShapeGeometry(leafShape, 6), std('#5f7d34', { side: THREE.DoubleSide }));
  leaf.rotation.set(-Math.PI / 2 + 0.35, 0, 0.5);
  leaf.position.set(0.05 * r, r * 1.5, 0);
  g.add(leaf);
  if (carved) {
    const tri = (pts: number[][]) => new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * r, y * r))));
    for (const geo2 of [
      tri([[-0.58, 0.12], [-0.18, 0.12], [-0.36, 0.46]]),
      tri([[0.18, 0.12], [0.58, 0.12], [0.36, 0.46]]),
      tri([[-0.09, -0.04], [0.09, -0.04], [0, 0.12]]),
      tri([[-0.62, -0.14], [0.62, -0.14], [0.48, -0.38], [0.26, -0.3], [0.13, -0.44], [0, -0.32], [-0.13, -0.44], [-0.26, -0.3], [-0.48, -0.38]]),
    ]) {
      const m = new THREE.Mesh(geo2, M.carved);
      m.position.set(0, r * 0.8, r * 1.0);
      g.add(m);
    }
    const glow = sprite(glowTex, '#ffb13b', 0.6);
    glow.scale.setScalar(r * 3.2);
    glow.position.set(0, r * 0.8, r * 0.9);
    g.add(glow);
  }
  g.rotation.y = Math.PI / 4;
  return g;
}

/** Abóbora da caça: com halo no chão e um facho de luz, para ser achada. */
export function huntPumpkin() {
  const g = new THREE.Group();
  const k = pumpkin(0.24);
  g.add(k);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.46, 40), new THREE.MeshBasicMaterial({ color: '#ffb52e', transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  g.add(ring);
  const beamTex = drawn(4, 128, (c) => {
    const gr = c.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
    c.fillStyle = gr; c.fillRect(0, 0, 4, 128);
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.34, 2.4, 24, 1, true), new THREE.MeshBasicMaterial({ map: beamTex, color: '#ffb52e', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  beam.position.y = 1.2;
  g.add(beam);
  g.userData.bob = k;
  g.userData.ring = ring;
  return g;
}

/** Coroinha de quem lidera a caça: uma abóbora pequena com uma coroa dourada. */
export function crown() {
  const g = new THREE.Group();
  g.add(pumpkin(0.085, false));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 20, 1, true), M.gold);
  band.position.y = 0.155;
  g.add(band);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.05, 5), M.gold);
    tip.position.set(Math.cos(a) * 0.072, 0.19, Math.sin(a) * 0.072);
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), new THREE.MeshBasicMaterial({ color: '#ff5a4a' }));
    gem.position.set(Math.cos(a) * 0.076, 0.155, Math.sin(a) * 0.076);
    g.add(tip, gem);
  }
  return g;
}
