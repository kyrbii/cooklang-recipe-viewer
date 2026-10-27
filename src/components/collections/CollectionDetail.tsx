import React, { useEffect, useMemo, useState } from 'react';
import { CheckSquare, ChevronLeft, Clock, LayoutGrid, List as ListIcon, Pencil, Plus, Search, Star, Tag, Trash2, UserPlus, X } from 'lucide-react';
import type { Collection, Recipe } from '../../types/cook';
import { cookApi } from '../../services/cookApi';
import { DEFAULT_FILTER, filterRecipes, formatRating, tagsOf } from '../../utils/recipeFilter';
import { ConfirmDialog } from '../ConfirmDialog';
import { AuthenticatedImage } from '../AuthenticatedImage';
import { OverflowMenu } from '../OverflowMenu';
import { SelectBox } from '../SelectBox';
import { AvatarStack } from './Avatars';
import { NameDialog } from './NameDialog';
import { AddRecipesSheet } from './AddRecipesSheet';
import { ShareSheet } from './ShareSheet';

interface CollectionDetailProps {
  collection: Collection;
  recipes: Recipe[];
  loginUser: string;
  onBack: () => void;
  onOpenRecipe: (recipe: Recipe) => void;
  /** Reloads the collections after a change */
  onChanged: () => Promise<void>;
}

