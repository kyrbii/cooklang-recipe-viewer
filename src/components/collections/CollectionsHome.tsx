import React from 'react';
import { Plus } from 'lucide-react';
import type { Collection, Recipe } from '../../types/cook';
import { AuthenticatedImage } from '../AuthenticatedImage';
import { AvatarStack } from './Avatars';

const PASTELS = ['bg-[#F2D6CF]', 'bg-[#EBCB9E]', 'bg-[#D7E0BF]', 'bg-[#CFDCE8]', 'bg-[#E6D3E6]', 'bg-[#F0E1B8]'];

/** 2x2 mosaic: recipe photos where there are some, soft colors otherwise */
const Cover: React.FC<{ collection: Collection; recipes: Recipe[] }> = ({ collection, recipes }) => {
  const byPath = new Map(recipes.map((r) => [r.path, r]));
  return (
    <div className="grid grid-cols-2 grid-rows-2 gap-[3px] h-[104px] rounded-[10px] overflow-hidden">
      {[0, 1, 2, 3].map((i) => {
        const color = PASTELS[(collection.id + i) % PASTELS.length];
        const image = byPath.get(collection.paths[i])?.image;
        return image ? (
          <AuthenticatedImage
            key={i}
            src={image}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
            fallback={<div className={`w-full h-full ${color}`} />}
          />
        ) : (
          <div key={i} className={`${color} dark:opacity-80`} />
        );
      })}
    </div>
  );
};

interface CollectionsHomeProps {
  collections: Collection[];
  recipes: Recipe[];
  loaded: boolean;
  error: string | null;
  onOpen: (id: number) => void;
  onCreate: () => void;
}

export const CollectionsHome: React.FC<CollectionsHomeProps> = ({
  collections,
  recipes,
  loaded,
  error,
  onOpen,
  onCreate
}) => (
  <div className="flex-1 pb-16">
    {error && (
      <p role="alert" className="mb-3 text-xs text-rose-700 dark:text-rose-400">
        {error}
      </p>
    )}
    {!loaded && !error ? (
      <p className="py-16 text-center text-stone-400 dark:text-stone-500 font-mela-serif text-xl">Lade Sammlungen…</p>
    ) : (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {collections.map((c) => {
          const count = `${c.paths.length} ${c.paths.length === 1 ? 'Rezept' : 'Rezepte'}`;
          const who = c.members.length === 1 ? 'nur du' : `${c.members.length} Mitglieder`;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onOpen(c.id)}
              aria-label={`${c.name}, ${count}, ${who}`}
              className="text-left flex flex-col p-2.5 pb-3.5 rounded-2xl bg-white dark:bg-[#1A1816] border border-stone-200 dark:border-stone-800 shadow-xs hover:border-stone-300 dark:hover:border-stone-700 hover:shadow-md active:scale-[0.99] transition-all cursor-pointer"
            >
              <Cover collection={c} recipes={recipes} />
              <span className="font-mela-serif text-[17px] font-bold leading-tight mt-3 mx-1 text-stone-900 dark:text-stone-100 line-clamp-2">
                {c.name}
              </span>
              <span className="flex items-center justify-between mt-2 mx-1 text-xs text-stone-500 dark:text-stone-400">
                <span>{count}</span>
                <AvatarStack members={c.members} />
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onCreate}
          className="min-h-[178px] flex flex-col items-center justify-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-stone-400 dark:border-stone-600 text-stone-500 dark:text-stone-400 text-sm font-semibold hover:bg-stone-200/40 dark:hover:bg-stone-800/50 cursor-pointer transition-colors"
        >
          <span className="w-10 h-10 rounded-full bg-stone-200/60 dark:bg-stone-800 flex items-center justify-center">
            <Plus className="w-5 h-5" />
          </span>
          Neue Sammlung
        </button>
      </div>
    )}
  </div>
);
