import type { Channel, User } from './types';

// The Store is the only thing that knows about D1. The bot talks to this
// interface; the tests use MemoryStore and never touch a database.
export interface Store {
  getUserByChat(channel: Channel, chatId: string): Promise<User | null>;
  createUser(channel: Channel, chatId: string, now: Date): Promise<User>;
  deleteUser(userId: number): Promise<void>;

  countModelCalls(userId: number, day: string): Promise<number>;
  recordModelCall(userId: number, day: string, kind: string, now: Date): Promise<void>;

  appendOutbox(channel: Channel, chatId: string, text: string, now: Date): Promise<void>;
  readOutbox(channel: Channel, chatId: string): Promise<{ text: string; at: string }[]>;
  clearOutbox(channel: Channel, chatId: string): Promise<void>;

  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}

export class MemoryStore implements Store {
  private users: User[] = [];
  private nextId = 1;
  private calls: { userId: number; day: string; kind: string; at: string }[] = [];
  private outbox: { channel: Channel; chatId: string; text: string; at: string }[] = [];
  private settings = new Map<string, string>();

  async getUserByChat(channel: Channel, chatId: string): Promise<User | null> {
    return this.users.find((u) => u.channel === channel && u.chatId === chatId) ?? null;
  }
  async createUser(channel: Channel, chatId: string, now: Date): Promise<User> {
    const u: User = { id: this.nextId++, channel, chatId, createdAt: now.toISOString(), tz: null };
    this.users.push(u);
    return u;
  }
  async deleteUser(userId: number): Promise<void> {
    this.users = this.users.filter((u) => u.id !== userId);
    this.calls = this.calls.filter((c) => c.userId !== userId);
  }
  async countModelCalls(userId: number, day: string): Promise<number> {
    return this.calls.filter((c) => c.userId === userId && c.day === day).length;
  }
  async recordModelCall(userId: number, day: string, kind: string, now: Date): Promise<void> {
    this.calls.push({ userId, day, kind, at: now.toISOString() });
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

type UserRow = { id: number; channel: Channel; chat_id: string; created_at: string; tz: string | null };

export class D1Store implements Store {
  constructor(private db: D1Database) {}

  private toUser(r: UserRow): User {
    return { id: r.id, channel: r.channel, chatId: r.chat_id, createdAt: r.created_at, tz: r.tz };
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
  async deleteUser(userId: number): Promise<void> {
    // Add a line here for every table that gains a user_id in later PRs.
    await this.db.batch([
      this.db.prepare('DELETE FROM model_calls WHERE user_id = ?').bind(userId),
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
