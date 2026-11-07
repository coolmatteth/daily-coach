import type { Channel } from './types';
import type { Store } from './store';
import { sendMessage } from './telegram';

// How a message reaches a person. The bot never knows which one it has.
// Telegram today; SMS or WhatsApp later is a new class here and nothing
// else changes (spec: "a configuration change, never a rewrite").
export interface Transport {
  readonly channel: Channel;
  send(chatId: string, text: string): Promise<void>;
}

export class TelegramTransport implements Transport {
  readonly channel: Channel = 'telegram';
  constructor(private token: string) {}
  async send(chatId: string, text: string): Promise<void> {
    await sendMessage(this.token, chatId, text);
  }
}

// Staging never texts anyone: every send lands in the outbox table, where
// the deploy check and the simulated users read it.
export class OutboxTransport implements Transport {
  constructor(private store: Store, readonly channel: Channel, private now: () => Date) {}
  async send(chatId: string, text: string): Promise<void> {
    await this.store.appendOutbox(this.channel, chatId, text, this.now());
  }
}

// For tests, and for the /sim/message route, which hands the caller back
// exactly what the bot said in reply to that one message.
export class FakeTransport implements Transport {
  readonly sent: { chatId: string; text: string }[] = [];
  constructor(readonly channel: Channel = 'sim', private also?: Transport) {}
  async send(chatId: string, text: string): Promise<void> {
    this.sent.push({ chatId, text });
    if (this.also) await this.also.send(chatId, text);
  }
}
