import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BOARD_GAP, DESKS, DOORS, HUB, REUNIAO, SALA, doorGeom, type Desk, type Door, type Rect, type SpaceId } from '../../../shared/layout';
import { FACE, FS, MAT, Space, type Facing } from './space';
import { carpet, concrete, drawn, planks, tiles } from './textures';
import { easel, nameplate, officeChair, panel, signTex, stickyNote, tree } from './props';
import { SEAT_Y, chairAt, floorMat, plant } from './office';
import { boardTex, gameTex, tvTex } from './live';
import { decorateHub, decorateReuniao, decorateSala } from './halloween';

// Escritório em três ambientes, cada um uma cena: a sala da equipe (inspirada na sala real),
// onde todos entram; o hub, com café, jogo e caixa de sugestões; e a sala de reunião.
// Portas ligam a sala ao hub e o hub à reunião. As paredes de vidro baixam até a altura do
// armário para quem está dentro, para ninguém ficar escondido atrás delas.

const DESK_W = 1.8, DESK_D = 0.8, DESK_H = 0.38 * FS;
const opposite: Record<Facing, Facing> = { n: 's', s: 'n', e: 'w', w: 'e' };
// cinco cores sortidas pela sala, sem duas iguais lado a lado, frente a frente ou de costas no corredor
const CHAIR = { laranja: '#b4692c', vermelho: '#9b3a36', azul: '#2f4f9a', roxo: '#5d4387', preto: '#4a4f5a' };
const CHAIR_COLORS = (['roxo', 'preto', 'laranja', 'azul', 'preto', 'vermelho', 'azul', 'preto', 'roxo', 'azul', 'laranja', 'preto',
  'vermelho', 'roxo', 'laranja', 'vermelho', 'roxo', 'azul'] as const).map((c) => CHAIR[c]);

export interface DeskHandle { desk: Desk; seat: string; plate: THREE.Mesh; note: THREE.Mesh }

/** Partes do cenário que mudam com o estado do escritório. */
export interface World {
  spaces: Record<SpaceId, Space>;
  desks: DeskHandle[];
  /** Face de cada quadro fixo, para desenhar o conteúdo real. */
  boards: Map<string, THREE.MeshStandardMaterial>;
  tv: THREE.MeshStandardMaterial;
  game: THREE.MeshStandardMaterial;
  /** Folha da porta da sala de reunião, visível quando fechada. */
  door: THREE.Object3D;
  /** Luz sobre a porta da reunião, no hub: verde aberta, vermelha fechada. */
  meetingLight: THREE.MeshStandardMaterial;
}

function station(sp: Space, d: Desk): DeskHandle {
  const sitSide: Facing = d.side;
  const back = sitSide === 's' ? -1 : 1;
  const parts = [
    sp.model('desk', d.x, d.z, { rot: FACE[sitSide], s: [DESK_W / 0.72, FS, DESK_D / 0.38] }),
    sp.model('computerScreen', d.x, d.z + back * 0.22, { rot: FACE[sitSide], y: DESK_H, block: false }),
    sp.model('computerKeyboard', d.x - 0.05, d.z - back * 0.08, { rot: FACE[sitSide], y: DESK_H, block: false }),
    sp.model('computerMouse', d.x + 0.36, d.z - back * 0.08, { rot: FACE[sitSide], y: DESK_H, block: false }),
  ];
  sp.interactive(`mesa:${d.index}`, 'Mesa', 'Bilhetes', parts.map((p) => p.obj));
  const cz = d.z - back * 0.72;
  const seat = `mesa-${d.index}`;
  const chair = officeChair(sp, d.x, cz, FACE[opposite[sitSide]], CHAIR_COLORS[d.index % CHAIR_COLORS.length]);
  sp.seat(seat, d.x, cz, opposite[sitSide], SEAT_Y.chairDesk);
  sp.sittable(chair, seat);
  const plate = nameplate(sp, d.x - 0.6, DESK_H, d.z - back * 0.3, FACE[sitSide], 'Livre');
  const note = stickyNote(sp, d.x - 0.42, DESK_H, d.z - back * 0.18, 0.3);
  note.visible = false;
  return { desk: d, seat, plate, note };
}

