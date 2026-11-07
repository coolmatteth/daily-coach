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
export type Sex = 'F' | 'M';

// The profile fields onboarding fills, in the order they are asked.
export type ProfileField = 'liftingDays' | 'weightLb' | 'drug' | 'shotDay' | 'heightIn' | 'sex' | 'age' | 'tz' | 'goalLb';

export interface Profile {
  weightLb: number | null;
  heightIn: number | null;
  sex: Sex | null;
  age: number | null;
  drug: string | null;
  shotDay: number | null;      // 0 Sun .. 6 Sat; -1 = daily pill
  liftingDays: number | null;
  goalLb: number | null;
  leanMassLb: number | null;
  tz: string | null;
  pendingField: ProfileField | null;
  lastAskedDay: string | null;
  skipped: ProfileField[];
  pendingMeal: string | null;   // JSON of a FoodEntry the bot asked about, not logged
  pendingUntil: string | null;  // ISO; the pending meal expires
  lastRecapDay: string | null;  // YYYY-MM-DD the Sunday pass last ran for this user
}

export interface User extends Profile {
  id: number;
  channel: Channel;
  chatId: string;
  createdAt: string;
}

export type NoteKind = 'injury' | 'equipment' | 'preference' | 'dose' | 'shot' | 'travel' | 'illness' | 'rule' | 'note';

export interface Note {
  id: number;
  userId: number;
  date: string;
  kind: NoteKind;
  text: string;
  value: string | null;
  source: 'user' | 'coach';
  createdAt: string;
}

export interface FoodItem { name: string; protein_g: number; kcal: number }
export type Confidence = 'high' | 'medium' | 'low';

export interface FoodEntry {
  id?: number;       // set once stored
  at: string;        // ISO, when the meal was eaten (or logged)
  text: string;      // what the user sent (caption for a photo)
  photo: boolean;
  items: FoodItem[];
  protein_g: number;
  kcal: number;
  confidence: Confidence;
}

export interface FoodAlias { word: string; item: FoodItem }

export interface DaySummary { day: string; protein_g: number; kcal: number; meals: number }
