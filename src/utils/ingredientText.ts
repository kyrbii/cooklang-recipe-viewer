import type { CookIngredient } from '../types/cook';
import { displayName, scaleQuantity } from './cooklangParser';

/**
 * Plain-text ingredient list, one line per ingredient: "250 g Mehl".
 * Quantities are scaled by `ratio`, optional ingredients get a suffix.
 */
export function ingredientListText(ingredients: CookIngredient[], ratio: number): string {
  return ingredients
    .map((ing) => {
      const name = displayName(ing).replace(/^\?+\s*/, '').trim();
      const optional = Boolean(ing.optional || ing.name.startsWith('?'));
      const amount = [scaleQuantity(ing.quantity, ratio, ing.fixed), ing.units].filter(Boolean).join(' ');
      const line = [amount, name].filter(Boolean).join(' ');
      return `${line}${ing.note ? ` (${ing.note})` : ''}${optional ? ' (optional)' : ''}`;
    })
    .join('\n');
}

/**
 * Copies text to the clipboard. Uses the async API where available and falls back to
 * a hidden text field, which also works on plain http pages. Returns false if both fail.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the fallback
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } finally {
    area.remove();
  }
}
