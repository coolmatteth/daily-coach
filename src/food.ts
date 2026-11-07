// The Food Log's plain-code parts (PR 3, 11/7/26), rebuilt from the private
// coach with the same shape: totals, tiers, the bar, corrections, the
// twenty-minute merge, shortcuts. The model only reads one message and
// names an action (estimator.ts); everything that has to be right is here.
import type { Confidence, DaySummary, FoodAlias, FoodEntry, FoodItem } from './types';
import type { KcalBand, ProteinTiers } from './targets';

export type Tier = 'under' | 'floor' | 'goal' | 'stretch';
export type KcalDay = 'light' | 'band' | 'big';

export function dayTotals(entries: FoodEntry[]): { protein_g: number; kcal: number; meals: number } {
  return {
    protein_g: Math.round(entries.reduce((n, e) => n + e.protein_g, 0)),
    kcal: Math.round(entries.reduce((n, e) => n + e.kcal, 0)),
    meals: entries.length,
  };
}

export function tierOf(protein_g: number, t: ProteinTiers): Tier {
  return protein_g >= t.stretch ? 'stretch' : protein_g >= t.goal ? 'goal' : protein_g >= t.floor ? 'floor' : 'under';
}
export const TIER_LABEL: Record<Tier, string> = { under: 'under the floor', floor: 'floor', goal: 'goal ✓', stretch: 'stretch 🏆' };

// All three rungs on every line: the gap until passed, then a check, and
// past the top the surplus. "89 → floor · 119 → goal · 149 → stretch".
export function tierLine(protein_g: number, t: ProteinTiers): string {
  const p = Math.round(protein_g);
  const rung = (name: string, at: number, last = false) =>
    p >= at ? `${name} ✅${last ? ` +${p - at}` : ''}` : `${at - p} → ${name}`;
  return [rung('floor', t.floor), rung('goal', t.goal), rung('stretch', t.stretch, true)].join(' · ');
}

// A bar as wide as the stretch tier, with a gap at the floor and the goal.
export const BAR_CELLS = 12;
export function tierBar(protein_g: number, t: ProteinTiers): string {
  const per = t.stretch / BAR_CELLS;
  const filled = Math.max(0, Math.min(BAR_CELLS, Math.floor(protein_g / per)));
  const cells = Array.from({ length: BAR_CELLS }, (_, i) => (i < filled ? '▰' : '▱'));
  const cut = (g: number) => Math.round(g / per);
  const a = cells.slice(0, cut(t.floor)).join(''), b = cells.slice(cut(t.floor), cut(t.goal)).join(''), c = cells.slice(cut(t.goal)).join('');
  return [a, b, c].filter(Boolean).join(' ');
}

export const kc = (n: number) => `${Math.round(n).toLocaleString('en-US')} kcal`;

export function statusLine(protein_g: number, kcal: number | undefined, t: ProteinTiers): string {
  const head = `Today: ${Math.round(protein_g)} g protein${kcal == null ? '' : ` · ${kc(kcal)}`}`;
  return `${head}\n${tierBar(protein_g, t)}  ${tierLine(protein_g, t)}`;
}
export const status = (entries: FoodEntry[], t: ProteinTiers) => { const d = dayTotals(entries); return statusLine(d.protein_g, d.kcal, t); };

export const itemList = (items: FoodItem[]) => items.map((i) => `${i.name} ${Math.round(i.protein_g)} g`).join(', ');

export function loggedReply(entry: FoodEntry, todayProtein: number, todayKcal: number | undefined, t: ProteinTiers): string {
  const items = itemList(entry.items);
  return `Logged ~${Math.round(entry.protein_g)} g protein, ~${Math.round(entry.kcal)} kcal${items ? `: ${items}` : ''}.\n${statusLine(todayProtein, todayKcal, t)}`;
}

export function kcalDayOf(kcal: number, b: KcalBand): KcalDay {
  return kcal < b.floor ? 'light' : kcal > b.ceiling ? 'big' : 'band';
}

// "4:22 PM" in the user's time zone.
export function clock(iso: string, tz: string | null): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz ?? 'UTC' });
}