export const CollectionDetail: React.FC<CollectionDetailProps> = ({
  collection,
  recipes,
  loginUser,
  onBack,
  onOpenRecipe,
  onChanged
}) => {
  const [query, setQuery] = useState('');
  const [view, setViewState] = useState<'grid' | 'list'>(() => cookApi.getCollectionView());
  const setView = (v: 'grid' | 'list') => {
    setViewState(v);
    cookApi.setCollectionView(v);
  };
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Paths of the chosen recipes, null while the selection mode is off
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const selecting = selection !== null;
  const toggleSelected = (path: string) =>
    setSelection((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const open = (recipe: Recipe) => (selection ? toggleSelected(recipe.path) : onOpenRecipe(recipe));

  useEffect(() => {
    if (!selecting || confirmRemove) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelection(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting, confirmRemove]);

  // Recipes that no longer exist on the server are skipped
  const members = useMemo(() => {
    const byPath = new Map(recipes.map((r) => [r.path, r]));
    return collection.paths.map((p) => byPath.get(p)).filter((r): r is Recipe => r !== undefined);
  }, [collection.paths, recipes]);
  const shown = useMemo(() => filterRecipes(members, { ...DEFAULT_FILTER, query }, []), [members, query]);

  const removeSelected = async () => {
    if (!selection) return;
    setError(null);
    setRemoveBusy(true);
    try {
      await Promise.all([...selection].map((path) => cookApi.removeFromCollection(collection.id, path)));
      setSelection(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Das hat nicht geklappt.');
    } finally {
      await onChanged();
      setRemoveBusy(false);
      setConfirmRemove(false);
    }
  };

  const count = `${members.length} ${members.length === 1 ? 'Rezept' : 'Rezepte'}`;
  const people = `${collection.members.length} ${collection.members.length === 1 ? 'Mitglied' : 'Mitglieder'}`;

  return (
    <div className="flex-1 flex flex-col max-w-xl md:max-w-4xl lg:max-w-6xl xl:max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-safe pb-safe font-mela-sans">
      <div className="flex items-center justify-between pt-2 h-[52px]">
        <button
          type="button"
          onClick={onBack}
          aria-label="Zurück zu Sammlungen"
          className="h-9 pl-2 pr-3 flex items-center gap-1 rounded-full bg-stone-200/60 dark:bg-stone-800 text-[13px] font-medium text-stone-600 dark:text-stone-300 cursor-pointer active:scale-95 transition-transform"
        >
          <ChevronLeft className="w-4 h-4" />
          Sammlungen
        </button>
        <OverflowMenu
          label="Mehr"
          items={[
            members.length > 0 && {
              label: 'Rezepte auswählen',
              icon: <CheckSquare className="w-4 h-4" />,
              onClick: () => setSelection(new Set())
            },
            {
              label: view === 'grid' ? 'Listenansicht' : 'Kachelansicht',
              icon: view === 'grid' ? <ListIcon className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />,
              onClick: () => setView(view === 'grid' ? 'list' : 'grid')
            },
            { label: 'Umbenennen', icon: <Pencil className="w-4 h-4" />, onClick: () => setRenaming(true) },
            {
              label: 'Für alle löschen',
              icon: <Trash2 className="w-4 h-4" />,
              danger: true,
              onClick: () => {
                setDeleteError(null);
                setDeleting(true);
              }
            }
          ]}
        />
      </div>

      <h1 className="font-mela-serif text-3xl font-bold tracking-tight leading-[1.1] mt-3.5 text-stone-900 dark:text-stone-50">
        {collection.name}
      </h1>
      <div className="flex items-center justify-between mt-3 gap-3">
        <div className="flex items-center gap-2.5 text-xs text-stone-500 dark:text-stone-400 min-w-0">
          <AvatarStack members={collection.members} size="md" ring="border-[#FAF8F5] dark:border-[#121110]" />
          <span className="truncate">
            {people} · {count}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setSharing(true)}
          className="h-9 px-3.5 flex items-center gap-[7px] rounded-xl bg-stone-200/60 dark:bg-stone-800 text-[13px] font-semibold text-stone-800 dark:text-stone-200 cursor-pointer active:scale-95 transition-transform"
        >
          <UserPlus className="w-[15px] h-[15px]" />
          Teilen
        </button>
      </div>

      <div className="relative mt-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="In dieser Sammlung suchen…"
          aria-label="In dieser Sammlung suchen"
          className="w-full h-11 pl-10 pr-10 rounded-xl bg-stone-200/50 dark:bg-stone-800/60 text-sm text-stone-900 dark:text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-[#DE5D4E]/30 focus:bg-white dark:focus:bg-[#1A1816] transition-all"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Suche leeren"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-rose-700 dark:text-rose-400">
          {error}
        </p>
      )}

      <div className={view === 'grid' ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-3.5' : 'flex flex-col gap-2.5 mt-3.5'}>
        {view === 'grid' &&
          shown.map((recipe) => (
            <div
              key={recipe.path}
              className={`group relative aspect-square rounded-2xl overflow-hidden bg-stone-200 dark:bg-stone-800 border border-stone-200/80 dark:border-stone-800 ${
                selection?.has(recipe.path) ? 'ring-2 ring-[#DE5D4E]' : ''
              }`}
            >
              <button type="button" onClick={() => open(recipe)} className="absolute inset-0 w-full text-left cursor-pointer">
                {recipe.image ? (
                  <AuthenticatedImage
                    src={recipe.image}
                    alt=""
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
                    loading="lazy"
                    fallback={<TileFallback />}
                  />
                ) : (
                  <TileFallback />
                )}
                <span className="absolute inset-x-0 bottom-0 px-3 pt-8 pb-2.5 bg-gradient-to-t from-black/70 to-transparent">
                  <span className="block font-mela-serif text-[15px] font-bold leading-tight text-white line-clamp-2">
                    {recipe.name}
                  </span>
                </span>
              </button>
              {selection && (
                <SelectBox checked={selection.has(recipe.path)} className="absolute top-2 right-2 pointer-events-none" />
              )}
            </div>
          ))}
        {view === 'list' && shown.map((recipe) => {
          const time = recipe.metadata.total_time || recipe.metadata.cook_time || recipe.metadata.time || recipe.metadata.prep_time;
          const category = tagsOf(recipe)[0];
          return (
            <div
              key={recipe.path}
              className={`flex items-center justify-between gap-3 pl-5 pr-4 py-4 rounded-2xl bg-white dark:bg-[#1A1816] border shadow-xs ${
                selection?.has(recipe.path)
                  ? 'border-[#DE5D4E] ring-1 ring-[#DE5D4E]'
                  : 'border-stone-200 dark:border-stone-800 hover:border-stone-300 dark:hover:border-stone-700'
              }`}
            >
              <button type="button" onClick={() => open(recipe)} className="flex-1 min-w-0 text-left cursor-pointer">
                <h2 className="font-mela-serif text-lg font-bold leading-tight text-stone-900 dark:text-stone-100 line-clamp-2">
                  {recipe.name}
                </h2>
                <span className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {time && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 px-2 py-[3px] rounded-md">
                      <Clock className="w-[11px] h-[11px] text-[#DE5D4E]" />
                      {String(time)}
                    </span>
                  )}
                  {category && (
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 px-2 py-[3px] rounded-md">
                      {category}
                    </span>
                  )}
                  {recipe.ratingCount && recipe.ratingAverage !== undefined ? (
                    <span className="inline-flex items-center gap-[3px] text-[11px] font-semibold text-stone-800 dark:text-stone-200">
                      <Star className="w-[11px] h-[11px] fill-amber-400 text-amber-400" />
                      {formatRating(recipe.ratingAverage)}
                    </span>
                  ) : null}
                </span>
              </button>
              {selection && <SelectBox checked={selection.has(recipe.path)} />}
            </div>
          );
        })}
        {shown.length === 0 && (
          <p className="col-span-full py-10 text-center text-sm text-stone-500 dark:text-stone-400">
            {members.length === 0 ? 'Diese Sammlung ist noch leer.' : 'Keine passenden Rezepte in dieser Sammlung.'}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mt-3 mb-32 h-12 w-full flex items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-stone-400 dark:border-stone-600 text-sm font-semibold text-stone-500 dark:text-stone-400 hover:bg-stone-200/40 dark:hover:bg-stone-800/50 cursor-pointer transition-colors"
      >
        <Plus className="w-4 h-4" />
        Rezepte hinzufügen
      </button>

      {renaming && (
        <NameDialog
          title="Sammlung umbenennen"
          initial={collection.name}
          confirmLabel="Umbenennen"
          onCancel={() => setRenaming(false)}
          onSubmit={async (name) => {
            await cookApi.renameCollection(collection.id, name);
            await onChanged();
            setRenaming(false);
          }}
        />
      )}
      <ConfirmDialog
        isOpen={deleting}
        title="Sammlung löschen?"
        message={
          <>
            „{collection.name}“ wird für alle {collection.members.length} Mitglieder gelöscht. Die Rezepte selbst bleiben erhalten.
          </>
        }
        confirmLabel="Löschen"
        busy={deleteBusy}
        error={deleteError}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          setDeleteBusy(true);
          setDeleteError(null);
          try {
            await cookApi.deleteCollection(collection.id);
            await onChanged();
            onBack();
          } catch (err) {
            setDeleteError(err instanceof Error ? err.message : 'Das hat nicht geklappt.');
            setDeleteBusy(false);
          }
        }}
      />
      {selection && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-md p-3 rounded-2xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-xl animate-slideUp">
          <div className="flex items-center justify-between mb-2.5 pl-1">
            <span className="text-sm font-medium whitespace-nowrap">{selection.size} ausgewählt</span>
            <button
              type="button"
              onClick={() => setSelection(null)}
              className="h-8 px-3 rounded-lg text-xs font-medium text-white/80 dark:text-stone-600 cursor-pointer"
            >
              Abbrechen
            </button>
          </div>
          <button
            type="button"
            disabled={selection.size === 0}
            onClick={() => setConfirmRemove(true)}
            className="w-full h-11 rounded-xl bg-[#DE5D4E] text-white text-sm font-semibold disabled:opacity-40 cursor-pointer"
          >
            Aus Sammlung entfernen
          </button>
        </div>
      )}
      <ConfirmDialog
        isOpen={confirmRemove}
        title="Aus Sammlung entfernen?"
        message={
          <>
            {selection?.size === 1 ? 'Das Rezept wird' : `${selection?.size ?? 0} Rezepte werden`} aus „{collection.name}“
            für alle {collection.members.length} {collection.members.length === 1 ? 'Mitglied' : 'Mitglieder'} entfernt.
            Die Rezepte selbst bleiben erhalten.
          </>
        }
        confirmLabel="Entfernen"
        busy={removeBusy}
        error={null}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={removeSelected}
      />
      {adding && (
        <AddRecipesSheet collection={collection} recipes={recipes} onClose={() => setAdding(false)} onChanged={onChanged} />
      )}
      {sharing && (
        <ShareSheet
          collection={collection}
          loginUser={loginUser}
          onClose={() => setSharing(false)}
          onChanged={onChanged}
          onLeft={() => {
            setSharing(false);
            onBack();
          }}
        />
      )}
    </div>
  );
};

/** Tile without a photo */
const TileFallback: React.FC = () => (
  <span className="w-full h-full flex items-center justify-center text-stone-400 dark:text-stone-600">
    <Tag className="w-8 h-8 opacity-40" />
  </span>
);
