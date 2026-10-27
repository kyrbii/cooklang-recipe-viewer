import React from 'react';
import { MoreHorizontal, Plus, UserRound } from 'lucide-react';
import type { Collection, ConnectionStatus, Recipe } from '../../types/cook';
import { CollectionsHome } from './CollectionsHome';
import { HomeTabs, type HomeView } from './HomeTabs';

interface CollectionsPageProps {
  collections: Collection[];
  recipes: Recipe[];
  loaded: boolean;
  error: string | null;
  status: ConnectionStatus;
  loginUser: string;
  onViewChange: (view: HomeView) => void;
  onOpen: (id: number) => void;
  onCreate: () => void;
  onAddRecipe: () => void;
  onOpenSettings: () => void;
}

/** Main page in its "Sammlungen" form: same header as the recipe list, tiles instead of recipes */
export const CollectionsPage: React.FC<CollectionsPageProps> = ({
  collections,
  recipes,
  loaded,
  error,
  status,
  loginUser,
  onViewChange,
  onOpen,
  onCreate,
  onAddRecipe,
  onOpenSettings
}) => (
  <div className="flex-1 flex flex-col max-w-xl md:max-w-4xl lg:max-w-6xl xl:max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-safe pb-safe font-mela-sans">
    <div className="flex items-center justify-between pt-2 pb-1">
      <div>
        <h1 className="font-mela-serif text-3xl sm:text-4xl font-bold tracking-tight text-stone-900 dark:text-stone-50">stir</h1>
        <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 flex items-center gap-1.5">
          <span>
            {collections.length} {collections.length === 1 ? 'Sammlung' : 'Sammlungen'}
          </span>
          <span className="text-stone-300 dark:text-stone-700">•</span>
          <span
            role="img"
            aria-label={status === 'connected' ? 'Online' : 'Offline'}
            className={`w-1.5 h-1.5 rounded-full ${status === 'connected' ? 'bg-emerald-500' : 'bg-stone-400 dark:bg-stone-600'}`}
          />
          <span
            role="img"
            aria-label={`Angemeldet als ${loginUser}`}
            title={`Angemeldet als ${loginUser}`}
            className="inline-flex text-emerald-600 dark:text-emerald-400"
          >
            <UserRound className="w-3 h-3" />
          </span>
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onAddRecipe}
          className="h-9 px-3 sm:px-3.5 rounded-full bg-[#DE5D4E] hover:bg-[#cf5142] text-white active:scale-95 transition-all shadow-xs flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
          title="Rezept hinzufügen / importieren"
          aria-label="Neues Rezept"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Neues Rezept</span>
        </button>
        <button
          onClick={onOpenSettings}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-stone-200/60 dark:bg-stone-800 text-stone-700 dark:text-stone-300 active:scale-95 transition-transform cursor-pointer"
          title="Einstellungen & Server"
          aria-label="Einstellungen"
        >
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </div>
    </div>
    <HomeTabs value="collections" onChange={onViewChange} />
    <CollectionsHome collections={collections} recipes={recipes} loaded={loaded} error={error} onOpen={onOpen} onCreate={onCreate} />
  </div>
);
