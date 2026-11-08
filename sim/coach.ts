// The two ways the harness talks to the coach (PR 5, 11/8/26): in process
// against a MemoryStore (CI, no network), or over HTTP to staging's /sim/*
// routes (the real thing, with the real model).
import { MemoryStore } from '../src/store';
import { FakeTransport, OutboxTransport } from '../src/transport';
import { handleIncoming } from '../src/bot';
import { weeklyPass } from '../src/weekly';
import { eveningPass } from '../src/training';
import { FakeEstimator } from './fakeEstimator';

export interface Coach {
  /** Send one message as `chatId` at the current clock; returns the replies. */
  send(chatId: string, text: string): Promise<string[]>;
  /** Move the clock to an absolute instant. */
  setClock(at: Date): Promise<void>;
  /** Run the evening send and the Sunday pass; returns the messages sent to `chatId`. */
  passes(chatId: string): Promise<string[]>;
  /** Forget a user entirely. */
  reset(chatId: string): Promise<void>;
  /** Model calls made so far (local only; null when unknown). */
  modelCalls(): number | null;
}

export class LocalCoach implements Coach {
  readonly store = new MemoryStore();
  readonly estimator = new FakeEstimator();
  private now = new Date('2026-11-09T08:00:00Z');
  async send(chatId: string, text: string): Promise<string[]> {
    const t = new FakeTransport('sim');
    await handleIncoming({ store: this.store, transport: t, channel: 'sim', chatId, text, now: this.now, version: 'sim', estimator: this.estimator });
    return t.sent.map((s) => s.text);
  }
  async setClock(at: Date): Promise<void> { this.now = at; }
  async passes(chatId: string): Promise<string[]> {
    const t = new FakeTransport('sim');
    await eveningPass(this.store, () => t, this.now);
    await weeklyPass(this.store, () => t, this.now);
    return t.sent.filter((s) => s.chatId === chatId).map((s) => s.text);
  }
  async reset(chatId: string): Promise<void> {
    const u = await this.store.getUserByChat('sim', chatId);
    if (u) await this.store.deleteUser(u.id);
  }
  modelCalls(): number | null { return this.estimator.calls; }
}

export class RemoteCoach implements Coach {
  private seen = new Map<string, number>();
  constructor(private base: string, private secret: string) {}
  private async post(path: string, body: unknown): Promise<unknown> {
    const r = await fetch(`${this.base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': this.secret }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
    return r.json();
  }
  async send(chatId: string, text: string): Promise<string[]> {
    const r = (await this.post('/sim/message', { chatId, text })) as { replies: string[] };
    this.seen.set(chatId, (this.seen.get(chatId) ?? 0) + r.replies.length);
    return r.replies;
  }
  async setClock(at: Date): Promise<void> {
    await this.post('/sim/clock', { offsetMs: at.getTime() - Date.now() });
  }
  async passes(chatId: string): Promise<string[]> {
    const before = await this.outbox(chatId);
    await this.post('/sim/evening', {});
    await this.post('/sim/weekly', {});
    const after = await this.outbox(chatId);
    return after.slice(before.length);
  }
  private async outbox(chatId: string): Promise<string[]> {
    const r = await fetch(`${this.base}/sim/outbox?chatId=${encodeURIComponent(chatId)}`, { headers: { 'X-Admin-Secret': this.secret } });
    const j = (await r.json()) as { messages: { text: string }[] };
    return j.messages.map((m) => m.text);
  }
  async reset(chatId: string): Promise<void> { await this.post('/sim/reset', { chatId }); }
  modelCalls(): number | null { return null; }
}

export { OutboxTransport };
