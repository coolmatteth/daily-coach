import type { Channel, DaySummary, FoodAlias, FoodEntry, FoodItem, Note, NoteKind, Profile, ProfileField, Sex, User } from './types';
import type { WeighIn } from './weighins';

export function emptyProfile(): Profile {
  return {
    weightLb: null, heightIn: null, sex: null, age: null, drug: null, shotDay: null,
    liftingDays: null, goalLb: null, leanMassLb: null, tz: null,
    pendingField: null, lastAskedDay: null, skipped: [],
    pendingMeal: null, pendingUntil: null, lastRecapDay: null,
  };
}

export type StoredMeal = FoodEntry & { id: number; day: string };

// The Store is the only thing that knows about D1. The bot talks to this
// interface; the tests use MemoryStore and never touch a database.
export interface Store {
  getUserByChat(channel: Channel, chatId: string): Promise<User | null>;
  createUser(channel: Channel, chatId: string, now: Date): Promise<User>;
  updateUser(userId: number, patch: Partial<Profile>): Promise<User>;
  deleteUser(userId: number): Promise<void>;
  listUsers(): Promise<User[]>;

  countModelCalls(userId: number, day: string): Promise<number>;
  recordModelCall(userId: number, day: string, kind: string, now: Date): Promise<void>;

  addNote(userId: number, n: { date: string; kind: NoteKind; text: string; value: string | null; source: 'user' | 'coach' }, now: Date): Promise<Note>;
  listNotes(userId: number): Promise<Note[]>;   // newest first
  deleteNote(userId: number, noteId: number): Promise<boolean>;

  addWeighIn(userId: number, date: string, lb: number, now: Date): Promise<void>;
  listWeighIns(userId: number): Promise<WeighIn[]>;  // oldest first

  listMeals(userId: number, day: string): Promise<StoredMeal[]>;   // by time
  addMeal(userId: number, day: string, m: FoodEntry, now: Date): Promise<StoredMeal>;
  updateMeal(userId: number, id: number, m: FoodEntry): Promise<void>;
  deleteMeal(userId: number, id: number): Promise<void>;
  daySummaries(userId: number, fromDay: string, toDay: string): Promise<DaySummary[]>; // every day in range, oldest first

  listAliases(userId: number): Promise<FoodAlias[]>;
  setAlias(userId: number, a: FoodAlias): Promise<void>;
  removeAlias(userId: number, word: string): Promise<boolean>;

  // One in-flight message per user. true = acquired.
  acquireLock(userId: number, now: Date, ttlMs: number): Promise<boolean>;
  releaseLock(userId: number): Promise<void>;

  appendOutbox(channel: Channel, chatId: string, text: string, now: Date): Promise<void>;
  readOutbox(channel: Channel, chatId: string): Promise<{ text: string; at: string }[]>;
  clearOutbox(channel: Channel, chatId: string): Promise<void>;

  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}