// /today: every meal numbered, so "delete 3" and "the second one" mean something.
export function todayList(entries: FoodEntry[], t: ProteinTiers, tz: string | null): string {
  const lines = entries.map((e, i) => `${i + 1}. ${clock(e.at, tz)} — ${itemList(e.items) || e.text} (${Math.round(e.protein_g)} g · ${Math.round(e.kcal)} kcal)`);
  return `${lines.join('\n') || 'Nothing logged yet today.'}\n${status(entries, t)}`;
}

export function weekSummary(days: DaySummary[], t: ProteinTiers, b: KcalBand | null, dayAfterShot: (day: string) => boolean = () => false): string {
  const logged = days.filter((d) => d.meals > 0);
  const avg = logged.length ? Math.round(logged.reduce((n, d) => n + d.protein_g, 0) / logged.length) : 0;
  const avgKcal = logged.length ? logged.reduce((n, d) => n + d.kcal, 0) / logged.length : null;
  const mark = (d: DaySummary) => !b ? '' : { light: dayAfterShot(d.day) ? ' · light day, post-shot' : ' · light day', band: '', big: ' · big day' }[kcalDayOf(d.kcal, b)];
  const lines = days.map((d) => `${d.day.slice(5).replace('-', '/')} — ${d.meals
    ? `${d.protein_g} g · ${kc(d.kcal)} · ${TIER_LABEL[tierOf(d.protein_g, t)]}${mark(d)}`
    : 'nothing logged'}`);
  if (!logged.length) return `Nothing logged in the last 7 days.\n${lines.join('\n')}`;
  const count = (tier: Tier) => logged.filter((d) => tierOf(d.protein_g, t) === tier).length;
  const head = `Last 7 days: ${avg} g protein${avgKcal != null && b ? ` and ${kc(avgKcal)} (aim ${b.target.toLocaleString('en-US')})` : avgKcal != null ? ` and ${kc(avgKcal)}` : ''} a day on the ${logged.length} day${logged.length === 1 ? '' : 's'} you logged.`;
  const score = `Days: ${count('stretch')} stretch · ${count('goal')} goal · ${count('floor')} floor · ${count('under')} under the floor (${t.floor}/${t.goal}/${t.stretch} g).`;
  let kscore = '';
  if (b) {
    const kcount = (k: KcalDay) => logged.filter((d) => kcalDayOf(d.kcal, b) === k).length;
    kscore = `\nCalories: ${kcount('band')} in the band · ${kcount('light')} light · ${kcount('big')} big (${b.floor.toLocaleString('en-US')}–${b.ceiling.toLocaleString('en-US')} kcal).`;
  }
  return `${head}\n${score}${kscore}\n${lines.join('\n')}`;
}

export function recompute<T extends FoodEntry>(e: T): T {
  return { ...e, protein_g: e.items.reduce((n, i) => n + i.protein_g, 0), kcal: e.items.reduce((n, i) => n + i.kcal, 0) };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function itemMatches(item: FoodItem, name: string): boolean {
  const a = norm(item.name); const b = norm(name);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const wa = new Set(a.split(' ')); const wb = b.split(' ').filter((w) => w.length > 2);
  return wb.length > 0 && wb.every((w) => wa.has(w) || [...wa].some((x) => x.startsWith(w) || w.startsWith(x)));
}

// Which entry a correction is about: the one the user numbered, else the
// latest entry holding any of the named items, else the last entry.
export function pickEntry(entries: FoodEntry[], entry: number | null | undefined, names: string[]): number {
  if (!entries.length) return -1;
  if (entry && entry >= 1 && entry <= entries.length) return entry - 1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (names.some((n) => entries[i].items.some((it) => itemMatches(it, n)))) return i;
  }
  return entries.length - 1;
}

export interface EditResult<T extends FoodEntry> { entries: T[]; changed: T | null; removed: FoodItem[]; deletedEntry: T | null; added: FoodItem[] }

// Remove named items from one entry (or the whole entry when no names match
// or none were given), and add replacement items to the same entry.
export function applyEdit<T extends FoodEntry>(entries: T[], entry: number | null | undefined, removeNames: string[], add: FoodItem[]): EditResult<T> {
  const out = entries.map((e) => ({ ...e, items: [...e.items] }));
  const idx = pickEntry(out, entry, removeNames);
  if (idx < 0) return { entries: out, changed: null, removed: [], deletedEntry: null, added: [] };
  const target = out[idx];
  const removed = removeNames.length ? target.items.filter((it) => removeNames.some((n) => itemMatches(it, n))) : [...target.items];
  const kept = target.items.filter((it) => !removed.includes(it));
  if (!kept.length && !add.length) {
    const [deleted] = out.splice(idx, 1);
    return { entries: out, changed: null, removed, deletedEntry: deleted, added: [] };
  }
  out[idx] = recompute({ ...target, items: [...kept, ...add] });
  return { entries: out, changed: out[idx], removed, deletedEntry: null, added: add };
}

