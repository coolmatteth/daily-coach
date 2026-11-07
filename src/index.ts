import type { Env } from './types';
import { D1Store } from './store';
import { handleIncoming } from './bot';
import { FakeTransport, OutboxTransport, TelegramTransport, type Transport } from './transport';
import { CLOCK_OFFSET_KEY, readOffsetMs, withOffset } from './clock';
import { RateLimiter } from './ratelimit';
import { getWebhookInfo, setMyCommands, setWebhook, type TelegramUpdate } from './telegram';

const limiter = new RateLimiter();

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } });

const COMMANDS = [
  { command: 'start', description: 'Begin, or read what this is' },
  { command: 'me', description: 'Your file: profile, numbers, notes' },
  { command: 'note', description: 'Add a line to your file' },
  { command: 'weight', description: 'Log a weigh-in' },
  { command: 'why', description: 'Where your numbers come from' },
  { command: 'version', description: 'Which build is answering' },
];

function adminOk(req: Request, env: Env): boolean {
  const given = req.headers.get('X-Admin-Secret');
  return Boolean(env.ADMIN_SECRET) && given === env.ADMIN_SECRET;
}

function versionInfo(env: Env) {
  return {
    name: 'glp1-coach',
    gitSha: env.GIT_SHA ?? 'local',
    deployedBy: env.DEPLOYED_BY ?? (env.GIT_SHA ? 'actions' : 'hand'),
    staging: env.STAGING === '1',
  };
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const staging = env.STAGING === '1';
    const store = new D1Store(env.DB);
    const version = (env.GIT_SHA ?? 'local').slice(0, 7);

    if (req.method === 'GET' && path === '/version') return json(versionInfo(env));
    if (req.method === 'GET' && path === '/health') return json({ ok: true });

    if (req.method === 'POST') {
      const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
      if (limiter.check(ip, Date.now())) return json({ error: 'slow down' }, 429);
    }

    const now = async () => withOffset(new Date(), await readOffsetMs(store, staging));

    // Telegram → bot. Staging answers into the outbox, never to a phone.
    if (req.method === 'POST' && path === '/telegram/webhook') {
      const secret = req.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (!env.TELEGRAM_WEBHOOK_SECRET || secret !== env.TELEGRAM_WEBHOOK_SECRET) return json({ error: 'forbidden' }, 403);
      const update = (await req.json().catch(() => ({}))) as TelegramUpdate;
      const chatId = update.message?.chat?.id;
      const text = update.message?.text;
      if (chatId === undefined || typeof text !== 'string') return json({ ok: true, ignored: true });
      const t = await now();
      const transport: Transport = staging
        ? new OutboxTransport(store, 'telegram', () => t)
        : new TelegramTransport(env.TELEGRAM_BOT_TOKEN ?? '');
      // Awaited on purpose: Telegram holds the next update until this one
      // has answered (max_connections 1), which is the write serialization.
      await handleIncoming({ store, transport, channel: 'telegram', chatId: String(chatId), text, now: t, version });
      return json({ ok: true });
    }

    if (req.method === 'POST' && path === '/telegram/setup') {
      if (!adminOk(req, env)) return json({ error: 'forbidden' }, 403);
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return json({ error: 'bot secrets not set' }, 500);
      const hook = await setWebhook(env.TELEGRAM_BOT_TOKEN, `${url.origin}/telegram/webhook`, env.TELEGRAM_WEBHOOK_SECRET);
      const cmds = await setMyCommands(env.TELEGRAM_BOT_TOKEN, COMMANDS);
      const info = await getWebhookInfo(env.TELEGRAM_BOT_TOKEN);
      return json({ hook, cmds, info });
    }

    // The simulated-user harness. Staging only, admin secret required.
    if (staging && path.startsWith('/sim/')) {
      if (!adminOk(req, env)) return json({ error: 'forbidden' }, 403);

      if (req.method === 'POST' && path === '/sim/message') {
        const body = (await req.json().catch(() => ({}))) as { chatId?: string; text?: string };
        if (!body.chatId || typeof body.text !== 'string') return json({ error: 'chatId and text required' }, 400);
        const t = await now();
        const replies = new FakeTransport('sim', new OutboxTransport(store, 'sim', () => t));
        await handleIncoming({ store, transport: replies, channel: 'sim', chatId: body.chatId, text: body.text, now: t, version });
        return json({ at: t.toISOString(), replies: replies.sent.map((s) => s.text) });
      }

      if (req.method === 'GET' && path === '/sim/outbox') {
        const chatId = url.searchParams.get('chatId');
        const channel = (url.searchParams.get('channel') ?? 'sim') as 'sim' | 'telegram';
        if (!chatId) return json({ error: 'chatId required' }, 400);
        return json({ messages: await store.readOutbox(channel, chatId) });
      }

      if (req.method === 'POST' && path === '/sim/clock') {
        const body = (await req.json().catch(() => ({}))) as { offsetMs?: number; advanceMs?: number; reset?: boolean };
        const current = await readOffsetMs(store, true);
        const next = body.reset ? 0 : body.offsetMs ?? current + (body.advanceMs ?? 0);
        await store.setSetting(CLOCK_OFFSET_KEY, String(next));
        return json({ offsetMs: next, now: (await now()).toISOString() });
      }

      if (req.method === 'POST' && path === '/sim/reset') {
        const body = (await req.json().catch(() => ({}))) as { chatId?: string };
        if (!body.chatId) return json({ error: 'chatId required' }, 400);
        const user = await store.getUserByChat('sim', body.chatId);
        if (user) await store.deleteUser(user.id);
        await store.clearOutbox('sim', body.chatId);
        return json({ ok: true });
      }

      return json({ error: 'unknown sim route' }, 404);
    }

    void ctx;
    return json({ error: 'not found' }, 404);
  },

  // Nothing scheduled yet (crons = []). The evening plan and the Sunday
  // pass land here in later PRs.
  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext): Promise<void> {},
};