function dayRange(fromDay: string, toDay: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${fromDay}T00:00:00Z`); t <= Date.parse(`${toDay}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export class MemoryStore implements Store {
  private users: User[] = [];
  private nextId = 1;
  private nextNoteId = 1;
  private nextMealId = 1;
  private calls: { userId: number; day: string; kind: string; at: string }[] = [];
  private notes: Note[] = [];
  private weighIns: { userId: number; date: string; lb: number }[] = [];
  private meals: (StoredMeal & { userId: number })[] = [];
  private aliases: { userId: number; alias: FoodAlias }[] = [];
  private locks = new Map<number, number>();
  private outbox: { channel: Channel; chatId: string; text: string; at: string }[] = [];
  private settings = new Map<string, string>();

  private copy(u: User): User { return { ...u, skipped: [...u.skipped] }; }
  async getUserByChat(channel: Channel, chatId: string): Promise<User | null> {
    const u = this.users.find((u) => u.channel === channel && u.chatId === chatId);
    return u ? this.copy(u) : null;
  }
  async createUser(channel: Channel, chatId: string, now: Date): Promise<User> {
    const u: User = { id: this.nextId++, channel, chatId, createdAt: now.toISOString(), ...emptyProfile() };
    this.users.push(u);
    return this.copy(u);
  }
  async updateUser(userId: number, patch: Partial<Profile>): Promise<User> {
    const u = this.users.find((x) => x.id === userId);
    if (!u) throw new Error(`no user ${userId}`);
    Object.assign(u, patch);
    return this.copy(u);
  }
  async deleteUser(userId: number): Promise<void> {
    this.users = this.users.filter((u) => u.id !== userId);
    this.calls = this.calls.filter((c) => c.userId !== userId);
    this.notes = this.notes.filter((n) => n.userId !== userId);
    this.weighIns = this.weighIns.filter((w) => w.userId !== userId);
    this.meals = this.meals.filter((m) => m.userId !== userId);
    this.aliases = this.aliases.filter((a) => a.userId !== userId);
    this.locks.delete(userId);
  }
  async listUsers(): Promise<User[]> { return this.users.map((u) => this.copy(u)); }
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
  async listMeals(userId: number, day: string): Promise<StoredMeal[]> {
    return this.meals.filter((m) => m.userId === userId && m.day === day).sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id).map(({ userId: _u, ...m }) => ({ ...m, items: m.items.map((i) => ({ ...i })) }));
  }
  async addMeal(userId: number, day: string, m: FoodEntry): Promise<StoredMeal> {
    const stored = { ...m, items: m.items.map((i) => ({ ...i })), id: this.nextMealId++, day, userId };
    this.meals.push(stored);
    const { userId: _u, ...out } = stored;
    return out;
  }
  async updateMeal(userId: number, id: number, m: FoodEntry): Promise<void> {
    const i = this.meals.findIndex((x) => x.userId === userId && x.id === id);
    if (i >= 0) this.meals[i] = { ...this.meals[i], ...m, id, items: m.items.map((x) => ({ ...x })) };
  }
  async deleteMeal(userId: number, id: number): Promise<void> {
    this.meals = this.meals.filter((x) => !(x.userId === userId && x.id === id));
  }
  async daySummaries(userId: number, fromDay: string, toDay: string): Promise<DaySummary[]> {
    return dayRange(fromDay, toDay).map((day) => {
      const ms = this.meals.filter((m) => m.userId === userId && m.day === day);
      return { day, protein_g: Math.round(ms.reduce((n, m) => n + m.protein_g, 0)), kcal: Math.round(ms.reduce((n, m) => n + m.kcal, 0)), meals: ms.length };
    });
  }
  async listAliases(userId: number): Promise<FoodAlias[]> {
    return this.aliases.filter((a) => a.userId === userId).map((a) => ({ word: a.alias.word, item: { ...a.alias.item } }));
  }
  async setAlias(userId: number, a: FoodAlias): Promise<void> {
    this.aliases = this.aliases.filter((x) => !(x.userId === userId && x.alias.word === a.word));
    this.aliases.push({ userId, alias: a });
  }
  async removeAlias(userId: number, word: string): Promise<boolean> {
    const before = this.aliases.length;
    this.aliases = this.aliases.filter((x) => !(x.userId === userId && x.alias.word === word));
    return this.aliases.length < before;
  }
  async acquireLock(userId: number, now: Date, ttlMs: number): Promise<boolean> {
    const until = this.locks.get(userId);
    if (until !== undefined && until > now.getTime()) return false;
    this.locks.set(userId, now.getTime() + ttlMs);
    return true;
  }
  async releaseLock(userId: number): Promise<void> { this.locks.delete(userId); }
  async appendOutbox(channel: Channel, chatId: string, text: string, now: Date): Promise<void> {
    this.outbox.push({ channel, chatId, text, at: now.toISOString() });
  }
  async readOutbox(channel: Channel, chatId: string): Promise<{ text: string; at: string }[]> {
    return this.outbox.filter((o) => o.channel === channel && o.chatId === chatId).map(({ text, at }) => ({ text, at }));
  }
  async clearOutbox(channel: Channel, chatId: string): Promise<void> {
    this.outbox = this.outbox.filter((o) => !(o.channel === channel && o.chatId === chatId));
  }
  async getSetting(key: string): Promise<string | null> { return this.settings.get(key) ?? null; }
  async setSetting(key: string, value: string): Promise<void> { this.settings.set(key, value); }
}

