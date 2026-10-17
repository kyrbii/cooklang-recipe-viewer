import type { CookIngredient, Recipe } from '../types/cook';
import {
  aggregateIngredients,
  multiplyQuantity,
  parseLeadingNumber,
  parseQuantity,
  unitInfo
} from './cooklangParser';

/** Finds the recipe a `@./folder/Name{}` reference points to. Path and case follow the recipe folder. */
export function findReferencedRecipe(recipes: Recipe[], recipePath: string): Recipe | null {
  const wanted = recipePath.replace(/\.cook$/i, '').replace(/^\.?\//, '').toLowerCase();
  const pathOf = (r: Recipe) => r.path.replace(/\.cook$/i, '').toLowerCase();
  const exact = recipes.find((r) => pathOf(r) === wanted);
  if (exact) return exact;
  // Only the file name given: take it if it is unique
  const byName = recipes.filter((r) => pathOf(r).split('/').pop() === wanted.split('/').pop());
  return byName.length === 1 ? byName[0] : null;
}

const SERVINGS_WORDS = new Set(['servings', 'serving', 'portion', 'portionen', 'person', 'personen']);

/** Amounts from `yield: 500%ml` or `yield: [500%ml, 350%g]` */
function yields(recipe: Recipe): Array<{ quantity: number; units: string }> {
  const raw = recipe.metadata.yield;
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const out: Array<{ quantity: number; units: string }> = [];
  for (const entry of list) {
    const [q, u] = String(entry).split('%');
    const quantity = parseQuantity(q);
    if (quantity !== null && u?.trim()) out.push({ quantity, units: u.trim() });
  }
  return out;
}

/**
 * How much of the referenced recipe is needed, following the Cooklang conventions:
 * no unit multiplies the recipe, `servings` matches its servings, any other unit matches its yield.
 * `matched` is false when a unit has no counterpart in the recipe.
 */
export function referenceFactor(
  reference: Pick<CookIngredient, 'quantity' | 'units'>,
  referenced: Recipe
): { factor: number; matched: boolean } {
  const amount = parseQuantity(reference.quantity);
  if (amount === null) return { factor: 1, matched: reference.quantity === undefined || reference.quantity === '' };
  const units = (reference.units ?? '').trim().toLowerCase();
  if (!units) return { factor: amount, matched: true };

  if (SERVINGS_WORDS.has(units)) {
    const servings = parseLeadingNumber(referenced.metadata.servings ?? referenced.metadata.serves) ?? 1;
    return { factor: amount / servings, matched: true };
  }

  const wanted = unitInfo(units);
  for (const y of yields(referenced)) {
    const have = unitInfo(y.units);
    if (y.units.toLowerCase() === units) return { factor: amount / y.quantity, matched: true };
    if (wanted && have && wanted.family === have.family) {
      return { factor: (amount * wanted.factor) / (y.quantity * have.factor), matched: true };
    }
  }
  return { factor: 1, matched: false };
}

const MAX_DEPTH = 5;

/**
 * The ingredients of a recipe plus those of the recipes it references, scaled to the amount asked
 * for. An optional reference makes all of its ingredients optional. References that cannot be
 * found, loops and very deep chains are left out.
 */
export function expandRecipeReferences(recipe: Recipe, recipes: Recipe[]): CookIngredient[] {
  const collect = (
    current: Recipe,
    factor: number,
    forceOptional: boolean,
    origin: string | undefined,
    trail: string[]
  ): CookIngredient[] => {
    const out: CookIngredient[] = [];
    for (const ing of current.ingredients) {
      // Rows for references stay in the top recipe only, the nested ones are replaced by their content
      if (ing.recipePath && origin) continue;
      out.push({
        ...ing,
        quantity: multiplyQuantity(ing.quantity, factor, ing.fixed),
        sources: ing.sources?.map((s) => ({ ...s, quantity: multiplyQuantity(s.quantity, factor, ing.fixed) })),
        optional: ing.optional || forceOptional || undefined,
        fromRecipe: origin
      });
    }
    if (trail.length >= MAX_DEPTH) return out;

    for (const ing of current.ingredients) {
      if (!ing.recipePath) continue;
      const target = findReferencedRecipe(recipes, ing.recipePath);
      if (!target || trail.includes(target.path)) continue;
      const { factor: wanted } = referenceFactor(ing, target);
      out.push(
        ...collect(
          target,
          factor * wanted,
          forceOptional || Boolean(ing.optional),
          origin ?? target.name,
          [...trail, target.path]
        )
      );
    }
    return out;
  };

  return aggregateIngredients(collect(recipe, 1, false, undefined, [recipe.path]));
}
