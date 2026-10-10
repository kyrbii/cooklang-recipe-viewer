import type { Recipe } from '../types/cook';

const PREFIX = '#/rezept/';

/** Slug aus dem Rezeptpfad: Umlaute ausschreiben, Kleinbuchstaben, Trennzeichen als Bindestrich */
export const slugify = (text: string) =>
  text
    .replace(/ä/gi, (c) => (c === 'ä' ? 'ae' : 'Ae'))
    .replace(/ö/gi, (c) => (c === 'ö' ? 'oe' : 'Oe'))
    .replace(/ü/gi, (c) => (c === 'ü' ? 'ue' : 'Ue'))
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Slug aus Ordner und Dateiname, z. B. "Backen/Veganer Marmorkuchen.cook" -> "backen-veganer-marmorkuchen".
 * Der volle Pfad macht den Slug eindeutig, auch wenn zwei Ordner dieselbe Datei haben.
 */
export const recipeSlug = (recipe: Recipe) =>
  slugify(recipe.path.replace(/\.cook$/i, ''));

/** Hash-Teil der URL für ein Rezept, z. B. #/rezept/backen-veganer-marmorkuchen */
export const recipeHash = (recipe: Recipe) => PREFIX + recipeSlug(recipe);

/** Liest den Slug aus dem aktuellen Hash, liefert null wenn kein Rezept gemeint ist */
export function recipeKeyFromHash(hash: string): string | null {
  return hash.startsWith(PREFIX) ? hash.slice(PREFIX.length) : null;
}

export const findRecipeByKey = (recipes: Recipe[], key: string): Recipe | null =>
  recipes.find((r) => recipeSlug(r) === key) ?? null;

/** Vollständige, teilbare URL zu einem Rezept */
export const recipeShareUrl = (recipe: Recipe) =>
  `${window.location.origin}${window.location.pathname}${recipeHash(recipe)}`;
