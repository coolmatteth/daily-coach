import type { Block } from './estimator';

const api = (token: string) => `https://api.telegram.org/bot${token}`;

// Plain text, no parse_mode: a stray underscore in a food name must never
// make Telegram reject the message.
export async function sendMessage(token: string, chatId: string, text: string): Promise<void> {
  await fetch(`${api(token)}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export async function sendTyping(token: string, chatId: string): Promise<void> {
  await fetch(`${api(token)}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
  });
}

// max_connections 1: Telegram delivers one update at a time, in order, and
// holds the next until the worker has answered. The per-user lock in
// bot.ts is the real guard; this keeps the queue short.
export async function setWebhook(token: string, url: string, secret: string): Promise<unknown> {
  const r = await fetch(`${api(token)}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, secret_token: secret, max_connections: 1, allowed_updates: ['message'] }),
  });
  return r.json();
}

export async function setMyCommands(token: string, commands: { command: string; description: string }[]): Promise<unknown> {
  const r = await fetch(`${api(token)}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands }),
  });
  return r.json();
}

export async function getWebhookInfo(token: string): Promise<unknown> {
  const r = await fetch(`${api(token)}/getWebhookInfo`);
  return r.json();
}

// The largest size of a photo message, as a base64 image block.
export async function photoBlock(token: string, fileId: string): Promise<Block | null> {
  const meta = (await (await fetch(`${api(token)}/getFile?file_id=${encodeURIComponent(fileId)}`)).json()) as { ok: boolean; result?: { file_path?: string } };
  if (!meta.ok || !meta.result?.file_path) return null;
  const bytes = new Uint8Array(await (await fetch(`https://api.telegram.org/file/bot${token}/${meta.result.file_path}`)).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: btoa(bin) } };
}

// The shape of the one update kind we accept (allowed_updates: message).
export interface TelegramUpdate {
  message?: {
    chat?: { id?: number };
    text?: string;
    caption?: string;
    photo?: { file_id: string; width: number; height: number }[];
  };
}
