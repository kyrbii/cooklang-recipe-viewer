import React from 'react';
import { Check } from 'lucide-react';

/** Round tick circle shown on recipes while selecting */
export const SelectBox: React.FC<{ checked: boolean; className?: string }> = ({ checked, className = '' }) => (
  <span
    aria-hidden="true"
    className={`w-7 h-7 shrink-0 rounded-full border-2 flex items-center justify-center ${
      checked ? 'bg-[#DE5D4E] border-[#DE5D4E] text-white' : 'bg-white/90 dark:bg-stone-900/80 border-stone-400'
    } ${className}`}
  >
    {checked && <Check className="w-4 h-4" strokeWidth={3} />}
  </span>
);
