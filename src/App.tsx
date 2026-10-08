import React, { useState, useEffect, useCallback } from 'react';
import type { ConnectionStatus, Recipe } from './types/cook';
import { cookApi } from './services/cookApi';
import { RecipeList } from './components/RecipeList';
import { RecipeDetail } from './components/RecipeDetail';
import { RecipeEditor } from './components/RecipeEditor';
import { SettingsSheet } from './components/SettingsSheet';
import { AddRecipeModal } from './components/AddRecipeModal';
import { TimerProvider } from './context/TimerContext';

const MelaApp: React.FC = () => {
  const [recipes, setRecipes] = useState<Recipe[]>(() => cookApi.getCachedRecipes());
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>(() => cookApi.getStatus());

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