// One sitting, one meal: a meal logged within MERGE_MINUTES of the previous
// one joins it and keeps the first time; a meal with a stated time stands alone.
export const MERGE_MINUTES = 20;
export function mergeTarget(entries: FoodEntry[], at: string, explicitTime: boolean): number {
  if (explicitTime || !entries.length) return -1;
  const last = entries[entries.length - 1];
  const gap = (Date.parse(at) - Date.parse(last.at)) / 60_000;
  return gap >= 0 && gap <= MERGE_MINUTES ? entries.length - 1 : -1;
}
export function mergeInto<T extends FoodEntry>(target: T, add: FoodEntry): T {
  const rank: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
  return recompute({
    ...target,
    text: [target.text, add.text].filter(Boolean).join(' · ').slice(0, 600),
    photo: target.photo || add.photo,
    items: [...target.items, ...add.items],
    confidence: rank[add.confidence] < rank[target.confidence] ? add.confidence : target.confidence,
  });
}

// "lunch at 1pm" → 1 PM in the user's zone on that day, not when they typed it.
export function atTime(day: string, hhmm: string | undefined, fallbackIso: string, tz: string | null): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  if (!m) return fallbackIso;
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h > 23 || mi > 59) return fallbackIso;
  const zone = tz ?? 'UTC';
  const probe = new Date(`${day}T12:00:00Z`);
  let offsetH = 0;
  try {
    const local = new Date(probe.toLocaleString('en-US', { timeZone: zone }));
    offsetH = Math.round((probe.getTime() - local.getTime()) / 3_600_000);
  } catch { offsetH = 0; }
  return new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), h + offsetH, mi)).toISOString();
}

// ---- shortcuts ----
// A word that stands for a fixed item with fixed numbers. A message that is
// exactly the word logs it with no model call; in any other message the
// model is told the numbers and uses them.

export function normalizeWord(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/^(a|an|my|the|one|had|ate)\s+/, '').replace(/\s+/g, ' ').trim();
}

export function parseAlias(text: string): FoodAlias | { error: string } {
  const body = text.replace(/^\/alias(@\w+)?\s*/i, '').trim();
  const eq = body.indexOf('=');
  if (eq < 1) return { error: 'Write it as: /alias shake = whey 2 scoops, 50 g, 240 kcal' };
  const word = normalizeWord(body.slice(0, eq));
  let rest = body.slice(eq + 1).trim();
  const p = /(\d+(?:\.\d+)?)\s*g(?:rams?)?(?:\s+protein)?\b/i.exec(rest);
  const k = /(\d+(?:\.\d+)?)\s*(?:kcal|cal(?:ories)?)\b/i.exec(rest);
  if (!word) return { error: 'The word before "=" is missing.' };
  if (!p || !k) return { error: `Give both numbers: /alias ${word} = <what it is>, <N> g, <N> kcal` };
  rest = rest.replace(p[0], '').replace(k[0], '');
  const name = rest.replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim() || word;
  return { word, item: { name, protein_g: Number(p[1]), kcal: Number(k[1]) } };
}

export function matchAlias(text: string, aliases: FoodAlias[]): FoodAlias | undefined {
  const w = normalizeWord(text);
  return w ? aliases.find((a) => a.word === w) : undefined;
}

export function aliasLines(aliases: FoodAlias[]): string {
  return aliases.length
    ? aliases.map((a) => `${a.word} = ${a.item.name}, ${Math.round(a.item.protein_g)} g, ${Math.round(a.item.kcal)} kcal`).join('\n')
    : 'No shortcuts yet. Set one: /alias shake = whey 2 scoops, 50 g, 240 kcal';
}

export const YES = /^(y|yes|yep|yeah|yup|ok|okay|log it|correct|right|sure)\b/i;
