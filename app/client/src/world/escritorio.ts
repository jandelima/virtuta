import * as THREE from 'three';
import { AREAS, BOARD_GAP, D, DESKS, REUNIAO, REUNIAO_DOOR, SALA, W, type Desk } from '../../../shared/layout';
import { FACE, FS, MAT, Space, type Facing } from './space';
import { carpet, concrete, drawn, planks, tiles } from './textures';
import { beanbag, easel, nameplate, officeChair, panel, signTex, stickyNote, tree } from './props';
import { SEAT_Y, chairAt, floorMat, plant } from './office';
import { boardTex, gameTex, tvTex } from './live';

// Escritório: a sala da equipe (inspirada na sala real) e, fora dela, um salão aberto com uma
// região para cada atividade. A única divisão do salão é a sala de reunião, de vidro.
// As paredes de vidro das salas são inteiras para quem olha de fora e baixam até a altura
// do armário para quem está dentro, para ninguém ficar escondido atrás delas.

const DESK_W = 1.8, DESK_D = 0.8, DESK_H = 0.38 * FS;
const opposite: Record<Facing, Facing> = { n: 's', s: 'n', e: 'w', w: 'e' };
const CHAIR_COLORS = ['#2f4f9a', '#9b3a36', '#2f6b52', '#4a4f5a', '#b4692c', '#5d4387', '#22708c', '#8c7330', '#7a3d5c', '#3f6f8f'];

export interface DeskHandle { desk: Desk; seat: string; plate: THREE.Mesh; note: THREE.Mesh }

