import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { characterUrl, gltf } from './assets';
import { FACES, HAIR_STYLES, OUTFITS, kitExtras, nearestFace, sanitizeLook, type Look, type Outfit, type StoredLook } from '../../shared/look';

// Montagem do avatar a partir das peças do kit: o crânio e o cabelo de um personagem, o rosto
// (olhos e boca) de outro e a roupa de um terceiro, com uma cor para cada parte.
//
// Os personagens do kit pintam tudo com uma paleta compartilhada (blocos de cor numa textura),
// e um mesmo bloco aparece em partes diferentes: num personagem a cor do cabelo é também a dos
// olhos, noutro a da calça é também a do tronco. Por isso as cores não são trocadas na paleta:
// cada triângulo é classificado pela parte do corpo a que pertence (osso, bloco e posição) e
// recebe a cor dessa parte direto no vértice, mantendo o leve sombreado da textura original.

export type { Look, StoredLook };

/** Personagens do kit usados como peças (pré-carregados na entrada). */
export const ALL_MODELS = [...new Set([...HAIR_STYLES.filter((h) => h !== 'none'), ...FACES, ...OUTFITS])];

export const SKIN_TONES = ['#fbe1cc', '#f7d7bd', '#efbf9b', '#e3a982', '#d9a077', '#c68a5e', '#b97d52', '#a06a45', '#8d5b3a', '#74482d', '#5f3d2a', '#4a2f21'];
export const HAIR_COLORS = ['#1f1d22', '#2b2a2f', '#4b3426', '#6b4430', '#8a5a3a', '#a8703f', '#c25a30', '#d9893e', '#e4b75c', '#efd9a0', '#b4b7bf', '#f2f2f2', '#df7aa8', '#8b5cf6', '#4f7fd9', '#2f9e6a'];
export const CLOTH_COLORS = ['#f4f4f5', '#d4d4d8', '#9ca3af', '#4b5563', '#26292f', '#111216', '#1e3a8a', '#3b5bdb', '#5f8fe8', '#0f9fb5', '#2f9e6a', '#355e3b', '#84a98c', '#f2b443', '#ec7a3c', '#d6453d', '#7b2d3b', '#db5c95', '#8b5cf6', '#c9b48f', '#7a5a3a', '#4a3527'];
export const GEAR_COLORS = ['#111216', '#4b5563', '#b4b7bf', '#f4f4f5', '#c9a227', '#9b4d2e', '#3b5bdb', '#d6453d', '#2f9e6a', '#db5c95'];

type Slot = 'skin' | 'hair' | 'face' | 'band' | 'frame' | 'lens' | 'beard' | 'earrings'
  | 'top' | 'detail' | 'bottom' | 'shoes' | 'sole' | 'legs' | 'fixed' | 'drop';

/** Bloco da paleta que pinta a pele e, em cada cabeça, os acessórios desenhados nela. */
const HEADS: Record<string, { skin: string; band?: string[]; glasses?: string[]; beard?: string[]; earrings?: string[]; drop?: string[] }> = {
  'female-a': { skin: '63' },
  'female-b': { skin: '73', band: ['22'] },
  'female-c': { skin: '53', band: ['42'] },
  'female-d': { skin: '73', earrings: ['43'] },
  'female-e': { skin: '73' },
  'female-f': { skin: '73' },
  'male-a': { skin: '63', glasses: ['33', '43'] },
  'male-b': { skin: '73', beard: ['53', '63'], drop: ['33'] },
  'male-d': { skin: '73' },
  'male-e': { skin: '73', glasses: ['33', '43'] },
  'male-f': { skin: '53' },
};

/**
 * Parte de cada bloco de cada roupa, por osso ('22:arm' = bloco 22 nos braços; sem osso, vale
 * para todos). 'legs' separa calça, sapato e sola pela altura de cada peça, quando as três
 * usam o mesmo bloco. Mapeado olhando cada personagem com cores falsas.
 */
