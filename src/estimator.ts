// The one model call the Food Log makes (PR 3, 11/7/26): read one message
// (text, or a photo with a caption) and name an action. The system prompt is
// built per user from their file, never from a constant. The bot talks to
// the Estimator interface; tests use a fake and never reach the network.
import Anthropic from '@anthropic-ai/sdk';
import type { Confidence, FoodAlias, FoodEntry, FoodItem, Profile } from './types';
import type { ProteinTiers } from './targets';
import { clock } from './food';

export type Block =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp'; data: string } };

export interface Action {
  action: 'log' | 'edit' | 'ask' | 'answer';
  items: FoodItem[];
  entry: number | null;
  remove_items: string[];
  time: string;
  confidence: Confidence;
  question: string;
  reply: string;
}

export interface Estimator {
  decide(system: string, context: string, content: Block[]): Promise<Action>;
}

const ITEMS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', description: 'short name, e.g. "chicken bowl"' },
      protein_g: { type: 'number' },
      kcal: { type: 'number' },
    },
    required: ['name', 'protein_g', 'kcal'],
  },
} as const;

export const ACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string', enum: ['log', 'edit', 'ask', 'answer'],
      description: 'log: a meal they ate, to add. edit: a correction to a meal already logged today (remove items, replace an item, change a portion). ask: the food is unclear, ask one question before logging. answer: not about food they ate.',
    },
    items: { ...ITEMS_SCHEMA, description: 'log: the items eaten. edit: the items to ADD to the corrected entry (the replacement), empty when only removing.' },
    entry: { type: ['integer', 'null'], description: 'edit only: the 1-based number of the entry from TODAY SO FAR being corrected, or null when it is the latest one that has the item' },
    remove_items: { type: 'array', items: { type: 'string' }, description: 'edit only: names of items to remove from that entry, matching the names in TODAY SO FAR; empty to remove the whole entry' },
    time: { type: 'string', description: 'HH:MM 24-hour local time when they say when they ate ("lunch at 1pm" → "13:00"); empty otherwise' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    question: { type: 'string', description: 'ask only: one short question naming what you read, e.g. "Did you mean broccoli? About a cup?"; empty otherwise' },
    reply: { type: 'string', description: 'answer only: one or two plain sentences; empty otherwise' },
  },
  required: ['action', 'items', 'entry', 'remove_items', 'time', 'confidence', 'question', 'reply'],
} as const;

// The rules the model gets. The user's own facts come from their profile
// and shortcuts; nothing about any other person is in here.
export function systemPrompt(p: Profile, tiers: ProteinTiers, aliases: FoodAlias[]): string {
  const drug = p.drug && p.drug !== 'none' ? `is on ${p.drug} (a GLP-1 medication, so appetite is small and portions are often modest)` : 'is losing weight';
  const lifts = p.liftingDays ? `lifts ${p.liftingDays} day${p.liftingDays === 1 ? '' : 's'} a week` : 'is not lifting yet';
  const shortcuts = aliases.length
    ? `\nTHEIR SHORTCUTS (use these exact numbers whenever the word appears): ${aliases.map((a) => `"${a.word}" = ${a.item.name}, ${Math.round(a.item.protein_g)} g, ${Math.round(a.item.kcal)} kcal`).join('; ')}`
    : '';
  return `You keep a food log for one person who ${drug}, ${lifts}, and aims for ${tiers.goal} g of protein a day (${tiers.floor} g is the floor, ${tiers.stretch} g the stretch). Each message is one of: a meal they ate (action "log"), a correction to a meal already in TODAY SO FAR (action "edit"), food you cannot identify (action "ask"), or something else (action "answer").
- Estimate each item from typical US portions unless they give an amount. Prefer the label value when a photo shows a nutrition label or the item is a known packaged product. Never pad numbers to be encouraging.
- NEVER invent a food they did not name. A word you cannot read as a food (a typo, slang) is an "ask" with one question offering your best reading; it is never logged as something else. Only "log" what you are sure of; if one item of several is unclear, "ask" about the whole message.
- "Remove the shake", "I didn't have X", "that was broccoli not a shake", "two slices not one", "delete the pizza": action "edit". Name the items to remove exactly as they appear in TODAY SO FAR, and put any replacement or corrected item in items. "Remove the last one" with no item named: remove_items empty, entry null.
- "Lunch at 1pm, chicken bowl": log, with time "13:00".
- A photo of a nutrition label, or a second photo of a package already in TODAY SO FAR, is the SAME item, not a second one: action "edit" that removes that item by name and adds it back with the label's numbers (or action "answer" if the numbers already match). Only a different food is a new item.
- Never offer to log something ("tell me and I'll add it"). If the message names a food that is not in TODAY SO FAR and they seem to say they ate it, return "ask" with that item and a one-line question, so a plain "yes" logs it.
- Not about food they ate (a question, a plan, a joke): action "answer", one or two plain sentences. Never give advice about their medication or its dose; say that is for their prescriber.${shortcuts}`;
}

export function todayContext(entries: FoodEntry[], tz: string | null, pending?: FoodEntry): string {
  const head = entries.length
    ? 'TODAY SO FAR:\n' + entries.map((e, i) => `${i + 1}. ${clock(e.at, tz)}: ${e.items.map((it) => `${it.name} (${Math.round(it.protein_g)} g)`).join(', ') || e.text}`).join('\n')
    : 'TODAY SO FAR: nothing logged.';
  const pend = pending ? `\nPENDING (asked about, not logged): ${pending.items.map((it) => `${it.name} (${Math.round(it.protein_g)} g)`).join(', ')} — if this message confirms or corrects it, "log" the right items.` : '';
  return head + pend;
}

export const REFUSAL: Action = { action: 'answer', items: [], entry: null, remove_items: [], time: '', confidence: 'low', question: '', reply: 'I could not read that one. Try describing it in words.' };

export class ClaudeEstimator implements Estimator {
  constructor(private apiKey: string, private model: string) {}
  async decide(system: string, context: string, content: Block[]): Promise<Action> {
    const client = new Anthropic({ apiKey: this.apiKey });
    const res = await client.messages.create({
      model: this.model,
      max_tokens: 2000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ACTION_SCHEMA } },
      system: [{ type: 'text', text: system }, { type: 'text', text: context }],
      messages: [{ role: 'user', content: content as Anthropic.Messages.ContentBlockParam[] }],
    });
    if (res.stop_reason === 'refusal') return REFUSAL;
    const block = res.content.find((b) => b.type === 'text');
    try {
      return JSON.parse(block && block.type === 'text' ? block.text : '{}') as Action;
    } catch {
      return REFUSAL;
    }
  }
}
