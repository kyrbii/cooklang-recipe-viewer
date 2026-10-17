import React from 'react';
import { slugify } from '../utils/recipeLink';

interface RecipeRefLinkProps {
  /** Path from `@./folder/Recipe{}` without `.cook` */
  path: string;
  children: React.ReactNode;
}

/** Link to another recipe, written in Cooklang as `@./folder/Recipe{}` */
export const RecipeRefLink: React.FC<RecipeRefLinkProps> = ({ path, children }) => (
  <a
    href={`#/rezept/${slugify(path)}`}
    onClick={(e) => e.stopPropagation()}
    className="underline decoration-dotted underline-offset-4 decoration-[#DE5D4E]/60 hover:decoration-[#DE5D4E]"
    title={`Rezept „${path}“ öffnen`}
  >
    {children}
  </a>
);