type UserRow = {
  id: number; channel: Channel; chat_id: string; created_at: string; tz: string | null;
  weight_lb: number | null; height_in: number | null; sex: Sex | null; age: number | null; drug: string | null;
  shot_day: number | null; lifting_days: number | null; goal_lb: number | null; lean_mass_lb: number | null;
  pending_field: ProfileField | null; last_asked_day: string | null; skipped: string | null;
  pending_meal: string | null; pending_until: string | null; last_recap_day: string | null;
};

const COLUMN: Record<keyof Profile, string> = {
  weightLb: 'weight_lb', heightIn: 'height_in', sex: 'sex', age: 'age', drug: 'drug', shotDay: 'shot_day',
  liftingDays: 'lifting_days', goalLb: 'goal_lb', leanMassLb: 'lean_mass_lb', tz: 'tz',
  pendingField: 'pending_field', lastAskedDay: 'last_asked_day', skipped: 'skipped',
  pendingMeal: 'pending_meal', pendingUntil: 'pending_until', lastRecapDay: 'last_recap_day',
};

type NoteRow = { id: number; user_id: number; date: string; kind: NoteKind; text: string; value: string | null; source: 'user' | 'coach'; created_at: string };
type MealRow = { id: number; day: string; at: string; text: string; photo: number; items: string; protein_g: number; kcal: number; confidence: FoodEntry['confidence'] };

export class D1Store implements Store {
  constructor(private db: D1Database) {}

