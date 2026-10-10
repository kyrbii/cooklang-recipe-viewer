import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ChevronLeft,
  MoreHorizontal,
  Clock,
  Users,
  Check,
  Circle,
  CheckCircle2,
  Minus,
  Plus,
  Heart,
  Share2,
  CookingPot,
  ChefHat,
  Pencil,
  Tag,
  Lightbulb,
  Sparkles
} from 'lucide-react';
import type { Recipe, StepItem } from '../types/cook';
import {
  aggregateIngredients,
  parseQuantity,
  parseStepText,
  scaleQuantity,
  sortIngredientsByQuantity
} from '../utils/cooklangParser';
import { cookApi } from '../services/cookApi';
import { useTimers } from '../context/useTimers';
import { recipeShareUrl } from '../utils/recipeLink';
import { AuthenticatedImage } from './AuthenticatedImage';

interface RecipeDetailProps {
  recipe: Recipe;
  onBack: () => void;
  onOpenSettings: () => void;
  onEdit: () => void;
}

function formatRemaining(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const RecipeDetail: React.FC<RecipeDetailProps> = ({
  recipe,
  onBack,
  onOpenSettings,
  onEdit
}) => {
  const { timers, addTimer, startTimer, pauseTimer } = useTimers();

  // Screen Wake Lock (Cook Mode)
  const [isCookMode, setIsCookMode] = useState(false);
  const [wakeLockError, setWakeLockError] = useState<string | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const requestWakeLock = async (): Promise<boolean> => {
    if ('wakeLock' in navigator) {
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        wakeLockRef.current = sentinel;
        sentinel.addEventListener('release', () => {
          if (wakeLockRef.current === sentinel) {
            wakeLockRef.current = null;
          }
        });
        setWakeLockError(null);
        return true;
      } catch (err) {
        console.warn('Screen Wake Lock error:', err);
        setWakeLockError('Display-Aktivhaltung wird in diesem Browser nicht zugelassen');
        return false;
      }
    } else {
      setWakeLockError('Screen Wake Lock API nicht unterstützt');
      return false;
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
      } catch {
        // ignore
      }
      wakeLockRef.current = null;
    }
  };

  const handleToggleCookMode = async () => {
    if (isCookMode) {
      await releaseWakeLock();
      setIsCookMode(false);
    } else {
      const ok = await requestWakeLock();
      setIsCookMode(ok);
      if (!ok) {
        setTimeout(() => setWakeLockError(null), 3500);
      }
    }
  };

  // Re-acquire lock if user switches back to app tab while cook mode is on
  useEffect(() => {
    const handleVisibility = async () => {
      if (isCookMode && document.visibilityState === 'visible' && !wakeLockRef.current) {
        await requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isCookMode]);

  // Clean up wake lock on unmount
  useEffect(() => {
    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, []);

  // Base servings
  const baseServings = useMemo(() => {
    const raw = recipe.metadata.servings;
    const parsed = parseQuantity(raw);
    return parsed && parsed > 0 ? parsed : 4;
  }, [recipe]);

  const [currentServings, setCurrentServings] = useState<number>(baseServings);
  const [checkedIngredients, setCheckedIngredients] = useState<Set<string>>(() =>
    cookApi.getCheckedIngredients(recipe.id)
  );
  const [isFavorite, setIsFavorite] = useState<boolean>(() =>
    cookApi.getFavorites().includes(recipe.id)
  );
  const [copiedLink, setCopiedLink] = useState(false);

  const ratio = currentServings / baseServings;
  // Faktor zur Anzeige: maximal zwei Nachkommastellen, ohne unnötige Nullen
  const ratioLabel = Number(ratio.toFixed(2)).toString();

  const ingredients = useMemo(
    () => sortIngredientsByQuantity(aggregateIngredients(recipe.ingredients)),
    [recipe]
  );

  const tags = useMemo(() => {
    const raw = recipe.metadata.tags ?? recipe.metadata.tag;
    if (Array.isArray(raw)) {
      return raw.map(String).map((t) => t.trim()).filter(Boolean);
    }
    if (typeof raw === 'string') {
      return raw.split(',').map((t) => t.trim()).filter(Boolean);
    }
    return [];
  }, [recipe]);

  const handleServingChange = (delta: number) => {
    setCurrentServings((prev) => Math.max(1, prev + delta));
  };

  const handleToggleIngredient = (name: string) => {
    setCheckedIngredients((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      cookApi.setCheckedIngredients(recipe.id, next);
      return next;
    });
  };

  const handleToggleFavorite = () => {
    const fav = cookApi.toggleFavorite(recipe.id);
    setIsFavorite(fav);
  };

  const handleShare = async () => {
    const url = recipeShareUrl(recipe);
    if (navigator.share) {
      try {
        await navigator.share({
          title: recipe.name,
          text: `Rezept: ${recipe.name}`,
          url
        });
        return;
      } catch {
        // Fallback to clipboard
      }
    }
    navigator.clipboard?.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const prepTime = recipe.metadata.prep_time;
  const cookTime = recipe.metadata.cook_time;
  const totalTime = recipe.metadata.total_time || recipe.metadata.time;

  const groupedSections = useMemo(() => {
    let rawGroups: Array<{ name?: string; steps: typeof recipe.steps }> = [];
    if (recipe.sections && recipe.sections.length > 0) {
      rawGroups = recipe.sections;
    } else {
      const hasSections = recipe.steps.some((s) => Boolean(s.section));
      if (!hasSections) {
        rawGroups = [{ name: undefined, steps: recipe.steps }];
      } else {
        let currentGroup: { name?: string; steps: typeof recipe.steps } | null = null;
        for (const step of recipe.steps) {
          if (!currentGroup || currentGroup.name !== step.section) {
            currentGroup = { name: step.section, steps: [] };
            rawGroups.push(currentGroup);
          }
          currentGroup.steps.push(step);
        }
      }
    }

    // Number steps continuously across all sections (1, 2, 3...)
    let stepCounter = 1;
    return rawGroups.map((group) => ({
      name: group.name,
      steps: group.steps.map((st) => ({
        ...st,
        stepNumber: stepCounter++
      }))
    }));
  }, [recipe]);

  return (
    <div className="flex-1 flex flex-col w-full font-mela-sans min-h-screen">
      {/* Top Bar (Header) */}
      <header className="shrink-0 w-full border-b border-stone-200/60 dark:border-stone-800/60 bg-[#FAF8F5]/95 dark:bg-[#121110]/95 backdrop-blur-sm z-10 pt-safe sticky top-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between">
          <button
            onClick={onBack}
            className="h-10 px-2.5 -ml-2 flex items-center gap-1 rounded-full text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800 active:scale-95 transition-all cursor-pointer"
            title="Zurück zur Rezeptübersicht"
          >
            <ChevronLeft className="w-6 h-6 -ml-0.5" />
            <span className="hidden sm:inline text-sm font-semibold pr-1">Rezepte</span>
          </button>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Edit Recipe Button */}
            <button
              id="recipe-edit-button"
              onClick={onEdit}
              className="h-9 px-3 rounded-full text-xs font-semibold flex items-center gap-1.5 bg-stone-200/70 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white hover:bg-stone-300/60 active:scale-95 transition-all cursor-pointer shadow-2xs"
              title="Rezeptdatei (.cook) bearbeiten"
            >
              <Pencil className="w-3.5 h-3.5 text-[#DE5D4E]" />
              <span>Bearbeiten</span>
            </button>

            {/* Cook Mode (Screen Wake Lock) Button */}
            <button
              onClick={handleToggleCookMode}
              className={`h-9 px-3 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer ${
                isCookMode
                  ? 'bg-[#DE5D4E] text-white shadow-sm ring-2 ring-[#DE5D4E]/30'
                  : 'bg-stone-200/70 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
              }`}
              title={
                isCookMode
                  ? 'Kochmodus beenden (Display schaltet wieder normal aus)'
                  : 'Kochmodus starten (Display bleibt an)'
              }
            >
              <ChefHat
                className={`w-4 h-4 ${
                  isCookMode ? 'text-white' : 'text-stone-600 dark:text-stone-400'
                }`}
              />
              <span className="hidden min-[420px]:inline">
                {isCookMode ? 'Display an' : 'Kochen'}
              </span>
            </button>

            <button
              onClick={handleToggleFavorite}
              className="w-9 h-9 flex items-center justify-center rounded-full text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800 active:scale-95 cursor-pointer"
              title="Favorit"
            >
              <Heart
                className={`w-4 h-4 ${
                  isFavorite ? 'fill-[#DE5D4E] text-[#DE5D4E]' : ''
                }`}
              />
            </button>

            <button
              onClick={onOpenSettings}
              className="w-9 h-9 flex items-center justify-center rounded-full text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800 active:scale-95 cursor-pointer"
              title="Optionen & Server-Einstellungen"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Cook Mode Active Banner */}
      {isCookMode && (
        <div className="shrink-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-3">
          <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-orange-50 dark:bg-orange-950/40 border border-[#DE5D4E]/30 text-xs text-[#DE5D4E] dark:text-[#f87a6c] font-medium animate-fadeIn">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#DE5D4E] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#DE5D4E]"></span>
              </span>
              <span>Kochmodus aktiv • Display bleibt dauerhaft an</span>
            </div>
            <button
              onClick={handleToggleCookMode}
              className="text-[11px] font-semibold underline hover:no-underline cursor-pointer"
            >
              Beenden
            </button>
          </div>
        </div>
      )}

      {/* Wake Lock Error Warning */}
      {wakeLockError && (
        <div className="shrink-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-3">
          <div className="px-3.5 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300/40 text-xs text-amber-700 dark:text-amber-300 animate-fadeIn">
            {wakeLockError}
          </div>
        </div>
      )}

      {/* Main Content Area: Unified page scroll, 2 columns on desktop (lg:) with Ingredients on the RIGHT */}
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 flex flex-col lg:grid lg:grid-cols-12 lg:gap-10 xl:gap-14 lg:items-start">
        {/* Left Column (Desktop): Image + Title + Description + Metadata + Instructions/Steps */}
        <div className="contents lg:block lg:col-span-7 xl:col-span-8 space-y-8">
          {/* Header Presentation Block: Image, Title, Description, Times */}
          <div className="order-1 lg:order-none space-y-4">
            {/* Dish Photo */}
            {recipe.image && (
              <div className="overflow-hidden rounded-2xl sm:rounded-3xl shadow-lg border border-stone-200/60 dark:border-stone-800/80 bg-stone-200 dark:bg-stone-800">
                <AuthenticatedImage
                  src={recipe.image}
                  alt={recipe.name}
                  className="w-full h-56 sm:h-72 lg:h-84 xl:h-96 object-cover hover:scale-[1.01] transition-transform duration-500"
                />
              </div>
            )}

            {/* Recipe Title */}
            <h1 className="font-mela-serif text-3xl sm:text-4xl lg:text-4xl xl:text-5xl font-bold tracking-tight text-stone-900 dark:text-stone-50 leading-tight">
              {recipe.name}
            </h1>

            {/* Recipe Description */}
            {recipe.metadata.description && (
              <p className="text-sm sm:text-base text-stone-600 dark:text-stone-400 italic leading-relaxed">
                {String(recipe.metadata.description)}
              </p>
            )}

            {/* Recipe Tags */}
            {tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {tags.map((tag, idx) => (
                  <span
                    key={`${tag}_${idx}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-stone-200/70 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-200/60 dark:border-stone-700/60 shadow-2xs hover:bg-stone-300/60 transition-colors"
                  >
                    <Tag className="w-3 h-3 text-[#DE5D4E] opacity-80" />
                    <span>{tag}</span>
                  </span>
                ))}
              </div>
            )}

            {/* Metadata Badges & Share Row */}
            <div className="flex flex-wrap items-center justify-between gap-3 py-2.5 border-y border-stone-200/70 dark:border-stone-800/80 text-xs text-stone-600 dark:text-stone-400">
              <div className="flex flex-wrap items-center gap-4">
                {/* Servings Indicator */}
                <div className="flex items-center gap-1.5 font-medium">
                  <Users className="w-4 h-4 text-stone-500" />
                  <span className="font-semibold text-stone-900 dark:text-stone-100">
                    {currentServings}
                  </span>
                  <span>Portionen</span>
                  {ratio !== 1 && (
                    <span className="text-[#DE5D4E] font-semibold">({ratioLabel}x)</span>
                  )}
                </div>

                {prepTime && (
                  <>
                    <span className="text-stone-300 dark:text-stone-700">•</span>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-stone-400" />
                      <span>{String(prepTime)}</span>
                      <span className="uppercase text-[10px] text-stone-400 font-semibold tracking-wider">
                        VORB.
                      </span>
                    </div>
                  </>
                )}

                {(totalTime || cookTime) && (
                  <>
                    <span className="text-stone-300 dark:text-stone-700">•</span>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-[#DE5D4E]" />
                      <span>{String(totalTime || cookTime)}</span>
                      <span className="uppercase text-[10px] text-stone-400 font-semibold tracking-wider">
                        GESAMT
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* Share Button */}
              <button
                onClick={handleShare}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-stone-200/60 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-300/60 flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all"
                title="Rezept teilen"
              >
                {copiedLink ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Share2 className="w-3.5 h-3.5" />
                )}
                <span>{copiedLink ? 'Kopiert' : 'Teilen'}</span>
              </button>
            </div>
          </div>

          {/* Instructions / Steps Block */}
          <div className="order-3 lg:order-none space-y-6 pt-4 lg:pt-2">
            <h2 className="font-mela-serif text-2xl sm:text-3xl font-bold text-stone-900 dark:text-stone-100 pb-2 border-b border-stone-200/70 dark:border-stone-800/80">
              Zubereitung
            </h2>

            <div className="space-y-8">
              {groupedSections.map((group, gIdx) => (
                <div key={gIdx} className="space-y-4">
                  {group.name && (
                    <div className="flex items-center gap-2 pt-1">
                      <h3 className="font-mela-serif text-xl sm:text-2xl font-bold text-stone-900 dark:text-stone-100">
                        {group.name}
                      </h3>
                      <span className="h-px flex-1 bg-stone-200/80 dark:bg-stone-800/80 ml-2" />
                    </div>
                  )}

                  <div className="space-y-6 sm:space-y-7">
                    {group.steps.map((step) => (
                      <div key={step.stepNumber} className="flex gap-4 sm:gap-5">
                        {/* Step Number in bold serif */}
                        <span className="font-mela-serif text-xl sm:text-2xl font-bold text-stone-400 dark:text-stone-500 shrink-0 w-6 pt-0.5">
                          {step.stepNumber}
                        </span>

                        {/* Step text with clean typography and embedded interactive timers */}
                        <div className="flex-1 text-[15px] sm:text-base leading-relaxed text-stone-800 dark:text-stone-200">
                          {renderMelaStepItems(
                            step.items,
                            ratio,
                            addTimer,
                            recipe.name,
                            step.stepNumber,
                            timers,
                            pauseTimer,
                            startTimer
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Tips / Notes Section (Tipps aus dem Rezepttext) */}
            {recipe.notes && recipe.notes.length > 0 && (
              <div className="mt-8 pt-6 border-t border-stone-200/70 dark:border-stone-800/80 space-y-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/15 dark:bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
                    <Lightbulb className="w-4 h-4" />
                  </div>
                  <h3 className="font-mela-serif text-xl sm:text-2xl font-bold text-stone-900 dark:text-stone-100">
                    {recipe.notes.length === 1 ? 'Tipp' : 'Tipps & Hinweise'}
                  </h3>
                </div>

                <div className="space-y-3">
                  {recipe.notes.map((note, idx) => {
                    const parsed = parseStepText(note);
                    return (
                      <div
                        key={idx}
                        className="p-4 sm:p-5 rounded-2xl bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/25 dark:border-amber-500/30 text-stone-800 dark:text-stone-200 shadow-2xs"
                      >
                        <div className="flex items-start gap-3">
                          <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          <div className="flex-1 text-sm sm:text-[15px] leading-relaxed">
                            {renderMelaStepItems(
                              parsed.items,
                              ratio,
                              addTimer,
                              recipe.name,
                              0,
                              timers,
                              pauseTimer,
                              startTimer
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column (Desktop): Ingredients & Portions scaler on the right (natural continuous scroll) */}
        <div className="contents lg:block lg:col-span-5 xl:col-span-4">
          <div className="order-2 lg:order-none space-y-5 pt-4 lg:pt-0 lg:bg-stone-100/60 dark:lg:bg-stone-900/50 lg:p-6 lg:rounded-3xl lg:border lg:border-stone-200/70 dark:lg:border-stone-800/80">
            {/* Ingredients Header */}
            <div className="flex items-center justify-between pb-1 border-b border-stone-200/70 dark:border-stone-800/80">
              <div className="flex items-baseline gap-2">
                <h2 className="font-mela-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
                  Zutaten
                </h2>
                <span className="text-xs text-stone-500 dark:text-stone-400">
                  ({ingredients.length})
                </span>
              </div>
              <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                {checkedIngredients.size}/{ingredients.length} erledigt
              </span>
            </div>

            {/* Serving Scaler Box directly above ingredients */}
            <div className="p-3.5 rounded-2xl bg-white dark:bg-[#1A1816] border border-stone-200/80 dark:border-stone-800 shadow-2xs flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-stone-500" />
                  <span className="text-xs font-bold text-stone-800 dark:text-stone-200">
                    Portionen
                  </span>
                  {ratio !== 1 && (
                    <span className="text-[11px] font-semibold text-[#DE5D4E] bg-rose-50 dark:bg-rose-950/40 px-1.5 py-0.5 rounded">
                      {ratioLabel}x
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-stone-400 block mt-0.5">
                  Basis: {baseServings} Portionen
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleServingChange(-1)}
                  disabled={currentServings <= 1}
                  className="w-8 h-8 rounded-lg bg-stone-100 dark:bg-stone-800 flex items-center justify-center font-bold text-stone-700 dark:text-stone-200 disabled:opacity-30 active:scale-95 cursor-pointer hover:bg-stone-200/70 dark:hover:bg-stone-700 transition-colors"
                  title="Portionen verringern"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>

                <span className="w-8 text-center font-mono font-bold text-base text-stone-900 dark:text-stone-100">
                  {currentServings}
                </span>

                <button
                  onClick={() => handleServingChange(1)}
                  className="w-8 h-8 rounded-lg bg-stone-100 dark:bg-stone-800 flex items-center justify-center font-bold text-stone-700 dark:text-stone-200 active:scale-95 cursor-pointer hover:bg-stone-200/70 dark:hover:bg-stone-700 transition-colors"
                  title="Portionen erhöhen"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>

                {ratio !== 1 && (
                  <button
                    onClick={() => setCurrentServings(baseServings)}
                    className="text-xs text-[#DE5D4E] font-medium ml-1 hover:underline cursor-pointer"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* Checklist of Ingredients */}
            <div className="space-y-1">
              {ingredients.map((ing, idx) => {
                const isOptional = Boolean(ing.optional || ing.name.startsWith('?'));
                const cleanName = ing.name.replace(/^\?+\s*/, '').trim();
                const itemKey = isOptional ? `${cleanName} (optional)` : cleanName;
                const isChecked = checkedIngredients.has(itemKey) || checkedIngredients.has(cleanName) || checkedIngredients.has(ing.name);
                const scaledQty = scaleQuantity(ing.quantity, ratio);
                const amountPart = [scaledQty, ing.units].filter(Boolean).join(' ');

                return (
                  <div
                    key={`${itemKey}_${idx}`}
                    onClick={() => handleToggleIngredient(itemKey)}
                    className={`py-2 px-2.5 rounded-xl flex items-center gap-3 cursor-pointer transition-colors select-none ${
                      isChecked
                        ? 'text-stone-400 dark:text-stone-600 line-through bg-stone-100/40 dark:bg-stone-900/40'
                        : 'text-stone-800 dark:text-stone-200 hover:bg-stone-200/50 dark:hover:bg-stone-800/50'
                    }`}
                  >
                    {isChecked ? (
                      <CheckCircle2 className="w-4 h-4 text-[#DE5D4E] shrink-0" />
                    ) : (
                      <Circle className="w-4 h-4 text-stone-300 dark:text-stone-700 shrink-0" />
                    )}

                    <div className="text-sm leading-snug">
                      {amountPart && (
                        <span className="font-semibold text-stone-900 dark:text-stone-100 font-mono mr-1.5">
                          {amountPart}
                        </span>
                      )}
                      <span>{cleanName}</span>
                      {ing.sources && ing.sources.length > 1 && (
                        <span className="ml-1.5 text-xs text-stone-400 dark:text-stone-500 font-normal">
                          ({ing.sources
                            .map((src) => [scaleQuantity(src.quantity, ratio), src.units].filter(Boolean).join(' '))
                            .join(' und ')})
                        </span>
                      )}
                      {isOptional && (
                        <span className="ml-1.5 text-xs text-stone-500 dark:text-stone-400 font-normal">
                          (optional)
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Section: Cookware (if any) */}
            {recipe.cookware.length > 0 && (
              <div className="pt-4 border-t border-stone-200/70 dark:border-stone-800/80">
                <div className="flex items-center gap-2 text-xs text-stone-500 mb-2.5">
                  <CookingPot className="w-4 h-4 text-stone-400" />
                  <span className="font-semibold uppercase tracking-wider">
                    Kochgeschirr
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recipe.cookware.map((cw, idx) => {
                    const isOptional = Boolean(cw.optional || cw.name.startsWith('?'));
                    const cleanName = cw.name.replace(/^\?+\s*/, '').trim();
                    return (
                      <span
                        key={idx}
                        className="px-2.5 py-1 rounded-lg bg-stone-200/60 dark:bg-stone-800 text-xs font-medium text-stone-700 dark:text-stone-300 border border-stone-200/50 dark:border-stone-700/50"
                      >
                        {cleanName}{isOptional ? ' (optional)' : ''}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Editorial Mela style step sentence items
 */
function renderMelaStepItems(
  items: StepItem[],
  ratio: number,
  addTimer: (name: string, durationSeconds: number, recipeId?: string, stepNumber?: number) => string,
  recipeName: string,
  stepNumber: number,
  timers: Array<{ id: string; name: string; remainingSeconds: number; isRunning: boolean; stepNumber?: number }>,
  pauseTimer: (id: string) => void,
  startTimer: (id: string) => void
) {
  return items.map((item, idx) => {
    if (item.type === 'text') {
      return <span key={idx}>{item.value}</span>;
    }

    if (item.type === 'ingredient') {
      const scaled = scaleQuantity(item.quantity, ratio);
      const amount = [scaled, item.units].filter(Boolean).join(' ');
      const isOptional = Boolean(item.optional || item.name?.startsWith('?'));
      const cleanName = item.name ? item.name.replace(/^\?+\s*/, '').trim() : '';
      const displayName = isOptional ? `${cleanName} (optional)` : cleanName;
      return (
        <span key={idx} className="font-semibold text-stone-900 dark:text-stone-100">
          {amount ? `${amount} ` : ''}
          {displayName}
        </span>
      );
    }

    if (item.type === 'cookware') {
      const isOptional = Boolean(item.optional || item.name?.startsWith('?'));
      const cleanName = item.name ? item.name.replace(/^\?+\s*/, '').trim() : '';
      const displayName = isOptional ? `${cleanName} (optional)` : cleanName;
      return (
        <span key={idx} className="font-medium text-stone-900 dark:text-stone-100">
          {displayName}
        </span>
      );
    }

    if (item.type === 'timer') {
      const active = timers.find(
        (t) =>
          t.stepNumber === stepNumber &&
          (t.name === item.name || t.name.includes(item.name || 'Timer'))
      );

      if (active) {
        const isFinished = active.remainingSeconds === 0;
        return (
          <button
            key={idx}
            onClick={() => {
              if (active.isRunning) {
                pauseTimer(active.id);
              } else {
                startTimer(active.id);
              }
            }}
            className={`inline-flex items-center gap-1 font-mono text-xs font-semibold px-2 py-0.5 mx-1 rounded-md border align-baseline active:scale-95 transition-all ${
              isFinished
                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border-rose-300 animate-pulse'
                : active.isRunning
                ? 'bg-[#DE5D4E]/15 border-[#DE5D4E]/40 text-[#DE5D4E]'
                : 'bg-stone-200 dark:bg-stone-800 text-stone-600 dark:text-stone-300 border-stone-300 dark:border-stone-700'
            }`}
          >
            <Clock className="w-3 h-3 text-[#DE5D4E]" />
            <span>{formatRemaining(active.remainingSeconds)}</span>
          </button>
        );
      }

      return (
        <button
          key={idx}
          onClick={() => {
            addTimer(
              item.name || `${recipeName} - Schritt ${stepNumber}`,
              item.totalSeconds || 60,
              undefined,
              stepNumber
            );
          }}
          className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-[#DE5D4E] hover:underline decoration-dotted underline-offset-4 active:scale-95 transition-all"
          title="Timer starten"
        >
          <Clock className="w-3 h-3 text-[#DE5D4E]" />
          <span>{String(item.quantity)} {item.units}</span>
        </button>
      );
    }

    return null;
  });
}