/** Mesa de reunião no sentido norte-sul, de frente para a TV, com cabeceira. */
function meetingTable(sp: Space, id: string, cx: number, cz: number, len: number, width: number, perSide: number) {
  sp.model('table', cx, cz, { rot: Math.PI / 2, s: [len / 0.84, 1.65, width / 0.45] });
  const chair = (sid: string, x: number, z: number, f: Facing) => {
    sp.sittable(officeChair(sp, x, z, FACE[f], '#3d434f'), sid);
    sp.seat(sid, x, z, f, SEAT_Y.chairDesk);
  };
  const step = len / perSide;
  for (let i = 0; i < perSide; i++) {
    const z = cz - len / 2 + step * (i + 0.5);
    chair(`${id}-w${i}`, cx - width / 2 - 0.4, z, 'e');
    chair(`${id}-e${i}`, cx + width / 2 + 0.4, z, 'w');
  }
  chair(`${id}-cab`, cx, cz + len / 2 + 0.46, 'n');
}

/** Púlpito com a caixa de sugestões, encostado na parede, e um quadrinho acima que diz o que é. */
function suggestionBox(sp: Space, x: number, z: number) {
  const wood = new THREE.MeshStandardMaterial({ color: '#8a6440', roughness: 0.75 });
  const top = new THREE.MeshStandardMaterial({ color: '#b98c5c', roughness: 0.7 });
  const parts = [
    sp.box(x, 0, z, 0.46, 0.04, 0.36, wood),
    sp.box(x, 0.04, z, 0.13, 0.76, 0.13, wood),
    sp.box(x, 0.8, z, 0.52, 0.035, 0.4, top),
    // a urna: corpo claro, tampa escura com a fenda e um bilhete entrando
    sp.box(x, 0.835, z, 0.4, 0.26, 0.3, new THREE.MeshStandardMaterial({ color: '#f3eee5', roughness: 0.6 })),
    sp.box(x, 1.095, z, 0.42, 0.03, 0.32, MAT.cap),
    sp.box(x, 1.12, z, 0.2, 0.006, 0.035, new THREE.MeshStandardMaterial({ color: '#0f1114', roughness: 1 }), false),
  ];
  const slip = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.08), new THREE.MeshStandardMaterial({ color: '#ffe27a', roughness: 0.85, side: THREE.DoubleSide }));
  slip.position.set(x + 0.02, 1.15, z);
  slip.rotation.set(0, 0, 0.06);
  slip.castShadow = true;
  sp.group.add(slip);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.2), new THREE.MeshStandardMaterial({ map: suggestionLabelTex(), roughness: 0.7 }));
  label.position.set(x, 0.965, z + 0.152);
  sp.group.add(label);
  sp.nav.block(x - 0.38, z - 0.3, x + 0.38, z + 0.3);
  const sign = panel(sp, x, 1.68, 0.11, 1.2, 0.42, 0, suggestionSignTex(), { frame: '#20242c', depth: 0.03 });
  const it = sp.interactive('sugestoes', 'Caixa de sugestões', 'Deixar uma ideia, melhoria ou problema', [...parts, slip, label, sign.obj]);
  // usa-se de frente, nunca pelos lados
  it.spot = { x, z: z + 0.75 };
}

function suggestionLabelTex() {
  return drawn(360, 200, (c) => {
    c.fillStyle = '#f3eee5'; c.fillRect(0, 0, 360, 200);
    c.fillStyle = '#f2b443'; c.beginPath(); c.roundRect(130, 18, 100, 100, 24); c.fill();
    bulb(c, 180, 66, 1.15);
    c.fillStyle = '#20242c'; c.font = '700 40px Geist, sans-serif'; c.textAlign = 'center'; c.fillText('Sugestões', 180, 170);
  });
}

