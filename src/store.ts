import type { Channel, Note, NoteKind, Profile, ProfileField, Sex, User } from './types';
import type { WeighIn } from './weighins';

export function emptyProfile(): Profile {
  return {
    weightLb: null, heightIn: null, sex: null, age: null, drug: null, shotDay: null,
    liftingDays: null, goalLb: null, leanMassLb: null, tz: null,
    pendingField: null, lastAskedDay: null, skipped: [],
  };
}

// The Store is the only thing that knows about D1. The bot talks to this
// interface; the tests use MemoryStore and never touch a database.
export interface Store {
  getUserByChat(channel: Channel, chatId: string): Promise<User | null>;
  createUser(channel: Channel, chatId: string, now: Date): Promise<User>;
  updateUser(userId: number, patch: Partial<Profile>): Promise<User>;
  deleteUser(userId: number): Promise<void>;

  countModelCalls(userId: number, day: string): Promise<number>;
  recordModelCall(userId: number, day: string, kind: string, now: Date): Promise<void>;

  addNote(userId: number, n: { date: string; kind: NoteKind; text: string; value: string | null; source: 'user' | 'coach' }, now: Date): Promise<Note>;
  listNotes(userId: number): Promise<Note[]>;   // newest first
  deleteNote(userId: number, noteId: number): Promise<boolean>;

  addWeighIn(userId: number, date: string, lb: number, now: Date): Promise<void>;
  listWeighIns(userId: number): Promise<WeighIn[]>;  // oldest first

  appendOutbox(channel: Channel, chatId: string, text: string, now: Date): Promise<void>;
  readOutbox(channel: Channel, chatId: string): Promise<{ text: string; at: string }[]>;
  clearOutbox(channel: Channel, chatId: string): Promise<void>;

  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}

export class MemoryStore implements Store {
  private users: User[] = [];
  private nextId = 1;
  private nextNoteId = 1;
  private calls: { userId: number; day: string; kind: string; at: string }[] = [];
  private notes: Note[] = [];
  private weighIns: { userId: number; date: string; lb: number }[] = [];
  private outbox: { channel: Channel; chatId: string; text: string; at: string }[] = [];
  private settings = new Map<string, string>();

  async getUserByChat(channel: Channel, chatId: string): Promise<User | null> {
    const u = this.users.find((u) => u.channel === channel && u.chatId === chatId);
    return u ? { ...u, skipped: [...u.skipped] } : null;
  }
  async createUser(channel: Channel, chatId: string, now: Date): Promise<User> {
    const u: User = { id: this.nextId++, channel, chatId, createdAt: now.toISOString(), ...emptyProfile() };
    this.users.push(u);
    return { ...u };
  }
  async updateUser(userId: number, patch: Partial<Profile>): Promise<User> {
    const u = this.users.find((x) => x.id === userId);
    if (!u) throw new Error(`no user ${userId}`);
    Object.assign(u, patch);
    return { ...u, skipped: [...u.skipped] };
  }
  async deleteUser(userId: number): Promise<void> {
    this.users = this.users.filter((u) => u.id !== userId);
    this.calls = this.calls.filter((c) => c.userId !== userId);
    this.notes = this.notes.filter((n) => n.userId !== userId);
    this.weighIns = this.weighIns.filter((w) => w.userId !== userId);
  }
  async countModelCalls(userId: number, day: string): Promise<number> {
    return this.calls.filter((c) => c.userId === userId && c.day === day).length;
  }
  async recordModelCall(userId: number, day: string, kind: string, now: Date): Promise<void> {
    this.calls.push({ userId, day, kind, at: now.toISOString() });
  }
  async addNote(userId: number, n: { date: string; kind: NoteKind; text: string; value: string | null; source: 'user' | 'coach' }, now: Date): Promise<Note> {
    const note: Note = { id: this.nextNoteId++, userId, ...n, createdAt: now.toISOString() };
    this.notes.push(note);
    return note;
  }
  async listNotes(userId: number): Promise<Note[]> {
    return this.notes.filter((n) => n.userId === userId).sort((a, b) => b.id - a.id);
  }
  async deleteNote(userId: number, noteId: number): Promise<boolean> {
    const before = this.notes.length;
    this.notes = this.notes.filter((n) => !(n.userId === userId && n.id === noteId));
    return this.notes.length < before;
  }
  async addWeighIn(userId: number, date: string, lb: number): Promise<void> {
    this.weighIns.push({ userId, date, lb });
  }
  async listWeighIns(userId: number): Promise<WeighIn[]> {
    return this.weighIns.filter((w) => w.userId === userId).map(({ date, lb }) => ({ date, lb })).sort((a, b) => a.date.localeCompare(b.date));
  }
  async appendOutbox(channel: Channel, chatId: string, text: string, now: Date): Promise<void> {
    this.outbox.push({ channel, chatId, text, at: now.toISOString() });
  }
  async readOutbox(channel: Channel, chatId: string): Promise<{ text: string; at: string }[]> {
    return this.outbox.filter((o) => o.channel === channel && o.chatId === chatId).map(({ text, at }) => ({ text, at }));
  }
  async clearOutbox(channel: Channel, chatId: string): Promise<void> {
    this.outbox = this.outbox.filter((o) => !(o.channel === channel && o.chatId === chatId));
  }
  async getSetting(key: string): Promise<string | null> {
    return this.settings.get(key) ?? null;
  }
  async setSetting(key: string, value: string): Promise<void> {
    this.settings.set(key, value);
  }
}

