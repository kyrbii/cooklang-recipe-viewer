import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  X,
  Check,
  Loader2,
  CloudOff,
  Cloud,
  AlertTriangle,
  RotateCcw,
  Copy,
  Clock,
  Users,
  HelpCircle,
  History,
  FileCode2,
  Eye,
  CookingPot,
  Sparkles,
  Lightbulb,
  Camera,
  ImageOff
} from 'lucide-react';
import type { ConnectionStatus, Recipe, StepItem } from '../types/cook';
import { cookApi } from '../services/cookApi';
import type { RecipeDraft } from '../types/cook';
import {
  aggregateIngredients,
  normalizeServerRecipe,
  parseStepText,
  sortIngredientsByQuantity
} from '../utils/cooklangParser';
import { highlightCooklang } from '../utils/cooklangHighlight';
import { AuthenticatedImage } from './AuthenticatedImage';
import { useLoginUser } from '../hooks/useLoginUser';
import { shrinkPhoto } from '../utils/shrinkPhoto';

interface RecipeEditorProps {
  recipe: Recipe;
  status: ConnectionStatus;
  onClose: () => void;
  onSaved: (recipe: Recipe) => void;
}

type Phase = 'loading' | 'blocked' | 'ready';
/** A photo change waiting for "Speichern": a new file, or removing the current photo */
type PendingPhoto = { kind: 'set'; file: File; previewUrl: string } | { kind: 'remove' } | null;

type DraftNotice =
  | { kind: 'restored'; updatedAt: number }
  | { kind: 'stale'; draft: RecipeDraft }
  | null;

const normalizeEol = (s: string) => s.replace(/\r\n?/g, '\n');

