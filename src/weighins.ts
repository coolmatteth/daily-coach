// Weigh-in rules (PR 2, 11/7/26). Weekly by default, daily allowed, judged
// on a 7-day average with a visible noise band. A plateau is under 5%
// change over 12 weeks (the trial definition, Horn et al. 2025), never a
// flat fortnight. Rapid loss is a 7-day-average drop over 1.5 kg a week for
// two weeks running (Weinsier 1995 gallstone model, the Delphi's monitoring
// trigger). The number stays in code; the message never names a threshold.

export interface WeighIn { date: string; lb: number }  // date YYYY-MM-DD

export const NOISE_PCT = 1.0;                 // day-to-day noise is under 1% of bodyweight
export const PLATEAU_WEEKS = 12;
export const PLATEAU_PCT = 5;
export const RAPID_LOSS_LB_PER_WEEK = 1.5 * 2.20462; // 1.5 kg
export const RAPID_LOSS_WEEKS = 2;

const DAY = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

function sorted(ws: WeighIn[]): WeighIn[] {
  return [...ws].sort((a, b) => a.date.localeCompare(b.date));
}

// Average of every weigh-in in the 7 days ending on `asOf` (inclusive).
// Null when there is none in that window.
export function sevenDayAverage(ws: WeighIn[], asOf: string): number | null {
  const end = toMs(asOf);
  const start = end - 6 * DAY;
  const inWindow = ws.filter((w) => { const t = toMs(w.date); return t >= start && t <= end; });
  if (inWindow.length === 0) return null;
  return Math.round((inWindow.reduce((s, w) => s + w.lb, 0) / inWindow.length) * 10) / 10;
}

export function noiseBandLb(lb: number): number {
  return Math.round((lb * NOISE_PCT) / 100 * 10) / 10;
}

// What the user sees after a weigh-in.
export function weighInReply(ws: WeighIn[], asOf: string): string {
  const s = sorted(ws);
  const latest = s[s.length - 1];
  const avg = sevenDayAverage(s, asOf);
  const band = noiseBandLb(latest.lb);
  const lines = [`Logged ${latest.lb} lb.`];
  if (avg !== null && s.length > 1) lines.push(`7-day average ${avg} lb. Day-to-day swings up to about ${band} lb are noise; the average is the number.`);
  else lines.push(`Day-to-day swings up to about ${band} lb are noise. Once there are a few, the 7-day average is the number.`);
  return lines.join(' ');
}

// Plateau: the 7-day average as of `asOf` is within PLATEAU_PCT of the
// 7-day average PLATEAU_WEEKS earlier, and both exist. Null when there is
// not enough history to say.
export function plateau(ws: WeighIn[], asOf: string): { plateau: boolean; changePct: number } | null {
  const now = sevenDayAverage(ws, asOf);
  const thenDate = new Date(toMs(asOf) - PLATEAU_WEEKS * 7 * DAY).toISOString().slice(0, 10);
  const then = sevenDayAverage(ws, thenDate);
  if (now === null || then === null) return null;
  const changePct = Math.round(((now - then) / then) * 1000) / 10;
  return { plateau: Math.abs(changePct) < PLATEAU_PCT, changePct };
}

// Rapid loss: for each of the last RAPID_LOSS_WEEKS weeks, the 7-day
// average fell by more than RAPID_LOSS_LB_PER_WEEK against the week before.
export function rapidLoss(ws: WeighIn[], asOf: string): boolean {
  for (let i = 0; i < RAPID_LOSS_WEEKS; i++) {
    const endThis = new Date(toMs(asOf) - i * 7 * DAY).toISOString().slice(0, 10);
    const endPrev = new Date(toMs(asOf) - (i + 1) * 7 * DAY).toISOString().slice(0, 10);
    const a = sevenDayAverage(ws, endThis);
    const b = sevenDayAverage(ws, endPrev);
    if (a === null || b === null) return false;
    if (b - a <= RAPID_LOSS_LB_PER_WEEK) return false;
  }
  return true;
}

// The wellness-carve-out wording: no number, no diagnosis, a suggestion
// that a professional check-in may help.
export const RAPID_LOSS_TEXT =
  "Your weight is coming down faster than the range this coach is built for. A check-in with your prescriber or a dietitian may be helpful; keeping protein up and adding a daily multivitamin are the usual asks.";
export const UNDER_FLOOR_TEXT =
  "This week's calories averaged below the range this coach is built for. A check-in with your prescriber or a dietitian may be helpful; a protein shake and a daily multivitamin are the usual asks when appetite is this low.";