function suggestionSignTex() {
  return drawn(1200, 420, (c) => {
    c.fillStyle = '#20242c'; c.fillRect(0, 0, 1200, 420);
    c.fillStyle = '#f2b443'; c.beginPath(); c.roundRect(60, 90, 240, 240, 52); c.fill();
    bulb(c, 180, 208, 2.7);
    c.fillStyle = '#ffffff'; c.font = '700 112px Geist, sans-serif'; c.fillText('Caixa de', 350, 196);
    c.fillText('sugestões', 350, 316);
  });
}

/** Lâmpada desenhada no centro (cx, cy), no traço do ícone da interface. */
function bulb(c: CanvasRenderingContext2D, cx: number, cy: number, k: number) {
  c.save();
  c.translate(cx, cy);
  c.scale(k, k);
  c.strokeStyle = '#20242c'; c.lineWidth = 6; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(-9, 14); c.bezierCurveTo(-9, 6, -20, 2, -20, -10); c.arc(0, -10, 20, Math.PI, 0); c.bezierCurveTo(20, 2, 9, 6, 9, 14);
  c.closePath(); c.stroke();
  c.beginPath(); c.moveTo(-8, 22); c.lineTo(8, 22); c.moveTo(-5, 30); c.lineTo(5, 30); c.stroke();
  c.restore();
}

const door = (id: string) => DOORS.find((d) => d.id === id)!;

export function buildEscritorio(): World {
  const boards = new Map<string, THREE.MeshStandardMaterial>();
  const sala = buildSala(boards);
  const hub = buildHub();
  // o vidro da reunião baixa na mesma altura do da sala
  const reuniao = buildReuniao(boards, sala.low);
  return {
    spaces: { sala: sala.space, hub: hub.space, reuniao: reuniao.space },
    desks: sala.desks,
    boards,
    tv: reuniao.tv,
    game: hub.game,
    door: reuniao.door,
    meetingLight: hub.light,
  };
}

/** Laje sob o ambiente, com `extra` metros a mais em cada lado (corredor do lado de fora do vidro). */
function slab(sp: Space, r: Rect, extra: { e?: number; s?: number } = {}) {
  const x2 = r.x2 + (extra.e ?? 0) + 0.25, z2 = r.z2 + (extra.s ?? 0) + 0.25, x1 = r.x1 - 0.25, z1 = r.z1 - 0.25;
  sp.box((x1 + x2) / 2, -0.42, (z1 + z2) / 2, x2 - x1, 0.4, z2 - z1, MAT.slab);
}

const corridorMat = () => floorMat(concrete('#e4e0d9', 12), 0.6);