/** Partes do cenário que mudam com o estado do escritório. */
export interface World {
  space: Space;
  desks: DeskHandle[];
  /** Face de cada quadro fixo, para desenhar o conteúdo real. */
  boards: Map<string, THREE.MeshStandardMaterial>;
  tv: THREE.MeshStandardMaterial;
  game: THREE.MeshStandardMaterial;
  door: THREE.Object3D;
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

export function buildEscritorio(): World {
  const sp = new Space('terreo', 'Escritório', W, D);
  const F = BOARD_GAP;

  // laje e gramado com árvores a oeste (aparecem pela janela da sala)
  sp.box(W / 2, -0.42, D / 2, W + 0.5, 0.4, D + 0.5, MAT.slab);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(5, D + 4), new THREE.MeshStandardMaterial({ color: '#9fbf86', roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(-2.75, -0.395, D / 2);
  grass.receiveShadow = true;
  grass.userData.noDim = true;
  sp.group.add(grass);
  tree(sp, -1.6, 1.3, 3.9, 3, 0.8);
  tree(sp, -1.7, 3.8, 3.5, 7, 0.8);
  tree(sp, -2.6, 2.6, 4.2, 11);
  tree(sp, -1.9, 7.0, 3.6, 5, 0.8);
  tree(sp, -2.2, 10.4, 3.4, 13, 0.8);

  // --- pisos: um por área, sem sobreposição
  const floors: Record<string, THREE.Material> = {
    sala: floorMat(tiles('#f3f2ef', '#efeeea', 'rgba(60,60,60,0.10)', 4), 0.35),
    reuniao: floorMat(carpet('#aab5c4', '#4d5a6e', 3), 0.95),
    recepcao: floorMat(concrete('#e4e0d9', 12), 0.6),
    cafe: floorMat(tiles('#ebe8e2', '#dcd7cf', 'rgba(0,0,0,0.06)', 8), 0.6),
    lounge: floorMat(planks(['#b08a64', '#a8825d', '#b8916a', '#a07a55'], 'rgba(40,20,5,0.2)', 9)),
    lazer: floorMat(carpet('#b8c4b0', '#55644f', 8), 0.95),
  };
  for (const a of AREAS) {
    sp.floor(a.x1, a.z1, a.x2, a.z2, floors[a.id], a.id === 'sala' ? 2.4 : 2);
    sp.zone(a.id, a.name, a.x1, a.z1, a.x2, a.z2, a.kind === 'room' ? '#dfe3ea' : '#ece8e1');
  }

  // --- paredes externas: fundo e lado esquerdo inteiros; frente e lado direito baixos
  sp.wall(0, 0, W, 0, { h: 2.4, windows: [[9.0, 10.2], [13.8, 15.0], [22.2, 23.4]] });
  sp.wall(0, 0, 0, D, { h: 2.4, windows: [[1.8, 5.0], [9.0, 10.8]] });
  sp.wall(0, D, W, D, { h: 0.32, low: true, open: [[2.0, 3.2]] });
  sp.wall(W, 0, W, D, { h: 0.32, low: true });

  // ======== Sala da equipe ========
  const salaCabinets = Array.from({ length: 6 }, (_, i) => {
    const z0 = 2.0, len = (6.6 - z0) / 6;
    return sp.model('kitchenCabinet', SALA.x2 - 0.3, z0 + len * (i + 0.5), { rot: FACE.w, s: [len / 0.43, 2.0, 0.6 / 0.45], pad: 0.18, tint: '#c9a57a' });
  });
  // para quem está dentro, as paredes de vidro baixam até a altura do armário
  const low = salaCabinets[0].top;
  sp.wall(SALA.x2, 0, SALA.x2, SALA.z2, { h: 2.4, glass: true, open: [[0.1, 1.0]], cut: { room: 'sala', y: low } });
  sp.wall(0, SALA.z2, SALA.x2, SALA.z2, { h: 2.4, glass: true, cut: { room: 'sala', y: low } });
  const boardsMap = new Map<string, THREE.MeshStandardMaterial>();
  const salaBoard = panel(sp, 3.6, 0.85, 0.1, 3.8, 1.2, 0, boardTex([], 1600), { frame: '#c9cdd3' });
  boardsMap.set('sala', salaBoard.mat);
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
  sp.lamp(2.8, 2.2, 3.3, '#ffd6a0', 5, 7);

  // ======== Sala de reunião (vidro), a única divisão do salão ========
  // a parede oeste fica atrás da sala para a câmera: não precisa baixar
  sp.wall(REUNIAO.x1, 0, REUNIAO.x1, REUNIAO.z2, { h: 2.4, glass: true });
  sp.wall(REUNIAO.x1, REUNIAO.z2, W, REUNIAO.z2, { h: 2.4, glass: true, open: [[REUNIAO_DOOR.x1, REUNIAO_DOOR.x2]], cut: { room: 'reuniao', y: low } });
  const MX = (REUNIAO.x1 + REUNIAO.x2) / 2;
  const tv = panel(sp, MX, 0.75, 0.12, 2.6, 1.46, 0, tvTex('Sala de reunião', 'Livre'), { glow: true }).mat;
  meetingTable(sp, 'reuniao', MX, 3.5, 4.0, 1.3, 5);
  const meetBoard = easel(sp, W - 0.75, 4.9, -Math.PI / 2, boardTex([], 1024));
  boardsMap.set('reuniao', meetBoard.mat);
  sp.interactive('board:reuniao', 'Quadro da reunião', 'Abrir quadro', [meetBoard.obj]);
  plant(sp, REUNIAO.x1 + 0.5, 0.5);
  plant(sp, W - 0.5, 0.5);
  sp.lamp(MX, 2.2, 3.4, '#ffd6a0', 5, 8);
  // porta fechada: folha de vidro fosco; a parte alta some junto com a parede para quem está dentro
  const DW = REUNIAO_DOOR.x2 - REUNIAO_DOOR.x1, DX = (REUNIAO_DOOR.x1 + REUNIAO_DOOR.x2) / 2;
  const frost = new THREE.MeshStandardMaterial({ color: '#dfe7ef', roughness: 0.3, transparent: true, opacity: 0.6 });
  const door = new THREE.Group();
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
  door.add(leaf(0, low), doorUpper, doorCap);
  door.position.set(DX, 0, REUNIAO.z2);
  door.userData.dynamic = true;
  door.visible = false;
  sp.group.add(door);
  sp.cutaways.push({ room: 'reuniao', upper: doorUpper, cap: doorCap });
  // o vão da porta é clicável mesmo aberto: uma folha invisível só para mirar e destacar
  const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(DW - 0.04, 2.08, 0.08));
  doorLeaf.position.set(DX, 1.04, REUNIAO.z2);
  doorLeaf.userData.ghost = true;
  sp.interactive('porta', 'Porta da sala de reunião', 'Abrir ou fechar', [doorLeaf]);

  // ======== Salão: Lounge (logo na saída da sala da equipe) ========
  const LX = 12.2, LZ = 4.3;
  sp.model('rugRectangle', LX, LZ + 0.2, { block: false, s: [FS * 1.5, FS, FS * 1.25] });
  const couch = sp.model('loungeSofa', LX, LZ - 1.75, { rot: FACE.s, s: FS * 1.15 });
  ['sofa-0', 'sofa-1'].forEach((id, i) => sp.seat(id, LX - 0.5 + i, LZ - 1.65, 's', SEAT_Y.sofa));
  sp.sittable(couch.obj, 'sofa-0', 'sofa-1');
  const armW = sp.model('loungeChair', LX - 2.05, LZ + 0.1, { rot: FACE.e, s: FS * 1.1 });
  sp.seat('poltrona-w', LX - 1.95, LZ + 0.1, 'e', SEAT_Y.sofa);
  sp.sittable(armW.obj, 'poltrona-w');
  const armE = sp.model('loungeChair', LX + 2.05, LZ + 0.1, { rot: FACE.w, s: FS * 1.1 });
  sp.seat('poltrona-e', LX + 1.95, LZ + 0.1, 'w', SEAT_Y.sofa);
  sp.sittable(armE.obj, 'poltrona-e');
  const coffee = sp.model('tableCoffee', LX, LZ + 0.1, { rot: FACE.s });
  sp.interactive('lounge', 'Lounge', 'Convidar a equipe para uma pausa', [coffee.obj]);
  sp.model('lampRoundFloor', LX + 2.7, LZ - 1.9, {});
  plant(sp, 9.0, 7.2);
  plant(sp, 15.1, 7.2);
  sp.lamp(LX, 1.6, LZ, '#ffc27a', 5, 7);
  // caixa de sugestões, encostada na parede do fundo, atrás do sofá
  suggestionBox(sp, LX, 0.5);

  // ======== Salão: Recepção ========
  panel(sp, 0.25, 0.0, 9.1, 1.3, 1.25, Math.PI / 2, signTex('Virtuta', 'Bem-vindo'), { frame: '#20242c', depth: 0.12 });
  sp.nav.block(0, 8.4, 0.5, 9.8);
  const RX = 3.0, RZ = 9.0;
  const counter = [
    sp.model('desk', RX, RZ, { rot: FACE.n, s: [1.6 / 0.72, FS, DESK_D / 0.38] }),
    sp.model('computerScreen', RX + 0.3, RZ + 0.2, { rot: FACE.n, y: DESK_H, block: false }),
  ];
  sp.interactive('recepcao', 'Recepção', 'Convidar ou receber visitante', counter.map((c) => c.obj));
  chairAt(sp, 'recepcao', RX + 0.3, RZ - 0.72, 's', 'chair');
  const sofa = sp.model('loungeDesignSofa', 0.6, 10.9, { rot: FACE.e });
  ['espera-0', 'espera-1'].forEach((id, i) => sp.seat(id, 0.71, 10.55 + i * 0.7, 'e', SEAT_Y.sofa));
  sp.sittable(sofa.obj, 'espera-0', 'espera-1');
  sp.model('rugDoormat', 2.6, 11.6, { block: false });
  sp.model('coatRackStanding', 5.2, 11.5, { pad: 0.1 });
  plant(sp, 5.3, 8.3);
  sp.lamp(2.5, 2.2, 10.0, '#ffd6a0', 4, 6);

  // ======== Salão: Café ========
  const cabinets = [6.75, 7.44, 8.13].map((x, i) => sp.model(i === 1 ? 'kitchenSink' : 'kitchenCabinet', x, SALA.z2 + 0.33, { rot: FACE.s }));
  sp.model('kitchenFridgeLarge', 8.95, SALA.z2 + 0.36, { rot: FACE.s });
  const machine = sp.model('kitchenCoffeeMachine', 6.75, SALA.z2 + 0.3, { rot: FACE.s, y: 0.72, block: false });
  sp.model('kitchenMicrowave', 8.13, SALA.z2 + 0.3, { rot: FACE.s, y: 0.72, block: false });
  sp.interactive('cafe', 'Café', 'Fui tomar café (ficar ausente)', [machine.obj, cabinets[0].obj]);
  [[9.4, 10.4], [12.8, 10.4]].forEach(([tx, tz], k) => {
    sp.model('tableRound', tx, tz, {});
    chairAt(sp, `cafe-${k}-w`, tx - 0.9, tz, 'e', 'chair');
    chairAt(sp, `cafe-${k}-e`, tx + 0.9, tz, 'w', 'chair');
  });
  plant(sp, 15.1, 11.5);
  sp.lamp(9.0, 2.2, 10.0, '#ffd6a0', 4, 7);
  sp.lamp(12.8, 2.2, 10.2, '#ffd6a0', 4, 6);

  // ======== Salão: Lazer ========
  const GX = 20.4, GZ = 9.5;
  const gameTable = sp.model('tableCoffeeSquare', GX, GZ, { s: FS * 1.25 });
  const gameFace = new THREE.MeshStandardMaterial({ map: gameTex(null, ''), roughness: 0.6 });
  const gb = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), gameFace);
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
  // pufes para quem assiste
  ([[GX - 1.9, GZ, 'e', '#d99a5b'], [GX + 1.9, GZ, 'w', '#6f97bd']] as const).forEach(([x, z, f, color], i) => {
    sp.sittable(beanbag(sp, x, z, color), `pufe-${i}`);
    // o pufe afunda com o peso: altura ajustada à mão, abaixo do topo
    sp.seat(`pufe-${i}`, x, z, f, 0.36);
    sp.seats.get(`pufe-${i}`)!.auto = false;
  });
  plant(sp, 23.5, 7.3);
  plant(sp, 16.1, 11.5);
  sp.lamp(GX, 2.2, GZ, '#ffd6a0', 4, 7);

  sp.spawn.set(2.6, 0, 10.6);
  sp.finalize();
  return { space: sp, desks, boards: boardsMap, tv, game: gameFace, door };
}
