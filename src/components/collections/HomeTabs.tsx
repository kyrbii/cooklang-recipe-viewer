import React from 'react';
import { Folder, List } from 'lucide-react';

export type HomeView = 'recipes' | 'collections';

/** "Alle Rezepte / Sammlungen" switch under the page header */
export const HomeTabs: React.FC<{ value: HomeView; onChange: (view: HomeView) => void }> = ({ value, onChange }) => (
  <div
    role="tablist"
    aria-label="Ansicht"
    className="grid grid-cols-2 gap-0.5 mt-4 mb-4 p-[3px] rounded-xl bg-stone-200/60 dark:bg-stone-800"
  >
    {(
      [
        ['recipes', 'Alle Rezepte', List],
        ['collections', 'Sammlungen', Folder]
      ] as const
    ).map(([view, label, Icon]) => (
      <button
        key={view}
        type="button"
        role="tab"
        aria-selected={value === view}
        onClick={() => onChange(view)}
        className={`h-[38px] rounded-[9px] text-sm flex items-center justify-center gap-[7px] cursor-pointer transition-colors ${
          value === view
            ? 'bg-white dark:bg-[#1A1816] text-stone-900 dark:text-white font-semibold shadow-sm'
            : 'text-stone-500 dark:text-stone-400 font-medium hover:text-stone-800 dark:hover:text-stone-200'
        }`}
      >
        <Icon className="w-4 h-4" />
        {label}
      </button>
    ))}
  </div>
);
