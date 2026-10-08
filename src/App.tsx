import React, { useState, useEffect, useCallback } from 'react';
import { Clock, Play, Pause, X } from 'lucide-react';
import type { ConnectionStatus, Recipe } from './types/cook';
import { cookApi } from './services/cookApi';
import { RecipeList } from './components/RecipeList';
import { RecipeDetail } from './components/RecipeDetail';
import { RecipeEditor } from './components/RecipeEditor';
import { SettingsSheet } from './components/SettingsSheet';
import { AddRecipeModal } from './components/AddRecipeModal';
import { TimerProvider, useTimers } from './context/TimerContext';

function formatRemaining(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const MelaApp: React.FC = () => {
  const [recipes, setRecipes] = useState<Recipe[]>(() => cookApi.getCachedRecipes());
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>(() => cookApi.getStatus());

  const { timers, pauseTimer, startTimer, removeTimer } = useTimers();

  // Initialize theme and status listeners
  useEffect(() => {
    const unsub = cookApi.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });

    const theme = cookApi.getTheme();
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    return () => unsub();
  }, []);

  // Sync recipes from server or fallback to cache
  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const result = await cookApi.syncRecipes();
      setRecipes(result.recipes);

      // If a recipe is currently selected, update its reference with latest data
      setSelectedRecipe((current) => {
        if (!current) return null;
        return result.recipes.find((r) => r.id === current.id || r.path === current.path) || current;
      });
    } catch (err) {
      console.error('Error syncing recipes:', err);
    } finally {
      setIsSyncing(false);
      setIsLoading(false);
    }
  }, []);

  // Initial load: show cached immediately, then sync with server
  useEffect(() => {
    const initialCached = cookApi.getCachedRecipes();
    if (initialCached.length === 0) {
      setIsLoading(true);
    }
    handleSync();
  }, [handleSync]);

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-stone-900 dark:bg-[#121110] dark:text-stone-100 flex flex-col transition-colors duration-200">
      <main className="flex-1 flex flex-col">
        {selectedRecipe ? (
          <RecipeDetail
            recipe={selectedRecipe}
            onBack={() => setSelectedRecipe(null)}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onEdit={() => setEditingRecipe(selectedRecipe)}
          />
        ) : (
          <RecipeList
            recipes={recipes}
            isLoading={isLoading}
            isSyncing={isSyncing}
            status={status}
            onSync={handleSync}
            onSelectRecipe={(r) => setSelectedRecipe(r)}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onAddRecipe={() => setIsAddModalOpen(true)}
          />
        )}
      </main>

      {/* Floating Active Timers Bar (Visible across whole app when timers are running or completed) */}
      {timers.length > 0 && (
        <aside aria-label="Aktive Koch-Timer" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-md w-[calc(100%-2rem)] flex flex-col gap-2 pointer-events-none">
          {timers.map((timer) => {
            const isFinished = timer.remainingSeconds === 0;
            return (
              <div
                key={timer.id}
                className={`pointer-events-auto p-3 rounded-2xl shadow-xl flex items-center justify-between gap-3 border transition-all animate-slideUp ${
                  isFinished
                    ? 'bg-rose-500 text-white border-rose-600 animate-pulse'
                    : 'bg-stone-900/95 text-white dark:bg-stone-100/95 dark:text-stone-900 border-stone-800 dark:border-stone-200 backdrop-blur-md'
                }`}
              >
                <div
                  className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
                  onClick={() => {
                    if (timer.recipeId) {
                      const found = recipes.find(
                        (r) => r.id === timer.recipeId || r.path === timer.recipeId || r.name === timer.recipeId
                      );
                      if (found) setSelectedRecipe(found);
                    }
                  }}
                  title="Zum Rezept springen"
                >
                  <Clock className={`w-4 h-4 shrink-0 ${isFinished ? 'animate-bounce' : 'text-[#DE5D4E]'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate leading-tight">
                      {timer.name}
                    </p>
                    <p className="text-[11px] opacity-80 font-mono">
                      {isFinished ? 'Fertig!' : formatRemaining(timer.remainingSeconds)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {!isFinished && (
                    <button
                      onClick={() => (timer.isRunning ? pauseTimer(timer.id) : startTimer(timer.id))}
                      className="p-1.5 rounded-lg hover:bg-white/20 active:scale-95 transition-all cursor-pointer"
                      title={timer.isRunning ? 'Pause' : 'Start'}
                    >
                      {timer.isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>
                  )}
                  <button
                    onClick={() => removeTimer(timer.id)}
                    className="p-1.5 rounded-lg hover:bg-white/20 active:scale-95 transition-all cursor-pointer"
                    title="Timer schließen"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </aside>
      )}

      {/* Edit Recipe Editor (Fullscreen Overlay with Live Preview & Server Sync) */}
      {editingRecipe && (
        <RecipeEditor
          recipe={editingRecipe}
          status={status}
          onClose={() => setEditingRecipe(null)}
          onSaved={(updatedRecipe) => {
            setEditingRecipe(null);
            setSelectedRecipe(updatedRecipe);
            setRecipes((prev) => {
              const next = [...prev];
              const idx = next.findIndex(
                (r) => r.id === updatedRecipe.id || r.path === updatedRecipe.path
              );
              if (idx >= 0) {
                next[idx] = updatedRecipe;
              } else {
                next.push(updatedRecipe);
                next.sort((a, b) => a.name.localeCompare(b.name));
              }
              return next;
            });
          }}
        />
      )}

      {/* Add / Import Recipe Modal */}
      <AddRecipeModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onRecipeSaved={(newRecipe) => {
          setSelectedRecipe(newRecipe);
          handleSync();
        }}
      />

      {/* Mela-styled Settings Sheet */}
      <SettingsSheet
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        status={status}
        isSyncing={isSyncing}
        onSync={handleSync}
      />
    </div>
  );
};

export default function App() {
  return (
    <TimerProvider>
      <MelaApp />
    </TimerProvider>
  );
}
