import React, { useState } from 'react';
import { X, Sun, Moon, CheckCircle2, RefreshCw, Lock, LogOut, LogIn } from 'lucide-react';
import { cookApi } from '../services/cookApi';
import { useLoginUser } from '../hooks/useLoginUser';
import { LoginDialog } from './LoginDialog';
import type { ConnectionStatus } from '../types/cook';

interface SettingsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  status: ConnectionStatus;
  isSyncing: boolean;
  onSync: () => Promise<void>;
}

export const SettingsSheet: React.FC<SettingsSheetProps> = ({ isOpen, onClose, status, isSyncing, onSync }) => {
  const loggedInAs = useLoginUser();
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [theme, setThemeState] = useState<'dark' | 'light'>(() => cookApi.getTheme());
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSyncNow = async () => {
    setSyncFeedback(null);
    try {
      const result = await cookApi.syncRecipes();
      await onSync();
      if (result.success) {
        setSyncFeedback(`Erfolgreich ${result.count} Rezept(e) synchronisiert`);
      } else {
        setSyncFeedback(`Keine Verbindung zum Server (${result.count} Rezepte aus Cache)`);
      }
    } catch {
      setSyncFeedback('Synchronisation fehlgeschlagen. Bitte Verbindung prüfen.');
    }
    setTimeout(() => setSyncFeedback(null), 4500);
  };

  const handleToggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setThemeState(next);
    cookApi.setTheme(next);
  };

  const handleLogout = async () => {
    await cookApi.logout();
    setSyncFeedback('Abgemeldet');
    setTimeout(() => setSyncFeedback(null), 3500);
  };

  // The login dialog is a sibling, not a child: the backdrop blur here would otherwise trap its fixed positioning
  return (
    <>
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm transition-opacity">
      <div className="w-full max-w-lg bg-[#FAF8F5] dark:bg-[#1A1816] rounded-t-3xl sm:rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 overflow-hidden max-h-[90dvh] flex flex-col pb-safe animate-slideUp">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200 dark:border-stone-800">
          <span className="font-mela-serif text-lg font-bold text-stone-900 dark:text-stone-100">Einstellungen</span>
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-stone-200/70 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1 font-mela-sans">
          {/* Synchronisation */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">Server</span>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                  status === 'connected'
                    ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                    : 'bg-stone-200 dark:bg-stone-800 text-stone-600 dark:text-stone-400'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${status === 'connected' ? 'bg-emerald-500' : 'bg-stone-400'}`} />
                <span>{status === 'connected' ? 'Verbunden' : status === 'checking' ? 'Prüfe...' : 'Offline'}</span>
              </span>
            </div>

            <button
              onClick={handleSyncNow}
              disabled={isSyncing}
              className="w-full h-10 px-4 rounded-xl bg-[#DE5D4E] hover:bg-[#cf5142] text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Synchronisiere...' : 'Rezepte jetzt synchronisieren'}</span>
            </button>

            {syncFeedback && (
              <div className="p-2.5 rounded-xl text-xs flex items-center gap-2 bg-stone-100 dark:bg-stone-900 text-stone-800 dark:text-stone-200 border border-stone-200 dark:border-stone-800">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-[#DE5D4E]" />
                <span>{syncFeedback}</span>
              </div>
            )}
          </div>

          {/* Anmeldung: nur ein Knopf, die Zugangsdaten gibt man im Dialog ein */}
          <div className="space-y-3 p-4 rounded-2xl bg-white dark:bg-[#121110] border border-stone-200 dark:border-stone-800 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-stone-700 dark:text-stone-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-stone-500" />
                <span>Konto</span>
              </span>
              {loggedInAs ? (
                <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>Angemeldet</span>
                </span>
              ) : (
                <span className="text-[11px] font-semibold text-stone-600 dark:text-stone-400 bg-stone-200 dark:bg-stone-800 px-2 py-0.5 rounded-full">
                  Nicht angemeldet
                </span>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
                {loggedInAs ? (
                  <>
                    Angemeldet als <span className="font-semibold text-stone-800 dark:text-stone-200">{loggedInAs}</span>
                  </>
                ) : (
                  'Rezepte lesen geht ohne Anmeldung. Zum Speichern und für den KI-Import bitte anmelden.'
                )}
              </p>
              {loggedInAs ? (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="shrink-0 px-3 py-1.5 rounded-xl bg-stone-100 dark:bg-stone-900 text-stone-700 dark:text-stone-300 hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-950/60 dark:hover:text-rose-300 text-xs font-semibold flex items-center gap-1.5 transition-colors border border-stone-200 dark:border-stone-800"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Abmelden</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsLoginOpen(true)}
                  className="shrink-0 px-3.5 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-900 dark:bg-stone-200 dark:hover:bg-white text-white dark:text-stone-900 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Anmelden</span>
                </button>
              )}
            </div>
          </div>

          {/* Theme Option */}
          <div className="pt-2 border-t border-stone-200 dark:border-stone-800 flex items-center justify-between">
            <div>
              <span className="text-sm font-semibold text-stone-800 dark:text-stone-200">Erscheinungsbild</span>
              <p className="text-xs text-stone-500">Warmes Elfenbein oder dunkles Schiefergrau</p>
            </div>
            <button
              onClick={handleToggleTheme}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-200 dark:bg-stone-800 text-stone-800 dark:text-stone-200 text-xs font-medium cursor-pointer active:scale-95 transition-transform"
            >
              {theme === 'dark' ? <Moon className="w-3.5 h-3.5 text-[#DE5D4E]" /> : <Sun className="w-3.5 h-3.5 text-amber-500" />}
              <span>{theme === 'dark' ? 'Dunkel' : 'Hell'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <LoginDialog isOpen={isLoginOpen} onClose={() => setIsLoginOpen(false)} />
    </>
  );
};
