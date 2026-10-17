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
  /** Name as written; ingredients with the same name are listed together */
  name: string;
  /** Display name from `@name|alias{}`, shown instead of `name` */
  alias?: string;
  /** A number, or a string for fractions ("1/2"), ranges ("1-2") and free text */
  quantity?: number | string;
  units?: string;
  /** Preparation note from `@name{1}(finely diced)` */
  note?: string;
  optional?: boolean;
  /** `@name{=1%tsp}`: the amount does not change when scaling the servings */
  fixed?: boolean;
  /** `@-name`: used in the steps, but not listed under the ingredients */
  hidden?: boolean;
  /** `@+name`: a new ingredient that is not merged with earlier ones of the same name */
  isNew?: boolean;
  /** `@&name`: refers back to an ingredient defined earlier */
  isReference?: boolean;
  /** `@./path/Recipe{}`: path of the referenced recipe without `.cook` */
  recipePath?: string;
  /** Name of the referenced recipe this ingredient was taken from, set when the list is expanded */
  fromRecipe?: string;
  /** Einzelmengen, aus denen eine zusammengefasste Zutat entstanden ist */
  sources?: Array<{ quantity?: number | string; units?: string }>;
}

export interface CookCookware {
  name: string;
  alias?: string;
  quantity?: number | string;
  note?: string;
  optional?: boolean;
  hidden?: boolean;
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
  alias?: string;
  note?: string;
  fixed?: boolean;
  hidden?: boolean;
  isReference?: boolean;
  recipePath?: string;
}

export interface CookStep {
  stepNumber: number;
  section?: string;
  /** Notes (`> text`) that stand right before this step */
  notesBefore?: string[];
  /** Notes that stand after the last step */
  notesAfter?: string[];
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
  /** Tips from the metadata (`notes:`, `tips:`). Notes written as `> text` belong to the steps. */
  notes?: string[];
  rawCook?: string;
  /** Version of the parser setup that produced this object, older cached copies are parsed again */
  parserVersion?: number;
  /** Parser report for the recipe text (warnings, or the error that made it unreadable), plain text */
  diagnostics?: string;
  /** True when the text has an error and the recipe is only shown as plain text */
  hasError?: boolean;
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
