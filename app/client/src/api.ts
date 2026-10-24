// Chamadas HTTP ao servidor.

import type { PublicUser, StoredLook, Suggestion, SuggestionKind, SuggestionStatus } from '../../shared/protocol';

export interface MeResponse {
  config: { googleEnabled: boolean; devLogin: boolean; officeName: string; domain: string };
  user?: { id: string; name: string; role: 'member' | 'admin' | 'guest' };
  email?: string;
}

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    signal,
  });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok && r.status !== 401) throw new Error(data.error ?? `Erro ${r.status}`);
  return data;
}

export const api = {
  me: () => call<MeResponse>('GET', '/api/me'),
  saveLook: async (look: StoredLook): Promise<PublicUser> => {
    const result = await call<{ user?: PublicUser }>('POST', '/api/me/look', { look }, AbortSignal.timeout(15_000));
    if (!result.user) throw new Error('Sua sessão expirou. Entre novamente.');
    return result.user;
  },
  devLogin: (name: string, email?: string) => call<{ ok: boolean }>('POST', '/api/auth/dev', { name, email }),
  logout: () => call('POST', '/api/auth/logout'),
  mediaToken: () => call<{ url: string; token: string }>('GET', '/api/media-token'),
  invite: (name: string, hours: number) => call<{ url: string; expiresAt: number }>('POST', '/api/invites', { name, hours }),
  inviteInfo: (token: string) => call<{ name: string; host: string; expiresAt: number; officeName: string; error?: string }>('GET', `/api/invite?token=${encodeURIComponent(token)}`),
  joinInvite: (token: string, name: string) => call<{ ok: boolean }>('POST', '/api/invite/join', { token, name }),
  admin: () => call<AdminData>('GET', '/api/admin'),
  adminMember: (b: { id: string; role?: string; desk?: number | null; active?: boolean; name?: string }) => call('POST', '/api/admin/member', b),
  adminRevoke: (token: string) => call('POST', '/api/admin/invite/revoke', { token }),
  adminSettings: (b: { officeName: string }) => call('POST', '/api/admin/settings', b),
  adminSuggestion: (id: number, status: SuggestionStatus) => call('POST', '/api/admin/suggestion', { id, status }),
  suggest: (kind: SuggestionKind, text: string) => call<{ ok: boolean }>('POST', '/api/suggestions', { kind, text }),
  mySuggestions: () => call<{ suggestions: Suggestion[] }>('GET', '/api/suggestions'),
};

export interface AdminData {
  members: { id: string; name: string; email: string; role: 'member' | 'admin'; desk: number | null; active: boolean; online: boolean }[];
  invites: { token: string; name: string; host: string; createdAt: number; expiresAt: number; revoked: boolean }[];
  settings: { officeName: string };
  desks: number[];
  suggestions: Suggestion[];
}
