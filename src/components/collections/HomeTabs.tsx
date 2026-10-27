import React from 'react';
import { Folder, List, Plus } from 'lucide-react';

export type HomeView = 'recipes' | 'collections';

/** One button that jumps to the other main page: from the recipes to the collections and back */
export const HomeViewToggle: React.FC<{ value: HomeView; onChange: (view: HomeView) => void }> = ({ value, onChange }) => {
  const toCollections = value === 'recipes';
  const Icon = toCollections ? Folder : List;
  const label = toCollections ? 'Sammlungen' : 'Alle Rezepte';
  return (
    <button
      type="button"
      onClick={() => onChange(toCollections ? 'collections' : 'recipes')}
      title={`Zu ${label} wechseln`}
      className="h-9 px-3 rounded-full bg-stone-200/60 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white active:scale-95 transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
};

/** Round "+" in thumb reach, bottom right */
export const AddRecipeFab: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    title="Rezept hinzufügen / importieren"
    aria-label="Neues Rezept"
    className="fixed bottom-6 right-5 z-30 w-14 h-14 rounded-full bg-[#DE5D4E] hover:bg-[#cf5142] text-white shadow-lg flex items-center justify-center active:scale-95 transition-all cursor-pointer"
  >
    <Plus className="w-6 h-6" />
  </button>
);
