// Temas de época. O servidor decide pelo relógio de Brasília e avisa os clientes; a decoração,
// as fantasias e a caça às abóboras só existem enquanto o tema está ativo.

export type Season = 'halloween';

/** Halloween: de 30/10 a 6/11, no horário de Brasília. */
export function seasonAt(d: Date): Season | null {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', month: 'numeric', day: 'numeric' }).formatToParts(d);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  if ((month === 10 && day >= 30) || (month === 11 && day <= 6)) return 'halloween';
  return null;
}

/** Abóbora da caça: aparece num desses lugares e some quando alguém pega (ou o tempo acaba). */
export interface Pumpkin { id: string; space: 'sala' | 'hub'; x: number; z: number; until: number }
export interface Hunt { pumpkin: Pumpkin | null; scores: Record<string, number> }

/** Esconderijos no chão livre da sala da equipe e do hub (a reunião fica de fora, para não atrapalhar chamadas). */
export const HUNT_SPOTS: { space: 'sala' | 'hub'; x: number; z: number }[] = [
  { space: 'sala', x: 2.0, z: 5.8 },
  { space: 'sala', x: 6.6, z: 10.2 },
  { space: 'sala', x: 0.45, z: 14.9 },
  { space: 'sala', x: 7.7, z: 14.7 },
  { space: 'sala', x: 0.45, z: 7.0 },
  { space: 'sala', x: 4.3, z: 11.1 },
  { space: 'sala', x: 7.5, z: 7.4 },
  { space: 'hub', x: 20.55, z: 2.4 },
  { space: 'hub', x: 29.4, z: 2.3 },
  { space: 'hub', x: 24.6, z: 6.4 },
  { space: 'hub', x: 28.9, z: 6.45 },
  { space: 'hub', x: 22.85, z: 5.3 },
];
