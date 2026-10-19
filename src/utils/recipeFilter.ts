import type { Recipe } from '../types/cook';

/** For the person filter, '' means "no creator recorded". */
export const FAVORITES = 'Favoriten';
export const NO_CREATOR = '';

/** Category and creator are multi-select: an empty list means no filter, several entries match any of them. */
export interface RecipeFilter {
  query: string;
  category: string[];
  creator: string[];
}

export const DEFAULT_FILTER: RecipeFilter = { query: '', category: [], creator: [] };

/** Average rating as German text, e.g. "4,5" */
export const formatRating = (average: number) => average.toFixed(1).replace('.', ',');

/** Tags of a recipe, from a YAML list or a comma-separated string */
export function tagsOf(recipe: Recipe): string[] {
  const tags = recipe.metadata.tags;
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(',').map((t) => t.trim()).filter(Boolean);
  return [];
}

/** Category dropdown: favorites (only once there are some), then every tag in German alphabetical order */
export function categoryOptions(recipes: Recipe[], favoriteCount: number): string[] {
  const tags = [...new Set(recipes.flatMap(tagsOf))].sort((a, b) => a.localeCompare(b, 'de'));
  return [...(favoriteCount > 0 ? [FAVORITES] : []), ...tags];
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
  filter.category.length > 0 || filter.creator.length > 0 || filter.query.trim() !== '';

/** Recipes matching all three filters (within the category and person filters, any selected entry matches). The search looks at name, description, author, creator and tags. */
export function filterRecipes(recipes: Recipe[], filter: RecipeFilter, favorites: string[]): Recipe[] {
  const q = filter.query.toLowerCase().trim();
  const categories = filter.category.map((c) => c.toLowerCase());
  const wantsFavorites = filter.category.includes(FAVORITES);

  return recipes.filter((r) => {
    if (filter.creator.length > 0 && !filter.creator.includes(r.addedBy ?? NO_CREATOR)) return false;

    if (filter.category.length > 0) {
      const matches =
        (wantsFavorites && favorites.includes(r.id)) ||
        tagsOf(r).some((t) => categories.includes(t.toLowerCase()));
      if (!matches) return false;
    }

    if (!q) return true;
    return [r.name, r.metadata.description, r.metadata.author, r.addedBy, ...tagsOf(r)].some(
      (value) => typeof value === 'string' && value.toLowerCase().includes(q)
    );
  });
}
