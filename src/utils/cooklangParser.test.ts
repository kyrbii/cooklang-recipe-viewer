import { describe, expect, it } from 'vitest';
import {
  aggregateIngredients,
  parseCooklangText,
  sortIngredientsByQuantity
} from './cooklangParser';

const recipe = (body: string) => parseCooklangText(`---\ntitle: Test\nservings: 2\n---\n\n${body}\n`, 'test.cook');

describe('aggregateIngredients', () => {
  it('addiert gleiche Zutaten mit gleicher Einheit', () => {
    const r = recipe('Mit @Mehl{250%g} und @Mehl{100%g} arbeiten.');
    expect(r.ingredients).toHaveLength(1);
    expect(r.ingredients[0].quantity).toBe(350);
  });

  it('übernimmt die Menge, wenn die erste Nennung keine hat', () => {
    const r = recipe('@Ei{} und später @Ei{2}.');
    expect(r.ingredients).toHaveLength(1);
    expect(r.ingredients[0].quantity).toBe(2);
  });

  it('hält Zutaten mit unterschiedlicher Einheit getrennt, auch ohne Menge', () => {
    const r = recipe('@Salz{} und später @Salz{1%TL}.');
    expect(r.ingredients).toHaveLength(2);
  });

  it('lässt unterschiedliche Einheiten getrennt', () => {
    const r = recipe('@Milch{1/2%l} und @Milch{300%ml}.');
    expect(r.ingredients).toHaveLength(2);
  });

  it('merkt sich die Einzelmengen einer zusammengefassten Zutat', () => {
    const r = recipe('@Hafermilch{200%ml} und @Hafermilch{500%ml}.');
    const milk = r.ingredients[0];
    expect(milk.quantity).toBe(700);
    expect(milk.sources).toEqual([
      { quantity: '200', units: 'ml' },
      { quantity: '500', units: 'ml' }
    ]);
  });

  it('behält die Quellen auch bei einem zweiten Durchlauf', () => {
    const once = aggregateIngredients(recipe('@Hafermilch{200%ml} und @Hafermilch{500%ml}.').ingredients);
    const twice = aggregateIngredients(once);
    expect(twice[0].sources).toHaveLength(2);
  });
});

describe('sortIngredientsByQuantity', () => {
  it('gruppiert gleiche Zutaten nebeneinander, Zutaten ohne Menge ans Ende', () => {
    const r = recipe('@Mehl{250%g}, @Salz{}, @Milch{1/2%l}, @Zucker{50%g}, @Milch{300%ml}, @Salz{1%TL}.');
    const names = sortIngredientsByQuantity(aggregateIngredients(r.ingredients)).map((i) => i.name);
    expect(names).toHaveLength(6);
    const milkIdx = names.map((n, i) => (n === 'Milch' ? i : -1)).filter((i) => i >= 0);
    expect(milkIdx[1] - milkIdx[0]).toBe(1);
    expect(names.indexOf('Mehl')).toBeLessThan(names.indexOf('Zucker'));
    expect(names.slice(-2)).toEqual(['Salz', 'Salz']);
  });

  it('sortiert Gruppen nach der größten Menge', () => {
    const r = recipe('@Mehl{250%g}, @Zucker{50%g}, @Ei{2}, @Ei{1}.');
    const sorted = sortIngredientsByQuantity(aggregateIngredients(r.ingredients));
    // Gruppen nach größter Menge: Mehl 250 g, Zucker 50 g, Ei 3 Stück
    expect(sorted.map((i) => i.name)).toEqual(['Mehl', 'Zucker', 'Ei']);
  });
});
