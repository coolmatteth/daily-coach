import type { Channel } from './types';
import type { Store } from './store';
import type { Transport } from './transport';

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
  "I'm the experimental stage of a coach for people on a GLP-1 who lift or want to start. Right now I can take /start, /version and \"delete me\". The questions, the food log and the daily plan arrive with the next builds.",
  '',
  'Send "delete me" at any time and everything you told me is gone.',
].join('\n');

export const DELETED_TEXT = 'Done. Everything you told me is deleted. Say /start if you ever want to begin again.';
export const NOT_STARTED_TEXT = 'Say /start to begin.';
export const NOT_BUILT_TEXT = "Not built yet. For now I know /start, /version and \"delete me\".";

export function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isDeleteMe(text: string): boolean {
  const t = normalize(text);
  return t === 'delete me' || t === '/delete me' || t === '/deleteme' || t === '/delete_me';
}

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

  const user = await store.getUserByChat(channel, chatId);

  if (isDeleteMe(m.text)) {
    if (user) await store.deleteUser(user.id);
    await reply(DELETED_TEXT);
    return;
  }

  if (text === '/start' || text.startsWith('/start ')) {
    if (!user) await store.createUser(channel, chatId, m.now);
    await reply(START_TEXT);
    return;
  }

  if (!user) {
    await reply(NOT_STARTED_TEXT);
    return;
  }

  await reply(NOT_BUILT_TEXT);
}
