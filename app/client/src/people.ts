import type { StoredLook } from '../../shared/protocol';

// Como cada pessoa aparece na interface. "Em reunião" vem de estar na sala de reunião.

export type Status = 'disp' | 'foco' | 'reuniao' | 'afk' | 'visita';

export interface Person {
  id: string;
  name: string;
  /** Nome curto do balão sobre o avatar: o primeiro nome (com a inicial do sobrenome se houver xará). */
  short: string;
  model: string;
  color: string;
  status: Status;
  note?: string;
  me?: boolean;
  guest?: boolean;
  /** Conexão instável: o servidor aguarda a volta da pessoa. */
  unstable?: boolean;
  look?: StoredLook | null;
  /** Mão levantada. */
  hand?: boolean;
}

export const STATUS_COLOR: Record<Status, string> = {
  disp: '#22c55e',
  foco: '#8b5cf6',
  reuniao: '#ef4444',
  afk: '#98a2b3',
  visita: '#f59e0b',
};

export const STATUS_LABEL: Record<Status, string> = {
  disp: 'Disponível',
  foco: 'Em foco',
  reuniao: 'Em reunião',
  afk: 'Ausente',
  visita: 'Visitante',
};
