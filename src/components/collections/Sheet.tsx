import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface SheetProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

/** Bottom sheet on a dimmed, blurred backdrop (centered on wide screens). Escape and a tap outside close it. */
export const Sheet: React.FC<SheetProps> = ({ title, onClose, children }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg bg-[#FAF8F5] dark:bg-[#1A1816] rounded-t-3xl sm:rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 overflow-hidden max-h-[90dvh] flex flex-col pb-safe animate-slideUp font-mela-sans"
      >
        <div className="flex items-center justify-between px-5 pt-[18px] pb-1">
          <h2 className="font-mela-serif text-[22px] font-bold text-stone-900 dark:text-stone-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-stone-200/70 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 pb-6">{children}</div>
      </div>
    </div>
  );
};
