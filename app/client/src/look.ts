import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { characterUrl, gltf } from './assets';

// Aparência do avatar: cabeça (cabelo) e corpo (roupa) podem vir de modelos diferentes do kit,
// e as cores de pele, cabelo, blusa e calça são trocadas na textura de paleta.
//
// A textura do kit é uma paleta de blocos de 64 x 128 px (8 colunas x 4 linhas). Cada modelo usa
// um bloco para cada parte; os blocos abaixo foram mapeados pela posição das faces no corpo.

import type { Look } from '../../shared/protocol';
export type { Look };
export type Gender = Look['gender'];

interface Parts { skin: string; hair: string[]; top: string[]; bottom: string[] }

const PARTS: Record<string, Parts> = {
  'female-a': { skin: '63', hair: ['03'], top: [], bottom: [] },
  'female-b': { skin: '73', hair: ['53'], top: ['22'], bottom: ['72'] },
  'female-c': { skin: '53', hair: ['13'], top: ['52'], bottom: ['42'] },
  'female-d': { skin: '73', hair: ['53'], top: ['13'], bottom: ['03'] },
  'female-e': { skin: '73', hair: ['03'], top: ['43'], bottom: ['03'] },
  'female-f': { skin: '73', hair: ['63', '53'], top: ['03'], bottom: ['52'] },
  'male-a': { skin: '63', hair: ['03'], top: ['12'], bottom: ['52'] },
  'male-b': { skin: '73', hair: ['53', '63'], top: ['42'], bottom: ['52'] },
  'male-d': { skin: '73', hair: ['53'], top: ['03'], bottom: [] },
  'male-e': { skin: '73', hair: ['63'], top: ['43'], bottom: ['22'] },
  'male-f': { skin: '53', hair: ['03'], top: ['12'], bottom: ['73'] },
};

export const HEADS: Record<Gender, string[]> = {
  f: ['female-a', 'female-b', 'female-c', 'female-d', 'female-e', 'female-f'],
  m: ['male-a', 'male-b', 'male-d', 'male-e', 'male-f'],
};
// female-a segura um equipamento e male-c é um uniforme de polícia: ficam fora dos corpos
export const BODIES: Record<Gender, string[]> = {
  f: ['female-b', 'female-c', 'female-d', 'female-e', 'female-f'],
  m: ['male-a', 'male-b', 'male-d', 'male-e', 'male-f'],
};
export const ALL_MODELS = [...new Set([...HEADS.f, ...HEADS.m, ...BODIES.f, ...BODIES.m])];

export const SKIN_TONES = ['#f7d7bd', '#efbf9b', '#d9a077', '#b97d52', '#8d5b3a', '#5f3d2a'];
export const HAIR_COLORS = ['#2b2a2f', '#4b3426', '#7c4f2f', '#c25a30', '#e4b75c', '#b4b7bf', '#df7aa8', '#4f7fd9'];
export const TOP_COLORS = ['#3b5bdb', '#d6453d', '#2f9e6a', '#f2b443', '#8b5cf6', '#ec7a3c', '#1f2937', '#f4f4f5', '#0f9fb5', '#db5c95'];
export const BOTTOM_COLORS = ['#26324a', '#3e5f9c', '#2b2b30', '#6b7280', '#7a5a3a', '#c9b48f', '#355e3b', '#7b2d3b'];

/** Visual equivalente ao personagem original do kit (mesmas cores), ponto de partida do editor. */
export function defaultLook(kitModel: string): Look {
  const model = kitModel.replace('character-', '');
  const gender: Gender = model.startsWith('female') ? 'f' : 'm';
  const body = BODIES[gender].includes(model) ? model : BODIES[gender][0];
  const map = ((gltf(characterUrl(`character-${body}`)).scene.getObjectByName('body-mesh') as THREE.Mesh).material as THREE.MeshStandardMaterial).map!;
  const pal = sourcePalette(map);
  const base = (block: string | undefined, fallback: string) => {
    if (!block) return fallback;
    const x = +block[0] * (pal.width / 8) + 8, y = +block[1] * (pal.height / 4) + 8, i = (y * pal.width + x) * 4;
    return '#' + [0, 1, 2].map((k) => pal.data[i + k].toString(16).padStart(2, '0')).join('');
  };
  const hp = PARTS[model], bp = PARTS[body];
  return { gender, head: model, body, skin: base(hp.skin, SKIN_TONES[1]), hair: base(hp.hair[0], HAIR_COLORS[0]), top: base(bp.top[0], TOP_COLORS[0]), bottom: base(bp.bottom[0], BOTTOM_COLORS[0]) };
}

