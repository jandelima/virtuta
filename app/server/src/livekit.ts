import { createHmac } from 'node:crypto';
import { config } from './config';

// LiveKit sem o SDK do servidor: tokens JWT HS256 e chamadas à API (Twirp) do próprio LiveKit.
// Cada conversa é uma sala de mídia separada e o token só abre a sala da conversa em que a
// pessoa está agora; quem sai de uma conversa é tirado da sala pelo servidor. Assim ninguém
// consegue ouvir uma conversa da qual não participa, mesmo com um navegador modificado.

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

function jwt(claims: object) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(claims);
  const sig = createHmac('sha256', config.livekit.apiSecret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/** Nome da sala de mídia de uma conversa (ou de um anúncio). */
export const mediaRoom = (id: string) => `virtuta-${id}`;

/**
 * Token para entrar numa sala. Vale poucos minutos: só é usado para entrar, e o LiveKit
 * renova sozinho a credencial de quem já está dentro.
 */
export function joinToken(identity: string, name: string, room: string, canPublish = true) {
  const nowS = Math.floor(Date.now() / 1000);
  return jwt({
    iss: config.livekit.apiKey,
    sub: identity,
    name,
    nbf: nowS - 10,
    exp: nowS + 10 * 60,
    video: { room, roomJoin: true, canPublish, canSubscribe: true, canPublishData: canPublish },
  });
}

async function call(method: string, room: string, body: object) {
  const nowS = Math.floor(Date.now() / 1000);
  const token = jwt({ iss: config.livekit.apiKey, nbf: nowS - 10, exp: nowS + 60, video: { room, roomAdmin: true, roomCreate: true } });
  const r = await fetch(`${config.livekit.apiUrl}/twirp/livekit.RoomService/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  // a pessoa (ou a sala) já não existe: é o resultado que se queria
  if (!r.ok && r.status !== 404) throw new Error(`LiveKit ${method}: ${r.status}`);
}

// sem LiveKit no ar (desenvolvimento), avisa no máximo uma vez por minuto
let warnedAt = 0;
const warn = (e: unknown) => { if (Date.now() - warnedAt > 60_000) { warnedAt = Date.now(); console.warn(String(e)); } };

/** Tira alguém de uma sala de mídia (saiu da conversa ou perdeu o acesso). */
export function kick(room: string, identity: string) {
  call('RemoveParticipant', room, { room, identity }).catch(warn);
}

/** Fecha uma sala de mídia, tirando todos que estiverem nela. */
export function closeRoom(room: string) {
  call('DeleteRoom', room, { room }).catch(warn);
}
