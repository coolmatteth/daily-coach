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

// max_connections 1: Telegram delivers one update at a time, in order, and
// holds the next until the worker has answered. With one bot and few users
// that is the serialization; a per-user lock replaces it in PR 3.
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

// The shape of the one update kind we accept (allowed_updates: message).
export interface TelegramUpdate {
  message?: { chat?: { id?: number }; text?: string };
}
