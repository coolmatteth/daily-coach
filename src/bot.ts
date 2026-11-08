import type { Channel, FoodEntry, FoodItem, Profile, ProfileField, User } from './types';
import type { Store, StoredMeal } from './store';
import type { Transport } from './transport';
import { addDays, dayKey, weekday } from './clock';
import {
  DAY_ONE_FIELDS, MAX_ASKS, MAX_RETRIES, dayOneDone, isMissing, isSkip, nextQuestion, numbersText, parseNote, parseWeightLb, questionFor, renderFile, userTargets, whyText,
} from './athlete';
import { weighInReply, plateau } from './weighins';
import {
  aliasLines, applyEdit, atTime, clock, dayTotals, itemList, loggedReply, matchAlias, mergeInto, mergeTarget, normalizeWord, parseAlias,
  recompute, status, todayList, weekSummary, YES,
} from './food';
import { systemPrompt, todayContext, type Block, type Estimator } from './estimator';
import { QUOTA_MESSAGE, takeModelCall } from './quota';
import { prescriberSummary, weeklyRecap, weeksOnDose } from './recap';
import { checkInReply, CHECKIN_RANGE_TEXT, looksLikeCheckIn, parseCheckIn, renderPlan, ROUGH_STOMACH } from './plans';
import { dayAfterShot as isDayAfterShot, planFor, recordSets } from './training';

export interface Incoming {
  store: Store;
  transport: Transport;
  channel: Channel;
  chatId: string;
  text: string;
  now: Date;
  version: string;
  // The Food Log's model call and photo, when the route has them.
  estimator?: Estimator;
  photo?: () => Promise<Block | null>;
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
export const HELP_TEXT = [
  'Text or photograph what you eat and I keep the protein total against your tiers. Corrections in plain words work ("remove the shake", "that was 1 bar not 2"). Meals within 20 minutes count as one sitting. A shortcut word on its own logs a fixed item; /aliases lists them.',
  '',
  'After the gym, reply with your numbers: "leg press 180 x 10 x 3". On a rest day, two numbers for stomach and energy: "4 3".',
  '',
  '/plan · /today · /week · /recap · /delete N · /undo · /me · /note · /weight · /checkin · why',
].join('\n');
export const SKIPPED_TEXT = 'Skipped. You can give it later by telling me.';
export const BUSY_TEXT = 'One at a time: I am still on your last message. Send that again in a moment.';
export const PENDING_TTL_MS = 15 * 60 * 1000;
export const LOCK_TTL_MS = 30 * 1000;

export function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isDeleteMe(text: string): boolean {
  const t = normalize(text);
  return t === 'delete me' || t === '/delete me' || t === '/deleteme' || t === '/delete_me';
}

const WEIGHT_RE = /^\/?(?:weight|weighed|weigh-in|weighin)\s+(.+)$/i;
// Words that answer nothing. A single word not on this list ("burrito",
// "shake") is read as a meal, never as a failed answer.
const NON_ANSWER = /^(idk|dunno|whatever|whenever|maybe|later|no|nah|nope|hmm+|hm+|ok|okay|lol|k|\?+|not sure|no idea|dont know|don't know)$/i;
const COMMANDS = new Set(['/me', '/file', '/why', '/help', '/version', '/start', '/note', '/forget', '/weight', '/plan', '/checkin']);
const FOOD_COMMANDS = new Set(['/today', '/week', '/recap', '/undo', '/delete', '/aliases', '/shortcuts', '/alias', '/shortcut']);

// One message in, zero or more out. No HTTP, no Telegram, no D1 in here:
// the tests call this with a MemoryStore, a FakeTransport and a fake Estimator.
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
    await askNext(store, user, reply, m.now);
    return;
  }

  if (!user) {
    await reply(NOT_STARTED_TEXT);
    return;
  }

  // One in-flight message per user: two fast messages must never both
  // read the day, append, and write, losing one.
  if (!(await store.acquireLock(user.id, m.now, LOCK_TTL_MS))) {
    await reply(BUSY_TEXT);
    return;
  }
  try {
    await handleForUser(m, user, reply);
  } finally {
    await store.releaseLock(user.id);
  }
}

