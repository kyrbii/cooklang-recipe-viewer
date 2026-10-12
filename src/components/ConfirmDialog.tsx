import React, { useEffect } from 'react';
import { X, Trash2 } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation for destructive actions. Escape and clicking outside cancel, unless an action is running. */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onCancel
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, busy, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-sm bg-[#FAF8F5] dark:bg-[#1A1816] rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 p-5 space-y-4 font-mela-sans"
      >
        <div className="flex items-center justify-between">
          <h2 id="confirm-dialog-title" className="font-mela-serif text-lg font-bold text-stone-900 dark:text-stone-100">
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Schließen"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-stone-200/70 dark:bg-stone-800 text-stone-600 dark:text-stone-300 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">{message}</div>

        {error && (
          <p role="alert" className="text-xs text-rose-700 dark:text-rose-400 leading-relaxed">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-10 px-4 rounded-xl bg-stone-200/70 dark:bg-stone-800 text-stone-700 dark:text-stone-300 text-xs font-semibold disabled:opacity-50"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="h-10 px-4 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{busy ? 'Lösche...' : confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