const BODIES: Record<Outfit, Record<string, Slot>> = {
  'female-b': { '73': 'skin', '22': 'top', '72': 'bottom', '03:leg': 'shoes', '43:leg': 'sole' },
  'female-c': { '53:arm': 'skin', '53:torso': 'skin', '52': 'top', '43:torso': 'detail', '42:torso': 'bottom', '13:leg': 'bottom', '43:leg': 'fixed', '53:leg': 'shoes', '73:leg': 'sole' },
  'female-d': { '73': 'skin', '13:arm': 'top', '13:torso': 'top', '13:leg': 'bottom', '43': 'detail', '03:leg': 'legs' },
  'female-e': { '52:arm': 'skin', '43:arm': 'top', '43:torso': 'top', '33:torso': 'detail', '53:torso': 'detail', '03:leg': 'bottom', '43:leg': 'shoes', '33:leg': 'sole' },
  'female-f': { '73': 'skin', '03': 'top', '22': 'detail', '33:torso': 'detail', '13:torso': 'bottom', '52:leg': 'bottom', '72:leg': 'shoes', '43:leg': 'sole' },
  'male-a': { '63': 'skin', '12': 'top', '53:torso': 'bottom', '52:leg': 'bottom', '22:leg': 'shoes', '43:leg': 'sole' },
  'male-b': { '73:arm': 'skin', '73:torso': 'skin', '42': 'top', '53:torso': 'bottom', '52:leg': 'bottom', '53:leg': 'shoes', '73:leg': 'sole' },
  'male-d': { '73': 'skin', '03:arm': 'top', '03:torso': 'top', '42': 'detail', '43': 'fixed', '03:leg': 'legs' },
  'male-e': { '03:arm': 'skin', '43:arm': 'top', '43:torso': 'top', '22': 'detail', '43:leg': 'bottom', '03:leg': 'shoes', '13:leg': 'sole' },
  'male-f': { '53:arm': 'skin', '53:torso': 'top', '12': 'top', '03:torso': 'detail', '13:torso': 'detail', '73:arm': 'detail', '73:leg': 'bottom', '53:leg': 'shoes', '13:leg': 'sole' },
};

/** Nomes das opções, na ordem em que aparecem no criador. */
export const HAIR_NAMES: Record<string, string> = {
  'male-f': 'Curto', 'male-a': 'Cacheado', 'male-d': 'Espetado', 'male-e': 'Topete', 'female-e': 'Liso longo', 'female-a': 'Rabo de cavalo',
  'female-c': 'Coque alto', 'female-d': 'Coque', 'female-b': 'Dois coques', 'female-f': 'Franja', none: 'Careca',
};
export const FACE_NAMES: Record<string, string> = { 'male-d': 'Sorriso', 'female-b': 'Cílios', 'female-f': 'Maquiagem', 'male-b': 'Tranquilo', 'male-f': 'Sério' };
export const OUTFIT_NAMES: Record<string, string> = {
  'male-a': 'Camiseta', 'male-b': 'Manga longa', 'female-b': 'Cropped', 'female-e': 'Camisa e gravata', 'male-e': 'Suspensório',
  'female-f': 'Jaqueta', 'male-f': 'Colete', 'female-c': 'Saia', 'female-d': 'Blazer', 'male-d': 'Terno',
};
export const GLASSES_NAMES = { none: 'Sem óculos', grau: 'De grau', redondos: 'Redondos', escuros: 'Escuros' };
export const FACIAL_NAMES = { none: 'Sem barba', bigode: 'Bigode', cavanhaque: 'Cavanhaque', barba: 'Barba' };
export const HAT_NAMES = { none: 'Sem chapéu', bone: 'Boné', gorro: 'Gorro' };
export const COSTUME_NAMES = { none: 'Sem fantasia', bruxa: 'Chapéu de bruxa', chifres: 'Chifrinhos', mascara: 'Máscara', abobora: 'Cabeça de abóbora' };
export const CAPE_COLORS = ['#1c1a22', '#5b2a86', '#9b1c24', '#1f4d3a', '#e8761c'];

