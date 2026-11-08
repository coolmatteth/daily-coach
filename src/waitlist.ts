// The waitlist route (11/8/26). The static site posts an email here; the
// worker keeps it in D1 and says thanks. No third party sees it.
import type { Env } from './types';

export const ALLOWED_ORIGINS = [
  'https://dailycoach.fitness',
  'https://www.dailycoach.fitness',
];

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Vercel preview deployments of the same site.
  return /^https:\/\/fitness-claude-demo(-[a-z0-9-]+)?\.vercel\.app$/.test(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin) && origin.includes('fitness-claude-demo');
}

export function corsHeaders(origin: string | null): Record<string, string> {
  return isAllowedOrigin(origin)
    ? { 'Access-Control-Allow-Origin': origin as string, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' }
    : {};
}

// Good enough for a sign-up form: something@something.something, no spaces.
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return null;
  return e;
}

export async function addToWaitlist(env: Env, email: string, source: string, now: Date): Promise<'added' | 'already'> {
  const r = await env.DB.prepare('INSERT INTO waitlist (email, source, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING')
    .bind(email, source, now.toISOString()).run();
  return (r.meta?.changes ?? 0) > 0 ? 'added' : 'already';
}

export async function waitlistCount(env: Env): Promise<number> {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM waitlist').first<{ n: number }>();
  return r?.n ?? 0;
}

export const THANKS_TEXT = "You're on the list. One email when the next channel opens, and nothing else.";
export const ALREADY_TEXT = "You're already on the list.";
