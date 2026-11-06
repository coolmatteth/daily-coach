export interface Env {
  DB: D1Database;
  STAGING?: string;
  GIT_SHA?: string;
  DEPLOYED_BY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ADMIN_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
}

export type Channel = 'telegram' | 'sim';

export interface User {
  id: number;
  channel: Channel;
  chatId: string;
  createdAt: string;
  tz: string | null;
}