/** Fantasias só aparecem enquanto o tema de Halloween está ativo; fora dele, ficam guardadas. */
let costumesOn = false;
export function setCostumes(on: boolean) { costumesOn = on; }
export function costumesActive() { return costumesOn; }

// ---------- leitura das peças do kit ----------

interface Tri { p: number[]; n: number[]; uv: number[]; bone: number; block: string; c: THREE.Vector3; part: string }

const BONE_PART = ['root', 'leg', 'leg', 'torso', 'arm', 'arm', 'head'];
const triCache = new Map<string, Tri[]>();

/** Triângulos de uma malha do kit ('head-mesh' ou 'body-mesh'), com bloco da paleta e osso. */
function tris(model: string, mesh: 'head-mesh' | 'body-mesh') {
  const key = `${model}/${mesh}`;
  const hit = triCache.get(key);
  if (hit) return hit;
  const m = gltf(characterUrl(`character-${model}`)).scene.getObjectByName(mesh) as THREE.SkinnedMesh;
  const g = m.geometry, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, si = g.attributes.skinIndex;
  const idx = g.index!;
  const out: Tri[] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const v = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
    const p = v.flatMap((i) => [pos.getX(i), pos.getY(i), pos.getZ(i)]);
    const u = (uv.getX(v[0]) + uv.getX(v[1]) + uv.getX(v[2])) / 3, w = (uv.getY(v[0]) + uv.getY(v[1]) + uv.getY(v[2])) / 3;
    const bone = si.getX(v[0]);
    out.push({
      p, n: v.flatMap((i) => [nor.getX(i), nor.getY(i), nor.getZ(i)]), uv: v.flatMap((i) => [uv.getX(i), uv.getY(i)]), bone,
      block: `${Math.floor(u * 8)}${Math.floor(w * 4)}`, part: BONE_PART[bone] ?? 'torso',
      c: new THREE.Vector3((p[0] + p[3] + p[6]) / 3, (p[1] + p[4] + p[7]) / 3, (p[2] + p[5] + p[8]) / 3),
    });
  }
  triCache.set(key, out);
  return out;
}

/** Olhos, boca e maquiagem: no plano da frente do rosto, na altura dos olhos e da boca. */
const onFace = (t: Tri) => t.c.z > 0.155 && t.c.z < 0.178 && Math.abs(t.c.x) < 0.1 && t.c.y > 0.395 && t.c.y < 0.53;

function headSlot(model: string, t: Tri): Slot {
  const h = HEADS[model];
  if (h.drop?.includes(t.block)) return 'drop';
  if (h.glasses?.includes(t.block)) return t.block === h.glasses[1] ? 'lens' : 'frame';
  if (h.beard?.includes(t.block)) return 'beard';
  if (h.earrings?.includes(t.block)) return 'earrings';
  if (t.block === h.skin) return 'skin';
  if (onFace(t)) return 'face';
  if (h.band?.includes(t.block)) return 'band';
  return 'hair';
}

function bodySlot(outfit: Outfit, t: Tri): Slot {
  const map = BODIES[outfit];
  return map[`${t.block}:${t.part}`] ?? map[t.block] ?? 'fixed';
}

/**
 * Calça, sapato e sola pintados com o mesmo bloco: cada peça é um bloco de geometria separado,
 * então os triângulos são agrupados por vértices em comum e cada grupo vai pela altura.
 */
