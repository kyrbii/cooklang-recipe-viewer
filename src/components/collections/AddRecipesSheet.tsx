import React, { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import type { Collection, Recipe } from '../../types/cook';
import { cookApi } from '../../services/cookApi';
import { DEFAULT_FILTER, filterRecipes } from '../../utils/recipeFilter';
import { Sheet } from './Sheet';

interface AddRecipesSheetProps {
  collection: Collection;
  recipes: Recipe[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}

/** Pick several recipes for one collection: tick to add, untick to remove */
export const AddRecipesSheet: React.FC<AddRecipesSheetProps> = ({ collection, recipes, onClose, onChanged }) => {
  const [query, setQuery] = useState('');
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inside = new Set(collection.paths);
  const shown = useMemo(() => filterRecipes(recipes, { ...DEFAULT_FILTER, query }, []), [recipes, query]);

  const toggle = async (recipe: Recipe) => {
    setBusyPath(recipe.path);
    setError(null);
    try {
      if (inside.has(recipe.path)) await cookApi.removeFromCollection(collection.id, recipe.path);
      else await cookApi.addToCollection(collection.id, recipe.path);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Das hat nicht geklappt.');
    } finally {
      setBusyPath(null);
    }
  };

  return (
    <Sheet title="Rezepte hinzufügen" onClose={onClose}>
      <p className="px-5 pb-3 text-[13px] text-stone-500 dark:text-stone-400">
        Zu <b className="font-semibold text-stone-900 dark:text-stone-100">{collection.name}</b>
      </p>
      <div className="px-4 space-y-2">
        <div className="relative mb-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rezepte durchsuchen…"
            aria-label="Rezepte durchsuchen"
            className="w-full h-11 pl-10 pr-3 rounded-xl bg-stone-200/50 dark:bg-stone-800/60 text-sm text-stone-900 dark:text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-[#DE5D4E]/30"
          />
        </div>
        {error && (
          <p role="alert" className="text-xs text-rose-700 dark:text-rose-400">
            {error}
          </p>
        )}
        {shown.map((recipe) => {
          const on = inside.has(recipe.path);
          return (
            <button
              key={recipe.path}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={busyPath === recipe.path}
              onClick={() => toggle(recipe)}
              className={`w-full min-h-14 px-3.5 py-2 flex items-center gap-3 text-left rounded-[14px] border cursor-pointer disabled:opacity-60 ${
                on
                  ? 'border-[#DE5D4E] bg-[#DE5D4E]/[0.06]'
                  : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121110]'
              }`}
            >
              <span
                className={`w-[22px] h-[22px] shrink-0 rounded-[7px] border-[1.5px] flex items-center justify-center text-white ${
                  on ? 'bg-[#DE5D4E] border-[#DE5D4E]' : 'border-stone-400'
                }`}
              >
                {on && <Check className="w-[13px] h-[13px]" strokeWidth={3} />}
              </span>
              <span className="flex-1 min-w-0 text-[15px] font-semibold text-stone-900 dark:text-stone-100 truncate">{recipe.name}</span>
            </button>
          );
        })}
        {shown.length === 0 && <p className="py-8 text-center text-sm text-stone-500">Keine passenden Rezepte.</p>}
      </div>
      <div className="px-4 pt-4">
        <button
          type="button"
          onClick={onClose}
          className="w-full h-[46px] rounded-xl bg-stone-800 dark:bg-stone-200 text-white dark:text-stone-900 text-[15px] font-semibold cursor-pointer"
        >
          Fertig
        </button>
      </div>
    </Sheet>
  );
};