/** Gramado com árvores do lado de fora da parede oeste (aparecem pela janela e acima do muro). */
function garden(sp: Space, r: Rect, trees: [number, number, number, number][]) {
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(5, r.z2 - r.z1 + 4), new THREE.MeshStandardMaterial({ color: '#9fbf86', roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(r.x1 - 2.75, -0.395, (r.z1 + r.z2) / 2);
  grass.receiveShadow = true;
  sp.group.add(grass);
  for (const [dz, h, seed, dx] of trees) tree(sp, r.x1 - dx, r.z1 + dz, h, seed, 0.8);
}

/**
 * Vão de porta para outro ambiente: uma folha invisível só para mirar e destacar, porque a
 * passagem fica aberta.
 */
function doorway(sp: Space, d: Door, title: string, hint: string) {
  const g = doorGeom(d);
  const m = new THREE.Mesh(new THREE.BoxGeometry(g.vertical ? 0.08 : g.width - 0.04, 2.08, g.vertical ? g.width - 0.04 : 0.08));
  m.position.set(g.c.x, 1.04, g.c.z);
  m.userData.ghost = true;
  return sp.interactive(`door:${d.id}`, title, hint, [m]);
}

/** Porta para outro ambiente numa parede cheia: batente, folha com maçaneta e placa do destino. */
function portalDoor(sp: Space, d: Door, label: string, h: number) {
  const g = doorGeom(d);
  const w = g.width;
  const grp = new THREE.Group();
  const add = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y + sy / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    grp.add(m);
    return m;
  };
  const leafMat = new THREE.MeshStandardMaterial({ color: '#a77d55', roughness: 0.7 });
  const top = 2.08;
  // parede acima do vão, batente escuro e a folha um pouco recuada
  add(w, h - top, 0.14, 0, top, 0, MAT.wall);
  add(0.06, top, 0.18, -w / 2 + 0.03, 0, 0, MAT.frame);
  add(0.06, top, 0.18, w / 2 - 0.03, 0, 0, MAT.frame);
  add(w, 0.06, 0.18, 0, top - 0.06, 0, MAT.frame);
  add(w - 0.12, top - 0.07, 0.05, 0, 0.01, -0.02, leafMat);
  // almofadas da folha e a maçaneta
  add(w - 0.36, 0.7, 0.012, 0, 1.12, 0.012, new THREE.MeshStandardMaterial({ color: '#97704b', roughness: 0.75 }));
  add(w - 0.36, 0.7, 0.012, 0, 0.26, 0.012, new THREE.MeshStandardMaterial({ color: '#97704b', roughness: 0.75 }));
  add(0.14, 0.03, 0.05, w / 2 - 0.2, 1.0, 0.04, MAT.frame);
  // placa com o nome do destino, na parede acima da porta
  const plateMat = new THREE.MeshStandardMaterial({ map: doorSignTex(label), roughness: 0.6 });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.2), plateMat);
  plate.position.set(0, top + 0.17, 0.072);
  grp.add(plate);
  // luz de estado (só a porta da reunião usa)
  // grande e com aro, para ser vista do outro lado do hub: verde aberta, vermelha fechada
  const lightMat = new THREE.MeshStandardMaterial({ color: '#22c55e', emissive: '#22c55e', emissiveIntensity: 1.6, roughness: 0.4 });
  const light = new THREE.Mesh(new THREE.CircleGeometry(0.075, 24), lightMat);
  light.position.set(0.62, top + 0.17, 0.076);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.1, 24), new THREE.MeshStandardMaterial({ color: '#20242c', roughness: 0.6 }));
  ring.position.set(0, 0, -0.001);
  light.add(ring);
  light.visible = false;
  light.userData.dynamic = true;
  grp.add(light);
  grp.position.set(g.c.x, 0, g.c.z);
  grp.rotation.y = g.rot;
  sp.group.add(grp);
  sp.interactive(`door:${d.id}`, label, 'Entrar', [grp]);
  return { light, lightMat };
}

/** Ar-condicionado split na parede, no alto: corpo branco arredondado, aleta embaixo e o visor. */
function airConditioner(sp: Space, x: number, y: number, z: number, rot: number) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.92, 0.3, 0.22, 3, 0.05), new THREE.MeshStandardMaterial({ color: '#f3f3f0', roughness: 0.45 }));
  body.castShadow = true;
  body.receiveShadow = true;
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.045, 0.02), new THREE.MeshStandardMaterial({ color: '#dcdcd8', roughness: 0.5 }));
  flap.position.set(0, -0.1, 0.105);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.01), new THREE.MeshStandardMaterial({ color: '#3a3d43', roughness: 0.8 }));
  slot.position.set(0, -0.135, 0.1);
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12), new THREE.MeshStandardMaterial({ color: '#7fd1ff', emissive: '#7fd1ff', emissiveIntensity: 0.8 }));
  led.position.set(0.34, 0.06, 0.111);
  g.add(body, flap, slot, led);
  // na escala dos móveis do kit, que são maiores que os de verdade
  g.scale.setScalar(1.25);
  g.position.set(x, y, z);
  g.rotation.y = rot;
  sp.group.add(g);
}