function splitLegs(list: Tri[]) {
  const key = (x: number, y: number, z: number) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
  const parent = list.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const seen = new Map<string, number>();
  list.forEach((t, i) => {
    for (let k = 0; k < 9; k += 3) {
      const id = key(t.p[k], t.p[k + 1], t.p[k + 2]) + t.bone;
      const j = seen.get(id);
      if (j === undefined) seen.set(id, i); else parent[find(i)] = find(j);
    }
  });
  const top = new Map<number, number>();
  list.forEach((t, i) => { const r = find(i); top.set(r, Math.max(top.get(r) ?? 0, t.p[1], t.p[4], t.p[7])); });
  return list.map((_, i): Slot => { const y = top.get(find(i))!; return y < 0.03 ? 'sole' : y < 0.095 ? 'shoes' : 'bottom'; });
}

// ---------- cores ----------

let palette: ImageData | null = null;
function pal() {
  if (palette) return palette;
  const mesh = gltf(characterUrl('character-male-a')).scene.getObjectByName('body-mesh') as THREE.Mesh;
  const img = (mesh.material as THREE.MeshStandardMaterial).map!.image as CanvasImageSource & { width: number; height: number };
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  return (palette = g.getImageData(0, 0, c.width, c.height));
}
/** Cor da paleta no ponto (u, v), sempre dentro do bloco (as bordas encostam no vizinho). */
function texel(u: number, v: number, block: string) {
  const p = pal(), bw = p.width / 8, bh = p.height / 4;
  const x0 = +block[0] * bw, y0 = +block[1] * bh;
  const x = Math.min(x0 + bw - 2, Math.max(x0 + 1, Math.floor(u * p.width)));
  const y = Math.min(y0 + bh - 2, Math.max(y0 + 1, Math.floor(v * p.height)));
  const i = (y * p.width + x) * 4;
  return [p.data[i], p.data[i + 1], p.data[i + 2]];
}
const blockColor = (block: string) => {
  const p = pal(), x = +block[0] * (p.width / 8) + 8, y = +block[1] * (p.height / 4) + 8, i = (y * p.width + x) * 4;
  return '#' + [0, 1, 2].map((k) => p.data[i + k].toString(16).padStart(2, '0')).join('');
};
const texelCenter = (block: string) => texel((+block[0] + 0.5) / 8, (+block[1] + 0.5) / 4, block);
const lum = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

/** Cor original de cada parte de uma roupa ou cabeça, para começar igual ao personagem do kit. */
function originalColors(model: string, mesh: 'head-mesh' | 'body-mesh', slotOf: (t: Tri) => Slot) {
  const out: Partial<Record<Slot, string>> = {};
  for (const t of tris(model, mesh)) { const s = slotOf(t); out[s] ??= blockColor(t.block); }
  return out;
}

/** Se a roupa tem uma segunda cor (gravata, colar, suspensório...). */
export const hasDetail = (outfit: Outfit) => Object.values(BODIES[outfit]).includes('detail');

/** Visual completo a partir do guardado; o que faltar vem do personagem do kit da pessoa. */
export function resolveLook(stored: StoredLook | null | undefined, kitModel = 'character-male-e'): Look {
  const kit = kitModel.replace('character-', '');
  const s = sanitizeLook(stored ?? {}) ?? {};
  const outfit = s.outfit ?? (OUTFITS as readonly string[]).find((o) => o === kit) as Outfit ?? 'male-e';
  const hairStyle = s.hairStyle ?? (HAIR_STYLES as readonly string[]).find((h) => h === kit) as Look['hairStyle'] ?? 'male-f';
  const body = originalColors(outfit, 'body-mesh', (t) => bodySlot(outfit, t));
  const headModel = hairStyle === 'none' ? 'male-b' : hairStyle;
  const head = originalColors(headModel, 'head-mesh', (t) => headSlot(headModel, t));
  const extras = stored && 'hairStyle' in stored ? {} : kitExtras(kit);
  return {
    hairStyle, face: s.face ?? nearestFace(kit), outfit,
    skin: s.skin ?? head.skin ?? SKIN_TONES[3], hair: s.hair ?? head.hair ?? HAIR_COLORS[1],
    top: s.top ?? body.top ?? CLOTH_COLORS[7], detail: s.detail ?? body.detail ?? CLOTH_COLORS[13],
    bottom: s.bottom ?? body.bottom ?? CLOTH_COLORS[4], shoes: s.shoes ?? body.shoes ?? CLOTH_COLORS[4],
    glasses: s.glasses ?? extras.glasses ?? 'none', frame: s.frame ?? GEAR_COLORS[0],
    facial: s.facial ?? extras.facial ?? 'none',
    hat: s.hat ?? 'none', hatColor: s.hatColor ?? CLOTH_COLORS[6],
    headphones: s.headphones ?? false, phonesColor: s.phonesColor ?? GEAR_COLORS[0],
    earrings: s.earrings ?? extras.earrings ?? false,
    costume: s.costume ?? 'none', cape: s.cape ?? false, capeColor: s.capeColor ?? CAPE_COLORS[0],
  };
}

