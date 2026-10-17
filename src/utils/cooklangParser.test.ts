import { describe, expect, it } from 'vitest';
import {
  aggregateIngredients,
  parseCooklangText,
  parseLeadingNumber,
  parseQuantity,
  scaleQuantity,
  servingsUnit,
  sortIngredientsByQuantity,
  unitToSeconds
} from './cooklangParser';
import { expandRecipeReferences, referenceFactor } from './recipeReferences';

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

  it('lässt Einheiten getrennt, die sich nicht umrechnen lassen', () => {
    const r = recipe('@Milch{1/2%l} und @Milch{2%Tassen}.');
    expect(r.ingredients).toHaveLength(2);
  });

  it('rechnet Gewichte und Volumen um und schreibt sie passend', () => {
    const sum = (body: string) => {
      const ing = recipe(body).ingredients;
      expect(ing).toHaveLength(1);
      return [ing[0].quantity, ing[0].units];
    };
    expect(sum('@Milch{1/2%l} und @Milch{300%ml}.')).toEqual([800, 'ml']);
    expect(sum('@Mehl{500%g} und @Mehl{1%kg}.')).toEqual([1.5, 'kg']);
    expect(sum('@Öl{1%EL} und @Öl{1%TL}.')).toEqual([4, 'TL']);
    expect(sum('@Mehl{200%g} und @Mehl{300%g}.')).toEqual([500, 'g']);
  });

  it('sammelt Zubereitungshinweise gleicher Zutaten', () => {
    const r = recipe('@Zwiebel{1}(gewürfelt) und @Zwiebel{1}(in Ringen) und @Zwiebel{1}(gewürfelt).');
    expect(r.ingredients).toHaveLength(1);
    expect(r.ingredients[0]).toMatchObject({ quantity: 3, note: 'gewürfelt; in Ringen' });
  });

  it('hält Zutaten mit unterschiedlichem Alias getrennt', () => {
    const r = recipe('@Reis|Basmati{100%g}, @Reis|Jasmin{50%g} und @Reis{20%g}.');
    expect(r.ingredients.map((i) => [i.alias, i.quantity])).toEqual([
      ['Basmati', 120],
      ['Jasmin', 50]
    ]);
  });

  it('merkt sich die Einzelmengen einer zusammengefassten Zutat', () => {
    const r = recipe('@Hafermilch{200%ml} und @Hafermilch{500%ml}.');
    const milk = r.ingredients[0];
    expect(milk.quantity).toBe(700);
    expect(milk.sources).toEqual([
      { quantity: 200, units: 'ml' },
      { quantity: 500, units: 'ml' }
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
    const r = recipe('@Mehl{250%g}, @Salz{}, @Milch{1/2%l}, @Zucker{50%g}, @Milch{2%Tassen}, @Salz{1%TL}.');
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

const firstStep = (body: string) => recipe(body).steps[0];

describe('Cooklang syntax', () => {
  it('liest Zubereitungshinweise in Klammern', () => {
    const r = recipe('@Zwiebel{1}(fein gewürfelt) anbraten.');
    expect(r.ingredients[0]).toMatchObject({ name: 'Zwiebel', quantity: 1, note: 'fein gewürfelt' });
    expect(firstStep('@Zwiebel{1}(fein gewürfelt) anbraten.').items.map((i) => i.type)).toEqual([
      'ingredient',
      'text'
    ]);
  });

  it('liest feste Mengen, die beim Skalieren bleiben', () => {
    const r = recipe('@Salz{=1%TL} und @Mehl{500%g}.');
    const salt = r.ingredients.find((i) => i.name === 'Salz');
    expect(salt?.fixed).toBe(true);
    expect(scaleQuantity(salt?.quantity, 2, salt?.fixed)).toBe('1');
    expect(r.ingredients.find((i) => i.name === 'Mehl')?.fixed).toBeUndefined();
  });

  it('skaliert Bereiche an beiden Enden', () => {
    const r = recipe('@Mehl{200-250%g}.');
    expect(r.ingredients[0].quantity).toBe('200-250');
    expect(scaleQuantity(r.ingredients[0].quantity, 2)).toBe('400-500');
  });

  it('liest Brüche und Dezimalkommas', () => {
    expect(recipe('@Milch{1/2%l}.').ingredients[0].quantity).toBe('1/2');
    expect(parseQuantity('1/2')).toBe(0.5);
    expect(parseQuantity('1,5')).toBe(1.5);
    expect(parseQuantity('½')).toBe(0.5);
    expect(parseQuantity('1-2')).toBeNull();
    expect(parseLeadingNumber('6 Portionen')).toBe(6);
  });

  it('liest Aliase, Modifikatoren und Rezept-Verweise', () => {
    const r = recipe('@Reis|Basmatireis{100%g}, @?Schnittlauch, @-Wasser{1%l}, @./Saucen/Pesto{}, @&Reis{}.');
    const rice = r.ingredients.find((i) => i.name === 'Reis');
    expect(rice?.alias).toBe('Basmatireis');
    expect(r.ingredients.find((i) => i.name === 'Schnittlauch')?.optional).toBe(true);
    // Versteckte Zutaten und Rückverweise ohne Menge stehen nicht in der Liste
    expect(r.ingredients.find((i) => i.name === 'Wasser')).toBeUndefined();
    expect(r.ingredients.filter((i) => i.name === 'Reis')).toHaveLength(1);
    expect(r.ingredients.find((i) => i.name === 'Pesto')?.recipePath).toBe('Saucen/Pesto');
    const hidden = r.steps[0].items.find((i) => i.name === 'Wasser');
    expect(hidden?.hidden).toBe(true);
  });

  it('hält Bereiche und neue Zutaten (@+) getrennt', () => {
    const r = recipe('@Mehl{1-2%EL} und @Mehl{1-2%EL}, @Ei{1} und @+Ei{2}.');
    expect(r.ingredients.filter((i) => i.name === 'Mehl')).toHaveLength(2);
    expect(r.ingredients.filter((i) => i.name === 'Ei')).toHaveLength(2);
  });

  it('erkennt Timer mit Einheiten, auch Tage und Stunden', () => {
    const t = (text: string) => firstStep(text).timers[0];
    expect(t('~{20%min}.').totalSeconds).toBe(1200);
    expect(t('~Eier{3%Minuten}.')).toMatchObject({ name: 'Eier', totalSeconds: 180 });
    expect(t('~{2%Stunden}.').totalSeconds).toBe(7200);
    expect(t('~{2%days}.').totalSeconds).toBe(172800);
    expect(t('~{1-2%hours}.').totalSeconds).toBe(3600);
    expect(unitToSeconds('sek', 30)).toBe(30);
  });

  it('lässt ein einzelnes ~ im Text stehen', () => {
    const step = firstStep('Bei ~180 Grad backen.');
    expect(step.timers).toHaveLength(0);
    expect(step.rawText).toBe('Bei ~180 Grad backen.');
  });

  it('lässt Temperaturen im Text', () => {
    expect(firstStep('Bei 180°C backen.').rawText).toBe('Bei 180°C backen.');
  });

  it('macht aus > Zeilen Hinweise, unabhängig von den Schritten', () => {
    const r = recipe('Erster Schritt.\n\n> Tipp eins\n> geht weiter\n\nZweiter Schritt.');
    expect(r.notes).toBeUndefined();
    expect(r.steps).toHaveLength(2);
    // Der Hinweis steht vor dem Schritt, vor dem er im Rezept steht
    expect(r.steps[0].notesBefore).toBeUndefined();
    expect(r.steps[1].notesBefore).toEqual(['Tipp eins geht weiter']);
  });

  it('ignoriert Kommentare', () => {
    const r = recipe('Mehl [- geheim -] sieben. -- nur für mich\n\nBacken.');
    expect(r.steps[0].rawText).toBe('Mehl  sieben. ');
    expect(r.steps).toHaveLength(2);
  });

  it('behält einen erzwungenen Zeilenumbruch mit \\', () => {
    expect(firstStep('Erste Zeile \\\nzweite Zeile.').rawText).toContain('\n');
  });

  it('nummeriert Schritte über Abschnitte hinweg und kennt Abschnittsnamen', () => {
    const r = recipe('= Teig =\nMischen.\n\n== Belag\nBelegen.');
    expect(r.steps.map((s) => s.stepNumber)).toEqual([1, 2]);
    expect(r.sections?.map((s) => s.name)).toEqual(['Teig', 'Belag']);
  });

  it('übernimmt Metadaten nach den Konventionen', () => {
    const r = parseCooklangText(
      [
        '---',
        'title: Torte',
        'serves: 6 Portionen',
        'tags: [kuchen, süß]',
        'source:',
        '  name: Oma',
        '  url: https://example.org/torte',
        'time:',
        '  prep: 20 min',
        '  cook: 1 h',
        'pictures: [a.jpg, b.jpg]',
        '---',
        'Backen.'
      ].join('\n'),
      'Torte.cook'
    );
    expect(r.name).toBe('Torte');
    expect(r.metadata.servings).toBe('6 Portionen');
    expect(r.metadata.tags).toEqual(['kuchen', 'süß']);
    expect(r.metadata.source).toBe('Oma');
    expect(r.metadata.prep_time).toBe('20 min');
    expect(r.metadata.cook_time).toBe('1 h');
    expect(r.image).toBe('a.jpg');
  });

  it('liest die alte >> Schreibweise für Metadaten', () => {
    const r = parseCooklangText('>> title: Alt\n>> servings: 3\n\nKochen @Nudeln.', 'x.cook');
    expect(r.name).toBe('Alt');
    expect(r.metadata.servings).toBe('3');
  });

  it('nimmt den Dateinamen als Titel, wenn keiner angegeben ist', () => {
    expect(parseCooklangText('Kochen.', 'Pasta/Spaghetti-Carbonara.cook').name).toBe('Spaghetti Carbonara');
  });
});

describe('fehlerhafter Rezepttext', () => {
  it('stürzt nicht ab und zeigt den Text als Schritte', () => {
    const r = parseCooklangText('---\ntitle: Kaputt\n---\n\nMit @{} rühren.\n\n~{} warten.', 'kaputt.cook');
    expect(r.hasError).toBe(true);
    expect(r.diagnostics).toBeTruthy();
    expect(r.name).toBe('Kaputt');
    expect(r.steps.map((s) => s.rawText)).toEqual(['Mit @{} rühren.', '~{} warten.']);
  });

  it('hält tausende fehlerhafte Eingaben aus, ohne dass der Parser ausfällt', () => {
    for (let i = 0; i < 3000; i++) parseCooklangText(`Nimm @a{%g} ~{} ${i}`, 'x.cook');
    expect(recipe('@Salz{1%g}.').ingredients).toHaveLength(1);
  });
});

describe('Meldungen des Parsers', () => {
  it('zeigt keine Meldung zu festen Mengen oder @+, aber zu echten Problemen', () => {
    expect(recipe('@Salz{=1%TL} und @+Ei{2}.').diagnostics).toBeUndefined();
    expect(
      parseCooklangText('---\nservings: 2 Portionen\nyield: 500%g\n---\nWarten ~{9%Minuten}.', 'x.cook').diagnostics
    ).toBeUndefined();
    const legacy = parseCooklangText('>> servings: 4\n\nKochen.', 'x.cook');
    expect(legacy.diagnostics).toMatch(/deprecated/);
    expect(legacy.hasError).toBeUndefined();
  });
});

describe('Hinweise an ihrer Stelle', () => {
  it('hängt Hinweise am Anfang, in der Mitte und am Ende an die richtigen Schritte', () => {
    const r = recipe('> Vorab\n\nEins.\n\n> Mitte\n\nZwei.\n\n> Zum Schluss');
    expect(r.steps[0].notesBefore).toEqual(['Vorab']);
    expect(r.steps[1].notesBefore).toEqual(['Mitte']);
    expect(r.steps[1].notesAfter).toEqual(['Zum Schluss']);
  });

  it('übernimmt Tipps aus den Metadaten als Rezept-Hinweise', () => {
    const r = parseCooklangText('---\ntips: Kalt servieren\n---\nMischen.', 'x.cook');
    expect(r.notes).toEqual(['Kalt servieren']);
  });
});

describe('Portionen und Kochgeschirr', () => {
  it('erkennt die Einheit hinter der Portionszahl', () => {
    expect(servingsUnit('6 Portionen')).toBe('Portionen');
    expect(servingsUnit('4')).toBeUndefined();
    expect(servingsUnit(4)).toBeUndefined();
  });

  it('behält Menge und Hinweis beim Kochgeschirr', () => {
    const r = recipe('In #Form{2}(gefettet) backen, dann wieder #Form.');
    expect(r.cookware).toHaveLength(1);
    expect(r.cookware[0]).toMatchObject({ name: 'Form', quantity: 2, note: 'gefettet' });
  });
});

describe('Rezept-Verweise', () => {
  const sauce = parseCooklangText(
    '---\nservings: 2\nyield: 500%ml\n---\n@Basilikum{50%g}, @Öl{100%ml}, @Salz{=1%TL}.',
    'Saucen/Pesto.cook'
  );
  const main = (ref: string) => parseCooklangText(`Nudeln mit ${ref}.\n\n@Nudeln{200%g}.`, 'Pasta.cook');

  it('skaliert mit einem Faktor ohne Einheit', () => {
    const list = expandRecipeReferences(main('@./Saucen/Pesto{2}'), [sauce]);
    expect(list.find((i) => i.name === 'Basilikum')).toMatchObject({ quantity: 100, fromRecipe: 'Pesto' });
    expect(list.find((i) => i.name === 'Salz')?.quantity).toBe(1);
    expect(list.find((i) => i.name === 'Pesto')?.recipePath).toBe('Saucen/Pesto');
  });

  it('skaliert über die Portionen des verlinkten Rezepts', () => {
    expect(referenceFactor({ quantity: 6, units: 'servings' }, sauce)).toEqual({ factor: 3, matched: true });
    const list = expandRecipeReferences(main('@./Saucen/Pesto{4%servings}'), [sauce]);
    expect(list.find((i) => i.name === 'Basilikum')?.quantity).toBe(100);
  });

  it('skaliert über die Ausbeute, auch mit anderer Einheit derselben Art', () => {
    expect(referenceFactor({ quantity: 250, units: 'ml' }, sauce).factor).toBe(0.5);
    expect(referenceFactor({ quantity: 1, units: 'l' }, sauce).factor).toBe(2);
    expect(referenceFactor({ quantity: 3, units: 'kg' }, sauce).matched).toBe(false);
  });

  it('macht alle Zutaten optional, wenn der Verweis optional ist', () => {
    const list = expandRecipeReferences(main('@?./Saucen/Pesto{}'), [sauce]);
    expect(list.find((i) => i.name === 'Basilikum')?.optional).toBe(true);
    expect(list.find((i) => i.name === 'Nudeln')?.optional).toBeUndefined();
  });

  it('übersteht fehlende Rezepte und Kreisverweise', () => {
    expect(expandRecipeReferences(main('@./gibt/es/nicht{}'), [sauce]).map((i) => i.name)).toContain('Nudeln');
    const a = parseCooklangText('@./B{}.', 'A.cook');
    const b = parseCooklangText('@./A{} @Mehl{1%g}.', 'B.cook');
    expect(() => expandRecipeReferences(a, [a, b])).not.toThrow();
  });
});