/** Capacho com o destino e uma seta, logo antes de um vão sem placa (as paredes de vidro ficam baixas). */
function doorMat(sp: Space, d: Door, label: string) {
  const g = doorGeom(d);
  const tex = drawn(400, 256, (c) => {
    c.fillStyle = '#2b3038'; c.beginPath(); c.roundRect(0, 0, 400, 256, 28); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 6; c.beginPath(); c.roundRect(14, 14, 372, 228, 18); c.stroke();
    c.fillStyle = '#ffffff'; c.font = '700 96px Geist, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(label, 160, 134);
    // seta para a porta
    c.beginPath(); c.moveTo(290, 92); c.lineTo(350, 128); c.lineTo(290, 164); c.closePath(); c.fill();
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.64), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  m.rotation.x = -Math.PI / 2;
  // deitado no chão, com a seta apontando para a porta
  m.rotation.z = Math.atan2(g.n.z, -g.n.x);
  // afastado do vão, para o montante do vidro não cobrir o texto
  m.position.set(g.c.x + g.n.x * 1.0, 0.012, g.c.z + g.n.z * 1.0);
  m.receiveShadow = true;
  sp.group.add(m);
}

function doorSignTex(label: string) {
  return drawn(500, 100, (c) => {
    c.fillStyle = '#20242c'; c.fillRect(0, 0, 500, 100);
    c.fillStyle = '#ffffff'; c.font = '600 44px Geist, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(label, 250, 53);
  });
}

// ======== Sala da equipe ========
function buildSala(boards: Map<string, THREE.MeshStandardMaterial>) {
  const sp = new Space('sala', 'Sala da equipe', SALA);
  const F = BOARD_GAP;
  const toHub = door('sala-hub');

  // laje com o corredor que passa do lado de fora do vidro, e gramado com árvores a oeste
  slab(sp, SALA, { e: 1.2, s: 1.2 });
  garden(sp, SALA, [[1.3, 3.9, 3, 1.6], [3.8, 3.5, 7, 1.7], [2.6, 4.2, 11, 2.6], [7.0, 3.6, 5, 1.9], [9.6, 3.8, 31, 2.4], [11.8, 3.4, 37, 1.6], [14.4, 4.0, 41, 2.2]]);

  // off-white quente e fosco: o branco puro com brilho cansava a vista
  sp.floor(SALA.x1, SALA.z1, SALA.x2, SALA.z2, floorMat(tiles('#ddd6ca', '#d8d1c4', 'rgba(80,65,45,0.12)', 4), 0.75), 2.4);
  const corridor = corridorMat();
  sp.floor(SALA.x2, 0, SALA.x2 + 1.2, SALA.z2 + 1.2, corridor);
  sp.floor(0, SALA.z2, SALA.x2, SALA.z2 + 1.2, corridor);

  // paredes externas inteiras no fundo e à esquerda; o fundo segue pelo corredor
  sp.wall(0, 0, SALA.x2 + 1.2, 0, { h: 2.4 });
  sp.wall(0, 0, 0, SALA.z2 + 1.2, { h: 2.4, windows: [[1.8, 5.0], [9.6, 12.8]] });

  // ar-condicionado logo depois de cada janela da parede esquerda, com uma folga
  for (const zEnd of [5.0, 12.8]) airConditioner(sp, 0.21, 1.98, zEnd + 0.3 + 0.58, Math.PI / 2);

  const salaCabinets = Array.from({ length: 6 }, (_, i) => {
    const z0 = 2.0, len = (6.6 - z0) / 6;
    return sp.model('kitchenCabinet', SALA.x2 - 0.3, z0 + len * (i + 0.5), { rot: FACE.w, s: [len / 0.43, 2.0, 0.6 / 0.45], pad: 0.18, tint: '#c9a57a' });
  });
  // para quem está dentro, as paredes de vidro baixam até a altura do armário
  const low = salaCabinets[0].top;
  sp.wall(SALA.x2, 0, SALA.x2, SALA.z2, { h: 2.4, glass: true, open: [[toHub.a1, toHub.a2]], cut: { room: 'sala', y: low } });
  sp.wall(0, SALA.z2, SALA.x2, SALA.z2, { h: 2.4, glass: true, cut: { room: 'sala', y: low } });
  doorway(sp, toHub, 'Porta para o hub', 'Ir para o hub');
  doorMat(sp, toHub, 'Hub');

  const salaBoard = panel(sp, 3.6, 0.85, 0.1, 3.8, 1.2, 0, boardTex([], 1600), { frame: '#c9cdd3' });
  boards.set('sala', salaBoard.mat);
  sp.interactive('board:sala', 'Quadro da sala', 'Abrir quadro', [salaBoard.obj]);
  const desks = DESKS.map((d) => station(sp, d));
  // mesas lado a lado formam uma bancada só: o vão entre duas vizinhas ganha um trecho de tampo
  for (const a of DESKS) {
    const b = DESKS.find((o) => o.z === a.z && o.side === a.side && o.x > a.x && o.x - a.x < DESK_W + 1);
    const gap = b ? b.x - a.x - DESK_W : 0;
    if (b && gap > 0.01) sp.model('desk', (a.x + b.x) / 2, a.z, { rot: FACE[a.side], s: [gap / 0.72, FS, DESK_D / 0.38] });
  }
  // rádio da equipe: em cima do armário, perto da porta; toca para quem está na sala
  const radio = sp.model('radio', SALA.x2 - 0.32, salaCabinets[0].box.getCenter(new THREE.Vector3()).z, { rot: FACE.w, y: low, block: false, s: FS * 1.3 });
  sp.interactive('radio', 'Rádio da equipe', 'Ouvir a rádio', [radio.obj, salaCabinets[0].obj]);
  sp.model('books', SALA.x2 - 0.25, 3.4 + F, { rot: FACE.w, y: 0.9, block: false });
  sp.model('plantSmall2', SALA.x2 - 0.25, 6.2, { y: 0.9, block: false, s: FS * 2 });
  sp.model('pottedPlant', 0.4, 0.4, { pad: 0.12 });
  // uma luminária sobre cada ilha e uma no corredor da direita
  for (const k of [0, 1, 2]) sp.lamp(2.8, 2.2, 3.4 + k * 4.4, '#ffd6a0', 5, 7);
  sp.lamp(6.4, 2.2, 7.8, '#ffd6a0', 4, 8);

  decorateSala(sp, SALA, low);
  sp.finalize();
  return { space: sp, desks, low };
}

// ======== Hub: café, jogo e caixa de sugestões ========
function buildHub() {
  const sp = new Space('hub', 'Hub', HUB);
  const X = HUB.x1, Z2 = HUB.z2, X2 = HUB.x2;
  const toSala = door('hub-sala'), toMeet = door('hub-reuniao');

  slab(sp, HUB);
  garden(sp, HUB, [[0.9, 3.7, 13, 1.7], [3.2, 4.1, 17, 2.5], [5.8, 3.4, 19, 1.8]]);
  sp.floor(X, 0, X2, Z2, floorMat(planks(['#b08a64', '#a8825d', '#b8916a', '#a07a55'], 'rgba(40,20,5,0.2)', 9)));
  // fundo e esquerda inteiros, com as portas; frente e direita baixas, com a entrada
  sp.wall(X, 0, X2, 0, { h: 2.4, windows: [[X + 4.5, X + 5.7]], open: [[toMeet.a1, toMeet.a2]] });
  sp.wall(X, 0, X, Z2, { h: 2.4, windows: [[2.8, 4.4]], open: [[toSala.a1, toSala.a2]] });
  sp.wall(X, Z2, X2, Z2, { h: 0.32, low: true, open: [[X + 1.4, X + 2.6]] });
  sp.wall(X2, 0, X2, Z2, { h: 0.32, low: true });
  portalDoor(sp, toSala, 'Sala da equipe', 2.4);
  const meet = portalDoor(sp, toMeet, 'Sala de reunião', 2.4);
  meet.light.visible = true;

  // café: bancada no fundo, à esquerda, e duas mesinhas
  const cabinets = [0.75, 1.44, 2.13].map((x, i) => sp.model(i === 1 ? 'kitchenSink' : 'kitchenCabinet', X + x, 0.33, { rot: FACE.s }));
  sp.model('kitchenFridgeLarge', X + 2.95, 0.36, { rot: FACE.s });
  const machine = sp.model('kitchenCoffeeMachine', X + 0.75, 0.3, { rot: FACE.s, y: 0.72, block: false });
  sp.model('kitchenMicrowave', X + 2.13, 0.3, { rot: FACE.s, y: 0.72, block: false });
  sp.interactive('cafe', 'Café', 'Pausa ou ausência', [machine.obj, cabinets[0].obj]);
  [[1.7, 3.5], [4.0, 3.5]].forEach(([tx, tz], k) => {
    sp.model('tableRound', X + tx, tz, {});
    chairAt(sp, `cafe-${k}-w`, X + tx - 0.9, tz, 'e', 'chair');
    chairAt(sp, `cafe-${k}-e`, X + tx + 0.9, tz, 'w', 'chair');
  });

  // mesa de jogos 1 contra 1, sobre um tapete
  const GX = X + 7.6, GZ = 4.0;
  const rug = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.012, 2.6), floorMat(carpet('#aab5c4', '#4d5a6e', 2), 0.95));
  rug.position.set(GX, 0.006, GZ);
  rug.receiveShadow = true;
  sp.group.add(rug);
  const gameTable = sp.model('tableCoffeeSquare', GX, GZ, { s: FS * 1.25 });
  const game = new THREE.MeshStandardMaterial({ map: gameTex(null, ''), roughness: 0.6 });
  const gb = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), game);
  gb.rotation.x = -Math.PI / 2;
  gb.position.set(GX, 0.5, GZ);
  sp.group.add(gb);
  sp.interactive('jogo', 'Jogo da velha', 'Jogar ou assistir', [gameTable.obj, gb]);
  const benchN = sp.model('benchCushionLow', GX, GZ - 0.85, { rot: FACE.s });
  const benchS = sp.model('benchCushionLow', GX, GZ + 0.85, { rot: FACE.n });
  sp.seat('jogo-0', GX, GZ - 0.9, 's', SEAT_Y.beanbag + 0.08);
  sp.seat('jogo-1', GX, GZ + 0.9, 'n', SEAT_Y.beanbag + 0.08);
  sp.sittable(benchN.obj, 'jogo-0');
  sp.sittable(benchS.obj, 'jogo-1');

  // caixa de sugestões no fundo, à direita
  suggestionBox(sp, X + 9.0, 0.5);

  // entrada (visitantes chegam por aqui), placa do escritório e plantas
  panel(sp, X + 0.09, 1.55, 5.7, 1.3, 0.325, Math.PI / 2, signTex('Virtuta', 'Bem-vindo'), { frame: '#20242c', depth: 0.03 });
  sp.model('rugDoormat', X + 2.0, Z2 - 0.45, { block: false });
  sp.model('coatRackStanding', X + 0.45, Z2 - 0.5, { pad: 0.1 });
  plant(sp, X + 6.15, 0.45);
  plant(sp, X2 - 0.5, Z2 - 0.5);
  plant(sp, X + 3.3, Z2 - 0.5);
  sp.lamp(X + 2.8, 2.2, 3.2, '#ffd6a0', 5, 7);
  sp.lamp(GX, 2.2, GZ, '#ffd6a0', 4, 6);

  decorateHub(sp, HUB);
  sp.finalize();
  return { space: sp, game, light: meet.lightMat };
}