// ---------- montagem ----------

class Builder {
  /** Ponto mais alto montado até agora (o arco do fone se apoia nele). */
  top = 0;
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private bones: number[] = [];

  /** Triângulo do kit com uma cor de parte (mantém o sombreado da paleta) ou a cor original. */
  kit(t: Tri, hex: string | null) {
    const c = new THREE.Color();
    if (!hex) {
      for (let k = 0; k < 3; k++) {
        const [r, g, b] = texel(t.uv[k * 2], t.uv[k * 2 + 1], t.block);
        c.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
        this.col.push(c.r, c.g, c.b);
      }
    } else {
      const base = Math.max(1, lum(texelCenter(t.block)));
      c.set(hex);
      for (let k = 0; k < 3; k++) {
        const shade = THREE.MathUtils.clamp(lum(texel(t.uv[k * 2], t.uv[k * 2 + 1], t.block)) / base, 0.7, 1.2);
        this.col.push(c.r * shade, c.g * shade, c.b * shade);
      }
    }
    this.pos.push(...t.p);
    this.top = Math.max(this.top, t.p[1], t.p[4], t.p[7]);
    this.nor.push(...t.n);
    this.bones.push(t.bone, t.bone, t.bone);
  }

  /** Bloco chanfrado no estilo do kit, preso a um osso (acessórios). */
  box(bone: number, x: number, y: number, z: number, w: number, h: number, d: number, hex: string, r = 0.006, rot?: THREE.Euler) {
    const g = new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
    if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot));
    g.translate(x, y, z);
    this.top = Math.max(this.top, y + h / 2);
    const c = new THREE.Color(hex);
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(c.r, c.g, c.b);
      this.bones.push(bone);
    }
    g.dispose();
  }

  /** Peça de forma livre (cone, cilindro) presa a um osso, para o que não é bloco. */
  shape(bone: number, geo: THREE.BufferGeometry, m: THREE.Matrix4, hex: string) {
    const g = (geo.index ? geo.toNonIndexed() : geo).applyMatrix4(m);
    const c = new THREE.Color(hex);
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(c.r, c.g, c.b);
      this.bones.push(bone);
      this.top = Math.max(this.top, p.getY(i));
    }
    g.dispose();
    geo.dispose();
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.bones.flatMap((b) => [b, 0, 0, 0]), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.bones.flatMap(() => [1, 0, 0, 0]), 4));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
const HEAD_BONE = 6;
/** Altura a partir da qual o cabelo some debaixo de um chapéu. */
const HAT_CUT = { bone: 0.59, gorro: 0.58 } as const;
const LENS_CLEAR = '#dfe6ee', LENS_DARK = '#1c1f26', BAND = '#2b2f37';

const PUMPKIN = '#e8761c', PUMPKIN_DARK = '#c45c10', CARVED = '#ffd34d', STEM = '#5b4a1e';

