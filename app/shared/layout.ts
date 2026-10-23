// Planta do escritório, compartilhada por cliente (desenho 3D) e servidor (regras de conversa).
// 1 unidade = 1 m. x cresce para a direita (leste), z para baixo (sul).
//
//  ┌──────────────┬────────────────────────┬──────────────────┐
//  │              │                        │                  │
//  │  Sala da     │ Lounge                 │ Sala de reunião  │
//  │  equipe      │ (sai da porta da sala) │ (vidro)          │
//  │              │                        ├──────────────────┤
//  ├──────────┬───┴────────────────────────┤ Lazer            │
//  │ Recepção │ Café                       │                  │
//  └─entrada──┴────────────────────────────┴──────────────────┘

export const W = 24;
export const D = 12;

export interface Rect { x1: number; z1: number; x2: number; z2: number }

export type AreaKind = 'room' | 'region';
export interface Area extends Rect {
  id: string;
  name: string;
  kind: AreaKind;
  /** Áreas acústicas diferentes nunca formam conversa juntas (paredes). */
  acoustic: 'sala' | 'salao' | 'reuniao';
  hint: string;
}

export const SALA: Rect = { x1: 0, z1: 0, x2: 8.4, z2: 7.8 };
export const REUNIAO: Rect = { x1: 15.6, z1: 0, x2: W, z2: 6.8 };

export const AREAS: Area[] = [
  { id: 'sala', name: 'Sala da equipe', kind: 'room', acoustic: 'sala', ...SALA, hint: 'Mesas de cada integrante' },
  { id: 'reuniao', name: 'Sala de reunião', kind: 'room', acoustic: 'reuniao', ...REUNIAO, hint: 'Chamada única para quem está dentro' },
  { id: 'lounge', name: 'Lounge', kind: 'region', acoustic: 'salao', x1: 8.4, z1: 0, x2: 15.6, z2: 7.8, hint: 'Pausa para conversar' },
  { id: 'recepcao', name: 'Recepção', kind: 'region', acoustic: 'salao', x1: 0, z1: 7.8, x2: 6, z2: D, hint: 'Visitantes aguardam aqui' },
  { id: 'cafe', name: 'Café', kind: 'region', acoustic: 'salao', x1: 6, z1: 7.8, x2: 15.6, z2: D, hint: 'Ausente: fui tomar café' },
  { id: 'lazer', name: 'Lazer', kind: 'region', acoustic: 'salao', x1: 15.6, z1: 6.8, x2: W, z2: D, hint: 'Jogos rápidos' },
];

export function areaAt(x: number, z: number): Area | undefined {
  // salas primeiro: são fechadas e têm prioridade sobre as regiões vizinhas
  return AREAS.find((a) => a.kind === 'room' && inside(a, x, z)) ?? AREAS.find((a) => inside(a, x, z));
}

export function inside(r: Rect, x: number, z: number) {
  return x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2;
}

/** Folga entre o quadro e a primeira fileira de mesas da sala. */
export const BOARD_GAP = 0.9;

/** Estações de trabalho da sala: posição da mesa e lado em que a pessoa senta. */
export interface Desk { index: number; x: number; z: number; side: 'n' | 's' }
export const DESKS: Desk[] = [
  ...[0.95, 2.75, 4.55].flatMap((x, i) => [
    { index: i * 2, x, z: 2.1 + BOARD_GAP, side: 'n' as const },
    { index: i * 2 + 1, x, z: 2.9 + BOARD_GAP, side: 's' as const },
  ]),
  ...[1.3, 3.5, 5.7].map((x, i) => ({ index: 6 + i, x, z: SALA.z2 - 0.4, side: 'n' as const })),
];

/** Onde a pessoa aparece ao entrar. */
export const ENTRY = { x: 2.6, z: 10.6 };
export const SALA_DOOR = { x: SALA.x2, z1: 0.1, z2: 1.0 };
/** Porta da sala de reunião (parede sul, perto do canto oeste). */
export const REUNIAO_DOOR = { z: REUNIAO.z2, x1: 16.2, x2: 17.2 };
/** Ponto do café para quem fica ausente. */
export const CAFE_SPOT = { x: 7.3, z: 9.1 };

/** Distâncias de conversa (m) e tempos (s): entrar exige permanência; sair tem tolerância. */
export const PROX = { join: 1.4, leave: 2.2, dwell: 0.5, grace: 0.7 };
