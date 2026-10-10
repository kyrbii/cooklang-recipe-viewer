import { describe, expect, it } from 'vitest';
import { recipeKeyFromHash, slugify } from './recipeLink';

describe('slugify', () => {
  it('schreibt Umlaute aus und entfernt Sonderzeichen', () => {
    expect(slugify('Süßkartoffel-Curry')).toBe('suesskartoffel-curry');
    expect(slugify('Käse Brötchen (Grundrezept)')).toBe('kaese-broetchen-grundrezept');
    expect(slugify('Groß & Klein!')).toBe('gross-klein');
  });
});

describe('recipeKeyFromHash', () => {
  it('liest den Slug aus dem Hash', () => {
    expect(recipeKeyFromHash('#/rezept/backen-marmorkuchen')).toBe('backen-marmorkuchen');
    expect(recipeKeyFromHash('')).toBeNull();
    expect(recipeKeyFromHash('#/anderes')).toBeNull();
  });
});
