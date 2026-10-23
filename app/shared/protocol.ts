// Mensagens trocadas pelo WebSocket entre cliente e servidor.

export type Status = 'disp' | 'foco' | 'afk' | 'visita';

export interface Look {
  gender: 'f' | 'm';
  head: string;
  body: string;
  skin: string;
  hair: string;
  top: string;
  bottom: string;
}

export interface PublicUser {
  id: string;
  name: string;
  role: 'member' | 'admin' | 'guest';
  desk: number | null;
  look: Look | null;
  /** Modelo padrão do kit, usado enquanto a pessoa não personaliza o avatar. */
  model: string;
  color: string;
}

export interface Presence {
  id: string;
  status: Status;
  note: string;
  x: number;
  z: number;
  rot: number;
  seat: string | null;
  /** Conexão caiu e o servidor aguarda a volta (diferente de ausente). */
  unstable: boolean;
  /** Visitante ainda não admitido. */
  waiting: boolean;
}

export interface Conv {
  id: string;
  kind: 'prox' | 'room' | 'direct';
  members: string[];
}

export interface Note { id: number; from: string; fromName: string; to: string; text: string; createdAt: number; readAt: number | null }

export interface BoardElement {
  id: string;
  kind: 'stroke' | 'sticky' | 'text' | 'rect' | 'ellipse' | 'arrow';
  x: number;
  y: number;
  w?: number;
  h?: number;
  points?: number[];
  color: string;
  size?: number;
  text?: string;
  z: number;
  by: string;
}
export interface BoardSummary { id: string; title: string; scope: string; updatedAt: number; updatedBy: string }
export interface BoardCopy { id: number; boardId: string; name: string; createdAt: number; createdBy: string }

export interface RadioItem { id: number; videoId: string; title: string; addedBy: string }
export interface RadioState { queue: RadioItem[]; current: RadioItem | null; startedAt: number; listeners: string[] }

export interface FocusBlock { kind: 'foco' | 'pausa'; minutes: number }
export interface FocusSession {
  id: string;
  owner: string;
  startedAt: number;
  blocks: FocusBlock[];
  participants: string[];
  /** Minutos de foco acumulados pela equipe nesta sessão (faz o jardim crescer). */
  grown: number;
}


export interface GameState { id: string; board: string[]; players: [string | null, string | null]; turn: 0 | 1; winner: string | null; draw: boolean }

export interface Settings { officeName: string }

/** Cliente → servidor */
export type ClientMsg =
  | { t: 'move'; x: number; z: number; rot: number; seat: string | null }
  | { t: 'status'; status: Status; note: string }
  | { t: 'look'; look: Look }
  | { t: 'react'; emoji: string }
  | { t: 'leaveConv' }
  | { t: 'knock'; to: string; text: string }
  | { t: 'knockReply'; to: string; accept: boolean }
  | { t: 'door'; open: boolean }
  | { t: 'doorKnock' }
  | { t: 'doorReply'; who: string; accept: boolean }
  | { t: 'note'; to: string; text: string }
  | { t: 'noteRead'; id: number }
  | { t: 'boardOpen'; id: string }
  | { t: 'boardClose'; id: string }
  | { t: 'boardOp'; id: string; put?: BoardElement[]; del?: string[] }
  | { t: 'boardCursor'; id: string; x: number; y: number }
  | { t: 'boardCopy'; id: string; name: string }
  | { t: 'boardRestore'; copyId: number }
  | { t: 'radioJoin' }
  | { t: 'radioLeave' }
  | { t: 'radioAdd'; url: string }
  | { t: 'radioSkip'; itemId: number }
  | { t: 'radioEnded'; itemId: number }
  | { t: 'radioError'; itemId: number }
  | { t: 'focusStart'; blocks: FocusBlock[] }
  | { t: 'focusJoin' }
  | { t: 'focusLeave' }
  | { t: 'gameJoin' }
  | { t: 'gameMove'; cell: number }
  | { t: 'gameLeave' }
  | { t: 'gameReset' }
  | { t: 'pauseInvite' }
  | { t: 'admit'; guest: string; accept: boolean }
  | { t: 'ping' };

/** Servidor → cliente */
export type ServerMsg =
  | {
      t: 'init';
      you: string;
      users: PublicUser[];
      presence: Presence[];
      doorOpen: boolean;
      radio: RadioState;
      focus: FocusSession | null;
      notes: Note[];
      noteCounts: Record<string, number>;
      game: GameState;
      settings: Settings;
      /** Conteúdo dos quadros fixos das paredes, para desenhar no mapa. */
      walls: Record<string, BoardElement[]>;
      serverTime: number;
    }
  | { t: 'user'; user: PublicUser }
  | { t: 'join'; presence: Presence }
  | { t: 'leave'; id: string }
  | { t: 'moves'; m: [string, number, number, number, string | null][] }
  | { t: 'presence'; presence: Presence }
  | { t: 'conv'; conv: Conv | null }
  | { t: 'convs'; convs: Conv[] }
  | { t: 'react'; from: string; emoji: string }
  | { t: 'knock'; from: string; text: string }
  | { t: 'knockReply'; from: string; accept: boolean }
  | { t: 'door'; open: boolean; by: string }
  | { t: 'doorKnock'; who: string }
  | { t: 'doorReply'; accept: boolean }
  | { t: 'note'; note: Note }
  | { t: 'noteCounts'; counts: Record<string, number> }
  | { t: 'board'; id: string; title: string; elements: BoardElement[]; copies: BoardCopy[]; editors: string[] }
  | { t: 'boardOp'; id: string; put?: BoardElement[]; del?: string[]; by: string }
  | { t: 'boardCursor'; id: string; by: string; x: number; y: number }
  | { t: 'boardEditors'; id: string; editors: string[] }
  | { t: 'boardCopies'; id: string; copies: BoardCopy[] }
  | { t: 'boards'; boards: BoardSummary[] }
  | { t: 'radio'; radio: RadioState; serverTime: number }
  | { t: 'focus'; focus: FocusSession | null; serverTime: number }
  | { t: 'game'; game: GameState }
  | { t: 'pauseInvite'; from: string }
  | { t: 'guestArrived'; guest: string; name: string; host: string }
  | { t: 'admitted' }
  | { t: 'refused' }
  | { t: 'toast'; text: string }
  | { t: 'replaced' }
  | { t: 'pong'; serverTime: number };
