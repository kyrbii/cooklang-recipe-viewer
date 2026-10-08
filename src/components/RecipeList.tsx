import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search,
  X,
  MoreHorizontal,
  Clock,
  Tag,
  RefreshCw,
  Plus,
  LayoutGrid,
  List as ListIcon
} from 'lucide-react';
import type { ConnectionStatus, Recipe } from '../types/cook';

interface RecipeListProps {
  recipes: Recipe[];
  isLoading: boolean;
  isSyncing: boolean;
  status: ConnectionStatus;
  onSync: () => void;
  onSelectRecipe: (recipe: Recipe) => void;
  onOpenSettings: () => void;
  onAddRecipe: () => void;
}

export const RecipeList: React.FC<RecipeListProps> = ({
  recipes,
  isLoading,
  isSyncing,
  status,
  onSync,
  onSelectRecipe,
  onOpenSettings,
  onAddRecipe
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [desktopView, setDesktopView] = useState<'grid' | 'list'>('grid');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: pressing "/" focuses search on desktop
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement !== searchInputRef.current &&
        !(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Derive categories/folders/tags
  const categories = useMemo(() => {
    const set = new Set<string>();
    recipes.forEach((r) => {
      if (r.folder) set.add(r.folder);
      if (Array.isArray(r.metadata.tags)) {
        r.metadata.tags.forEach((t) => set.add(t));
      } else if (typeof r.metadata.tags === 'string') {
        r.metadata.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .forEach((t) => set.add(t));
      }
    });
    return ['All', ...Array.from(set).sort()];
  }, [recipes]);

  // Filter recipes
  const filteredRecipes = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return recipes.filter((r) => {
      // Category filter
      if (selectedCategory !== 'All') {
        const inFolder = r.folder?.toLowerCase() === selectedCategory.toLowerCase();
        let inTags = false;
        if (Array.isArray(r.metadata.tags)) {
          inTags = r.metadata.tags.some(
            (t) => t.toLowerCase() === selectedCategory.toLowerCase()
          );
        } else if (typeof r.metadata.tags === 'string') {
          inTags = r.metadata.tags
            .toLowerCase()
            .split(',')
            .map((t) => t.trim())
            .includes(selectedCategory.toLowerCase());
        }
        if (!inFolder && !inTags) return false;
      }

      // Query filter
      if (q) {
        const titleMatch = r.name.toLowerCase().includes(q);
        const descMatch = (r.metadata.description as string)?.toLowerCase()?.includes(q);
        const tagMatch =
          Array.isArray(r.metadata.tags) &&
          r.metadata.tags.some((t) => t.toLowerCase().includes(q));
        const authorMatch = (r.metadata.author as string)?.toLowerCase()?.includes(q);
        return titleMatch || descMatch || tagMatch || authorMatch;
      }

      return true;
    });
  }, [recipes, searchQuery, selectedCategory]);

  return (
    <div className="flex-1 flex flex-col max-w-xl md:max-w-4xl lg:max-w-6xl xl:max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-safe pb-safe font-mela-sans">
      {/* Top Header Bar (Mela Style) */}
      <div className="flex items-center justify-between pt-2 pb-3">
        <div>
          <h1 className="font-mela-serif text-3xl sm:text-4xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
            {selectedCategory === 'All' ? 'Recipes' : selectedCategory}
          </h1>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5 flex items-center gap-1.5">
            <span>
              {recipes.length} {recipes.length === 1 ? 'recipe' : 'recipes'}
            </span>
            <span className="text-stone-300 dark:text-stone-700">•</span>
            <span className="inline-flex items-center gap-1">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  status === 'connected'
                    ? 'bg-emerald-500'
                    : status === 'checking'
                    ? 'bg-amber-500 animate-pulse'
                    : 'bg-stone-400 dark:bg-stone-600'
                }`}
              />
              <span className="text-[11px] text-stone-400 dark:text-stone-500">
                {status === 'connected' ? 'Online' : status === 'checking' ? 'Verbinde...' : 'Offline'}
              </span>
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Desktop View Switcher (Grid vs List) */}
          <div className="hidden md:flex items-center bg-stone-200/60 dark:bg-stone-800 p-0.5 rounded-full mr-1">
            <button
              onClick={() => setDesktopView('grid')}
              className={`p-1.5 rounded-full transition-all cursor-pointer ${
                desktopView === 'grid'
                  ? 'bg-white dark:bg-[#1A1816] text-stone-900 dark:text-white shadow-2xs'
                  : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
              }`}
              title="Rasteransicht"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setDesktopView('list')}
              className={`p-1.5 rounded-full transition-all cursor-pointer ${
                desktopView === 'list'
                  ? 'bg-white dark:bg-[#1A1816] text-stone-900 dark:text-white shadow-2xs'
                  : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
              }`}
              title="Listenansicht"
            >
              <ListIcon className="w-4 h-4" />
            </button>
          </div>

          {/* Add Recipe Button */}
          <button
            onClick={onAddRecipe}
            className="h-9 px-3 rounded-full bg-[#DE5D4E] hover:bg-[#cf5142] text-white active:scale-95 transition-all shadow-xs flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
            title="Rezept hinzufügen / importieren"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Neues Rezept</span>
          </button>

          {/* Direct Sync Button */}
          <button
            onClick={onSync}
            disabled={isSyncing}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-stone-200/60 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white active:scale-95 transition-transform disabled:opacity-50 cursor-pointer"
            title="Sync recipes with Cook CLI server"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin text-[#DE5D4E]' : ''}`} />
          </button>

          {/* Settings Button */}
          <button
            onClick={onOpenSettings}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-stone-200/60 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white active:scale-95 transition-transform cursor-pointer"
            title="Settings & Cook CLI Server"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Search Bar with Desktop "/" hint */}
      <div className="relative mb-3">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Rezepte, Zutaten, Tags durchsuchen…"
          className="w-full h-11 pl-10 pr-16 rounded-xl bg-stone-200/50 dark:bg-stone-800/60 text-stone-900 dark:text-stone-100 placeholder-stone-400 text-sm focus:outline-none focus:ring-2 focus:ring-[#DE5D4E]/30 focus:bg-white dark:focus:bg-[#1A1816] transition-all"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
          {searchQuery ? (
            <button
              onClick={() => setSearchQuery('')}
              className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <kbd className="hidden md:inline-block px-1.5 py-0.5 text-[10px] font-mono font-medium text-stone-400 dark:text-stone-500 bg-stone-300/40 dark:bg-stone-700/50 rounded border border-stone-300/60 dark:border-stone-700/60">
              /
            </kbd>
          )}
        </div>
      </div>

      {/* Category Pills (Horizontal scroll) */}
      {categories.length > 2 && (
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-3 mb-2">
          {categories.slice(0, 16).map((cat) => {
            const isSelected = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium shrink-0 transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 shadow-2xs'
                    : 'bg-stone-200/60 dark:bg-stone-800/80 text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200 hover:bg-stone-300/60'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      )}

      {/* Content Area: Responsive Grid / List on Desktop */}
      <div className="flex-1 pb-8">
        {isLoading ? (
          <div className="py-20 text-center text-stone-400 dark:text-stone-500">
            <RefreshCw className="w-7 h-7 animate-spin mx-auto mb-3 text-[#DE5D4E]" />
            <p className="font-mela-serif text-xl">Lade Rezepte…</p>
          </div>
        ) : filteredRecipes.length === 0 ? (
          <div className="text-center py-20 px-4">
            <div className="w-14 h-14 rounded-full bg-stone-200/70 dark:bg-stone-800/80 mx-auto flex items-center justify-center text-stone-400 dark:text-stone-500 mb-4">
              <Tag className="w-7 h-7 opacity-60" />
            </div>
            <p className="font-mela-serif text-2xl font-bold text-stone-800 dark:text-stone-200 mb-1">
              {recipes.length === 0 ? 'Keine Rezepte gefunden' : 'Keine passenden Rezepte'}
            </p>
            <p className="text-xs text-stone-500 dark:text-stone-400 max-w-sm mx-auto mb-5 leading-relaxed">
              {recipes.length === 0
                ? 'Verbinde dich mit deinem Cook CLI Server oder erstelle dein erstes Cooklang Rezept.'
                : 'Passe deine Suchbegriffe an oder wähle eine andere Kategorie.'}
            </p>
            {recipes.length === 0 && (
              <div className="flex flex-wrap justify-center gap-2.5">
                <button
                  onClick={onAddRecipe}
                  className="px-4 py-2.5 rounded-xl bg-[#DE5D4E] hover:bg-[#cf5142] text-white text-xs font-semibold shadow-sm active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Rezept hinzufügen</span>
                </button>
                <button
                  onClick={onSync}
                  className="px-4 py-2.5 rounded-xl bg-stone-200/80 dark:bg-stone-800 text-stone-700 dark:text-stone-300 text-xs font-medium hover:bg-stone-300 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>Jetzt synchronisieren</span>
                </button>
                <button
                  onClick={onOpenSettings}
                  className="px-4 py-2.5 rounded-xl bg-stone-200/80 dark:bg-stone-800 text-stone-700 dark:text-stone-300 text-xs font-medium hover:bg-stone-300 cursor-pointer"
                >
                  Server Einstellungen
                </button>
              </div>
            )}
          </div>
        ) : desktopView === 'grid' ? (
          /* Responsive Desktop Grid / Mobile Row List */
          <div className="divide-y divide-stone-200/70 dark:divide-stone-800/80 md:divide-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-4 lg:gap-5">
            {filteredRecipes.map((recipe) => (
              <RecipeCard
                key={recipe.id || recipe.path}
                recipe={recipe}
                onClick={() => onSelectRecipe(recipe)}
              />
            ))}
          </div>
        ) : (
          /* List Mode (Clean Rows) */
          <div className="divide-y divide-stone-200/70 dark:divide-stone-800/80">
            {filteredRecipes.map((recipe) => (
              <RecipeRow
                key={recipe.id || recipe.path}
                recipe={recipe}
                onClick={() => onSelectRecipe(recipe)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const RecipeCard: React.FC<{ recipe: Recipe; onClick: () => void }> = ({ recipe, onClick }) => {
  const time =
    recipe.metadata.total_time ||
    recipe.metadata.cook_time ||
    recipe.metadata.time ||
    recipe.metadata.prep_time;
  const category =
    recipe.folder ||
    (Array.isArray(recipe.metadata.tags)
      ? recipe.metadata.tags[0]
      : recipe.metadata.tags) ||
    'Rezept';
  const author = (recipe.metadata.author as string) || (recipe.metadata.source as string);

  return (
    <div
      onClick={onClick}
      className="group py-3 md:py-0 md:p-3.5 flex md:flex-col items-center md:items-start gap-3.5 md:gap-3 cursor-pointer active:opacity-70 md:active:opacity-100 transition-all md:rounded-2xl md:bg-white md:dark:bg-[#1A1816] md:border md:border-stone-200/80 md:dark:border-stone-800/80 md:hover:border-stone-300 md:dark:hover:border-stone-700 md:hover:shadow-md md:hover:-translate-y-0.5"
    >
      {/* Thumbnail */}
      <div className="w-[68px] h-[68px] md:w-full md:h-44 rounded-xl md:rounded-xl overflow-hidden bg-stone-200 dark:bg-stone-800 shrink-0 relative shadow-2xs">
        {recipe.image ? (
          <img
            src={recipe.image}
            alt={recipe.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-stone-200/80 dark:bg-stone-800 text-stone-400">
            <Tag className="w-6 h-6 md:w-8 md:h-8 opacity-40" />
          </div>
        )}
        {category && (
          <span className="hidden md:inline-block absolute top-2.5 left-2.5 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-xs text-[10px] font-semibold text-white uppercase tracking-wider">
            {category}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pr-1 md:pr-0 w-full">
        <h2 className="font-mela-serif text-[17px] md:text-lg font-bold text-stone-900 dark:text-stone-100 leading-snug line-clamp-1 group-hover:text-[#DE5D4E] transition-colors">
          {recipe.name}
        </h2>

        {/* Metadata */}
        <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 mt-1">
          {time && (
            <span className="flex items-center gap-1 font-medium">
              <Clock className="w-3 h-3 text-[#DE5D4E]" />
              <span>{String(time)}</span>
            </span>
          )}

          {time && (
            <span className="md:hidden">•</span>
          )}

          <span className="md:hidden capitalize">{category}</span>

          {author && (
            <>
              <span>•</span>
              <span className="truncate">{author}</span>
            </>
          )}
        </div>

        {/* Description snippet */}
        {recipe.metadata.description && (
          <p className="text-xs text-stone-500 dark:text-stone-400 line-clamp-2 mt-1 leading-relaxed">
            {String(recipe.metadata.description)}
          </p>
        )}
      </div>
    </div>
  );
};

const RecipeRow: React.FC<{ recipe: Recipe; onClick: () => void }> = ({ recipe, onClick }) => {
  const time =
    recipe.metadata.total_time ||
    recipe.metadata.cook_time ||
    recipe.metadata.time ||
    recipe.metadata.prep_time;
  const category =
    recipe.folder ||
    (Array.isArray(recipe.metadata.tags)
      ? recipe.metadata.tags[0]
      : recipe.metadata.tags) ||
    'Recipe';
  const author = (recipe.metadata.author as string) || (recipe.metadata.source as string);

  return (
    <div
      onClick={onClick}
      className="py-3.5 flex items-center gap-3.5 cursor-pointer active:opacity-70 transition-opacity hover:bg-stone-100/40 dark:hover:bg-stone-800/30 px-2 rounded-xl"
    >
      <div className="w-[68px] h-[68px] rounded-xl overflow-hidden bg-stone-200 dark:bg-stone-800 shrink-0 shadow-xs relative">
        {recipe.image ? (
          <img
            src={recipe.image}
            alt={recipe.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-stone-200 dark:bg-stone-800 text-stone-400">
            <Tag className="w-6 h-6 opacity-40" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 pr-1">
        <h2 className="font-mela-serif text-[17px] font-bold text-stone-900 dark:text-stone-100 leading-snug line-clamp-1">
          {recipe.name}
        </h2>

        <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 mt-0.5">
          {time && (
            <span className="flex items-center gap-1 font-medium">
              <Clock className="w-3 h-3 text-[#DE5D4E]" />
              <span>{String(time)}</span>
            </span>
          )}

          {time && category && <span>•</span>}

          {category && <span className="capitalize">{category}</span>}

          {author && (
            <>
              <span>•</span>
              <span className="truncate">{author}</span>
            </>
          )}
        </div>

        {recipe.metadata.description && (
          <p className="text-xs text-stone-500 dark:text-stone-400 line-clamp-2 mt-1 leading-relaxed">
            {String(recipe.metadata.description)}
          </p>
        )}
      </div>
    </div>
  );
};
