import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  ExternalLink,
  Download,
  FileText,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  FolderPlus,
  Tag,
  Loader2
} from 'lucide-react';
import { cookApi } from '../services/cookApi';
import type { Recipe } from '../types/cook';
import { normalizeServerRecipe } from '../utils/cooklangParser';
import { AuthenticatedImage } from './AuthenticatedImage';

interface AddRecipeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRecipeSaved: (recipe: Recipe) => void;
}

export const AddRecipeModal: React.FC<AddRecipeModalProps> = ({
  isOpen,
  onClose,
  onRecipeSaved
}) => {
  const [activeTab, setActiveTab] = useState<'cookify' | 'text'>('cookify');

  // Input states
  const [cookifyUrl, setCookifyUrl] = useState('');
  const [recipeName, setRecipeName] = useState('');
  const [folder, setFolder] = useState('');
  const [cookContent, setCookContent] = useState('');

  // Status states
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [nameUserEdited, setNameUserEdited] = useState(false);

  // Reset state when opening/closing
  useEffect(() => {
    if (!isOpen) {
      setCookifyUrl('');
      setRecipeName('');
      setFolder('');
      setCookContent('');
      setErrorMsg(null);
      setNameUserEdited(false);
      setIsFetchingUrl(false);
      setIsSaving(false);
    }
  }, [isOpen]);

  // Extract title from text content if available
  const extractTitleFromContent = (text: string): string | null => {
    // 1. Check YAML frontmatter: title: ...
    const frontmatterMatch = text.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/);
    if (frontmatterMatch) {
      const titleMatch = frontmatterMatch[1].match(/^\s*title\s*:\s*['"]?([^'"\r\n]+)['"]?/m);
      if (titleMatch && titleMatch[1].trim()) {
        return titleMatch[1].trim();
      }
    }

    // 2. Check Cooklang metadata: >> title: ...
    const metaMatch = text.match(/^>>\s*title\s*:\s*(.+)$/im);
    if (metaMatch && metaMatch[1].trim()) {
      return metaMatch[1].trim();
    }

    return null;
  };

  // Update recipe name when content changes if user hasn't explicitly customized the name
  const handleContentChange = (newContent: string) => {
    setCookContent(newContent);
    if (!nameUserEdited) {
      const extracted = extractTitleFromContent(newContent);
      if (extracted) {
        setRecipeName(extracted);
      }
    }
  };

  // Fetch recipe from cook.md cookify URL
  const handleFetchCookifyUrl = async () => {
    const rawUrl = cookifyUrl.trim();
    if (!rawUrl) {
      setErrorMsg('Bitte gib eine gültige cook.md URL ein.');
      return;
    }

    setErrorMsg(null);
    setIsFetchingUrl(true);

    try {
      // Extract cookify ID if present
      // Examples:
      // https://cook.md/cookifies/7ca41fed-2b43-4178-ac95-90124a63139e
      // https://cook.md/cookifies/7ca41fed-2b43-4178-ac95-90124a63139e/download
      let downloadUrl = rawUrl;
      const cookifyMatch = rawUrl.match(/cookifies\/([a-zA-Z0-9_-]+)/);
      if (cookifyMatch) {
        const id = cookifyMatch[1];
        downloadUrl = `https://cook.md/cookifies/${id}/download`;
      }

      const res = await fetch(downloadUrl);
      if (!res.ok) {
        throw new Error(`Konnte Rezept nicht laden (HTTP ${res.status}). Bitte überprüfe die URL.`);
      }

      // Check content-disposition header for suggested filename
      const disposition = res.headers.get('content-disposition');
      let suggestedName = '';
      if (disposition) {
        const fnMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i);
        if (fnMatch && fnMatch[1]) {
          suggestedName = decodeURIComponent(fnMatch[1]).replace(/\.cook$/i, '').trim();
        }
      }

      const text = await res.text();
      setCookContent(text);

      // Auto-set recipe name
      const titleFromText = extractTitleFromContent(text);
      const chosenName = suggestedName || titleFromText || 'Neues Rezept';
      if (!nameUserEdited || !recipeName) {
        setRecipeName(chosenName);
      }

      setActiveTab('text');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Fehler beim Laden des Rezepts.';
      setErrorMsg(
        `${msg} Tipp: Du kannst den Inhalt auch direkt auf cook.md kopieren und im Reiter "Cooklang Text" einfügen.`
      );
    } finally {
      setIsFetchingUrl(false);
    }
  };

  // Preview parsed details
  const previewRecipe = useMemo(() => {
    if (!cookContent.trim()) return null;
    try {
      return normalizeServerRecipe(cookContent, recipeName || 'Preview');
    } catch {
      return null;
    }
  }, [cookContent, recipeName]);

  // Compute final server path
  const finalServerPath = useMemo(() => {
    const cleanName = recipeName.trim().replace(/\.cook$/i, '');
    const cleanFolder = folder.trim().replace(/^\/+|\/+$/g, '');
    if (!cleanName) return '';
    return cleanFolder ? `${cleanFolder}/${cleanName}` : cleanName;
  }, [recipeName, folder]);

  // Save recipe to Cook CLI server using official PUT endpoint
  const handleSaveRecipe = async () => {
    if (!recipeName.trim()) {
      setErrorMsg('Bitte gib einen Namen für das Rezept ein.');
      return;
    }
    if (!cookContent.trim()) {
      setErrorMsg('Das Rezept enthält noch keinen Text.');
      return;
    }

    setErrorMsg(null);
    setIsSaving(true);

    try {
      // Official Cook CLI endpoint: PUT /api/recipes/{*path} with raw .cook text
      const result = await cookApi.saveRecipeToServer(finalServerPath, cookContent);

      if (!result.success) {
        throw new Error(result.error || 'Serverfehler beim Speichern des Rezepts.');
      }

      // Sync and retrieve updated recipe
      await cookApi.syncRecipes();
      const saved = await cookApi.getRecipe(result.path);

      if (saved) {
        onRecipeSaved(saved);
      } else {
        // Fallback local normalization
        const localNorm = normalizeServerRecipe(cookContent, result.path);
        onRecipeSaved(localNorm);
      }

      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Fehler beim Speichern.';
      setErrorMsg(msg);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm transition-opacity">
      <div className="w-full max-w-xl bg-[#FAF8F5] dark:bg-[#1A1816] rounded-t-3xl sm:rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 overflow-hidden max-h-[92dvh] flex flex-col pb-safe animate-slideUp">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200 dark:border-stone-800 shrink-0">
          <div>
            <h2 className="font-mela-serif text-xl font-bold text-stone-900 dark:text-stone-100">
              Rezept hinzufügen
            </h2>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
              Direkt auf deinem Cook CLI Server speichern
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-stone-200/70 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 font-mela-sans">
          {/* Error Message */}
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 flex items-start gap-2.5 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="leading-relaxed">{errorMsg}</div>
            </div>
          )}

          {/* Name & Folder Inputs */}
          <div className="p-4 rounded-2xl bg-white dark:bg-[#121110] border border-stone-200 dark:border-stone-800 space-y-3 shadow-xs">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-stone-700 dark:text-stone-300">
                  Rezeptname (Dateiname) *
                </label>
                {finalServerPath && (
                  <span className="text-[11px] font-mono text-stone-400 dark:text-stone-500 truncate max-w-[200px]">
                    {finalServerPath}.cook
                  </span>
                )}
              </div>
              <input
                type="text"
                value={recipeName}
                onChange={(e) => {
                  setRecipeName(e.target.value);
                  setNameUserEdited(true);
                }}
                placeholder="z. B. Veganer Marmorkuchen"
                className="w-full h-11 px-3.5 rounded-xl bg-stone-50 dark:bg-stone-900/60 border border-stone-300 dark:border-stone-700 text-stone-900 dark:text-stone-100 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#DE5D4E]/40 focus:border-[#DE5D4E] transition-all"
              />
              <p className="text-[11px] text-stone-400 dark:text-stone-500 mt-1">
                Bestimmt den Namen der <span className="font-mono">.cook</span>-Datei auf deinem Server.
              </p>
            </div>

            {/* Optional Folder */}
            <div>
              <label className="text-[11px] font-medium text-stone-500 dark:text-stone-400 flex items-center gap-1.5 mb-1">
                <FolderPlus className="w-3 h-3 text-stone-400" />
                <span>Ordner / Kategorie (optional)</span>
              </label>
              <input
                type="text"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="z. B. Backen oder Desserts"
                className="w-full h-9 px-3 rounded-lg bg-stone-50 dark:bg-stone-900/60 border border-stone-300 dark:border-stone-700 text-stone-800 dark:text-stone-200 text-xs focus:outline-none focus:ring-1 focus:ring-[#DE5D4E]"
              />
            </div>
          </div>

          {/* Tab Selector */}
          <div className="flex rounded-xl bg-stone-200/70 dark:bg-stone-800/80 p-1">
            <button
              onClick={() => setActiveTab('cookify')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                activeTab === 'cookify'
                  ? 'bg-white dark:bg-[#1A1816] text-stone-900 dark:text-stone-100 shadow-xs'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-[#DE5D4E]" />
              <span>cook.md Link</span>
            </button>
            <button
              onClick={() => setActiveTab('text')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                activeTab === 'text'
                  ? 'bg-white dark:bg-[#1A1816] text-stone-900 dark:text-stone-100 shadow-xs'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5 text-stone-500" />
              <span>Cooklang Text {cookContent && '✓'}</span>
            </button>
          </div>

          {/* Tab 1: cook.md URL import */}
          {activeTab === 'cookify' && (
            <div className="space-y-3.5">
              <div className="p-3.5 rounded-xl bg-orange-50/70 dark:bg-orange-950/20 border border-orange-200/60 dark:border-orange-900/30 flex items-start justify-between gap-3">
                <div className="text-xs text-stone-700 dark:text-stone-300 leading-relaxed">
                  <p className="font-semibold text-stone-900 dark:text-stone-100 mb-0.5">
                    Rezept aus Link oder Foto erstellen
                  </p>
                  Du kannst beliebige Rezept-URLs oder Fotos auf <strong>cook.md</strong> in Cooklang umwandeln.
                </div>
                <a
                  href="https://cook.md/cookifies/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 rounded-lg bg-[#DE5D4E] hover:bg-[#cf5142] text-white text-[11px] font-semibold flex items-center gap-1 shrink-0 shadow-xs transition-colors"
                >
                  <span>cook.md</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-1.5 block">
                  cook.md Cookify URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={cookifyUrl}
                    onChange={(e) => setCookifyUrl(e.target.value)}
                    placeholder="https://cook.md/cookifies/..."
                    className="flex-1 h-11 px-3.5 rounded-xl bg-white dark:bg-[#121110] border border-stone-300 dark:border-stone-700 text-stone-900 dark:text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-[#DE5D4E]/40"
                  />
                  <button
                    onClick={handleFetchCookifyUrl}
                    disabled={isFetchingUrl || !cookifyUrl.trim()}
                    className="h-11 px-4 rounded-xl bg-[#DE5D4E] hover:bg-[#cf5142] text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm active:scale-95 transition-all disabled:opacity-50 shrink-0"
                  >
                    {isFetchingUrl ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Lädt...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        <span>Laden</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-stone-400 dark:text-stone-500 mt-1">
                  Beispiel: <span className="font-mono">https://cook.md/cookifies/7ca41fed-...</span>
                </p>
              </div>

              {cookContent && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-300">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Rezept erfolgreich geladen ({cookContent.split('\n').length} Zeilen)</span>
                  </div>
                  <button
                    onClick={() => setActiveTab('text')}
                    className="text-xs font-semibold underline hover:no-underline"
                  >
                    Text ansehen
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Raw Cooklang Text */}
          {activeTab === 'text' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400">
                <label className="font-semibold uppercase tracking-wider">
                  Cooklang Inhalt (.cook)
                </label>
                <span className="text-[11px] font-mono">
                  {cookContent.length} Zeichen • {cookContent.split('\n').length} Zeilen
                </span>
              </div>
              <textarea
                value={cookContent}
                onChange={(e) => handleContentChange(e.target.value)}
                placeholder={`---
title: Mein Rezept
author: Küchenchef
servings: 4
---

Die @Zwiebel{1} würfeln und in #Pfanne{} mit @Öl{2%el} anbraten.
Mit @Gemüsebrühe{500%ml} ablöschen und für ~{15%min} köcheln lassen.`}
                rows={9}
                className="w-full p-3.5 rounded-xl bg-white dark:bg-[#121110] border border-stone-300 dark:border-stone-700 text-stone-900 dark:text-stone-100 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#DE5D4E]/40"
              />
            </div>
          )}

          {/* Preview Card */}
          {previewRecipe && (
            <div className="p-3.5 rounded-xl bg-stone-100 dark:bg-stone-900/60 border border-stone-200 dark:border-stone-800 space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                Vorschau
              </span>
              <div className="flex items-center gap-3">
                {previewRecipe.image ? (
                  <AuthenticatedImage
                    src={previewRecipe.image}
                    alt={previewRecipe.name}
                    className="w-12 h-12 rounded-lg object-cover bg-stone-200 shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-stone-200 dark:bg-stone-800 flex items-center justify-center text-stone-400 shrink-0">
                    <Tag className="w-5 h-5 opacity-40" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h4 className="font-mela-serif text-sm font-bold text-stone-900 dark:text-stone-100 truncate">
                    {recipeName || previewRecipe.name}
                  </h4>
                  <div className="flex items-center gap-2 text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">
                    <span>{previewRecipe.ingredients.length} Zutaten</span>
                    <span>•</span>
                    <span>{previewRecipe.cookware.length} Kochgeschirr</span>
                    <span>•</span>
                    <span>{previewRecipe.steps.length} Schritte</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-4 border-t border-stone-200 dark:border-stone-800 flex items-center justify-end gap-2.5 shrink-0 bg-stone-100/50 dark:bg-[#141312]">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2.5 rounded-xl bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-300 text-xs font-semibold hover:bg-stone-300 active:scale-95 transition-all"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSaveRecipe}
            disabled={isSaving || !recipeName.trim() || !cookContent.trim()}
            className="px-5 py-2.5 rounded-xl bg-[#DE5D4E] hover:bg-[#cf5142] text-white text-xs font-semibold flex items-center gap-2 shadow-sm active:scale-95 transition-all disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Wird auf Cook Server gespeichert...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Auf Cook Server speichern</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
