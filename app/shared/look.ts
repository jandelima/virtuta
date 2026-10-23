// Visual do avatar, compartilhado entre servidor (validação) e cliente (montagem).
// As peças vêm dos personagens do kit: o cabelo de um, o rosto de outro e a roupa de um terceiro.
// Cada parte tem a sua cor, e os acessórios (óculos, barba, chapéu, fone, brincos) são opcionais.

export const HAIR_STYLES = ['male-f', 'male-a', 'male-d', 'male-e', 'female-e', 'female-a', 'female-c', 'female-d', 'female-b', 'female-f', 'none'] as const;
export const FACES = ['male-d', 'female-b', 'female-f', 'male-b', 'male-f'] as const;
export const OUTFITS = ['male-a', 'male-b', 'female-b', 'female-e', 'male-e', 'female-f', 'male-f', 'female-c', 'female-d', 'male-d'] as const;
export const GLASSES = ['none', 'grau', 'redondos', 'escuros'] as const;
export const FACIAL = ['none', 'bigode', 'cavanhaque', 'barba'] as const;
export const HATS = ['none', 'bone', 'gorro'] as const;

export type HairStyle = (typeof HAIR_STYLES)[number];
export type Face = (typeof FACES)[number];
export type Outfit = (typeof OUTFITS)[number];

export interface Look {
  hairStyle: HairStyle;
  face: Face;
  outfit: Outfit;
  skin: string;
  hair: string;
  top: string;
  /** Gravata, colar, suspensório, punhos: a segunda cor da roupa (se ela tiver). */
  detail: string;
  bottom: string;
  shoes: string;
  glasses: (typeof GLASSES)[number];
  frame: string;
  facial: (typeof FACIAL)[number];
  hat: (typeof HATS)[number];
  hatColor: string;
  headphones: boolean;
  phonesColor: string;
  earrings: boolean;
}

/**
 * Visual como é guardado: qualquer campo pode faltar (o cliente completa com as cores originais
 * da roupa). Avatares salvos antes desta versão têm `head`/`body` no lugar de `hairStyle`/`outfit`.
 */
export type StoredLook = Partial<Look> & { head?: string; body?: string; gender?: string };

const COLOR_KEYS = ['skin', 'hair', 'top', 'detail', 'bottom', 'shoes', 'frame', 'hatColor', 'phonesColor'] as const;
const hex = (v: unknown) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined;
const pick = <T extends string>(list: readonly T[], v: unknown) => list.find((x) => x === v);

/** Aceita só campos conhecidos e valores válidos; converte o formato antigo. Nunca lança. */
export function sanitizeLook(raw: unknown): StoredLook | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: StoredLook = {};
  const hairStyle = pick(HAIR_STYLES, r.hairStyle) ?? pick(HAIR_STYLES, r.head);
  // no formato antigo, a cabeça trazia cabelo e rosto juntos
  const face = pick(FACES, r.face) ?? (typeof r.head === 'string' ? nearestFace(r.head) : undefined);
  const outfit = pick(OUTFITS, r.outfit) ?? pick(OUTFITS, r.body);
  if (hairStyle) out.hairStyle = hairStyle;
  if (face) out.face = face;
  if (outfit) out.outfit = outfit;
  for (const k of COLOR_KEYS) { const c = hex(r[k]); if (c) out[k] = c; }
  const g = pick(GLASSES, r.glasses); if (g) out.glasses = g;
  const f = pick(FACIAL, r.facial); if (f) out.facial = f;
  const h = pick(HATS, r.hat); if (h) out.hat = h;
  if (typeof r.headphones === 'boolean') out.headphones = r.headphones;
  if (typeof r.earrings === 'boolean') out.earrings = r.earrings;
  // no formato antigo, óculos e barba vinham desenhados em alguns personagens: viram opções
  if (typeof r.head === 'string' && r.hairStyle === undefined) Object.assign(out, { ...kitExtras(r.head), ...out });
  return Object.keys(out).length ? out : null;
}

/** Óculos, barba e brincos que o personagem do kit já trazia na cabeça. */
export function kitExtras(kit: string): StoredLook {
  const m = kit.replace('character-', '');
  if (m === 'male-a' || m === 'male-e') return { glasses: 'redondos' };
  if (m === 'male-b') return { facial: 'barba' };
  if (m === 'female-d') return { earrings: true };
  return {};
}

/** Rosto equivalente ao de um personagem do kit (os rostos se repetem entre eles). */
export function nearestFace(kit: string): Face {
  const m = kit.replace('character-', '');
  if (pick(FACES, m)) return m as Face;
  return m.startsWith('female') ? 'female-b' : 'male-d';
}
