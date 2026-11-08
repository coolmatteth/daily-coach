// PR 1 checks: the bot's three commands, the transport, the quota and the
// rate limiter, all without HTTP or a database. Run: npx tsx evals/skeleton-check.ts
import { MemoryStore } from '../src/store';
import { FakeTransport } from '../src/transport';
import { handleIncoming, START_TEXT, DELETED_TEXT, NOT_STARTED_TEXT, HELP_TEXT, isDeleteMe } from '../src/bot';
import { quotaDecision, takeModelCall, MODEL_CALLS_PER_DAY } from '../src/quota';
import { RateLimiter } from '../src/ratelimit';
import { withOffset, dayKey } from '../src/clock';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${detail}`); }
}

async function send(store: MemoryStore, chatId: string, text: string, now = new Date('2026-11-06T18:00:00Z')) {
  const transport = new FakeTransport('sim');
  await handleIncoming({ store, transport, channel: 'sim', chatId, text, now, version: 'abc1234' });
  return transport.sent.map((s) => s.text);
}

async function main() {
  // Bot
  {
    const store = new MemoryStore();
    check('unknown user gets "say /start"', (await send(store, 'u1', 'hello'))[0] === NOT_STARTED_TEXT);
    const r = await send(store, 'u1', '/start');
    check('/start replies with the disclosure, then the first question', r.length === 2 && r[0] === START_TEXT);
    check('/start text names software, not a person', START_TEXT.includes('software, not a person'));
    check('/start text says not medical advice', START_TEXT.includes('is medical advice') && START_TEXT.includes('nothing I say'));
    check('/start creates the user', (await store.getUserByChat('sim', 'u1')) !== null);
    const again = await send(store, 'u1', '/start');
    check('/start twice does not duplicate the user', again[0] === START_TEXT && (await store.getUserByChat('sim', 'u1'))?.id === 1);
    check('known user, unknown text while a question is pending gets the retry', /0 to 4/.test((await send(store, 'u1', 'what do I eat'))[0]));
    check('known user, unknown command gets help', (await send(store, 'u1', '/foo'))[0].startsWith("I don't know /foo") && (await send(store, 'u1', '/help'))[0] === HELP_TEXT);
    check('/version answers with the sha', (await send(store, 'u1', '/version'))[0] === 'GLP-1 Coach abc1234');
    check('delete me deletes the row', (await send(store, 'u1', 'delete me'))[0] === DELETED_TEXT && (await store.getUserByChat('sim', 'u1')) === null);
    check('delete me on nobody still answers', (await send(store, 'u9', 'Delete  Me'))[0] === DELETED_TEXT);
    check('isDeleteMe accepts the command forms', isDeleteMe('/delete me') && isDeleteMe('/deleteme') && !isDeleteMe('delete'));
    const s2 = new MemoryStore();
    await s2.createUser('sim', '7', new Date());
    check('users on different channels are different users', (await s2.getUserByChat('telegram', '7')) === null);
  }

  // Transport
  {
    const inner = new FakeTransport('sim');
    const outer = new FakeTransport('sim', inner);
    await outer.send('c', 'hi');
    check('fake transport records the send', outer.sent.length === 1 && outer.sent[0].text === 'hi');
    check('fake transport forwards to the wrapped transport', inner.sent.length === 1);
  }

  // Quota
  {
    check('quota: under the cap allowed', quotaDecision(0).allowed && quotaDecision(MODEL_CALLS_PER_DAY - 1).allowed);
    check('quota: at the cap refused', !quotaDecision(MODEL_CALLS_PER_DAY).allowed && quotaDecision(MODEL_CALLS_PER_DAY).remaining === 0);
    const store = new MemoryStore();
    const u = await store.createUser('sim', 'q', new Date());
    const day = new Date('2026-11-06T10:00:00Z');
    let allowed = 0;
    for (let i = 0; i < MODEL_CALLS_PER_DAY + 3; i++) if (await takeModelCall(store, u.id, 'meal', day)) allowed++;
    check('takeModelCall allows exactly the cap in a day', allowed === MODEL_CALLS_PER_DAY, `allowed ${allowed}`);
    check('a refused call is not recorded', (await store.countModelCalls(u.id, dayKey(day))) === MODEL_CALLS_PER_DAY);
    const nextDay = new Date('2026-11-07T10:00:00Z');
    check('the cap resets the next day', await takeModelCall(store, u.id, 'meal', nextDay));
    const other = await store.createUser('sim', 'q2', new Date());
    check('another user has their own cap', await takeModelCall(store, other.id, 'meal', day));
  }

  // Rate limiter
  {
    const rl = new RateLimiter(1000, 3, 5);
    const t = 1_000_000;
    check('rate limit: first three pass', !rl.check('a', t) && !rl.check('a', t) && !rl.check('a', t));
    check('rate limit: fourth from the same ip refused', rl.check('a', t));
    check('rate limit: another ip still passes', !rl.check('b', t));
    check('rate limit: window expiry lets the ip back in', !rl.check('a', t + 1001));
    const rl2 = new RateLimiter(1000, 100, 2);
    rl2.check('x', t); rl2.check('y', t);
    check('rate limit: instance cap refuses a third ip', rl2.check('z', t));
  }

  // Clock
  {
    const real = new Date('2026-11-06T00:00:00Z');
    check('clock offset moves time', withOffset(real, 7 * 86_400_000).toISOString().startsWith('2026-11-13'));
    check('dayKey is the calendar day', dayKey(real) === '2026-11-06');
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
  if (failures) process.exit(1);
}

main();
