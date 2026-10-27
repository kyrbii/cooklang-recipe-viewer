import React, { useState } from 'react';
import { X } from 'lucide-react';

interface NameDialogProps {
  title: string;
  initial?: string;
  confirmLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}

/** Name for a new or renamed collection */
export const NameDialog: React.FC<NameDialogProps> = ({ title, initial = '', confirmLabel, onSubmit, onCancel }) => {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Das hat nicht geklappt.');
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm bg-[#FAF8F5] dark:bg-[#1A1816] rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 p-5 space-y-4 font-mela-sans"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-mela-serif text-lg font-bold text-stone-900 dark:text-stone-100">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Schließen"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-stone-200/70 dark:bg-stone-800 text-stone-600 dark:text-stone-300 disabled:opacity-50 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <input
          autoFocus
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name der Sammlung"
          aria-label="Name der Sammlung"
          className="w-full h-11 px-3.5 rounded-xl bg-white dark:bg-[#121110] border border-stone-200 dark:border-stone-800 text-sm text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-[#DE5D4E]/30"
        />
        {error && (
          <p role="alert" className="text-xs text-rose-700 dark:text-rose-400">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-10 px-4 rounded-xl bg-stone-200/70 dark:bg-stone-800 text-stone-700 dark:text-stone-300 text-xs font-semibold disabled:opacity-50 cursor-pointer"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="h-10 px-4 rounded-xl bg-[#DE5D4E] hover:bg-[#cf5142] text-white text-xs font-semibold shadow-sm disabled:opacity-50 cursor-pointer"
          >
            {busy ? 'Speichere…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
};
