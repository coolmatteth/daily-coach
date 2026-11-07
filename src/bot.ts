import type { Channel, Profile, ProfileField, User } from './types';
import type { Store } from './store';
import type { Transport } from './transport';
import { dayKey } from './clock';
import {
  DAY_ONE_FIELDS, dayOneDone, isSkip, nextQuestion, numbersText, parseNote, parseWeightLb, questionFor, renderFile, whyText,
} from './athlete';
import { weighInReply } from './weighins';

export interface Incoming {
  store: Store;
  transport: Transport;
  channel: Channel;
  chatId: string;
  text: string;
  now: Date;
  version: string;
}

// The /start text. The first sentence is the AI disclosure several states
// now require of consumer chatbots; the second is the wellness line. Both
// stay in the first message a person ever sees, whatever else changes.
export const START_TEXT = [
  "Hi. I'm GLP-1 Coach: software, not a person, and nothing I say is medical advice. Anything about your medication is between you and your prescriber.",
  '',
  "I'm the experimental stage of a coach for people on a GLP-1 who lift or want to start. Three quick questions and you'll have your first numbers. After that I ask at most one question a day, each with the reason.",
  '',
  'Send "delete me" at any time and everything you told me is gone.',
].join('\n');

export const DELETED_TEXT = 'Done. Everything you told me is deleted. Say /start if you ever want to begin again.';
export const NOT_STARTED_TEXT = 'Say /start to begin.';
export const NOT_BUILT_TEXT = 'Not built yet. For now I know /start, /me, /note, /weight, "why", /version and "delete me".';
export const SKIPPED_TEXT = 'Skipped. You can give it later by telling me.';

export function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isDeleteMe(text: string): boolean {
  const t = normalize(text);
  return t === 'delete me' || t === '/delete me' || t === '/deleteme' || t === '/delete_me';
}

const WEIGHT_RE = /^\/?(?:weight|weighed|weigh-in|weighin)\s+(.+)$/i;

// One message in, zero or more out. No HTTP, no Telegram, no D1 in here:
// the tests call this with a MemoryStore and a FakeTransport.
export async function handleIncoming(m: Incoming): Promise<void> {
  const { store, transport, channel, chatId } = m;
  const text = normalize(m.text);
  const reply = (t: string) => transport.send(chatId, t);

  if (text === '/version') {
    await reply(`GLP-1 Coach ${m.version}`);
    return;
  }

  let user = await store.getUserByChat(channel, chatId);

  if (isDeleteMe(m.text)) {
    if (user) await store.deleteUser(user.id);
    await reply(DELETED_TEXT);
    return;
  }

  if (text === '/start' || text.startsWith('/start ')) {
    if (!user) user = await store.createUser(channel, chatId, m.now);
    await reply(START_TEXT);
    await askNext(store, user, reply, m.now, true);
    return;
  }

  if (!user) {
    await reply(NOT_STARTED_TEXT);
    return;
  }

  const today = dayKey(m.now, user.tz);

  // An answer to the question in flight, unless it is a command or a
  // weigh-in, which a pending question must never swallow.
  const commandLike = text.startsWith('/') || text === 'why' || text === 'me' || WEIGHT_RE.test(m.text.trim());
  if (user.pendingField && !commandLike) {
    const q = questionFor(user.pendingField);
    if (isSkip(m.text)) {
      user = await store.updateUser(user.id, { pendingField: null, skipped: [...user.skipped, q.field] });
      await reply(SKIPPED_TEXT);
      await askNext(store, user, reply, m.now, false);
      return;
    }
    const parsed = q.parse(m.text);
    if (!parsed) {
      await reply(q.retry);
      return;
    }
    const wasDone = dayOneDone(user);
    user = await store.updateUser(user.id, { ...parsed, pendingField: null });
    if (!wasDone && dayOneDone(user)) {
      await reply(numbersText(user));
      await store.updateUser(user.id, { lastAskedDay: today });
      return;
    }
    // Day-one questions run back to back with no ack between them.
    const ack = DAY_ONE_FIELDS.includes(q.field) ? null : ackFor(q.field, user);
    if (ack) await reply(ack);
    await askNext(store, user, reply, m.now, false);
    return;
  }

  if (text === '/me' || text === 'me' || text === '/file') {
    await reply(renderFile(user, await store.listNotes(user.id), today));
    await askNext(store, user, reply, m.now, false);
    return;
  }

  if (text === 'why' || text === '/why') {
    await reply(whyText(user));
    return;
  }

  if (text.startsWith('/note')) {
    const n = parseNote(m.text, today);
    if (!n) { await reply('What should I note? For example: /note left knee, no deep squats'); return; }
    const note = await store.addNote(user.id, { ...n, source: 'user' }, m.now);
    await reply(`Noted #${note.id} (${note.kind}): ${note.text}. /me shows your file; /forget ${note.id} removes it.`);
    return;
  }

  const forget = /^\/forget\s+#?(\d+)$/.exec(text);
  if (forget) {
    const ok = await store.deleteNote(user.id, Number(forget[1]));
    await reply(ok ? `Removed #${forget[1]}.` : `No note #${forget[1]} on your file.`);
    return;
  }

  const w = WEIGHT_RE.exec(m.text.trim());
  if (w) {
    const lb = parseWeightLb(w[1]);
    if (lb === null) { await reply('A number in lb or kg, please. For example: /weight 231.4'); return; }
    await store.addWeighIn(user.id, today, lb, m.now);
    user = await store.updateUser(user.id, { weightLb: lb });
    await reply(weighInReply(await store.listWeighIns(user.id), today));
    await askNext(store, user, reply, m.now, false);
    return;
  }

  await reply(NOT_BUILT_TEXT);
  await askNext(store, user, reply, m.now, false);
}

// Ask the next onboarding question if one is due. On day one the three
// first questions come back to back; afterwards at most one a day.
async function askNext(store: Store, user: User, reply: (t: string) => Promise<void>, now: Date, dayOne: boolean): Promise<void> {
  const today = dayKey(now, user.tz);
  const q = nextQuestion(user, today);
  if (!q) return;
  if (!dayOne && !dayOneDone(user) && !q) return;
  await store.updateUser(user.id, { pendingField: q.field, lastAskedDay: today });
  await reply(q.ask);
}

function ackFor(field: ProfileField, p: Profile): string | null {
  switch (field) {
    case 'heightIn':
    case 'sex':
    case 'age': {
      const t = p.heightIn && p.sex && p.age !== null ? numbersText(p) : null;
      return t ? `Thanks. ${t.split('\n').find((l) => l.startsWith('Calories')) ?? ''}`.trim() : 'Thanks.';
    }
    case 'shotDay': return 'Thanks. The day after your shot gets an easier plan, and the day before is usually the hungry one.';
    case 'tz': return 'Thanks. Evening messages will land in your evening.';
    case 'goalLb': return 'Thanks. The pace line will read against it.';
    default: return 'Thanks.';
  }
}
