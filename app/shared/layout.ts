// Planta do escritório, compartilhada por cliente (desenho 3D) e servidor (regras de conversa).
// 1 unidade = 1 m. x cresce para a direita (leste), z para baixo (sul).
//
// Cada ambiente é uma cena própria: quem está nele vê só ele. Os três ficam em trechos
// distantes do mesmo plano, então distância, áreas e regras de conversa continuam valendo
// sem saber de cenas; as portas levam de um ambiente a outro.
//
//   Sala da equipe        Hub                       Sala de reunião
//   ┌────────────┐        ┌──────────────[▯]──┐     ┌────────────────┐
//   │            ▯ ←────→ ▯ café   jogo       │     │                │
//   │            │        │       sugestões   │     │                │
//   └────────────┘        └──entrada──────────┘     └──[▯]───────────┘
//                         (a porta do fundo do hub leva à porta da reunião)

export interface Rect { x1: number; z1: number; x2: number; z2: number }

export type SpaceId = 'sala' | 'hub' | 'reuniao';
export interface Area extends Rect {
  id: SpaceId;
  name: string;
  hint: string;
}

export const SALA: Rect = { x1: 0, z1: 0, x2: 8.4, z2: 15.6 };
export const HUB: Rect = { x1: 20, z1: 0, x2: 30, z2: 7 };
export const REUNIAO: Rect = { x1: 40, z1: 0, x2: 48.4, z2: 6.8 };

export const AREAS: Area[] = [
  { id: 'sala', name: 'Sala da equipe', ...SALA, hint: 'Mesas de cada integrante' },
  { id: 'hub', name: 'Hub', ...HUB, hint: 'Café, jogo e caixa de sugestões' },
  { id: 'reuniao', name: 'Sala de reunião', ...REUNIAO, hint: 'Chamada única para quem está dentro' },
];

/** Ambiente de um ponto; a margem cobre o vão das portas, um pouco além da parede. */
export function areaAt(x: number, z: number): Area | undefined {
  return AREAS.find((a) => x >= a.x1 - 1 && x <= a.x2 + 1 && z >= a.z1 - 1 && z <= a.z2 + 1);
}

export function inside(r: Rect, x: number, z: number) {
  return x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2;
}

/**
 * Porta entre ambientes: um vão em uma das paredes (`wall`: n, s, e, w) do ambiente `space`,
 * de `a1` a `a2` ao longo dela. Quem atravessa aparece do lado de dentro da porta `to`.
 */
export interface Door { id: string; space: SpaceId; wall: 'n' | 's' | 'e' | 'w'; a1: number; a2: number; to: string }
export const DOORS: Door[] = [
  { id: 'sala-hub', space: 'sala', wall: 'e', a1: 0.1, a2: 1.0, to: 'hub-sala' },
  { id: 'hub-sala', space: 'hub', wall: 'w', a1: 1.0, a2: 2.0, to: 'sala-hub' },
  { id: 'hub-reuniao', space: 'hub', wall: 'n', a1: 26.6, a2: 27.6, to: 'reuniao-hub' },
  { id: 'reuniao-hub', space: 'reuniao', wall: 's', a1: 40.6, a2: 41.6, to: 'hub-reuniao' },
];

/** Geometria de uma porta: centro no plano da parede e direção para dentro do ambiente. */
export function doorGeom(d: Door) {
  const r = AREAS.find((a) => a.id === d.space)!;
  const mid = (d.a1 + d.a2) / 2;
  const at = { n: r.z1, s: r.z2, e: r.x2, w: r.x1 }[d.wall];
  const vertical = d.wall === 'e' || d.wall === 'w';
  const n = { n: { x: 0, z: 1 }, s: { x: 0, z: -1 }, e: { x: -1, z: 0 }, w: { x: 1, z: 0 } }[d.wall];
  const c = vertical ? { x: at, z: mid } : { x: mid, z: at };
  return { c, n, vertical, at, width: d.a2 - d.a1, rot: Math.atan2(n.x, n.z) };
}

/** Folga entre o quadro e a primeira fileira de mesas da sala. */
export const BOARD_GAP = 0.9;

/** Estações de trabalho da sala: posição da mesa e lado em que a pessoa senta. */
export interface Desk { index: number; x: number; z: number; side: 'n' | 's' }
/** Distância entre o centro de uma ilha de mesas e o da seguinte (com o corredor entre elas). */
const ISLAND_PITCH = 4.4;
/** Três ilhas iguais, uma abaixo da outra; cada uma tem 3 mesas de cada lado. */
export const DESKS: Desk[] = [0, 1, 2].flatMap((k) =>
  [0.95, 2.75, 4.55].flatMap((x, i) => [
    { index: k * 6 + i * 2, x, z: 2.1 + BOARD_GAP + k * ISLAND_PITCH, side: 'n' as const },
    { index: k * 6 + i * 2 + 1, x, z: 2.9 + BOARD_GAP + k * ISLAND_PITCH, side: 's' as const },
  ]),
);

/** Onde aparece quem entra sem mesa (quem tem mesa chega sentado nela). */
export const ENTRY = { x: 6.6, z: 1.6 };
/** Visitantes chegam pela entrada do hub e esperam ali. */
export const GUEST_ENTRY = { x: HUB.x1 + 2.0, z: HUB.z2 - 0.9 };
/** Ponto do café para quem fica ausente: na frente da máquina de café do hub. */
export const CAFE_SPOT = { x: HUB.x1 + 0.75, z: 1.2 };

/** Distâncias de conversa (m) e tempos (s): entrar exige permanência; sair tem tolerância. */
export const PROX = { join: 1.4, leave: 2.2, dwell: 0.5, grace: 0.7 };
