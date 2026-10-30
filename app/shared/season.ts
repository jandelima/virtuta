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
  // conferidos no mapa de caminhos: chão livre, com meio metro de folga em volta
  { space: 'sala', x: 2.0, z: 5.5 },
  { space: 'sala', x: 5.0, z: 5.5 },
  { space: 'sala', x: 3.0, z: 10.0 },
  { space: 'sala', x: 6.75, z: 3.5 },
  { space: 'sala', x: 7.0, z: 12.25 },
  { space: 'sala', x: 2.5, z: 14.5 },
  { space: 'sala', x: 4.75, z: 14.5 },
  { space: 'sala', x: 1.75, z: 1.25 },
  { space: 'hub', x: 21.5, z: 2.0 },
  { space: 'hub', x: 22.25, z: 5.0 },
  { space: 'hub', x: 26.0, z: 3.25 },
  { space: 'hub', x: 28.75, z: 1.5 },
  { space: 'hub', x: 29.0, z: 4.5 },
  { space: 'hub', x: 27.5, z: 2.0 },
];