async function handleForUser(m: Incoming, user: User, reply: (t: string) => Promise<void>): Promise<void> {
  const { store } = m;
  const text = normalize(m.text);
  const today = dayKey(m.now, user.tz);
  const cmd = text.split(' ')[0];
  const hasPhoto = Boolean(m.photo);

  // An answer to the question in flight, unless it is a command, a
  // weigh-in or a photo, which a pending question must never swallow.
  const commandLike = text.startsWith('/') || text === 'why' || text === 'me' || WEIGHT_RE.test(m.text.trim()) || hasPhoto;
  if (user.pendingField && !commandLike) {
    const q = questionFor(user.pendingField);
    if (isSkip(m.text)) {
      user = await store.updateUser(user.id, { pendingField: null, skipped: [...user.skipped, q.field] });
      await reply(SKIPPED_TEXT);
      await askNext(store, user, reply, m.now);
      return;
    }
    const parsed = q.parse(m.text);
    if (parsed) {
      const wasDone = dayOneDone(user);
      user = await store.updateUser(user.id, { ...parsed, pendingField: null, pendingTries: 0 });
      if (!wasDone && dayOneDone(user)) {
        await reply(numbersText(user));
        await store.updateUser(user.id, { lastAskedDay: today });
        return;
      }
      const ack = DAY_ONE_FIELDS.includes(q.field) ? null : ackFor(q.field, user);
      if (ack) await reply(ack);
      await askNext(store, user, reply, m.now);
      return;
    }
    if (DAY_ONE_FIELDS.includes(q.field) && user.pendingTries < MAX_RETRIES) {
      user = await store.updateUser(user.id, { pendingTries: user.pendingTries + 1 });
      await reply(q.retry);
      return;
    }
    // A single word that answers nothing ("whenever", "idk") gets the retry
    // once rather than a trip to the food model, but only while the
    // question is fresh (asked today) and the word is not a shortcut.
    if (!DAY_ONE_FIELDS.includes(q.field) && user.lastAskedDay === today && user.pendingTries < 1 && NON_ANSWER.test(m.text.trim())) {
      user = await store.updateUser(user.id, { pendingTries: 1 });
      await reply(q.retry);
      return;
    }
    // Twice not an answer: set the question aside for today and read the
    // message as what it probably is, a meal or a note. The question comes
    // back tomorrow. (Found by the simulated users, 11/8/26.)
    user = await store.updateUser(user.id, { pendingField: null, pendingTries: 0, deferredDay: DAY_ONE_FIELDS.includes(q.field) ? today : user.deferredDay });
  }

  // A late answer to the question asked earlier today, after a meal or two
  // came between and the question was set aside. "Thursday" the morning
  // after "Which day is your shot?" still counts. (Found by the simulated
  // users, 11/8/26.)
  if (!user.pendingField && user.lastAskedField && user.lastAskedDay === today && isMissing(user, user.lastAskedField) && !commandLike && !DAY_ONE_FIELDS.includes(user.lastAskedField)) {
    const q = questionFor(user.lastAskedField);
    if (isSkip(m.text)) {
      user = await store.updateUser(user.id, { lastAskedField: null, skipped: [...user.skipped, q.field] });
      await reply(SKIPPED_TEXT);
      return;
    }
    const parsed = q.parse(m.text);
    if (parsed) {
      user = await store.updateUser(user.id, { ...parsed, lastAskedField: null });
      const ack = ackFor(q.field, user);
      if (ack) await reply(ack);
      return;
    }
  }

  if (cmd === '/help') { await reply(HELP_TEXT); return; }

  if (cmd === '/me' || text === 'me' || cmd === '/file') {
    await reply(renderFile(user, await store.listNotes(user.id), today));
    await askNext(store, user, reply, m.now);
    return;
  }

  if (text === 'why' || cmd === '/why') { await reply(whyText(user)); return; }

  if (cmd === '/note') {
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
    await askNext(store, user, reply, m.now);
    return;
  }

  // ---- training ----
  if (cmd === '/plan') {
    const plan = await planFor(store, user, today);
    if (plan) { await store.savePlan(user.id, today, JSON.stringify(plan), m.now); await reply(renderPlan(plan, false)); }
    else await reply((user.liftingDays ?? 0) === 0 ? 'No lifting days set. Tell me how many days a week you can lift and the plans start.' : 'Today is a rest day. Your next plan arrives this evening for tomorrow.');
    return;
  }
  const checkinText = cmd === '/checkin' ? m.text.trim().slice(8) : m.text;
  const checkin = parseCheckIn(checkinText);
  if (!checkin && (cmd === '/checkin' || looksLikeCheckIn(checkinText))) { await reply(CHECKIN_RANGE_TEXT); return; }
  if (checkin && (cmd === '/checkin' || !hasPhoto)) {
    // Two small numbers are the check-in, asked or not; a weight is never
    // two digits, a meal never two bare digits.
    const forDay = user.pendingCheckinDay ?? today;
    await store.addCheckIn(user.id, { day: forDay, ...checkin }, m.now);
    user = await store.updateUser(user.id, { pendingCheckinDay: null });
    await reply(checkInReply(checkin, isDayAfterShot(user, forDay)));
    return;
  }
  if (!text.startsWith('/') && !hasPhoto) {
    const recorded = await recordSets(store, user, m.text, today, m.now);
    if (recorded) { await reply(recorded); return; }
  }

  // ---- the Food Log ----
  if (text.startsWith('/') && !FOOD_COMMANDS.has(cmd)) {
    await reply(COMMANDS.has(cmd) ? HELP_TEXT : `I don't know ${cmd}.\n${HELP_TEXT}`);
    return;
  }
  const targets = userTargets(user);
  if (!targets) {
    if (user.deferredDay === today) {
      // Already set the questions aside today: say what is needed once, no new question.
      await reply('I can keep a food log once I have your weight. Send it any time, like "weight 232".');
      return;
    }
    await reply("I'll keep that once I have your weight, which your protein numbers come from. What do you weigh?");
    await store.updateUser(user.id, { pendingField: 'weightLb', pendingTries: 0, lastAskedDay: today, deferredDay: null });
    return;
  }
  const tiers = targets.protein;
  const band = targets.kcal;
  const tz = user.tz;
  const dayAfterShot = (day: string) => user.shotDay !== null && user.shotDay >= 0 && weekday(day) === (user.shotDay + 1) % 7;

  if (cmd === '/today') {
    await reply(todayList(await store.listMeals(user.id, today), tiers, tz));
    return;
  }
  if (cmd === '/week') {
    await reply(weekSummary(await store.daySummaries(user.id, addDays(today, -6), today), tiers, band, dayAfterShot));
    return;
  }
  if (cmd === '/recap') {
    await reply(await recapText(store, user, today));
    return;
  }
  if (cmd === '/aliases' || cmd === '/shortcuts') {
    await reply(`Shortcuts (send the word alone to log it):\n${aliasLines(await store.listAliases(user.id))}`);
    return;
  }
  if (cmd === '/alias' || cmd === '/shortcut') {
    const rm = /^\/(alias|shortcut)(@\w+)?\s+(remove|delete|drop)\s+(.+)$/i.exec(m.text.trim());
    if (rm) {
      const word = normalizeWord(rm[4]);
      const ok = await store.removeAlias(user.id, word);
      await reply(ok ? `Removed "${word}".\n${aliasLines(await store.listAliases(user.id))}` : `No shortcut named "${word}".\n${aliasLines(await store.listAliases(user.id))}`);
      return;
    }
    const parsed = parseAlias(m.text);
    if ('error' in parsed) { await reply(parsed.error); return; }
    await store.setAlias(user.id, parsed);
    await reply(`Saved: "${parsed.word}" = ${parsed.item.name}, ${Math.round(parsed.item.protein_g)} g, ${Math.round(parsed.item.kcal)} kcal. Send "${parsed.word}" on its own to log it.`);
    return;
  }
  if (cmd === '/undo' || cmd === '/delete') {
    const entries = await store.listMeals(user.id, today);
    const n = cmd === '/delete' ? Number(text.split(' ')[1]) : entries.length;
    if (!entries.length) { await reply('Nothing to delete today.'); return; }
    if (!Number.isInteger(n) || n < 1 || n > entries.length) { await reply(`Which one? /delete 1 to ${entries.length}:\n${todayList(entries, tiers, tz)}`); return; }
    const removed = entries[n - 1];
    await store.deleteMeal(user.id, removed.id);
    const rest = entries.filter((e) => e.id !== removed.id);
    await reply(`Deleted ${n}. ${itemList(removed.items) || removed.text} (${Math.round(removed.protein_g)} g).\n${status(rest, tiers)}`);
    return;
  }

  // A meal, a correction, a question, or a photo.
  const entries = await store.listMeals(user.id, today);
  const aliases = await store.listAliases(user.id);
  const nowIso = m.now.toISOString();

  // A shortcut word on its own logs its fixed item: no model, no guess.
  const alias = !hasPhoto ? matchAlias(m.text, aliases) : undefined;
  if (alias) {
    await logEntry(store, user, today, entries, recompute({ at: nowIso, text: m.text.trim().slice(0, 300), photo: false, items: [{ ...alias.item }], confidence: 'high', protein_g: 0, kcal: 0 }), reply, tiers, tz, m.now);
    await askNext(store, user, reply, m.now);
    return;
  }

  // "save" after a one-word meal makes it a shortcut; a definition after an
  // unknown word logs it and saves it. (Matt, 11/8/26: "how do you remove
  // friction so they engage instead of bounce.")
  if (user.pendingAliasWord && !hasPhoto) {
    const word = user.pendingAliasWord;
    if (/^(save|yes save|save it)$/i.test(m.text.trim()) && user.pendingAliasItem) {
      const item = JSON.parse(user.pendingAliasItem) as FoodItem;
      await store.setAlias(user.id, { word, item });
      await store.updateUser(user.id, { pendingAliasWord: null, pendingAliasItem: null });
      await reply(`Saved: "${word}" = ${item.name}, ${Math.round(item.protein_g)} g, ${Math.round(item.kcal)} kcal. Send "${word}" on its own to log it.`);
      return;
    }
    const def = parseAlias(`/alias ${word} = ${m.text}`);
    if (!('error' in def) && !user.pendingAliasItem) {
      await store.setAlias(user.id, def);
      await store.updateUser(user.id, { pendingAliasWord: null, pendingAliasItem: null });
      await logEntry(store, user, today, entries, recompute({ at: nowIso, text: word, photo: false, items: [{ ...def.item }], confidence: 'high', protein_g: 0, kcal: 0 }), reply, tiers, tz, m.now);
      await reply(`And "${word}" is a shortcut now: send it on its own next time.`);
      return;
    }
    await store.updateUser(user.id, { pendingAliasWord: null, pendingAliasItem: null });
    user = { ...user, pendingAliasWord: null, pendingAliasItem: null };
  }

  // A plain "yes" to a question logs what was asked about, no model call.
  const pending = readPending(user, m.now);
  if (pending && YES.test(m.text.trim()) && !hasPhoto) {
    await store.updateUser(user.id, { pendingMeal: null, pendingUntil: null });
    await logEntry(store, user, today, entries, { ...pending, at: nowIso }, reply, tiers, tz, m.now);
    await askNext(store, user, reply, m.now);
    return;
  }

  if (!m.estimator) {
    // No model wired (tests, or a worker without a key): say what works.
    await reply(HELP_TEXT);
    await askNext(store, user, reply, m.now);
    return;
  }
  if (!text && !hasPhoto) return;

  // Every model call counts against the day's cap.
  if (!(await takeModelCall(store, user.id, hasPhoto ? 'photo' : 'meal', m.now))) {
    await reply(QUOTA_MESSAGE);
    return;
  }

  const content: Block[] = [];
  if (m.photo) { const img = await m.photo(); if (img) content.push(img); }
  content.push({ type: 'text', text: m.text.trim() || 'What is in this photo? Estimate it as a meal I ate.' });

  const act = await m.estimator.decide(systemPrompt(user, tiers, aliases), todayContext(entries, tz, pending), content);
  if (pending) await store.updateUser(user.id, { pendingMeal: null, pendingUntil: null });

  if (act.action === 'answer' || (act.action === 'log' && !act.items.length)) {
    await reply(`${act.reply || 'Send a meal to log it.'}\n${status(entries, tiers)}`);
    await askNext(store, user, reply, m.now);
    return;
  }

  if (act.action === 'ask' || (act.action === 'log' && act.confidence === 'low')) {
    // Nothing is written on a guess. The reading is parked for 15 minutes;
    // "yes" logs it, anything else is read as the correction.
    const draft: FoodEntry = recompute({ at: atTime(today, act.time, nowIso, tz), text: m.text.trim().slice(0, 300), photo: hasPhoto, items: act.items, confidence: act.confidence, protein_g: 0, kcal: 0 });
    // Nothing to confirm when the model read no food at all: a "yes" to
    // an empty draft would log an empty meal.
    if (draft.items.length) await store.updateUser(user.id, { pendingMeal: JSON.stringify(draft), pendingUntil: new Date(m.now.getTime() + PENDING_TTL_MS).toISOString() });
    const reading = draft.items.length ? ` I read it as ${itemList(draft.items)}, ~${Math.round(draft.protein_g)} g.` : '';
    const bareNumber = /^\d{2,3}(\.\d)?$/.test(m.text.trim()) ? ' If that is your weight, say "weight ' + m.text.trim() + '".' : '';
    const word = normalizeWord(m.text);
    const shortWord = !draft.items.length && !hasPhoto && word.length >= 3 && word.split(' ').length <= 2 && /^[a-z ]+$/.test(word);
    if (shortWord) {
      // One word the model cannot read is usually the person's own name for
      // a staple. One definition logs it and makes it a shortcut.
      await store.updateUser(user.id, { pendingAliasWord: word, pendingAliasItem: null });
      await reply(`I don't know "${word}" yet. Tell me what's in it once, like "whey 2 scoops, 50 g, 240 kcal", and I'll log it and make "${word}" a shortcut.`);
      return;
    }
    await reply(draft.items.length
      ? `${act.question || 'What was that, exactly?'}${reading}\nReply "yes" to log it, or tell me what it was.`
      : `${act.question || 'What was that, exactly?'}${bareNumber}\nTell me what it was and I will log it.`);
    return;
  }

  if (act.action === 'edit') {
    const result = applyEdit(entries, act.entry, act.remove_items, act.items);
    if (!entries.length || (!result.removed.length && !result.added.length && !result.deletedEntry)) {
      const named = act.remove_items.length ? act.remove_items.join(', ') : 'that';
      await reply(entries.length ? `No ${named} in today's meals. /today shows what is.` : 'Nothing logged yet today to change.');
      return;
    }
    if (result.deletedEntry) await store.deleteMeal(user.id, result.deletedEntry.id);
    else if (result.changed) await store.updateMeal(user.id, result.changed.id, result.changed);
    const parts: string[] = [];
    if (result.deletedEntry) parts.push(`Deleted ${itemList(result.deletedEntry.items) || result.deletedEntry.text} (${Math.round(result.deletedEntry.protein_g)} g)`);
    else {
      if (result.removed.length) parts.push(`Removed ${itemList(result.removed)}`);
      if (result.added.length) parts.push(`${result.removed.length ? 'added' : 'Added'} ${itemList(result.added)}`);
    }
    await reply(`${parts.join(', ')}.\n${status(result.entries, tiers)}`);
    await askNext(store, user, reply, m.now);
    return;
  }

  const entry: FoodEntry = recompute({ at: atTime(today, act.time, nowIso, tz), text: m.text.trim().slice(0, 300), photo: hasPhoto, items: act.items, confidence: act.confidence, protein_g: 0, kcal: 0 });
  await logEntry(store, user, today, entries, entry, reply, tiers, tz, m.now, Boolean(act.time));
  // A short name for a meal the model read: offer to make it one word.
  const short = normalizeWord(m.text);
  if (!hasPhoto && short.length >= 3 && short.split(' ').length <= 2 && /^[a-z ]+$/.test(short) && !aliases.some((a) => a.word === short)) {
    const item: FoodItem = { name: entry.items.map((i) => i.name).join(', '), protein_g: entry.protein_g, kcal: entry.kcal };
    await store.updateUser(user.id, { pendingAliasWord: short, pendingAliasItem: JSON.stringify(item) });
    await reply(`Want "${short}" to mean this every time? Reply "save".`);
  }
  // The day's one onboarding question rides on a logged meal, so a person
  // who only ever logs food still gets asked for height, age and time zone.
  // (Found by the simulated users, 11/8/26: Dana was never asked.)
  await askNext(store, user, reply, m.now);
}

