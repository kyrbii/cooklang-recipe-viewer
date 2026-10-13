import { describe, it, expect } from 'vitest';
import { ingredientListText } from './ingredientText';
import type { CookIngredient } from '../types/cook';

const ing = (over: Partial<CookIngredient>): CookIngredient => ({ name: 'Mehl', ...over }) as CookIngredient;

describe('ingredientListText', () => {
  it('writes one line per ingredient with amount and unit', () => {
    const text = ingredientListText([ing({ name: 'Mehl', quantity: 250, units: 'g' })], 1);
    expect(text).toBe('250 g Mehl');
  });

  it('scales quantities by the ratio', () => {
    const text = ingredientListText([ing({ name: 'Mehl', quantity: 250, units: 'g' })], 2);
    expect(text).toBe('500 g Mehl');
  });

  it('handles ingredients without quantity', () => {
    expect(ingredientListText([ing({ name: 'Salz' })], 1)).toBe('Salz');
  });

  it('marks optional ingredients from either source', () => {
    const text = ingredientListText(
      [ing({ name: 'Zimt', quantity: 1, units: 'Prise', optional: true }), ing({ name: '?Vanille' })],
      1
    );
    expect(text).toBe('1 Prise Zimt (optional)\nVanille (optional)');
  });
});
