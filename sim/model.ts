// A model plays a persona (PR 5, 11/8/26), when PERSONA_MODEL=1 and an API
// key is set. Two calls: what this person types today given their sheet and
// the last few messages, and at the end of a week the three questions the
// product needs answered. Everything the persona says is data; the coach
// never sees these prompts.
import Anthropic from '@anthropic-ai/sdk';
import type { Persona, DayContext } from './personas';

const model = () => process.env.PERSONA_MODEL_ID || 'claude-sonnet-5-5';

const MESSAGES_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { messages: { type: 'array', items: { type: 'string' }, description: 'what this person sends the coach today, in order, 0 to 8 short chat messages' } },
  required: ['messages'],
} as const;

export async function playPersona(p: Persona, ctx: DayContext, recent: string[]): Promise<string[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const hints = p.script(ctx);
  const res = await client.messages.create({
    model: model(), max_tokens: 800,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: MESSAGES_SCHEMA } },
    system: `You are playing a person testing a text-message fitness coach for people on GLP-1 medication. Stay in character. Write exactly what they would type into a chat: short, informal, sometimes sloppy. Never explain. Never write for the coach.\n\nWHO YOU ARE: ${p.sheet}`,
    messages: [{ role: 'user', content: `Day ${ctx.day + 1} (${ctx.date}, weekday ${ctx.weekday}). ${ctx.planText ? 'The coach sent you this plan for today:\n' + ctx.planText + '\nIf you went, reply with the numbers you lifted, one lift per line like "leg press 180 x 10 x 3".' : 'No training plan today.'} ${ctx.askedCheckIn ? 'The coach asked for your stomach and energy, 1 to 5, as two numbers.' : ''} ${ctx.pendingQuestion ? 'The coach\'s last message asked: "' + ctx.pendingQuestion + '". Answer it or ignore it, as this person would.' : ''}\n\nWhat happened to you today, for reference: ${hints.join(' | ') || 'an ordinary day'}.\n\nRecent chat:\n${recent.join('\n')}\n\nReturn the messages this person sends today.` }],
  });
  const block = res.content.find((b) => b.type === 'text');
  try { return (JSON.parse(block && block.type === 'text' ? block.text : '{}') as { messages?: string[] }).messages ?? []; } catch { return hints; }
}

export async function weeklyFeedback(p: Persona, week: number, weekTurns: string[]): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: model(), max_tokens: 600,
    output_config: { effort: 'low' },
    system: `You are the same person who just spent a week with a text-message coach. Answer honestly and briefly, in the first person, as this person would. WHO YOU ARE: ${p.sheet}`,
    messages: [{ role: 'user', content: `Week ${week} of chat:\n${weekTurns.join('\n').slice(-12000)}\n\nThree questions, two or three sentences each:\n1. What confused you?\n2. What would have made you stop using it?\n3. What do you wish it had said?` }],
  });
  const block = res.content.find((b) => b.type === 'text');
  return block && block.type === 'text' ? block.text : '';
}
