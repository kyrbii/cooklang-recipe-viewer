export interface CookMetadata {
  title?: string;
  servings?: string | number;
  author?: string;
  source?: string;
  tags?: string[] | string;
  time?: string;
  prep_time?: string;
  cook_time?: string;
  description?: string;
  image?: string;
  [key: string]: unknown;
}

export interface CookIngredient {
  name: string;
  quantity?: number | string;
  units?: string;
}

export interface CookCookware {
  name: string;
  quantity?: number | string;
}

export interface CookTimer {
  name?: string;
  quantity: number | string;
  units: string;
  totalSeconds: number;
}

export type StepItemType = 'text' | 'ingredient' | 'cookware' | 'timer';

export interface StepItem {
  type: StepItemType;
  value?: string;
  name?: string;
  quantity?: number | string;
  units?: string;
  totalSeconds?: number;
}

export interface CookStep {
  stepNumber: number;
  items: StepItem[];
  rawText: string;
  ingredients: CookIngredient[];
  cookware: CookCookware[];
  timers: CookTimer[];
}

export interface Recipe {
  id: string;
  path: string;
  name: string;
  folder?: string;
  metadata: CookMetadata;
  steps: CookStep[];
  ingredients: CookIngredient[];
  cookware: CookCookware[];
  rawCook?: string;
  image?: string;
  cachedAt?: number;
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'checking' | 'error';

export interface ActiveTimer {
  id: string;
  name: string;
  durationSeconds: number;
  remainingSeconds: number;
  isRunning: boolean;
  recipeId?: string;
  stepNumber?: number;
}

export interface RecipeDraft {
  path: string;
  base: string;
  content: string;
  updatedAt: number;
}

export type UpdateRecipeResult =
  | { status: 'saved'; recipe: Recipe; content: string }
  | { status: 'conflict'; serverContent: string }
  | { status: 'error'; message: string; isOffline?: boolean };
