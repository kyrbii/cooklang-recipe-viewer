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
  optional?: boolean;
  /** Einzelmengen, aus denen eine zusammengefasste Zutat entstanden ist */
  sources?: Array<{ quantity?: number | string; units?: string }>;
}

export interface CookCookware {
  name: string;
  quantity?: number | string;
  optional?: boolean;
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
  optional?: boolean;
}

export interface CookStep {
  stepNumber: number;
  section?: string;
  items: StepItem[];
  rawText: string;
  ingredients: CookIngredient[];
  cookware: CookCookware[];
  timers: CookTimer[];
}

export interface CookSection {
  name?: string;
  steps: CookStep[];
}

export interface Recipe {
  id: string;
  path: string;
  name: string;
  folder?: string;
  metadata: CookMetadata;
  steps: CookStep[];
  sections?: CookSection[];
  ingredients: CookIngredient[];
  cookware: CookCookware[];
  notes?: string[];
  rawCook?: string;
  image?: string;
  cachedAt?: number;
  /** Server version of the recipe file (ETag), used to skip unchanged recipes and for If-Match */
  etag?: string;
  /** When the recipe file was last saved on the server (ms since epoch), for "most recent first" */
  modifiedAt?: number;
  /** Who added the recipe (login name), if recorded */
  addedBy?: string;
  /** Average of all ratings, if anyone rated the recipe */
  ratingAverage?: number;
  /** How many people rated the recipe */
  ratingCount?: number;
}

/** One person's rating and note for a recipe */
export interface RecipeReview {
  username: string;
  rating?: number;
  note?: string;
  updatedAt: number;
}

export interface RecipeReviews {
  reviews: RecipeReview[];
  ratingAverage?: number;
  ratingCount: number;
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