function readPending(user: User, now: Date): FoodEntry | undefined {
  if (!user.pendingMeal || !user.pendingUntil) return undefined;
  if (Date.parse(user.pendingUntil) < now.getTime()) return undefined;
  try { return JSON.parse(user.pendingMeal) as FoodEntry; } catch { return undefined; }
}

async function logEntry(store: Store, user: User, today: string, entries: StoredMeal[], entry: FoodEntry, reply: (t: string) => Promise<void>, tiers: { floor: number; goal: number; stretch: number }, tz: string | null, now: Date, explicitTime = false): Promise<void> {
  const idx = mergeTarget(entries, entry.at, explicitTime);
  if (idx >= 0) {
    const merged = mergeInto(entries[idx], entry);
    await store.updateMeal(user.id, merged.id, merged);
    const next = entries.map((e, i) => (i === idx ? merged : e));
    await reply(`Added to your ${clock(merged.at, tz)} meal: ${itemList(entry.items)} (+${Math.round(entry.protein_g)} g, meal now ${Math.round(merged.protein_g)} g, ${Math.round(merged.kcal)} kcal).\n${status(next, tiers)}`);
    return;
  }
  const stored = await store.addMeal(user.id, today, entry, now);
  const next = [...entries, stored];
  const t = dayTotals(next);
  await reply(loggedReply(stored, t.protein_g, t.kcal, tiers));
}

