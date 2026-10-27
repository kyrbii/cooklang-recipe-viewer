import React, { useState } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import type { Collection } from '../../types/cook';
import { cookApi } from '../../services/cookApi';
import { AvatarStack } from './Avatars';
import { Sheet } from './Sheet';

interface AddToCollectionSheetProps {
  recipes: Array<{ path: string; name: string }>;
  collections: Collection[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}

/**
 * Tick the collections the recipes belong to. Each tap saves right away.
 * With several recipes a collection holding only some of them shows a dash, a tap then adds the rest.
 */
export const AddToCollectionSheet: React.FC<AddToCollectionSheetProps> = ({
  recipes,
  collections,
  onClose,
  onChanged
}) => {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const paths = recipes.map((r) => r.path);

  const run = async (id: number | null, action: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Das hat nicht geklappt.');
    } finally {
      setBusyId(null);
    }
  };

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    void run(-1, async () => {
      const created = await cookApi.createCollection(name);
      await Promise.all(paths.map((p) => cookApi.addToCollection(created.id, p)));
      setNewName('');
      setCreating(false);
    });
  };

  return (
    <Sheet title="Zu Sammlung hinzufügen" onClose={onClose}>
      <p className="px-5 pb-3 text-[13px] text-stone-500 dark:text-stone-400">
        {recipes.length === 1 ? 'Rezept: ' : `${recipes.length} Rezepte: `}
        <b className="font-semibold text-stone-900 dark:text-stone-100">
          {recipes.length === 1 ? recipes[0].name : recipes.map((r) => r.name).join(', ')}
        </b>
      </p>
      <div className="px-4 flex flex-col gap-2">
        {collections.map((c) => {
          const have = paths.filter((p) => c.paths.includes(p));
          const on = have.length === paths.length;
          const some = have.length > 0 && !on;
          return (
            <button
              key={c.id}
              type="button"
              role="checkbox"
              aria-checked={some ? 'mixed' : on}
              disabled={busyId === c.id}
              onClick={() =>
                run(c.id, async () => {
                  const todo = on ? paths : paths.filter((p) => !c.paths.includes(p));
                  const change = on ? cookApi.removeFromCollection : cookApi.addToCollection;
                  await Promise.all(todo.map((p) => change.call(cookApi, c.id, p)));
                })
              }
              className={`w-full min-h-14 px-3.5 py-2 flex items-center gap-3 text-left rounded-[14px] border cursor-pointer disabled:opacity-60 ${
                on
                  ? 'border-[#DE5D4E] bg-[#DE5D4E]/[0.06]'
                  : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121110]'
              }`}
            >
              <span
                className={`w-[22px] h-[22px] shrink-0 rounded-[7px] border-[1.5px] flex items-center justify-center text-white ${
                  on || some ? 'bg-[#DE5D4E] border-[#DE5D4E]' : 'border-stone-400'
                }`}
              >
                {on && <Check className="w-[13px] h-[13px]" strokeWidth={3} />}
                {some && <Minus className="w-[13px] h-[13px]" strokeWidth={3} />}
              </span>
              <span className="flex-1 min-w-0">
                <b className="block text-[15px] font-semibold text-stone-900 dark:text-stone-100 truncate">{c.name}</b>
                <span className="block text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                  {c.paths.length} {c.paths.length === 1 ? 'Rezept' : 'Rezepte'}
                </span>
              </span>
              <AvatarStack members={c.members} />
            </button>
          );
        })}

        {creating ? (
          <form onSubmit={create} className="flex gap-2">
            <input
              autoFocus
              value={newName}
              maxLength={100}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name der Sammlung"
              aria-label="Name der neuen Sammlung"
              className="flex-1 min-w-0 h-14 px-3.5 rounded-[14px] bg-white dark:bg-[#121110] border border-stone-200 dark:border-stone-800 text-sm text-stone-900 dark:text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-[#DE5D4E]/30"
            />
            <button
              type="submit"
              disabled={busyId === -1 || !newName.trim()}
              className="h-14 px-4 rounded-[14px] bg-[#DE5D4E] text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
            >
              Anlegen
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="w-full min-h-14 px-3.5 flex items-center gap-3 rounded-[14px] border-[1.5px] border-dashed border-stone-400 dark:border-stone-600 text-[#DE5D4E] text-[15px] font-semibold cursor-pointer hover:bg-stone-200/40 dark:hover:bg-stone-800/50"
          >
            <Plus className="w-[18px] h-[18px]" />
            Neue Sammlung
          </button>
        )}
        {error && (
          <p role="alert" className="text-xs text-rose-700 dark:text-rose-400">
            {error}
          </p>
        )}
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