type UserRow = {
  id: number; channel: Channel; chat_id: string; created_at: string; tz: string | null;
  weight_lb: number | null; height_in: number | null; sex: Sex | null; age: number | null; drug: string | null;
  shot_day: number | null; lifting_days: number | null; goal_lb: number | null; lean_mass_lb: number | null;
  pending_field: ProfileField | null; last_asked_day: string | null; skipped: string | null;
};

const COLUMN: Record<keyof Profile, string> = {
  weightLb: 'weight_lb', heightIn: 'height_in', sex: 'sex', age: 'age', drug: 'drug', shotDay: 'shot_day',
  liftingDays: 'lifting_days', goalLb: 'goal_lb', leanMassLb: 'lean_mass_lb', tz: 'tz',
  pendingField: 'pending_field', lastAskedDay: 'last_asked_day', skipped: 'skipped',
};

type NoteRow = { id: number; user_id: number; date: string; kind: NoteKind; text: string; value: string | null; source: 'user' | 'coach'; created_at: string };

export class D1Store implements Store {
  constructor(private db: D1Database) {}

  private toUser(r: UserRow): User {
    return {
      id: r.id, channel: r.channel, chatId: r.chat_id, createdAt: r.created_at, tz: r.tz,
      weightLb: r.weight_lb, heightIn: r.height_in, sex: r.sex, age: r.age, drug: r.drug, shotDay: r.shot_day,
      liftingDays: r.lifting_days, goalLb: r.goal_lb, leanMassLb: r.lean_mass_lb,
      pendingField: r.pending_field, lastAskedDay: r.last_asked_day,
      skipped: r.skipped ? (r.skipped.split(',').filter(Boolean) as ProfileField[]) : [],
    };
  }
  async getUserByChat(channel: Channel, chatId: string): Promise<User | null> {
    const r = await this.db.prepare('SELECT * FROM users WHERE channel = ? AND chat_id = ?').bind(channel, chatId).first<UserRow>();
    return r ? this.toUser(r) : null;
  }
  async createUser(channel: Channel, chatId: string, now: Date): Promise<User> {
    const r = await this.db
      .prepare('INSERT INTO users (channel, chat_id, created_at) VALUES (?, ?, ?) RETURNING *')
      .bind(channel, chatId, now.toISOString())
      .first<UserRow>();
    if (!r) throw new Error('insert users returned nothing');
    return this.toUser(r);
  }
  async updateUser(userId: number, patch: Partial<Profile>): Promise<User> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(patch) as [keyof Profile, unknown][]) {
      sets.push(`${COLUMN[k]} = ?`);
      vals.push(k === 'skipped' ? (v as string[]).join(',') : v);
    }
    if (sets.length === 0) {
      const r = await this.db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<UserRow>();
      if (!r) throw new Error(`no user ${userId}`);
      return this.toUser(r);
    }
    const r = await this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ? RETURNING *`).bind(...vals, userId).first<UserRow>();
    if (!r) throw new Error(`no user ${userId}`);
    return this.toUser(r);
  }
  async deleteUser(userId: number): Promise<void> {
    // One line per table that carries a user_id. Keep this list complete.
    await this.db.batch([
      this.db.prepare('DELETE FROM model_calls WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM notes WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM weigh_ins WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
    ]);
  }
  async countModelCalls(userId: number, day: string): Promise<number> {
    const r = await this.db.prepare('SELECT COUNT(*) AS n FROM model_calls WHERE user_id = ? AND day = ?').bind(userId, day).first<{ n: number }>();
    return r?.n ?? 0;
  }
  async recordModelCall(userId: number, day: string, kind: string, now: Date): Promise<void> {
    await this.db.prepare('INSERT INTO model_calls (user_id, day, kind, at) VALUES (?, ?, ?, ?)').bind(userId, day, kind, now.toISOString()).run();
  }
  async addNote(userId: number, n: { date: string; kind: NoteKind; text: string; value: string | null; source: 'user' | 'coach' }, now: Date): Promise<Note> {
    const r = await this.db
      .prepare('INSERT INTO notes (user_id, date, kind, text, value, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *')
      .bind(userId, n.date, n.kind, n.text, n.value, n.source, now.toISOString())
      .first<NoteRow>();
    if (!r) throw new Error('insert notes returned nothing');
    return { id: r.id, userId: r.user_id, date: r.date, kind: r.kind, text: r.text, value: r.value, source: r.source, createdAt: r.created_at };
  }
  async listNotes(userId: number): Promise<Note[]> {
    const r = await this.db.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY id DESC').bind(userId).all<NoteRow>();
    return (r.results ?? []).map((x) => ({ id: x.id, userId: x.user_id, date: x.date, kind: x.kind, text: x.text, value: x.value, source: x.source, createdAt: x.created_at }));
  }
  async deleteNote(userId: number, noteId: number): Promise<boolean> {
    const r = await this.db.prepare('DELETE FROM notes WHERE user_id = ? AND id = ?').bind(userId, noteId).run();
    return (r.meta?.changes ?? 0) > 0;
  }
  async addWeighIn(userId: number, date: string, lb: number, now: Date): Promise<void> {
    await this.db.prepare('INSERT INTO weigh_ins (user_id, date, lb, created_at) VALUES (?, ?, ?, ?)').bind(userId, date, lb, now.toISOString()).run();
  }
  async listWeighIns(userId: number): Promise<WeighIn[]> {
    const r = await this.db.prepare('SELECT date, lb FROM weigh_ins WHERE user_id = ? ORDER BY date, id').bind(userId).all<{ date: string; lb: number }>();
    return r.results ?? [];
  }
  async appendOutbox(channel: Channel, chatId: string, text: string, now: Date): Promise<void> {
    await this.db.prepare('INSERT INTO outbox (channel, chat_id, text, at) VALUES (?, ?, ?, ?)').bind(channel, chatId, text, now.toISOString()).run();
  }
  async readOutbox(channel: Channel, chatId: string): Promise<{ text: string; at: string }[]> {
    const r = await this.db.prepare('SELECT text, at FROM outbox WHERE channel = ? AND chat_id = ? ORDER BY id').bind(channel, chatId).all<{ text: string; at: string }>();
    return r.results ?? [];
  }
  async clearOutbox(channel: Channel, chatId: string): Promise<void> {
    await this.db.prepare('DELETE FROM outbox WHERE channel = ? AND chat_id = ?').bind(channel, chatId).run();
  }
  async getSetting(key: string): Promise<string | null> {
    const r = await this.db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
    return r?.value ?? null;
  }
  async setSetting(key: string, value: string): Promise<void> {
    await this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
  }
}