/** Cabeça de abóbora: cobre a cabeça inteira, com o rosto entalhado e iluminado por dentro. */
function pumpkinHead(b: Builder) {
  b.box(HEAD_BONE, 0, 0.53, 0, 0.46, 0.38, 0.42, PUMPKIN, 0.12);
  for (const x of [-0.12, 0, 0.12]) b.box(HEAD_BONE, x, 0.53, 0, 0.05, 0.39, 0.43, PUMPKIN_DARK, 0.02);
  b.box(HEAD_BONE, 0, 0.74, 0, 0.05, 0.08, 0.05, STEM, 0.012);
  for (const sx of [-1, 1]) {
    b.box(HEAD_BONE, sx * 0.085, 0.585, 0.212, 0.075, 0.05, 0.01, CARVED, 0.004);
    b.box(HEAD_BONE, sx * 0.085, 0.612, 0.212, 0.035, 0.03, 0.01, CARVED, 0.004);
  }
  b.box(HEAD_BONE, 0, 0.53, 0.212, 0.035, 0.03, 0.01, CARVED, 0.004);
  b.box(HEAD_BONE, 0, 0.455, 0.212, 0.22, 0.045, 0.01, CARVED, 0.006);
  for (const x of [-0.06, 0.04]) b.box(HEAD_BONE, x, 0.47, 0.218, 0.03, 0.022, 0.01, PUMPKIN, 0.003);
}

/** Acessórios de Halloween presos à cabeça (por cima do resto). */
function costumeHead(b: Builder, look: Look) {
  if (look.costume === 'bruxa') {
    // aba larga, copa cônica um pouco tombada para trás e a ponta dobrada
    const black = '#23202b', band = '#7b3fa0';
    const at = (x: number, y: number, z: number, rx = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)), new THREE.Vector3(1, 1, 1));
    b.shape(HEAD_BONE, new THREE.CylinderGeometry(0.31, 0.31, 0.02, 28), at(0, 0.605, 0), black);
    b.shape(HEAD_BONE, new THREE.CylinderGeometry(0.11, 0.18, 0.2, 20), at(0, 0.71, -0.01, -0.08), black);
    b.shape(HEAD_BONE, new THREE.CylinderGeometry(0.185, 0.185, 0.05, 20), at(0, 0.64, 0, -0.04), band);
    b.shape(HEAD_BONE, new THREE.ConeGeometry(0.11, 0.2, 18), at(0, 0.9, -0.04, -0.2), black);
    b.shape(HEAD_BONE, new THREE.ConeGeometry(0.045, 0.13, 12), at(0, 1.0, -0.1, -1.2), black);
  }
  if (look.costume === 'chifres') {
    for (const sx of [-1, 1]) {
      b.box(HEAD_BONE, sx * 0.1, 0.71, 0.03, 0.06, 0.07, 0.06, '#c0262d', 0.02);
      b.box(HEAD_BONE, sx * 0.118, 0.765, 0.035, 0.04, 0.06, 0.04, '#c0262d', 0.015);
      b.box(HEAD_BONE, sx * 0.13, 0.81, 0.04, 0.022, 0.04, 0.022, '#c0262d', 0.008);
    }
  }
  if (look.costume === 'mascara') {
    b.box(HEAD_BONE, 0, 0.497, 0.178, 0.33, 0.08, 0.02, '#4a2370', 0.02);
    for (const sx of [-1, 1]) b.box(HEAD_BONE, sx * 0.066, 0.499, 0.19, 0.07, 0.04, 0.006, '#0d0d12', 0.01);
    for (const sx of [-1, 1]) b.box(HEAD_BONE, sx * 0.17, 0.512, 0.17, 0.03, 0.03, 0.01, '#f2c14e', 0.006);
  }
}