const formatTime = (ts: number) =>
  new Date(ts).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export const RecipeEditor: React.FC<RecipeEditorProps> = ({
  recipe,
  status,
  onClose,
  onSaved
}) => {
  const path = recipe.path;
  const loginUser = useLoginUser();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Photo changes are staged like text changes and only sent with "Speichern"
  const [pendingPhoto, setPendingPhoto] = useState<PendingPhoto>(null);
  // Recipe after a successful text save, kept when the photo upload failed and is retried
  const savedRecipeRef = useRef<Recipe | null>(null);
  const serverHasPhoto = Boolean(recipe.image?.startsWith('recipe-photo/'));
  const hasPhoto = pendingPhoto ? pendingPhoto.kind === 'set' : serverHasPhoto;
  // Only an uploaded or staged photo; the preview falls back to >> image: from the text itself
  const shownPhoto =
    pendingPhoto?.kind === 'set' ? pendingPhoto.previewUrl : pendingPhoto?.kind === 'remove' ? undefined : serverHasPhoto ? recipe.image : undefined;
  const pendingPreviewUrl = pendingPhoto?.kind === 'set' ? pendingPhoto.previewUrl : null;

  useEffect(() => {
    if (!pendingPreviewUrl) return;
    return () => URL.revokeObjectURL(pendingPreviewUrl);
  }, [pendingPreviewUrl]);

  const handlePhotoChosen = async (chosen: File | undefined) => {
    if (photoInputRef.current) photoInputRef.current.value = '';
    if (!chosen) return;
    setPhotoError(null);
    try {
      // Scaled down to 1600 px before it is staged, so upload and later page loads stay small
      const file = await shrinkPhoto(chosen);
      setPendingPhoto({ kind: 'set', file, previewUrl: URL.createObjectURL(file) });
    } catch (err: unknown) {
      setPhotoError(err instanceof Error ? err.message : 'Das Foto konnte nicht gelesen werden.');
    }
  };

  const handleRemovePhoto = () => {
    setPhotoError(null);
    // Removing a photo that was only staged just undoes the staging
    setPendingPhoto(serverHasPhoto ? { kind: 'remove' } : null);
  };

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [base, setBase] = useState('');
  const [content, setContent] = useState('');
  const [draftNotice, setDraftNotice] = useState<DraftNotice>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [showServerVersion, setShowServerVersion] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [mobileTab, setMobileTab] = useState<'source' | 'preview'>('source');
  const [showHelp, setShowHelp] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [copied, setCopied] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const textDirty = phase === 'ready' && content !== base;
  const isDirty = textDirty || (phase === 'ready' && pendingPhoto !== null);
  const isOffline = !online || status === 'disconnected' || status === 'error';

  // ---- Load the LIVE server version directly (never from offline cache) ----
  const load = useCallback(async () => {
    setPhase('loading');
    setLoadError(null);
    try {
      const serverText = await cookApi.getRawRecipe(path);
      const draft = cookApi.getDraft(path);
      setBase(serverText);

      if (draft && normalizeEol(draft.content) !== normalizeEol(serverText)) {
        if (normalizeEol(draft.base) === normalizeEol(serverText)) {
          // Server has not changed since the draft was saved -> safe to resume
          setContent(draft.content);
          setDraftNotice({ kind: 'restored', updatedAt: draft.updatedAt });
          setDraftSavedAt(draft.updatedAt);
        } else {
          // Server was modified since the draft was created -> prompt the user
          setContent(serverText);
          setDraftNotice({ kind: 'stale', draft });
        }
      } else {
        if (draft) cookApi.clearDraft(path);
        setContent(serverText);
        setDraftNotice(null);
      }
      setPhase('ready');
    } catch (err) {
      const msg =
        err instanceof Error && err.message && !/fetch|abort/i.test(err.message)
          ? err.message
          : 'Der Rezept-Server ist derzeit nicht erreichbar.';
      setLoadError(msg);
      setPhase('blocked');
    }
  }, [path]);

  // Laden beim Öffnen und bei Pfadwechsel: die Zustandsänderungen sind hier gewollt
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    load();
  }, [load]);

  // ---- Autosave local working draft (debounced) ----
  useEffect(() => {
    if (phase !== 'ready' || draftNotice?.kind === 'stale') return;
    const t = setTimeout(() => {
      if (content === base) {
        cookApi.clearDraft(path);
        setDraftSavedAt(null);
      } else {
        const d = cookApi.saveDraft(path, base, content);
        if (d) setDraftSavedAt(d.updatedAt);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [content, base, phase, draftNotice, path]);

  // ---- Online / offline connectivity tracking ----
  useEffect(() => {
    const handleUp = () => setOnline(true);
    const handleDown = () => setOnline(false);
    window.addEventListener('online', handleUp);
    window.addEventListener('offline', handleDown);
    return () => {
      window.removeEventListener('online', handleUp);
      window.removeEventListener('offline', handleDown);
    };
  }, []);

  // ---- Prevent body scrolling while editor is open ----
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // ---- Browser beforeunload warning if dirty ----
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      cookApi.saveDraft(path, base, content);
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, path, base, content]);

  // ---- Save action ----
  const handleSave = useCallback(
    async (force = false) => {
      if (phase !== 'ready' || saving) return;
      const textChanged = force || content !== base;
      if (!textChanged && !pendingPhoto) return;
      setSaving(true);
      setSaveError(null);
      setPhotoError(null);

      let saved: Recipe = savedRecipeRef.current ?? recipe;
      if (textChanged) {
        const res = await cookApi.updateRecipe(path, content, base, { force });
        if (res.status === 'conflict') {
          setSaving(false);
          setConflict(res.serverContent);
          setShowServerVersion(false);
          return;
        }
        if (res.status === 'error') {
          setSaving(false);
          setSaveError(res.message);
          const d = cookApi.saveDraft(path, base, content);
          if (d) setDraftSavedAt(d.updatedAt);
          return;
        }
        cookApi.clearDraft(path);
        setConflict(null);
        setBase(content);
        saved = res.recipe;
        savedRecipeRef.current = saved;
      }

      if (pendingPhoto) {
        const result =
          pendingPhoto.kind === 'set'
            ? await cookApi.uploadRecipePhoto(path, pendingPhoto.file)
            : await cookApi.deleteRecipePhoto(path);
        if (result.status === 'error') {
          // The text may already be saved; the photo stays staged so "Speichern" retries only the photo
          setSaving(false);
          setPhotoError(textChanged ? `Der Text wurde gespeichert, das Foto nicht: ${result.message}` : result.message);
          return;
        }
        saved = { ...saved, image: result.status === 'saved' ? result.image : undefined };
        setPendingPhoto(null);
      }

      setSaving(false);
      onSaved(saved);
    },
    [phase, saving, content, base, path, pendingPhoto, recipe, onSaved]
  );

  // ---- Close handling with unsaved confirmation ----
  const requestClose = useCallback(() => {
    if (isDirty) {
      setConfirmClose(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  const keepDraftAndClose = () => {
    cookApi.saveDraft(path, base, content);
    onClose();
  };

  const discardAndClose = () => {
    cookApi.clearDraft(path);
    onClose();
  };

  // ---- Keyboard shortcuts (Cmd/Ctrl+S, Escape) ----
  const shortcutRef = useRef({ handleSave, requestClose, confirmClose });

  useEffect(() => {
    shortcutRef.current = { handleSave, requestClose, confirmClose };
  }, [handleSave, requestClose, confirmClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        shortcutRef.current.handleSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (shortcutRef.current.confirmClose) {
          setConfirmClose(false);
        } else {
          shortcutRef.current.requestClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- Quick snippet insertion helper ----
  const insertSnippet = (kind: 'ingredient' | 'cookware' | 'timer' | 'braces' | 'percent') => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const selected = ta.value.slice(s, e);

    let text: string;
    let caret: number;
    switch (kind) {
      case 'ingredient':
      case 'cookware': {
        const marker = kind === 'ingredient' ? '@' : '#';
        if (selected) {
          text = `${marker}${selected}{}`;
          caret = s + text.length - 1;
        } else {
          text = marker;
          caret = s + 1;
        }
        break;
      }
      case 'timer':
        text = `~${selected}{}`;
        caret = s + text.length - 1;
        break;
      case 'braces':
        text = '{}';
        caret = s + 1;
        break;
      default:
        text = '%';
        caret = s + 1;
    }

    let ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch {
      ok = false;
    }
    if (!ok) {
      ta.setRangeText(text, s, e, 'end');
      setContent(ta.value);
    }
    requestAnimationFrame(() => ta.setSelectionRange(caret, caret));
  };

  const copyMine = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  // ---- Syntax highlighting & live preview ----
  const deferredContent = useDeferredValue(content);
  const highlighted = useMemo(() => highlightCooklang(content), [content]);
  const preview = useMemo(() => {
    if (!deferredContent.trim()) return null;
    try {
      return normalizeServerRecipe(deferredContent, path);
    } catch {
      return null;
    }
  }, [deferredContent, path]);

  const lineCount = content.split('\n').length;

  // Status chip info
  const chip = saving
    ? {
        icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
        label: 'Speichert auf Server…',
        cls: 'bg-stone-200/70 dark:bg-stone-800 text-stone-600 dark:text-stone-300'
      }
    : isOffline
    ? {
        icon: <CloudOff className="w-3.5 h-3.5" />,
        label: 'Offline (Nur lokal)',
        cls: 'bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300'
      }
    : isDirty
    ? {
        icon: <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />,
        label: 'Ungespeichert',
        cls: 'bg-amber-100/80 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
      }
    : {
        icon: <Cloud className="w-3.5 h-3.5" />,
        label: 'Mit Server synchron',
        cls: 'bg-emerald-100/80 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
      };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#FAF8F5] dark:bg-[#121110] font-mela-sans animate-fadeIn select-none"
      role="dialog"
      aria-modal="true"
      aria-label={`${recipe.name} bearbeiten`}
    >
      {/* Top Header */}
      <header className="pt-safe shrink-0 border-b border-stone-200/80 dark:border-stone-800 bg-[#FAF8F5]/95 dark:bg-[#121110]/95 backdrop-blur z-10">
        <div className="flex items-center gap-2 px-3 lg:px-6 py-2.5 max-w-7xl mx-auto w-full">
          <button
            id="editor-close"
            onClick={requestClose}
            className="w-10 h-10 shrink-0 flex items-center justify-center rounded-full text-stone-600 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800 active:scale-95 transition"
            title="Schließen (Esc)"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#DE5D4E]">
                Cooklang Editor
              </span>
              <span className="text-[10px] text-stone-400">•</span>
              <span className="text-[11px] font-mono text-stone-400 dark:text-stone-500 truncate max-w-[200px] sm:max-w-md">
                {path.endsWith('.cook') ? path : `${path}.cook`}
              </span>
            </div>
            <h1 className="font-mela-serif text-base lg:text-xl font-bold text-stone-900 dark:text-stone-100 truncate leading-tight">
              {recipe.name}
            </h1>
          </div>

          {/* Foto: nur im Bearbeitungsmodus, nur angemeldet */}
          {loginUser && (
            <>
              {hasPhoto && (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  disabled={saving}
                  className="w-10 h-10 shrink-0 flex items-center justify-center rounded-full text-stone-600 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800 active:scale-95 transition disabled:opacity-50"
                  title="Foto entfernen (wird beim Speichern übernommen)"
                  aria-label="Foto entfernen"
                >
                  <ImageOff className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={saving}
                className="h-10 px-3 shrink-0 rounded-full bg-stone-200/70 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white hover:bg-stone-300/60 active:scale-95 transition flex items-center gap-1.5 text-xs font-semibold disabled:opacity-50"
                title={`${hasPhoto ? 'Foto ersetzen' : 'Foto hinzufügen'} (wird beim Speichern übernommen)`}
              >
                <Camera className="w-4 h-4 text-[#DE5D4E]" />
                <span className="hidden sm:inline">{hasPhoto ? 'Foto ersetzen' : 'Foto'}</span>
              </button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                className="hidden"
                onChange={(e) => void handlePhotoChosen(e.target.files?.[0])}
              />
            </>
          )}

          {/* Connection / Sync Status Chip */}
          <span
            className={`hidden min-[480px]:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-semibold shrink-0 ${chip.cls}`}
          >
            {chip.icon}
            <span>{chip.label}</span>
          </span>

          {/* Save Button */}
          <button
            id="editor-save"
            onClick={() => handleSave()}
            disabled={!isDirty || saving || isOffline}
            className="h-10 px-4 rounded-full bg-[#DE5D4E] hover:bg-[#cf5142] text-white text-xs sm:text-sm font-semibold flex items-center gap-2 shadow-sm active:scale-95 transition-all disabled:opacity-40 disabled:shadow-none disabled:active:scale-100 shrink-0 cursor-pointer disabled:cursor-not-allowed"
            title={
              isOffline
                ? 'Speichern erfordert eine Serververbindung'
                : `Auf Server speichern (${isMac ? '⌘' : 'Strg'}+S)`
            }
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            <span>Speichern</span>
            <kbd className="hidden lg:inline text-[10px] font-mono font-medium opacity-80 bg-black/15 px-1.5 py-0.5 rounded">
              {isMac ? '⌘S' : 'Ctrl+S'}
            </kbd>
          </button>
        </div>

        {/* Mobile Tab Toggle: Source vs Live Preview */}
        {phase === 'ready' && (
          <div className="lg:hidden px-3 pb-2.5 max-w-xl mx-auto w-full">
            <div className="flex rounded-xl bg-stone-200/70 dark:bg-stone-800/80 p-1">
              {(['source', 'preview'] as const).map((tab) => (
                <button
                  key={tab}
                  id={`editor-tab-${tab}`}
                  onClick={() => setMobileTab(tab)}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                    mobileTab === tab
                      ? 'bg-white dark:bg-[#1A1816] text-stone-900 dark:text-stone-100 shadow-xs'
                      : 'text-stone-600 dark:text-stone-400'
                  }`}
                >
                  {tab === 'source' ? (
                    <FileCode2 className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                  {tab === 'source' ? 'Quelltext (.cook)' : 'Live-Vorschau'}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {photoError && (
        <p role="alert" className="shrink-0 px-4 pt-3 text-xs text-rose-700 dark:text-rose-400 max-w-7xl mx-auto w-full">
          {photoError}
        </p>
      )}

      {/* Notifications & Warning Banners */}
      {phase === 'ready' && (draftNotice || conflict || saveError || confirmClose) && (
        <div className="shrink-0 px-3 lg:px-6 pt-3 space-y-2 max-w-7xl mx-auto w-full">
          {confirmClose && (
            <div className="p-4 rounded-2xl bg-white dark:bg-[#1A1816] border border-stone-200 dark:border-stone-800 shadow-lg animate-fadeIn">
              <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                Ungespeicherte Änderungen vorhanden
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 leading-relaxed">
                Deine Änderungen wurden noch nicht an den Server übertragen. Was möchtest du tun?
                {pendingPhoto && ' Die Foto-Änderung wird nicht als Entwurf aufgehoben.'}
              </p>
              <div className="flex flex-wrap gap-2 mt-3.5">
                {textDirty && (
                <button
                  id="editor-keep-draft"
                  onClick={keepDraftAndClose}
                  className="px-3.5 py-2 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-semibold active:scale-95 transition"
                >
                  Entwurf behalten & schließen
                </button>
                )}
                <button
                  id="editor-discard"
                  onClick={discardAndClose}
                  className="px-3.5 py-2 rounded-xl bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 text-xs font-semibold active:scale-95 transition"
                >
                  Änderungen verwerfen
                </button>
                <button
                  onClick={() => setConfirmClose(false)}
                  className="px-3.5 py-2 rounded-xl bg-stone-200/70 dark:bg-stone-800 text-stone-700 dark:text-stone-300 text-xs font-semibold active:scale-95 transition"
                >
                  Weiter bearbeiten
                </button>
              </div>
            </div>
          )}

          {conflict !== null && (
            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300/60 dark:border-amber-800/60 animate-fadeIn">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                    Konflikt: Rezeptdatei wurde extern auf dem Server verändert
                  </p>
                  <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-1 leading-relaxed">
                    Seit du dieses Rezept zum Bearbeiten geöffnet hast, wurde die Datei auf dem Server modifiziert.
                    Um ein versehentliches Überschreiben fremder Änderungen zu verhindern, kannst du wählen:
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3.5">
                    <button
                      id="editor-conflict-overwrite"
                      onClick={() => {
                        setConflict(null);
                        handleSave(true);
                      }}
                      className="px-3.5 py-2 rounded-xl bg-[#DE5D4E] text-white text-xs font-semibold active:scale-95 transition shadow-xs"
                    >
                      Meine Version erzwingen (Überschreiben)
                    </button>
                    <button
                      id="editor-conflict-load-server"
                      onClick={() => {
                        setBase(conflict);
                        setContent(conflict);
                        setConflict(null);
                      }}
                      className="px-3.5 py-2 rounded-xl bg-white dark:bg-stone-800 border border-amber-300/60 dark:border-stone-700 text-stone-800 dark:text-stone-200 text-xs font-semibold active:scale-95 transition"
                    >
                      Server-Version übernehmen
                    </button>
                    <button
                      onClick={copyMine}
                      className="px-3 py-1.5 rounded-lg bg-white/70 dark:bg-stone-800/70 text-stone-700 dark:text-stone-300 text-xs font-medium flex items-center gap-1.5 active:scale-95 transition"
                    >
                      {copied ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      {copied ? 'In Zwischenablage kopiert' : 'Meinen Text kopieren'}
                    </button>
                    <button
                      onClick={() => setShowServerVersion((v) => !v)}
                      className="px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300 underline underline-offset-2"
                    >
                      {showServerVersion ? 'Server-Version verbergen' : 'Server-Version anzeigen'}
                    </button>
                  </div>
                  {showServerVersion && (
                    <pre className="mt-3 max-h-52 overflow-auto custom-scroll p-3.5 rounded-xl bg-white dark:bg-[#121110] border border-amber-200 dark:border-stone-800 text-[11px] leading-relaxed font-mono text-stone-700 dark:text-stone-300 whitespace-pre-wrap select-text">
                      {conflict}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          )}

          {saveError && conflict === null && (
            <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 flex items-start gap-3 animate-fadeIn">
              <CloudOff className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1 text-xs text-rose-800 dark:text-rose-300 leading-relaxed">
                {saveError}
              </div>
              <button
                onClick={() => handleSave()}
                className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold shrink-0 active:scale-95 transition"
              >
                Erneut versuchen
              </button>
            </div>
          )}

          {draftNotice?.kind === 'restored' && !confirmClose && (
            <div className="px-4 py-2.5 rounded-2xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200/70 dark:border-sky-900/50 flex items-center gap-2.5 text-xs text-sky-900 dark:text-sky-200 animate-fadeIn">
              <History className="w-4 h-4 shrink-0 text-sky-600" />
              <span className="flex-1 min-w-0">
                Ungespeicherter lokaler Entwurf vom {formatTime(draftNotice.updatedAt)} wiederhergestellt.
              </span>
              <button
                onClick={() => {
                  setContent(base);
                  setDraftNotice(null);
                }}
                className="font-semibold underline underline-offset-2 shrink-0 cursor-pointer"
              >
                Verwerfen & Server laden
              </button>
              <button
                onClick={() => setDraftNotice(null)}
                className="shrink-0 opacity-60 hover:opacity-100 p-1"
                title="Ausblenden"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {draftNotice?.kind === 'stale' && (
            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300/60 dark:border-amber-800/60 animate-fadeIn">
              <div className="flex items-start gap-3">
                <History className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                    Älterer lokaler Entwurf gefunden
                  </p>
                  <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-1 leading-relaxed">
                    Du hast am {formatTime(draftNotice.draft.updatedAt)} Änderungen lokal begonnen, aber der Server hat
                    inzwischen einen neueren Stand. Standardmäßig wurde die aktuelle Server-Version geladen.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      id="editor-use-draft"
                      onClick={() => {
                        setContent(draftNotice.draft.content);
                        setDraftNotice(null);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-semibold active:scale-95 transition"
                    >
                      Meinen lokalen Entwurf wiederherstellen
                    </button>
                    <button
                      id="editor-use-server"
                      onClick={() => {
                        cookApi.clearDraft(path);
                        setDraftNotice(null);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-white dark:bg-stone-800 border border-amber-300/60 dark:border-stone-700 text-stone-800 dark:text-stone-200 text-xs font-semibold active:scale-95 transition"
                    >
                      Server-Version behalten
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Content Areas */}
      {phase === 'loading' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-stone-500 dark:text-stone-400">
          <Loader2 className="w-8 h-8 animate-spin text-[#DE5D4E]" />
          <p className="font-mela-serif text-lg text-stone-800 dark:text-stone-200">
            Lade Rezept direkt vom Server…
          </p>
          <p className="text-xs text-stone-400">
            Bearbeiten erfordert den frischen Stand von <span className="font-mono">{path}</span>
          </p>
        </div>
      )}

      {phase === 'blocked' && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md text-center bg-white dark:bg-[#1A1816] p-8 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-xl">
            <div className="w-14 h-14 rounded-full bg-rose-100 dark:bg-rose-950/50 flex items-center justify-center mx-auto mb-4">
              <CloudOff className="w-7 h-7 text-rose-600 dark:text-rose-400" />
            </div>
            <h2 className="font-mela-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
              Verbindung zum Server erforderlich
            </h2>
            <p className="text-sm text-stone-600 dark:text-stone-400 mt-2.5 leading-relaxed">
              Rezepte können nur mit aktiver Verbindung zum Rezept-Server bearbeitet werden,
              damit die lokale Kopie und die <span className="font-mono text-xs">.cook</span>-Dateien auf dem Server nicht auseinanderdriften.
            </p>
            {loadError && (
              <div className="text-xs font-mono text-rose-700 dark:text-rose-300 mt-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/40 text-left overflow-x-auto">
                {loadError}
              </div>
            )}
            {cookApi.hasDraft(path) && (
              <p className="text-xs text-sky-700 dark:text-sky-300 mt-3 font-medium">
                Hinweis: Ein ungespeicherter lokaler Entwurf ist gesichert und wird angeboten, sobald die Verbindung wieder steht.
              </p>
            )}
            <div className="flex justify-center gap-3 mt-6">
              <button
                id="editor-retry"
                onClick={load}
                className="px-5 py-2.5 rounded-xl bg-[#DE5D4E] hover:bg-[#cf5142] text-white text-sm font-semibold flex items-center gap-2 active:scale-95 transition shadow-sm cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Erneut verbinden
              </button>
              <button
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl bg-stone-200/80 dark:bg-stone-800 text-stone-700 dark:text-stone-300 text-sm font-semibold active:scale-95 transition cursor-pointer"
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'ready' && (
        <div className="flex-1 min-h-0 lg:grid lg:grid-cols-2 max-w-7xl mx-auto w-full">
          {/* Left / Source Pane */}
          <section
            className={`${
              mobileTab === 'source' ? 'flex' : 'hidden'
            } lg:flex flex-col h-full min-h-0 bg-[#FAF8F5] dark:bg-[#121110]`}
            aria-label="Cooklang Quelltext"
          >
            {/* Quick Insertion Toolbar */}
            <div className="shrink-0 flex items-center gap-1.5 px-3 lg:px-6 py-2 border-b border-stone-200/80 dark:border-stone-800/80 overflow-x-auto no-scrollbar bg-stone-50/60 dark:bg-[#161514]">
              <ToolbarButton
                id="insert-ingredient"
                onClick={() => insertSnippet('ingredient')}
                marker="@"
                label="Zutat"
                cls="text-[#DE5D4E] dark:text-[#f87a6c]"
              />
              <ToolbarButton
                id="insert-cookware"
                onClick={() => insertSnippet('cookware')}
                marker="#"
                label="Geschirr"
                cls="text-amber-700 dark:text-amber-300"
              />
              <ToolbarButton
                id="insert-timer"
                onClick={() => insertSnippet('timer')}
                marker="~"
                label="Timer"
                cls="text-sky-700 dark:text-sky-300"
              />
              <ToolbarButton id="insert-braces" onClick={() => insertSnippet('braces')} marker="{ }" />
              <ToolbarButton id="insert-percent" onClick={() => insertSnippet('percent')} marker="%" />
              <div className="flex-1" />
              <button
                id="editor-help"
                onClick={() => setShowHelp((v) => !v)}
                className={`h-8 px-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5 shrink-0 transition cursor-pointer ${
                  showHelp
                    ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                    : 'text-stone-500 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-800'
                }`}
                title="Cooklang Syntax-Hilfe"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Syntax</span>
              </button>
            </div>

            {/* Quick Syntax Cheat Sheet */}
            {showHelp && (
              <div className="shrink-0 px-4 lg:px-6 py-3 border-b border-stone-200/70 dark:border-stone-800/80 bg-stone-100/70 dark:bg-stone-900/50 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-stone-600 dark:text-stone-400 animate-fadeIn select-text">
                <HelpRow code="@Mehl{500%g}" text="Zutat mit Menge und Einheit" />
                <HelpRow code="@?Sesam{}" text="Optionale Zutat (@?...)" />
                <HelpRow code="@Salz" text="Zutat ohne Menge (einzelnes Wort)" />
                <HelpRow code="#Pfanne{}" text="Kochgeschirr / Utensil" />
                <HelpRow code="~{15%min}" text="Timer mit Dauer" />
                <HelpRow code="= Teig =" text="Abschnitt (z. B. Teig, Füllung)" />
                <HelpRow code="> Tipp: ..." text="Tipp / Hinweis zum Rezept" />
                <HelpRow code="-- Kommentar" text="Kommentar bis Zeilenende" />
                <HelpRow code="Leerzeile" text="Schritt trennen" />
              </div>
            )}

            {/* Overlay Editor Container */}
            <div
              className="flex-1 min-h-0 overflow-y-auto custom-scroll"
              onClick={() => textareaRef.current?.focus()}
            >
              <div className="grid min-h-full">
                {/* Syntax highlighted background layer */}
                <pre
                  aria-hidden="true"
                  className="editor-layer text-stone-800 dark:text-stone-200 pointer-events-none"
                >
                  {highlighted}
                  {'\n '}
                </pre>
                {/* Transparent input textarea layer directly on top */}
                <textarea
                  ref={textareaRef}
                  id="editor-textarea"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  className="editor-layer editor-input"
                  aria-label="Cooklang Quelltext"
                />
              </div>
            </div>
          </section>

          {/* Right / Live Preview Pane */}
          <section
            className={`${
              mobileTab === 'preview' ? 'block' : 'hidden'
            } lg:block h-full min-h-0 overflow-y-auto custom-scroll lg:border-l border-stone-200/80 dark:border-stone-800 bg-white/40 dark:bg-[#161514]`}
            aria-label="Live-Vorschau"
          >
            <RecipePreview
              recipe={preview}
              fallbackName={recipe.name}
              image={shownPhoto}
            />
          </section>
        </div>
      )}

      {/* Bottom Status Bar */}
      {phase === 'ready' && (
        <footer className="shrink-0 pb-safe lg:pb-0 border-t border-stone-200/80 dark:border-stone-800 bg-stone-100/70 dark:bg-[#141312] px-3 lg:px-6 py-2 flex items-center gap-3 text-[11px] text-stone-500 dark:text-stone-400 max-w-7xl mx-auto w-full">
          <span
            className={`inline-flex min-[480px]:hidden items-center gap-1 font-semibold ${chip.cls} px-2 py-0.5 rounded-full`}
          >
            {chip.icon}
            {chip.label}
          </span>
          <span className="font-mono">
            {lineCount} Zeilen · {content.length} Zeichen
          </span>
          <span className="flex-1" />
          {isDirty && draftSavedAt && (
            <span className="flex items-center gap-1.5 text-stone-500 dark:text-stone-400 truncate">
              <History className="w-3.5 h-3.5 text-sky-500" />
              <span>Entwurf lokal gesichert</span>
            </span>
          )}
          <span className="hidden lg:inline text-stone-400 dark:text-stone-600 font-mono">
            {isMac ? '⌘S' : 'Ctrl+S'} speichern · Esc abbrechen
          </span>
        </footer>
      )}
    </div>
  );
};

const ToolbarButton: React.FC<{
  id: string;
  onClick: () => void;
  marker: string;
  label?: string;
  cls?: string;
}> = ({ id, onClick, marker, label, cls }) => (
  <button
    id={id}
    type="button"
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
    className="h-8 px-2.5 rounded-lg bg-stone-200/60 dark:bg-stone-800 hover:bg-stone-300/70 dark:hover:bg-stone-700 text-xs font-medium text-stone-700 dark:text-stone-300 flex items-center gap-1.5 shrink-0 active:scale-95 transition cursor-pointer"
  >
    <span className={`font-mono font-semibold ${cls || ''}`}>{marker}</span>
    {label && <span>{label}</span>}
  </button>
);

const HelpRow: React.FC<{ code: string; text: string }> = ({ code, text }) => (
  <div className="flex items-center gap-2">
    <code className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-200 shrink-0 border border-stone-200/60 dark:border-stone-700/60">
      {code}
    </code>
    <span className="truncate">{text}</span>
  </div>
);

/**
 * Real-time formatted live preview of the recipe being edited
 */
const RecipePreview: React.FC<{
  recipe: Recipe | null;
  fallbackName: string;
  image?: string;
}> = ({ recipe, fallbackName, image }) => {
  const ingredients = useMemo(
    () => (recipe ? sortIngredientsByQuantity(aggregateIngredients(recipe.ingredients)) : []),
    [recipe]
  );
  const groupedSections = useMemo(() => {
    if (!recipe) return [];
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

  if (!recipe) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-stone-400 p-8 text-center">
        Noch kein Rezeptinhalt vorhanden.
      </div>
    );
  }

  const time =
    recipe.metadata.total_time ||
    recipe.metadata.time ||
    recipe.metadata.cook_time;
  const prepTime = recipe.metadata.prep_time;
  const servings = recipe.metadata.servings;
  const tags = Array.isArray(recipe.metadata.tags)
    ? recipe.metadata.tags
    : typeof recipe.metadata.tags === 'string'
    ? recipe.metadata.tags.split(',').map((t) => t.trim()).filter(Boolean)
    : [];
  const img = image || recipe.image;

  return (
    <div className="max-w-2xl mx-auto px-5 lg:px-8 py-6 select-text">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-[#DE5D4E]" />
          Live-Vorschau
        </span>
        <span className="text-[11px] text-stone-400">
          Wird beim Tippen automatisch aktualisiert
        </span>
      </div>

      <div className="flex items-center gap-4">
        {img && (
          <AuthenticatedImage
            src={img}
            alt=""
            className="w-20 h-20 rounded-2xl object-cover border-2 border-white dark:border-stone-800 shadow-md shrink-0"
          />
        )}
        <div className="min-w-0">
          <h2 className="font-mela-serif text-2xl lg:text-3xl font-bold text-stone-900 dark:text-stone-50 leading-tight">
            {recipe.name || fallbackName}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-stone-500 dark:text-stone-400">
            {servings && (
              <span className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5" />
                <span>{String(servings)} Portionen</span>
              </span>
            )}
            {prepTime && (
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-stone-400" />
                <span>Vorbereitung: {String(prepTime)}</span>
              </span>
            )}
            {time && (
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-[#DE5D4E]" />
                <span>{String(time)}</span>
              </span>
            )}
            {tags.map((t) => (
              <span
                key={t}
                className="px-2 py-0.5 rounded-full bg-stone-200/70 dark:bg-stone-800 text-[11px]"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {recipe.metadata.description && (
        <p className="text-sm text-stone-600 dark:text-stone-400 italic leading-relaxed mt-4">
          {String(recipe.metadata.description)}
        </p>
      )}

      {/* Ingredients */}
      {ingredients.length > 0 && (
        <div className="mt-6 pt-4 border-t border-stone-200/70 dark:border-stone-800/80">
          <h3 className="font-mela-serif text-lg font-bold text-stone-900 dark:text-stone-100 mb-2">
            Zutaten{' '}
            <span className="text-sm font-normal text-stone-400">
              ({ingredients.length})
            </span>
          </h3>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
            {ingredients.map((ing, i) => {
              const isOptional = Boolean(ing.optional || ing.name.startsWith('?'));
              const cleanName = ing.name.replace(/^\?+\s*/, '').trim();
              const displayName = isOptional ? `${cleanName} (optional)` : cleanName;
              return (
                <li
                  key={`${cleanName}_${i}`}
                  className="text-sm text-stone-800 dark:text-stone-200 py-1 flex items-baseline gap-2"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#DE5D4E] shrink-0 translate-y-[-2px]" />
                  <span>
                    {(ing.quantity !== undefined || ing.units) && (
                      <span className="font-mono font-semibold mr-1.5 text-stone-900 dark:text-stone-100">
                        {[ing.quantity, ing.units]
                          .filter((v) => v !== undefined && v !== '')
                          .join(' ')}
                      </span>
                    )}
                    {displayName}
                    {ing.sources && ing.sources.length > 1 && (
                      <span className="ml-1.5 text-xs text-stone-400 dark:text-stone-500">
                        ({ing.sources
                          .map((src) => [src.quantity, src.units].filter((v) => v !== undefined && v !== '').join(' '))
                          .join(' und ')})
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Cookware */}
      {recipe.cookware.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <CookingPot className="w-4 h-4 text-stone-400 mr-1" />
          {recipe.cookware.map((cw, i) => {
            const isOptional = Boolean(cw.optional || cw.name.startsWith('?'));
            const cleanName = cw.name.replace(/^\?+\s*/, '').trim();
            return (
              <span
                key={i}
                className="px-2.5 py-1 rounded-md bg-stone-200/60 dark:bg-stone-800 text-xs font-medium text-stone-700 dark:text-stone-300"
              >
                {cleanName}{isOptional ? ' (optional)' : ''}
              </span>
            );
          })}
        </div>
      )}

      {/* Instructions */}
      {recipe.steps.length > 0 && (
        <div className="mt-6 pt-4 border-t border-stone-200/70 dark:border-stone-800/80">
          <h3 className="font-mela-serif text-lg font-bold text-stone-900 dark:text-stone-100 mb-3">
            Zubereitung
          </h3>
          <div className="space-y-6">
            {groupedSections.map((group, gIdx) => (
              <div key={gIdx} className="space-y-3">
                {group.name && (
                  <div className="flex items-center gap-2 pt-1">
                    <h4 className="font-mela-serif text-base font-bold text-stone-900 dark:text-stone-100">
                      {group.name}
                    </h4>
                    <span className="h-px flex-1 bg-stone-200/80 dark:bg-stone-800/80 ml-2" />
                  </div>
                )}
                <ol className="space-y-3">
                  {group.steps.map((step) => (
                    <li key={step.stepNumber} className="flex gap-3">
                      <span className="font-mela-serif text-base font-bold text-stone-400 dark:text-stone-500 w-5 shrink-0">
                        {step.stepNumber}
                      </span>
                      <p className="text-[14.5px] leading-relaxed text-stone-800 dark:text-stone-200 flex-1">
                        {step.items.map((item, idx) => renderPreviewItem(item, idx))}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tips / Notes */}
      {recipe.notes && recipe.notes.length > 0 && (
        <div className="mt-6 pt-4 border-t border-stone-200/70 dark:border-stone-800/80 space-y-2.5">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <h3 className="font-mela-serif text-lg font-bold text-stone-900 dark:text-stone-100">
              {recipe.notes.length === 1 ? 'Tipp' : 'Tipps & Hinweise'}
            </h3>
          </div>
          <div className="space-y-2">
            {recipe.notes.map((note, idx) => (
              <div
                key={idx}
                className="p-3 rounded-xl bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/25 dark:border-amber-500/30 text-xs sm:text-sm leading-relaxed text-stone-800 dark:text-stone-200"
              >
                {parseStepText(note).items.map((it, itIdx) => renderPreviewItem(it, itIdx))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

function renderPreviewItem(item: StepItem, idx: number) {
  if (item.type === 'text') return <span key={idx}>{item.value}</span>;
  if (item.type === 'ingredient') {
    const amount = [item.quantity, item.units]
      .filter((v) => v !== undefined && v !== '')
      .join(' ');
    const isOptional = Boolean(item.optional || item.name?.startsWith('?'));
    const cleanName = item.name ? item.name.replace(/^\?+\s*/, '').trim() : '';
    const displayName = isOptional ? `${cleanName} (optional)` : cleanName;
    return (
      <span key={idx} className="font-semibold text-[#DE5D4E] dark:text-[#f87a6c]">
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
      <span key={idx} className="font-medium text-amber-700 dark:text-amber-300">
        {displayName}
      </span>
    );
  }
  if (item.type === 'timer') {
    return (
      <span
        key={idx}
        className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-sky-700 dark:text-sky-300 align-baseline bg-sky-100 dark:bg-sky-950/60 px-1.5 py-0.5 rounded"
      >
        <Clock className="w-3 h-3 text-sky-600" />
        {String(item.quantity)} {item.units}
      </span>
    );
  }
  return null;
}
