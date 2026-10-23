import Database from 'better-sqlite3';
import { join } from 'node:path';
import { config } from './config';
import type { BoardCopy, BoardElement, BoardSummary, Look, Note } from '../../shared/protocol';
import { DESKS } from '../../shared/layout';

// Banco SQLite em arquivo único: integrantes, sessões, convites, bilhetes e quadros.

export const db = new Database(join(config.dataDir, 'virtuta.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  desk INTEGER,
  look TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  guest INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS guests (
  id TEXT PRIMARY KEY,
  invite TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user TEXT NOT NULL,
  to_user TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  scope TEXT NOT NULL,
  elements TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS board_copies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id TEXT NOT NULL,
  name TEXT NOT NULL,
  elements TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS notes_to ON notes(to_user, read_at);
`);

export interface UserRow { id: string; email: string; name: string; role: 'member' | 'admin'; desk: number | null; look: string | null; active: number; created_at: number }

const now = () => Date.now();

// ---------- integrantes ----------
export const users = {
  all: () => db.prepare('SELECT * FROM users ORDER BY created_at').all() as UserRow[],
  get: (id: string) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined,
  byEmail: (email: string) => db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined,
  create(u: { id: string; email: string; name: string; role: 'member' | 'admin'; desk: number | null }) {
    db.prepare('INSERT INTO users (id, email, name, role, desk, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(u.id, u.email, u.name, u.role, u.desk, now());
  },
  update(id: string, f: Partial<{ name: string; role: string; desk: number | null; look: Look | null; active: boolean }>) {
    if (f.name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(f.name, id);
    if (f.role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(f.role, id);
    if (f.desk !== undefined) db.prepare('UPDATE users SET desk = ? WHERE id = ?').run(f.desk, id);
    if (f.look !== undefined) db.prepare('UPDATE users SET look = ? WHERE id = ?').run(f.look ? JSON.stringify(f.look) : null, id);
    if (f.active !== undefined) db.prepare('UPDATE users SET active = ? WHERE id = ?').run(f.active ? 1 : 0, id);
  },
};

// ---------- sessões ----------
export const sessions = {
  create(token: string, userId: string, guest: boolean, days: number) {
    db.prepare('INSERT INTO sessions (token, user_id, guest, expires_at) VALUES (?, ?, ?, ?)').run(token, userId, guest ? 1 : 0, now() + days * 864e5);
  },
  get(token: string) {
    const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as { token: string; user_id: string; guest: number; expires_at: number } | undefined;
    if (!s || s.expires_at < now()) return undefined;
    return s;
  },
  delete: (token: string) => db.prepare('DELETE FROM sessions WHERE token = ?').run(token),
  deleteForUser: (userId: string) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId),
  purge: () => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now()),
};

// ---------- convites de visitantes ----------
export interface InviteRow { token: string; name: string; created_by: string; created_at: number; expires_at: number; revoked: number }
export const invites = {
  create(i: { token: string; name: string; createdBy: string; hours: number }) {
    db.prepare('INSERT INTO invites (token, name, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(i.token, i.name, i.createdBy, now(), now() + i.hours * 36e5);
  },
  get: (token: string) => db.prepare('SELECT * FROM invites WHERE token = ?').get(token) as InviteRow | undefined,
  valid(token: string) {
    const i = invites.get(token);
    return i && !i.revoked && i.expires_at > now() ? i : undefined;
  },
  all: () => db.prepare('SELECT * FROM invites ORDER BY created_at DESC LIMIT 100').all() as InviteRow[],
  revoke: (token: string) => db.prepare('UPDATE invites SET revoked = 1 WHERE token = ?').run(token),
};
export const guests = {
  create: (id: string, invite: string, name: string) => db.prepare('INSERT INTO guests (id, invite, name, created_at) VALUES (?, ?, ?, ?)').run(id, invite, name, now()),
  get: (id: string) => db.prepare('SELECT * FROM guests WHERE id = ?').get(id) as { id: string; invite: string; name: string } | undefined,
};

// ---------- bilhetes ----------
interface NoteRow { id: number; from_user: string; to_user: string; text: string; created_at: number; read_at: number | null }
const noteOut = (r: NoteRow, fromName: string): Note => ({ id: r.id, from: r.from_user, fromName, to: r.to_user, text: r.text, createdAt: r.created_at, readAt: r.read_at });
export const notes = {
  add(from: string, to: string, text: string, fromName: string) {
    const info = db.prepare('INSERT INTO notes (from_user, to_user, text, created_at) VALUES (?, ?, ?, ?)').run(from, to, text, now());
    return noteOut(db.prepare('SELECT * FROM notes WHERE id = ?').get(info.lastInsertRowid) as NoteRow, fromName);
  },
  forUser(to: string, nameOf: (id: string) => string) {
    return (db.prepare('SELECT * FROM notes WHERE to_user = ? ORDER BY created_at DESC LIMIT 60').all(to) as NoteRow[]).map((r) => noteOut(r, nameOf(r.from_user)));
  },
  markRead: (id: number, to: string) => db.prepare('UPDATE notes SET read_at = ? WHERE id = ? AND to_user = ? AND read_at IS NULL').run(now(), id, to),
  unreadCounts() {
    const rows = db.prepare('SELECT to_user, COUNT(*) AS n FROM notes WHERE read_at IS NULL GROUP BY to_user').all() as { to_user: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.to_user, r.n]));
  },
};

// ---------- quadros ----------
interface BoardRow { id: string; title: string; scope: string; elements: string; updated_at: number; updated_by: string }
export const boards = {
  ensure(id: string, title: string, scope: string) {
    db.prepare('INSERT OR IGNORE INTO boards (id, title, scope, updated_at) VALUES (?, ?, ?, ?)').run(id, title, scope, now());
  },
  get(id: string) {
    const r = db.prepare('SELECT * FROM boards WHERE id = ?').get(id) as BoardRow | undefined;
    return r && { id: r.id, title: r.title, scope: r.scope, elements: JSON.parse(r.elements) as BoardElement[] };
  },
  save: (id: string, elements: BoardElement[], by: string) => db.prepare('UPDATE boards SET elements = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(JSON.stringify(elements), now(), by, id),
  list: () => (db.prepare("SELECT id, title, scope, updated_at, updated_by FROM boards WHERE scope NOT LIKE 'projeto:%' ORDER BY updated_at DESC").all() as BoardRow[]).map((r): BoardSummary => ({ id: r.id, title: r.title, scope: r.scope, updatedAt: r.updated_at, updatedBy: r.updated_by })),
  create(id: string, title: string, scope: string, elements: BoardElement[], by: string) {
    db.prepare('INSERT INTO boards (id, title, scope, elements, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)').run(id, title, scope, JSON.stringify(elements), now(), by);
  },
  copy(boardId: string, name: string, elements: BoardElement[], by: string) {
    db.prepare('INSERT INTO board_copies (board_id, name, elements, created_at, created_by) VALUES (?, ?, ?, ?, ?)').run(boardId, name, JSON.stringify(elements), now(), by);
  },
  copies: (boardId: string) => (db.prepare('SELECT id, board_id, name, created_at, created_by FROM board_copies WHERE board_id = ? ORDER BY created_at DESC').all(boardId) as { id: number; board_id: string; name: string; created_at: number; created_by: string }[]).map((r): BoardCopy => ({ id: r.id, boardId: r.board_id, name: r.name, createdAt: r.created_at, createdBy: r.created_by })),
  getCopy: (id: number) => db.prepare('SELECT * FROM board_copies WHERE id = ?').get(id) as { id: number; board_id: string; name: string; elements: string } | undefined,
};

// ---------- configurações ----------
export const settings = {
  get: (key: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value,
  set: (key: string, value: string) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value),
};

// quadros fixos do escritório
boards.ensure('sala', 'Quadro da sala da equipe', 'sala');
boards.ensure('reuniao', 'Quadro da sala de reunião', 'reuniao');
// mesas que deixaram de existir na planta (a sala real tem 9) ficam sem dono
db.prepare(`UPDATE users SET desk = NULL WHERE desk IS NOT NULL AND desk NOT IN (${DESKS.map((d) => d.index).join(',')})`).run();
// a antiga área de colaboração saiu da planta: o quadro dela some se estiver vazio e sem cópias
db.prepare("DELETE FROM boards WHERE id = 'colab' AND elements = '[]' AND NOT EXISTS (SELECT 1 FROM board_copies WHERE board_id = 'colab')").run();