  private toUser(r: UserRow): User {
    return {
      id: r.id, channel: r.channel, chatId: r.chat_id, createdAt: r.created_at, tz: r.tz,
      weightLb: r.weight_lb, heightIn: r.height_in, sex: r.sex, age: r.age, drug: r.drug, shotDay: r.shot_day,
      liftingDays: r.lifting_days, goalLb: r.goal_lb, leanMassLb: r.lean_mass_lb,
      pendingField: r.pending_field, lastAskedDay: r.last_asked_day,
      skipped: r.skipped ? (r.skipped.split(',').filter(Boolean) as ProfileField[]) : [],
      pendingMeal: r.pending_meal, pendingUntil: r.pending_until, lastRecapDay: r.last_recap_day,
    };
  }
  private toMeal(r: MealRow): StoredMeal {
    let items: FoodItem[] = [];
    try { items = JSON.parse(r.items) as FoodItem[]; } catch { items = []; }
    return { id: r.id, day: r.day, at: r.at, text: r.text, photo: r.photo === 1, items, protein_g: r.protein_g, kcal: r.kcal, confidence: r.confidence };
  }
  async getUserByChat(channel: Channel, chatId: string): Promise<User | null> {
    const r = await this.db.prepare('SELECT * FROM users WHERE channel = ? AND chat_id = ?').bind(channel, chatId).first<UserRow>();
    return r ? this.toUser(r) : null;
  }
  async createUser(channel: Channel, chatId: string, now: Date): Promise<User> {
    const r = await this.db.prepare('INSERT INTO users (channel, chat_id, created_at) VALUES (?, ?, ?) RETURNING *').bind(channel, chatId, now.toISOString()).first<UserRow>();
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
      this.db.prepare('DELETE FROM meals WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM aliases WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM locks WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
    ]);
  }
  async listUsers(): Promise<User[]> {
    const r = await this.db.prepare('SELECT * FROM users ORDER BY id').all<UserRow>();
    return (r.results ?? []).map((x) => this.toUser(x));
  }
  async countModelCalls(userId: number, day: string): Promise<number> {
    const r = await this.db.prepare('SELECT COUNT(*) AS n FROM model_calls WHERE user_id = ? AND day = ?').bind(userId, day).first<{ n: number }>();
    return r?.n ?? 0;
  }
  async recordModelCall(userId: number, day: string, kind: string, now: Date): Promise<void> {
    await this.db.prepare('INSERT INTO model_calls (user_id, day, kind, at) VALUES (?, ?, ?, ?)').bind(userId, day, kind, now.toISOString()).run();
  }
  async addNote(userId: number, n: { date: string; kind: NoteKind; text: string; value: string | null; source: 'user' | 'coach' }, now: Date): Promise<Note> {
    const r = await this.db.prepare('INSERT INTO notes (user_id, date, kind, text, value, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *')
      .bind(userId, n.date, n.kind, n.text, n.value, n.source, now.toISOString()).first<NoteRow>();
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
  async listMeals(userId: number, day: string): Promise<StoredMeal[]> {
    const r = await this.db.prepare('SELECT * FROM meals WHERE user_id = ? AND day = ? ORDER BY at, id').bind(userId, day).all<MealRow>();
    return (r.results ?? []).map((x) => this.toMeal(x));
  }
  async addMeal(userId: number, day: string, m: FoodEntry, now: Date): Promise<StoredMeal> {
    const r = await this.db.prepare('INSERT INTO meals (user_id, day, at, text, photo, items, protein_g, kcal, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *')
      .bind(userId, day, m.at, m.text, m.photo ? 1 : 0, JSON.stringify(m.items), m.protein_g, m.kcal, m.confidence, now.toISOString()).first<MealRow>();
    if (!r) throw new Error('insert meals returned nothing');
    return this.toMeal(r);
  }
  async updateMeal(userId: number, id: number, m: FoodEntry): Promise<void> {
    await this.db.prepare('UPDATE meals SET at = ?, text = ?, photo = ?, items = ?, protein_g = ?, kcal = ?, confidence = ? WHERE user_id = ? AND id = ?')
      .bind(m.at, m.text, m.photo ? 1 : 0, JSON.stringify(m.items), m.protein_g, m.kcal, m.confidence, userId, id).run();
  }
  async deleteMeal(userId: number, id: number): Promise<void> {
    await this.db.prepare('DELETE FROM meals WHERE user_id = ? AND id = ?').bind(userId, id).run();
  }
  async daySummaries(userId: number, fromDay: string, toDay: string): Promise<DaySummary[]> {
    const r = await this.db.prepare('SELECT day, SUM(protein_g) AS protein_g, SUM(kcal) AS kcal, COUNT(*) AS meals FROM meals WHERE user_id = ? AND day >= ? AND day <= ? GROUP BY day')
      .bind(userId, fromDay, toDay).all<{ day: string; protein_g: number; kcal: number; meals: number }>();
    const by = new Map((r.results ?? []).map((x) => [x.day, x]));
    return dayRange(fromDay, toDay).map((day) => {
      const x = by.get(day);
      return x ? { day, protein_g: Math.round(x.protein_g), kcal: Math.round(x.kcal), meals: x.meals } : { day, protein_g: 0, kcal: 0, meals: 0 };
    });
  }
  async listAliases(userId: number): Promise<FoodAlias[]> {
    const r = await this.db.prepare('SELECT word, name, protein_g, kcal FROM aliases WHERE user_id = ? ORDER BY word').bind(userId).all<{ word: string; name: string; protein_g: number; kcal: number }>();
    return (r.results ?? []).map((x) => ({ word: x.word, item: { name: x.name, protein_g: x.protein_g, kcal: x.kcal } }));
  }
  async setAlias(userId: number, a: FoodAlias): Promise<void> {
    await this.db.prepare('INSERT INTO aliases (user_id, word, name, protein_g, kcal) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, word) DO UPDATE SET name = excluded.name, protein_g = excluded.protein_g, kcal = excluded.kcal')
      .bind(userId, a.word, a.item.name, a.item.protein_g, a.item.kcal).run();
  }
  async removeAlias(userId: number, word: string): Promise<boolean> {
    const r = await this.db.prepare('DELETE FROM aliases WHERE user_id = ? AND word = ?').bind(userId, word).run();
    return (r.meta?.changes ?? 0) > 0;
  }
  async acquireLock(userId: number, now: Date, ttlMs: number): Promise<boolean> {
    const until = new Date(now.getTime() + ttlMs).toISOString();
    // Insert wins when there is no row; the update wins only when the old lock has expired.
    const r = await this.db.prepare('INSERT INTO locks (user_id, until) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET until = excluded.until WHERE locks.until < ?')
      .bind(userId, until, now.toISOString()).run();
    return (r.meta?.changes ?? 0) > 0;
  }
  async releaseLock(userId: number): Promise<void> {
    await this.db.prepare('DELETE FROM locks WHERE user_id = ?').bind(userId).run();
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