function buildHead(look: Look) {
  const b = new Builder();
  const costume = costumesOn ? look.costume : 'none';
  if (costume === 'abobora') { pumpkinHead(b); return b.geometry(); }
  // o chapéu de bruxa toma o lugar do chapéu normal
  if (costume === 'bruxa') look = { ...look, hat: 'none' };
  const hairModel = look.hairStyle === 'none' ? null : look.hairStyle;
  const hatCut = costume === 'bruxa' ? 0.6 : look.hat === 'none' ? Infinity : HAT_CUT[look.hat];
  // crânio e cabelo do penteado; olhos e boca do rosto escolhido
  for (const t of tris(hairModel ?? look.face, 'head-mesh')) {
    const s = headSlot(hairModel ?? look.face, t);
    if (s === 'skin') b.kit(t, look.skin);
    else if (hairModel && s === 'hair' && t.c.y < hatCut) b.kit(t, look.hair);
    else if (hairModel && s === 'band' && hatCut === Infinity) b.kit(t, null);
  }
  for (const t of tris(look.face, 'head-mesh')) if (headSlot(look.face, t) === 'face') b.kit(t, null);
  if (look.glasses === 'redondos' || look.glasses === 'escuros') {
    for (const t of tris('male-a', 'head-mesh')) {
      const s = headSlot('male-a', t);
      if (s === 'frame') b.kit(t, look.frame);
      if (s === 'lens') b.kit(t, look.glasses === 'escuros' ? LENS_DARK : LENS_CLEAR);
    }
  }
  if (look.glasses === 'grau') {
    // armação fina, sem lente: os olhos continuam aparecendo
    const f = look.frame, t = 0.013;
    for (const sx of [-1, 1]) {
      const cx = sx * 0.064;
      b.box(HEAD_BONE, cx, 0.528, 0.173, 0.096, t, t, f, 0.004);
      b.box(HEAD_BONE, cx, 0.452, 0.173, 0.096, t, t, f, 0.004);
      b.box(HEAD_BONE, cx - 0.042, 0.49, 0.173, t, 0.088, t, f, 0.004);
      b.box(HEAD_BONE, cx + 0.042, 0.49, 0.173, t, 0.088, t, f, 0.004);
      // dobradiça e haste até a orelha
      b.box(HEAD_BONE, sx * 0.143, 0.522, 0.173, 0.074, t, t, f, 0.004);
      b.box(HEAD_BONE, sx * 0.181, 0.522, 0.085, t, t, 0.19, f, 0.004);
    }
    b.box(HEAD_BONE, 0, 0.506, 0.173, 0.036, 0.011, 0.011, f, 0.004);
  }
  if (look.facial === 'barba') for (const t of tris('male-b', 'head-mesh')) if (headSlot('male-b', t) === 'beard') b.kit(t, look.hair);
  if (look.facial === 'bigode' || look.facial === 'cavanhaque') {
    b.box(HEAD_BONE, 0, 0.452, 0.168, 0.118, 0.022, 0.022, look.hair, 0.006);
    for (const sx of [-1, 1]) b.box(HEAD_BONE, sx * 0.05, 0.437, 0.168, 0.026, 0.022, 0.022, look.hair, 0.006);
  }
  if (look.facial === 'cavanhaque') b.box(HEAD_BONE, 0, 0.372, 0.168, 0.062, 0.05, 0.022, look.hair, 0.008);
  if (look.earrings) for (const t of tris('female-d', 'head-mesh')) if (headSlot('female-d', t) === 'earrings') b.kit(t, null);
  if (look.hat === 'bone') {
    b.box(HEAD_BONE, 0, 0.645, -0.004, 0.366, 0.11, 0.366, look.hatColor, 0.032);
    b.box(HEAD_BONE, 0, 0.597, 0.228, 0.28, 0.016, 0.15, look.hatColor, 0.007);
    b.box(HEAD_BONE, 0, 0.703, -0.004, 0.04, 0.012, 0.04, look.hatColor, 0.005);
  }
  if (look.hat === 'gorro') {
    b.box(HEAD_BONE, 0, 0.675, 0, 0.362, 0.15, 0.362, look.hatColor, 0.045);
    b.box(HEAD_BONE, 0, 0.606, 0, 0.384, 0.056, 0.384, look.hatColor, 0.016);
    b.box(HEAD_BONE, 0, 0.765, 0, 0.07, 0.06, 0.07, look.hatColor, 0.022);
  }
  if (look.headphones) {
    // o arco passa rente ao crânio (afunda nos coques) ou por cima do chapéu
    const top = costume === 'bruxa' ? 0.62 : look.hat === 'bone' ? 0.708 : look.hat === 'gorro' ? 0.758 : Math.min(b.top, 0.69) + 0.008;
    b.box(HEAD_BONE, 0, top, 0, 0.4, 0.024, 0.05, BAND, 0.008);
    for (const sx of [-1, 1]) {
      b.box(HEAD_BONE, sx * 0.205, (top + 0.53) / 2, 0, 0.02, top - 0.53, 0.044, BAND, 0.006);
      b.box(HEAD_BONE, sx * 0.224, 0.49, 0, 0.046, 0.115, 0.1, look.phonesColor, 0.018);
    }
  }
  if (costume !== 'none') costumeHead(b, { ...look, costume });
  return b.geometry();
}

