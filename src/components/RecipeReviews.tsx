import React, { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import type { Recipe, RecipeReviews as Reviews } from '../types/cook';
import { cookApi } from '../services/cookApi';
import { useLoginUser } from '../hooks/useLoginUser';
import { formatRating } from '../utils/recipeFilter';

interface RecipeReviewsProps {
  recipe: Recipe;
  /** Average and count changed: the list and the open recipe show the new values */
  onReviewsChanged: (path: string, ratingAverage?: number, ratingCount?: number) => void;
  onOpenSettings: () => void;
}

/** Ratings and notes of everyone who rated the recipe. The signed-in person edits their own. */
export const RecipeReviews: React.FC<RecipeReviewsProps> = ({ recipe, onReviewsChanged, onOpenSettings }) => {
  const loginUser = useLoginUser();
  const [data, setData] = useState<Reviews | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const path = recipe.path;

  useEffect(() => {
    // Laden vom Server ist ein externes System, daher ist der Effekt richtig
    let active = true;
    // oxlint-disable-next-line react/set-state-in-effect
    setLoadFailed(false);
    cookApi
      .getReviews(path)
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [path]);

  const own = data?.reviews.find((r) => r.username === loginUser);
  const others = data?.reviews.filter((r) => r.username !== loginUser) ?? [];

  const handleSaved = (result: Reviews) => {
    setData(result);
    onReviewsChanged(path, result.ratingAverage, result.ratingCount);
  };

  return (
    <section className="mt-8 pt-6 border-t border-stone-200/70 dark:border-stone-800/80 space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-mela-serif text-xl sm:text-2xl font-bold text-stone-900 dark:text-stone-100">Bewertungen</h3>
        {data && data.ratingCount > 0 && data.ratingAverage !== undefined && (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-700 dark:text-stone-300">
            <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
            {formatRating(data.ratingAverage)}
            <span className="font-normal text-stone-500 dark:text-stone-400">
              ({data.ratingCount} {data.ratingCount === 1 ? 'Bewertung' : 'Bewertungen'})
            </span>
          </span>
        )}
      </div>

      {loadFailed && (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Bewertungen sind offline nicht verfügbar.
        </p>
      )}

      {others.length > 0 && (
        <ul className="space-y-3">
          {others.map((review) => (
            <ReviewCard key={review.username} name={review.username} rating={review.rating} note={review.note} />
          ))}
        </ul>
      )}

      {loginUser ? (
        data && (
          <ReviewForm
            key={`${path}-${own?.updatedAt ?? 0}`}
            path={path}
            initialRating={own?.rating}
            initialNote={own?.note}
            hasReview={Boolean(own)}
            onSaved={handleSaved}
          />
        )
      ) : (
        <button
          type="button"
          onClick={onOpenSettings}
          className="w-full px-4 py-3 rounded-2xl bg-stone-200/60 dark:bg-stone-800/70 text-sm font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-800 active:scale-[0.99] transition-all cursor-pointer"
        >
          Anmelden, um dieses Rezept zu bewerten
        </button>
      )}
    </section>
  );
};

const ReviewCard: React.FC<{ name: string; rating?: number; note?: string }> = ({
  name,
  rating,
  note
}) => (
  <li className="p-4 rounded-2xl bg-white dark:bg-[#1A1816] border border-stone-200/80 dark:border-stone-800/80 shadow-2xs">
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-semibold text-stone-800 dark:text-stone-200 truncate">{name}</span>
      {rating !== undefined && <Stars value={rating} />}
    </div>
    {note && <p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-stone-400 whitespace-pre-line">{note}</p>}
  </li>
);

const Stars: React.FC<{ value: number }> = ({ value }) => (
  <span className="inline-flex shrink-0 gap-0.5" aria-label={`${value} von 5 Sternen`}>
    {[1, 2, 3, 4, 5].map((n) => (
      <Star
        key={n}
        className={`w-3.5 h-3.5 ${n <= value ? 'fill-amber-400 text-amber-400' : 'text-stone-300 dark:text-stone-600'}`}
      />
    ))}
  </span>
);

const ReviewForm: React.FC<{
  path: string;
  initialRating?: number;
  initialNote?: string;
  hasReview: boolean;
  onSaved: (result: Reviews) => void;
}> = ({ path, initialRating, initialNote, hasReview, onSaved }) => {
  const [rating, setRating] = useState<number | undefined>(initialRating);
  const [note, setNote] = useState(initialNote ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const changed = rating !== initialRating || note.trim() !== (initialNote ?? '');

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const result = await cookApi.saveReview(path, { rating, note: note.trim() });
    setSaving(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setSaved(true);
    onSaved(result);
  };

  return (
    <div className="p-4 sm:p-5 rounded-2xl bg-stone-100/70 dark:bg-stone-800/40 border border-stone-200/70 dark:border-stone-800/80 space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium text-stone-700 dark:text-stone-300">
          {hasReview ? 'Deine Bewertung' : 'Wie hat es dir geschmeckt?'}
        </p>
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Sterne">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} Stern${n === 1 ? '' : 'e'}`}
              onClick={() => {
                // Noch einmal auf den gewählten Stern tippen entfernt die Bewertung
                setRating(rating === n ? undefined : n);
                setSaved(false);
              }}
              className="p-1 rounded-lg active:scale-90 transition-transform cursor-pointer"
            >
              <Star
                className={`w-7 h-7 ${
                  rating !== undefined && n <= rating ? 'fill-amber-400 text-amber-400' : 'text-stone-300 dark:text-stone-600'
                }`}
              />
            </button>
          ))}
        </div>
      </div>

      <textarea
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setSaved(false);
        }}
        maxLength={2000}
        rows={3}
        placeholder="Notiz, z. B. „etwas weniger Salz“ oder „mit Ingwer lecker“"
        className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#1A1816] border border-stone-200 dark:border-stone-700 text-sm text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-[#DE5D4E]/30 resize-y"
      />

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-xs">
          {error && <span className="text-rose-600 dark:text-rose-400">{error}</span>}
          {!error && saved && !changed && <span className="text-emerald-600 dark:text-emerald-400">Gespeichert</span>}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !changed}
          className="px-4 py-2 rounded-xl bg-[#DE5D4E] hover:bg-[#cf5142] text-white text-sm font-semibold shadow-xs active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {saving ? 'Speichere…' : 'Speichern'}
        </button>
      </div>
    </div>
  );
};