// The Sunday text: the verdict, then the prescriber summary.
export async function recapText(store: Store, user: User, today: string): Promise<string> {
  const targets = userTargets(user);
  if (!targets) return 'I need your weight before I can read a week.';
  const days = await store.daySummaries(user.id, addDays(today, -14), addDays(today, -1));
  const dayAfterShot = (day: string) => user.shotDay !== null && user.shotDay >= 0 && weekday(day) === (user.shotDay + 1) % 7;
  const r = weeklyRecap({ days, band: targets.kcal, tiers: targets.protein, dayAfterShot });
  const notes = await store.listNotes(user.id);
  const weekStart = addDays(today, -7);
  const rough = (await store.listCheckIns(user.id, weekStart, addDays(today, -1))).filter((c) => c.stomach <= ROUGH_STOMACH).map((c) => c.day);
  const sideEffectDays = new Set([...notes.filter((n) => n.kind === 'illness' && n.date >= weekStart && n.date < today).map((n) => n.date), ...rough]).size;
  const ws = await store.listWeighIns(user.id);
  const trend = plateau(ws, addDays(today, -1));
  const weeks = ws.length ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${ws[0].date}T00:00:00Z`)) / (7 * 86_400_000)) : 0;
  const summary = prescriberSummary({
    drug: user.drug, weeksOnDose: weeksOnDose(notes, today), sideEffectDays,
    proteinGoalDays: r.proteinGoalDays, loggedDays: r.loggedDays, kcalAvg: r.kcalAvg, band: targets.kcal,
    trendPct12wk: trend ? trend.changePct : null, weeks,
  });
  return summary ? `${r.text}\n\n${summary}` : r.text;
}

// Ask the next onboarding question if one is due. On day one the three
// first questions come back to back; afterwards at most one a day.
async function askNext(store: Store, user: User, reply: (t: string) => Promise<void>, now: Date): Promise<void> {
  const today = dayKey(now, user.tz);
  const q = nextQuestion(user, today);
  if (!q) return;
  const count = user.lastAskedField === q.field ? user.askCount + 1 : 1;
  if (!DAY_ONE_FIELDS.includes(q.field) && count > MAX_ASKS) {
    // Asked three times, never answered: stop. (Linda, 11/8/26: asked her
    // shot day nineteen days running.)
    await store.updateUser(user.id, { skipped: [...user.skipped, q.field], lastAskedField: null, askCount: 0 });
    await reply(`I'll stop asking about that. Tell me any time if you want it on your file.`);
    return;
  }
  await store.updateUser(user.id, { pendingField: q.field, lastAskedDay: today, lastAskedField: q.field, askCount: count });
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
