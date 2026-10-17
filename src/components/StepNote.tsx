import React from 'react';
import { Sparkles } from 'lucide-react';

interface StepNoteProps {
  notes: string[];
  /** Smaller type and padding for the live preview */
  compact?: boolean;
}

/** Notes written as `> text`, shown where they stand in the recipe */
export const StepNote: React.FC<StepNoteProps> = ({ notes, compact }) => (
  <div className={compact ? 'space-y-2' : 'space-y-3'}>
    {notes.map((note, idx) => (
      <div
        key={idx}
        className={`flex items-start gap-2.5 border border-amber-500/25 dark:border-amber-500/30 bg-amber-500/10 dark:bg-amber-500/15 text-stone-800 dark:text-stone-200 ${
          compact ? 'p-2.5 rounded-xl text-xs leading-relaxed' : 'p-3.5 rounded-2xl text-sm leading-relaxed'
        }`}
      >
        <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 whitespace-pre-line">{note}</div>
      </div>
    ))}
  </div>
);
