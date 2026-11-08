import type { Channel, Env } from './types';
import { D1Store } from './store';
import { handleIncoming } from './bot';
import { FakeTransport, OutboxTransport, TelegramTransport, type Transport } from './transport';
import { CLOCK_OFFSET_KEY, readOffsetMs, withOffset } from './clock';
import { RateLimiter } from './ratelimit';
import { getWebhookInfo, photoBlock, sendTyping, setMyCommands, setWebhook, type TelegramUpdate } from './telegram';
import { ClaudeEstimator, type Block, type Estimator } from './estimator';
import { weeklyPass } from './weekly';
import { eveningPass } from './training';

const limiter = new RateLimiter();

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } });

const COMMANDS = [
  { command: 'start', description: 'Begin, or read what this is' },
  { command: 'plan', description: "Today's session" },
  { command: 'today', description: "Today's meals, numbered, and the protein total" },
  { command: 'week', description: 'Protein and calories for the last 7 days' },
  { command: 'recap', description: 'The Sunday verdict now' },
  { command: 'me', description: 'Your file: profile, numbers, notes' },
  { command: 'note', description: 'Add a line to your file' },
  { command: 'weight', description: 'Log a weigh-in' },
  { command: 'delete', description: 'Delete a meal by its number from /today' },
  { command: 'undo', description: 'Remove the last meal logged today' },
  { command: 'checkin', description: 'Stomach and energy, 1 to 5: /checkin 4 3' },
  { command: 'aliases', description: 'Shortcut words and what they log' },
  { command: 'help', description: 'What I can do' },
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

function estimatorFor(env: Env): Estimator | undefined {
  return env.ANTHROPIC_API_KEY ? new ClaudeEstimator(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL || 'claude-sonnet-5-5') : undefined;
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
      const msg = update.message;
      const chatId = msg?.chat?.id;
      const text = msg?.text ?? msg?.caption ?? '';
      const photoId = msg?.photo?.length ? msg.photo[msg.photo.length - 1].file_id : undefined;
      if (chatId === undefined || (!text && !photoId)) return json({ ok: true, ignored: true });
      const t = await now();
      const token = env.TELEGRAM_BOT_TOKEN ?? '';
      const transport: Transport = staging ? new OutboxTransport(store, 'telegram', () => t) : new TelegramTransport(token);
      if (!staging && token && (photoId || text.length > 2)) await sendTyping(token, String(chatId));
      // Awaited on purpose: Telegram holds the next update until this one
      // has answered (max_connections 1); the per-user lock does the rest.
      await handleIncoming({
        store, transport, channel: 'telegram', chatId: String(chatId), text, now: t, version,
        estimator: estimatorFor(env),
        photo: photoId && token ? () => photoBlock(token, photoId) : undefined,
      });
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
        const body = (await req.json().catch(() => ({}))) as { chatId?: string; text?: string; photoBase64?: string; mediaType?: 'image/jpeg' | 'image/png' | 'image/webp' };
        if (!body.chatId || (typeof body.text !== 'string' && !body.photoBase64)) return json({ error: 'chatId and text (or photoBase64) required' }, 400);
        const t = await now();
        const replies = new FakeTransport('sim', new OutboxTransport(store, 'sim', () => t));
        const img: Block | undefined = body.photoBase64 ? { type: 'image', source: { type: 'base64', media_type: body.mediaType ?? 'image/jpeg', data: body.photoBase64 } } : undefined;
        await handleIncoming({
          store, transport: replies, channel: 'sim', chatId: body.chatId, text: body.text ?? '', now: t, version,
          estimator: estimatorFor(env),
          photo: img ? async () => img : undefined,
        });
        return json({ at: t.toISOString(), replies: replies.sent.map((s) => s.text) });
      }

      if (req.method === 'GET' && path === '/sim/outbox') {
        const chatId = url.searchParams.get('chatId');
        const channel = (url.searchParams.get('channel') ?? 'sim') as Channel;
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

      // Run the Sunday pass or the evening send now against the (possibly moved) clock.
      if (req.method === 'POST' && path === '/sim/weekly') {
        const t = await now();
        const sent = await weeklyPass(store, (channel) => new OutboxTransport(store, channel, () => t), t);
        return json({ sent, now: t.toISOString() });
      }
      if (req.method === 'POST' && path === '/sim/evening') {
        const t = await now();
        const sent = await eveningPass(store, (channel) => new OutboxTransport(store, channel, () => t), t);
        return json({ sent, now: t.toISOString() });
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

  // Hourly: the evening send for whoever is at 6 PM local, and the Sunday
  // pass for whoever is at 5 PM local on a Sunday.
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const staging = env.STAGING === '1';
    const store = new D1Store(env.DB);
    const t = withOffset(new Date(), await readOffsetMs(store, staging));
    const transportFor = (channel: Channel): Transport =>
      staging || channel === 'sim' ? new OutboxTransport(store, channel, () => t) : new TelegramTransport(env.TELEGRAM_BOT_TOKEN ?? '');
    await weeklyPass(store, transportFor, t);
    await eveningPass(store, transportFor, t);
  },
};