// ---------- texturas recoloridas ----------

let palette: ImageData | null = null;
const texCache = new Map<string, THREE.Texture>();

function sourcePalette(map: THREE.Texture) {
  if (palette) return palette;
  const img = map.image as CanvasImageSource & { width: number; height: number };
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  palette = g.getImageData(0, 0, c.width, c.height);
  return palette;
}

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Cópia da paleta com cada bloco listado trocado pela cor pedida, mantendo o sombreado. */
function recolored(map: THREE.Texture, swaps: Record<string, string>) {
  const key = Object.entries(swaps).sort().map(([k, v]) => k + v).join();
  const hit = texCache.get(key);
  if (hit) return hit;
  const src = sourcePalette(map);
  const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
  const bw = src.width / 8, bh = src.height / 4;
  for (const [block, hex] of Object.entries(swaps)) {
    const bx = +block[0], by = +block[1];
    const x0 = bx * bw, y0 = by * bh;
    const bi = ((y0 + 8) * src.width + x0 + 8) * 4;
    const baseL = Math.max(1, lum(src.data[bi], src.data[bi + 1], src.data[bi + 2]));
    // a textura está em sRGB: usa os valores do hex direto, sem conversão para linear
    const n = parseInt(hex.slice(1), 16);
    const tr = (n >> 16) & 255, tg = (n >> 8) & 255, tb = n & 255;
    for (let y = y0; y < y0 + bh; y++)
      for (let x = x0; x < x0 + bw; x++) {
        const i = (y * src.width + x) * 4;
        const k = lum(out.data[i], out.data[i + 1], out.data[i + 2]) / baseL;
        out.data[i] = tr * k; out.data[i + 1] = tg * k; out.data[i + 2] = tb * k;
      }
  }
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d')!.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = map.flipY;
  t.colorSpace = map.colorSpace;
  t.magFilter = map.magFilter;
  t.minFilter = map.minFilter;
  // as combinações experimentadas no editor se acumulam; descarta as antigas
  if (texCache.size > 120) {
    for (const [k, old] of texCache) { old.dispose(); texCache.delete(k); if (texCache.size <= 60) break; }
  }
  texCache.set(key, t);
  return t;
}

function retexture(mesh: THREE.Mesh, swaps: Record<string, string>) {
  const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
  mat.map = recolored(mat.map!, swaps);
  mesh.material = mat;
}

/** Monta o personagem: corpo e animações de `look.body`, cabeça de `look.head`, cores trocadas. */
export function buildCharacter(look: Look) {
  const bodySrc = gltf(characterUrl(`character-${look.body}`));
  const headSrc = gltf(characterUrl(`character-${look.head}`));
  const model = cloneSkinned(bodySrc.scene);
  let headMesh: THREE.SkinnedMesh | undefined, bodyMesh: THREE.SkinnedMesh | undefined;
  model.traverse((o) => {
    if (o.name === 'head-mesh') headMesh = o as THREE.SkinnedMesh;
    if (o.name === 'body-mesh') bodyMesh = o as THREE.SkinnedMesh;
  });
  if (look.head !== look.body) {
    const srcHead = headSrc.scene.getObjectByName('head-mesh') as THREE.SkinnedMesh;
    headMesh!.geometry = srcHead.geometry;
  }
  const hp = PARTS[look.head], bp = PARTS[look.body];
  const headSwaps: Record<string, string> = { [hp.skin]: look.skin };
  for (const b of hp.hair) if (b !== hp.skin) headSwaps[b] = look.hair;
  const bodySwaps: Record<string, string> = { [bp.skin]: look.skin };
  for (const b of bp.top) bodySwaps[b] = look.top;
  for (const b of bp.bottom) if (!bp.top.includes(b)) bodySwaps[b] = look.bottom;
  retexture(headMesh!, headSwaps);
  retexture(bodyMesh!, bodySwaps);
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; }
  });
  return { model, animations: bodySrc.animations };
}
