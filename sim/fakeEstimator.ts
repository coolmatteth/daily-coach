// A rule-based stand-in for the model (PR 5, 11/8/26), so the harness and
// CI can run the Food Log with no API key. It knows the words the scripted
// personas use; anything else is an "ask", which is what the real model
// does with a word it cannot read.
import type { Action, Block, Estimator } from '../src/estimator';
import type { FoodItem } from '../src/types';

const FOODS: [RegExp, FoodItem[]][] = [
  [/two eggs and toast/, [{ name: 'two eggs', protein_g: 12, kcal: 140 }, { name: 'toast', protein_g: 4, kcal: 150 }]],
  [/greek yogurt/, [{ name: 'greek yogurt with berries', protein_g: 17, kcal: 180 }]],
  [/oatmeal.*protein/, [{ name: 'oatmeal with protein', protein_g: 30, kcal: 320 }]],
  [/chicken salad/, [{ name: 'chicken salad', protein_g: 35, kcal: 420 }]],
  [/turkey sandwich/, [{ name: 'turkey sandwich', protein_g: 28, kcal: 450 }]],
  [/tuna and crackers/, [{ name: 'tuna', protein_g: 26, kcal: 150 }, { name: 'crackers', protein_g: 2, kcal: 130 }]],
  [/chicken thigh.*rice/, [{ name: 'chicken thigh 6 oz', protein_g: 44, kcal: 400 }, { name: 'rice', protein_g: 4, kcal: 200 }]],
  [/salmon and broccoli/, [{ name: 'salmon', protein_g: 34, kcal: 280 }, { name: 'broccoli', protein_g: 4, kcal: 55 }]],
  [/ground beef and rice/, [{ name: 'ground beef', protein_g: 30, kcal: 350 }, { name: 'rice', protein_g: 4, kcal: 200 }]],
  [/chicken and veg/, [{ name: 'chicken breast', protein_g: 45, kcal: 250 }, { name: 'vegetables', protein_g: 3, kcal: 80 }]],
  [/pizza two slices/, [{ name: 'pizza x2', protein_g: 24, kcal: 600 }]],
  [/two protein bars/, [{ name: 'protein bar x2', protein_g: 40, kcal: 420 }]],
  [/protein bar/, [{ name: 'protein bar', protein_g: 20, kcal: 210 }]],
  [/string cheese/, [{ name: 'string cheese', protein_g: 7, kcal: 80 }]],
  [/^apple$/, [{ name: 'apple', protein_g: 0, kcal: 95 }]],
  [/cottage cheese/, [{ name: 'cottage cheese', protein_g: 14, kcal: 110 }]],
];

const A = (a: Partial<Action>): Action => ({ action: 'log', items: [], entry: null, remove_items: [], time: '', confidence: 'high', question: '', reply: '', ...a });

export class FakeEstimator implements Estimator {
  calls = 0;
  async decide(_system: string, _context: string, content: Block[]): Promise<Action> {
    this.calls++;
    const text = content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join(' ').trim().toLowerCase();
    if (content.some((b) => b.type === 'image')) return A({ items: [{ name: 'plate from photo', protein_g: 30, kcal: 450 }], confidence: 'medium' });
    let m = /that was (\d) bar not (\d)/.exec(text);
    if (m) return A({ action: 'edit', remove_items: ['protein bar x2'], items: [{ name: 'protein bar', protein_g: 20, kcal: 210 }] });
    m = /remove the (\w+)/.exec(text);
    if (m) return A({ action: 'edit', remove_items: [m[1]] });
    if (/dose|mg\b|shot|skip my/.test(text)) return A({ action: 'answer', reply: 'Anything about your dose or your shot is a question for your prescriber. I can tell you what your week looked like: /recap.' });
    if (/too light|too heavy/.test(text)) return A({ action: 'answer', reply: 'Lift what you did and reply with the numbers; the loads follow what you actually do.' });
    if (/nausea|sick|stomach/.test(text)) return A({ action: 'answer', reply: 'Small sittings, fluids, and a shake when a meal will not go down. If it is persistent or severe, that is one for your prescriber.' });
    if (/\?$/.test(text) || /^(what|how|why|is it|should)/.test(text)) return A({ action: 'answer', reply: 'That one is on your file: /me shows it.' });
    for (const [re, items] of FOODS) if (re.test(text)) return A({ items });
    return A({ action: 'ask', items: [], confidence: 'low', question: `I could not read "${text.slice(0, 40)}" as food. What was it?` });
  }
}
