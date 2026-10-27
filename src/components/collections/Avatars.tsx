import React from 'react';

const COLORS = [
  'bg-[#F4D9D4] text-[#8a2f26]',
  'bg-[#D9E6F2] text-[#1e4a73]',
  'bg-[#E3EBD3] text-[#3f5a1a]'
];

/** The same name always gets the same color */
const avatarColor = (name: string) => {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
};

export const Avatar: React.FC<{ name: string; size?: 'sm' | 'md' | 'lg'; ring?: string }> = ({
  name,
  size = 'sm',
  ring = 'border-white dark:border-[#1A1816]'
}) => {
  const dims = size === 'lg' ? 'w-[34px] h-[34px] text-[13px]' : size === 'md' ? 'w-[26px] h-[26px] text-[11px]' : 'w-[22px] h-[22px] text-[10px]';
  return (
    <span
      aria-hidden="true"
      className={`${dims} ${avatarColor(name)} rounded-full font-bold flex items-center justify-center ${
        size === 'lg' ? '' : `border-2 ${ring} -ml-[7px] first:ml-0`
      }`}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
};

/** Overlapping initials, at most three, as in the design */
export const AvatarStack: React.FC<{ members: string[]; size?: 'sm' | 'md'; ring?: string }> = ({
  members,
  size = 'sm',
  ring
}) => (
  <span className="flex items-center">
    {members.slice(0, 3).map((m) => (
      <Avatar key={m} name={m} size={size} ring={ring} />
    ))}
  </span>
);
