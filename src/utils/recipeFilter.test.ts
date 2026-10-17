import { describe, expect, it } from 'vitest';
import type { Recipe } from '../types/cook';
import {
  ALL,
  DEFAULT_FILTER,
  NO_CREATOR,
  categoryOptions,
  creatorOptions,
  filterRecipes,
  formatRating,
  isFilterActive,
  tagsOf
} from './recipeFilter';

const recipe = (id: string, patch: Partial<Recipe> = {}, metadata: Recipe['metadata'] = {}): Recipe => ({
  id,
  path: id,
  name: id,
  metadata,
  steps: [],
  ingredients: [],
  cookware: [],
  ...patch
});

const recipes = [
  recipe('Kuchen', { addedBy: 'korbinian' }, { tags: ['Backen', 'Süß'] }),
  recipe('Linsen', { addedBy: 'anna' }, { tags: 'Suppe, Vegan', author: 'Omas Buch' }),
  recipe('Brot', {}, { tags: ['Backen'], description: 'Knusprig' })
];

describe('tagsOf', () => {
  it('reads YAML lists and comma-separated strings', () => {
    expect(tagsOf(recipes[0])).toEqual(['Backen', 'Süß']);
    expect(tagsOf(recipes[1])).toEqual(['Suppe', 'Vegan']);
    expect(tagsOf(recipe('x'))).toEqual([]);
  });
});

describe('dropdown options', () => {
  it('lists all, favorites only when there are some, then tags sorted', () => {
    expect(categoryOptions(recipes, 0)).toEqual([ALL, 'Backen', 'Suppe', 'Süß', 'Vegan']);
    expect(categoryOptions(recipes, 2)[1]).toBe('Favoriten');
  });

  it('lists creators sorted, with an entry for recipes without one', () => {
    expect(creatorOptions(recipes)).toEqual(['anna', 'korbinian', NO_CREATOR]);
    expect(creatorOptions(recipes.slice(0, 2))).toEqual(['anna', 'korbinian']);
  });
});

describe('filterRecipes', () => {
  const ids = (list: Recipe[]) => list.map((r) => r.id);

  it('returns everything without a filter', () => {
    expect(ids(filterRecipes(recipes, DEFAULT_FILTER, []))).toEqual(['Kuchen', 'Linsen', 'Brot']);
  });

  it('filters by person, including recipes without a creator', () => {
    expect(ids(filterRecipes(recipes, { ...DEFAULT_FILTER, creator: 'anna' }, []))).toEqual(['Linsen']);
    expect(ids(filterRecipes(recipes, { ...DEFAULT_FILTER, creator: NO_CREATOR }, []))).toEqual(['Brot']);
  });

  it('filters by category, case-insensitively', () => {
    expect(ids(filterRecipes(recipes, { ...DEFAULT_FILTER, category: 'backen' }, []))).toEqual(['Kuchen', 'Brot']);
  });

  it('filters by favorites', () => {
    expect(ids(filterRecipes(recipes, { ...DEFAULT_FILTER, category: 'Favoriten' }, ['Brot']))).toEqual(['Brot']);
  });

  it('combines the filters', () => {
    const filter = { query: '', category: 'Backen', creator: 'korbinian' };
    expect(ids(filterRecipes(recipes, filter, []))).toEqual(['Kuchen']);
  });

  it('searches name, description, author, creator and tags', () => {
    const search = (query: string) => ids(filterRecipes(recipes, { ...DEFAULT_FILTER, query }, []));
    expect(search('kuchen')).toEqual(['Kuchen']);
    expect(search('knusprig')).toEqual(['Brot']);
    expect(search('omas')).toEqual(['Linsen']);
    expect(search('ANNA')).toEqual(['Linsen']);
    expect(search('vegan')).toEqual(['Linsen']);
    expect(search('  ')).toEqual(['Kuchen', 'Linsen', 'Brot']);
  });
});

describe('helpers', () => {
  it('detects an active filter', () => {
    expect(isFilterActive(DEFAULT_FILTER)).toBe(false);
    expect(isFilterActive({ ...DEFAULT_FILTER, query: ' ' })).toBe(false);
    expect(isFilterActive({ ...DEFAULT_FILTER, creator: 'anna' })).toBe(true);
  });

  it('formats ratings with a German decimal comma', () => {
    expect(formatRating(4.5)).toBe('4,5');
    expect(formatRating(5)).toBe('5,0');
  });
});
