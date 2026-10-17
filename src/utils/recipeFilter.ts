import type { Recipe } from '../types/cook';

/** 'Alle' means no filter. For the person filter, '' means "no creator recorded". */
export const ALL = 'Alle';
export const FAVORITES = 'Favoriten';
export const NO_CREATOR = '';

export interface RecipeFilter {
  query: string;
  category: string;
  creator: string;
}

export const DEFAULT_FILTER: RecipeFilter = { query: '', category: ALL, creator: ALL };

/** Average rating as German text, e.g. "4,5" */
export const formatRating = (average: number) => average.toFixed(1).replace('.', ',');

/** Tags of a recipe, from a YAML list or a comma-separated string */
export function tagsOf(recipe: Recipe): string[] {
  const tags = recipe.metadata.tags;
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(',').map((t) => t.trim()).filter(Boolean);
  return [];
}

/** Category dropdown: all, favorites (only once there are some), then every tag in German alphabetical order */
export function categoryOptions(recipes: Recipe[], favoriteCount: number): string[] {
  const tags = [...new Set(recipes.flatMap(tagsOf))].sort((a, b) => a.localeCompare(b, 'de'));
  return [ALL, ...(favoriteCount > 0 ? [FAVORITES] : []), ...tags];
}

/** Person dropdown: everyone who added a recipe, plus NO_CREATOR if some recipe has no recorded creator */
export function creatorOptions(recipes: Recipe[]): string[] {
  const names = new Set<string>();
  let hasUnknown = false;
  for (const r of recipes) {
    if (r.addedBy) names.add(r.addedBy);
    else hasUnknown = true;
  }
  const sorted = [...names].sort((a, b) => a.localeCompare(b, 'de'));
  return hasUnknown ? [...sorted, NO_CREATOR] : sorted;
}

export const isFilterActive = (filter: RecipeFilter) =>
  filter.category !== ALL || filter.creator !== ALL || filter.query.trim() !== '';

/** Recipes matching all three filters. The search looks at name, description, author, creator and tags. */
export function filterRecipes(recipes: Recipe[], filter: RecipeFilter, favorites: string[]): Recipe[] {
  const q = filter.query.toLowerCase().trim();
  const category = filter.category.toLowerCase();

  return recipes.filter((r) => {
    if (filter.creator !== ALL && (r.addedBy ?? NO_CREATOR) !== filter.creator) return false;

    if (filter.category === FAVORITES) {
      if (!favorites.includes(r.id)) return false;
    } else if (filter.category !== ALL) {
      if (!tagsOf(r).some((t) => t.toLowerCase() === category)) return false;
    }

    if (!q) return true;
    return [r.name, r.metadata.description, r.metadata.author, r.addedBy, ...tagsOf(r)].some(
      (value) => typeof value === 'string' && value.toLowerCase().includes(q)
    );
  });
}