// ======== Sala de reunião ========
function buildReuniao(boards: Map<string, THREE.MeshStandardMaterial>, low: number) {
  const R = REUNIAO;
  const sp = new Space('reuniao', 'Sala de reunião', R);
  const toHub = door('reuniao-hub');

  slab(sp, R, { s: 1.2 });
  garden(sp, R, [[1.0, 3.8, 23, 1.7], [4.4, 3.5, 29, 2.0]]);
  sp.floor(R.x1, R.z1, R.x2, R.z2, floorMat(carpet('#aab5c4', '#4d5a6e', 3), 0.95));
  sp.floor(R.x1, R.z2, R.x2, R.z2 + 1.2, corridorMat());
  sp.wall(R.x1, 0, R.x2, 0, { h: 2.4, windows: [[R.x2 - 1.8, R.x2 - 0.6]] });
  sp.wall(R.x1, 0, R.x1, R.z2 + 1.2, { h: 2.4, windows: [[1.6, 3.4]] });
  sp.wall(R.x2, 0, R.x2, R.z2 + 1.2, { h: 0.32, low: true });
  sp.wall(R.x1, R.z2, R.x2, R.z2, { h: 2.4, glass: true, open: [[toHub.a1, toHub.a2]], cut: { room: 'reuniao', y: low } });

  const MX = (R.x1 + R.x2) / 2;
  const tv = panel(sp, MX, 0.75, 0.12, 2.6, 1.46, 0, tvTex('Sala de reunião', 'Livre'), { glow: true }).mat;
  meetingTable(sp, 'reuniao', MX, 3.5, 4.0, 1.3, 5);
  const meetBoard = easel(sp, R.x2 - 0.75, 4.9, -Math.PI / 2, boardTex([], 1024));
  boards.set('reuniao', meetBoard.mat);
  sp.interactive('board:reuniao', 'Quadro da reunião', 'Abrir quadro', [meetBoard.obj]);
  plant(sp, R.x1 + 0.5, 0.5);
  plant(sp, R.x2 - 0.5, 0.5);
  sp.lamp(MX, 2.2, 3.4, '#ffd6a0', 5, 8);

  // porta fechada: folha de vidro fosco; a parte alta some junto com a parede para quem está dentro
  const g = doorGeom(toHub);
  const DW = g.width;
  const frost = new THREE.MeshStandardMaterial({ color: '#dfe7ef', roughness: 0.3, transparent: true, opacity: 0.6 });
  const leafDoor = new THREE.Group();
  const leaf = (y0: number, y1: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(DW, y1 - y0, 0.04), frost);
    m.position.y = (y0 + y1) / 2;
    return m;
  };
  const doorUpper = new THREE.Group();
  doorUpper.add(leaf(low, 2.1));
  const doorCap = new THREE.Group();
  const capRail = new THREE.Mesh(new THREE.BoxGeometry(DW, 0.04, 0.07), MAT.rail);
  capRail.position.y = low - 0.02;
  doorCap.add(capRail);
  doorCap.visible = false;
  leafDoor.add(leaf(0, low), doorUpper, doorCap);
  leafDoor.position.set(g.c.x, 0, g.c.z);
  leafDoor.userData.dynamic = true;
  leafDoor.visible = false;
  sp.group.add(leafDoor);
  sp.cutaways.push({ room: 'reuniao', upper: doorUpper, cap: doorCap });
  // o vão da porta é clicável mesmo aberto
  doorway(sp, toHub, 'Porta da sala de reunião', 'Abrir, fechar ou sair');

  decorateReuniao(sp, R);
  sp.finalize();
  return { space: sp, tv, door: leafDoor };
}