const TORSO_BONE = 3;

function buildBody(look: Look) {
  const b = new Builder();
  const list = tris(look.outfit, 'body-mesh');
  const slots = list.map((t) => bodySlot(look.outfit, t));
  const legIdx = slots.flatMap((s, i) => (s === 'legs' ? [i] : []));
  const legSlots = splitLegs(legIdx.map((i) => list[i]));
  legIdx.forEach((i, k) => (slots[i] = legSlots[k]));
  const sole = new THREE.Color(look.shoes).multiplyScalar(0.55).getHexString();
  list.forEach((t, i) => {
    const s = slots[i];
    const hex = s === 'skin' ? look.skin : s === 'top' ? look.top : s === 'detail' ? look.detail : s === 'bottom' ? look.bottom
      : s === 'shoes' ? look.shoes : s === 'sole' ? `#${sole}` : null;
    if (s !== 'drop') b.kit(t, hex);
  });
  // capa de Halloween: presa ao tronco, dos ombros até perto dos joelhos, pelas costas
  if (costumesOn && look.cape) {
    const torso = list.filter((t, i) => t.part === 'torso' && slots[i] !== 'drop');
    const xs = torso.map((t) => t.c.x), ys = torso.map((t) => t.c.y), zs = torso.map((t) => t.c.z);
    const w = (Math.max(...xs) - Math.min(...xs)) * 1.15 + 0.04, top = Math.max(...ys), back = Math.min(...zs) - 0.03;
    const bottom = 0.1;
    b.box(TORSO_BONE, 0, (top + bottom) / 2, back, w, top - bottom, 0.025, look.capeColor, 0.01);
    b.box(TORSO_BONE, 0, top + 0.02, back + 0.02, w + 0.04, 0.06, 0.05, look.capeColor, 0.015);
  }
  return b.geometry();
}

let material: THREE.MeshStandardMaterial | null = null;

/** Monta o personagem: esqueleto e animações do kit, malhas geradas para o visual escolhido. */
export function buildCharacter(look: Look) {
  const src = gltf(characterUrl(`character-${look.outfit}`));
  const model = cloneSkinned(src.scene);
  const head = model.getObjectByName('head-mesh') as THREE.SkinnedMesh;
  const body = model.getObjectByName('body-mesh') as THREE.SkinnedMesh;
  if (!material) {
    const orig = body.material as THREE.MeshStandardMaterial;
    material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: orig.roughness, metalness: orig.metalness });
  }
  head.geometry = buildHead(look);
  body.geometry = buildBody(look);
  head.material = body.material = material;
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; }
  });
  return { model, animations: src.animations };
}

/** Libera as malhas geradas de um personagem que saiu de cena. */
export function disposeCharacter(model: THREE.Object3D) {
  model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
}
