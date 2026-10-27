import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

export interface OverflowMenuItem {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}

/** "Three points" button that opens a small menu. A tap outside or Escape closes it. */
export const OverflowMenu: React.FC<{ items: Array<OverflowMenuItem | false | null | undefined>; label?: string }> = ({
  items,
  label = 'Mehr'
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const shown = items.filter((item): item is OverflowMenuItem => !!item);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-9 h-9 flex items-center justify-center rounded-full bg-stone-200/60 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white active:scale-95 transition-all cursor-pointer"
      >
        <MoreHorizontal className="w-5 h-5" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute z-30 right-0 mt-1.5 min-w-52 rounded-xl bg-white dark:bg-[#1A1816] border border-stone-200 dark:border-stone-700 shadow-xl py-1 animate-fadeIn"
        >
          {shown.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className={`w-full px-3.5 py-2.5 flex items-center gap-3 text-left text-sm whitespace-nowrap cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-800 ${
                item.danger ? 'text-rose-700 dark:text-rose-400' : 'text-stone-800 dark:text-stone-200'
              }`}
            >
              <span className="w-4 h-4 flex items-center justify-center text-stone-500 dark:text-stone-400">
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
