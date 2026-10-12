import React, { useState } from 'react';
import {
  X,
  Server,
  Sun,
  Moon,
  CheckCircle2,
  RefreshCw,
  Lock,
  User,
  Key,
  Eye,
  EyeOff,
  LogOut,
  LogIn
} from 'lucide-react';
import { cookApi, DEFAULT_SERVER_URL } from '../services/cookApi';
import type { ConnectionStatus } from '../types/cook';

interface SettingsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  status: ConnectionStatus;
  isSyncing: boolean;
  onSync: () => Promise<void>;
}

export const SettingsSheet: React.FC<SettingsSheetProps> = ({
  isOpen,
  onClose,
  status,
  isSyncing,
  onSync
}) => {
  const [serverUrl, setServerUrl] = useState(() => cookApi.getServerUrl());
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Der Anmeldestatus kommt aus cookApi und wird bei jedem Rendern gelesen: das Sheet bleibt geschlossen gemountet,
  // und die Sitzung kann sich inzwischen geändert haben (z. B. abgelaufener Token beim KI-Import).
  const [, setSessionVersion] = useState(0);
  const refreshSession = () => setSessionVersion((v) => v + 1);
  const loggedInAs = cookApi.isLoggedIn() ? cookApi.getUsername() : '';
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [theme, setThemeState] = useState<'dark' | 'light'>(() => cookApi.getTheme());
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleUrlChange = (val: string) => {
    setServerUrl(val);
    cookApi.setServerUrl(val);
    // Ein Token gilt nur für den Server, der ihn ausgestellt hat
    refreshSession();
  };

  const handleClose = () => {
    onClose();
  };

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!loginUser.trim() || !loginPass) {
      setLoginError('Bitte Benutzername und Passwort eingeben.');
      return;
    }
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      await cookApi.login(loginUser.trim(), loginPass);
      refreshSession();
      setLoginPass('');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSyncNow = async () => {
    cookApi.setServerUrl(serverUrl);
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
      setSyncFeedback('Synchronisation fehlgeschlagen. Bitte Server-Adresse und Verbindung prüfen.');
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
    refreshSession();
    setSyncFeedback('Abgemeldet');
    setTimeout(() => setSyncFeedback(null), 3500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm transition-opacity">
      <div className="w-full max-w-lg bg-[#FAF8F5] dark:bg-[#1A1816] rounded-t-3xl sm:rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 overflow-hidden max-h-[90dvh] flex flex-col pb-safe animate-slideUp">
        {/* Sheet Grabber / Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200 dark:border-stone-800">
          <div className="flex items-center gap-2">
            <span className="font-mela-serif text-lg font-bold text-stone-900 dark:text-stone-100">
              Einstellungen & Server
            </span>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-stone-200/70 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1 font-mela-sans">
          {/* Server Config Card */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5" />
                <span>Rezept-Server URL</span>
              </label>

              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                  status === 'connected'
                    ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                    : 'bg-stone-200 dark:bg-stone-800 text-stone-600 dark:text-stone-400'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    status === 'connected' ? 'bg-emerald-500' : 'bg-stone-400'
                  }`}
                />
                <span>{status === 'connected' ? 'Verbunden' : status === 'checking' ? 'Prüfe...' : 'Offline'}</span>
              </span>
            </div>

            <input
              type="url"
              value={serverUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder={DEFAULT_SERVER_URL}
              className="w-full h-11 px-3.5 rounded-xl bg-white dark:bg-[#121110] border border-stone-300 dark:border-stone-700 text-stone-900 dark:text-stone-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#DE5D4E]/40 focus:border-[#DE5D4E]"
            />

            <div className="flex items-center gap-2">
              {/* Primary Sync Button */}
              <button
                onClick={handleSyncNow}
                disabled={isSyncing}
                className="flex-1 h-10 px-4 rounded-xl bg-[#DE5D4E] hover:bg-[#cf5142] text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Synchronisiere...' : 'Rezepte jetzt synchronisieren'}</span>
              </button>

              <button
                onClick={() => handleUrlChange(DEFAULT_SERVER_URL)}
                className="h-10 px-3 rounded-xl bg-stone-200/60 dark:bg-stone-800/60 text-stone-600 dark:text-stone-400 text-xs font-medium hover:bg-stone-300 dark:hover:bg-stone-700"
              >
                Zurücksetzen
              </button>
            </div>

            {/* Sync feedback */}
            {syncFeedback && (
              <div className="p-2.5 rounded-xl text-xs flex items-center gap-2 bg-stone-100 dark:bg-stone-900 text-stone-800 dark:text-stone-200 border border-stone-200 dark:border-stone-800">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-[#DE5D4E]" />
                <span>{syncFeedback}</span>
              </div>
            )}
          </div>

          {/* Anmeldung: nötig zum Speichern, Lesen ist ohne Anmeldung möglich */}
          <div className="space-y-3 p-4 rounded-2xl bg-white dark:bg-[#121110] border border-stone-200 dark:border-stone-800 shadow-xs">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-stone-700 dark:text-stone-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-stone-500" />
                <span>Anmeldung</span>
              </label>
              {loggedInAs && (
                <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>Angemeldet</span>
                </span>
              )}
            </div>

            {loggedInAs ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-stone-700 dark:text-stone-300">
                  Angemeldet als <span className="font-semibold">{loggedInAs}</span>
                </p>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="px-3 py-1.5 rounded-xl bg-stone-100 dark:bg-stone-900 text-stone-700 dark:text-stone-300 hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-950/60 dark:hover:text-rose-300 text-xs font-semibold flex items-center gap-1.5 transition-colors border border-stone-200 dark:border-stone-800"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Abmelden</span>
                </button>
              </div>
            ) : (
              <form onSubmit={handleLogin} className="space-y-3">
                <p className="text-[11px] text-stone-500 dark:text-stone-400 leading-relaxed">
                  Rezepte lesen geht ohne Anmeldung. Zum Speichern und Bearbeiten bitte anmelden. Konten werden auf dem Server angelegt.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label
                      htmlFor="cook-username"
                      className="text-[11px] font-medium text-stone-600 dark:text-stone-400 mb-1 flex items-center gap-1"
                    >
                      <User className="w-3 h-3 text-stone-400" />
                      <span>Benutzername</span>
                    </label>
                    <input
                      id="cook-username"
                      name="username"
                      type="text"
                      value={loginUser}
                      onChange={(e) => setLoginUser(e.target.value)}
                      placeholder="Benutzername"
                      autoComplete="username"
                      autoCapitalize="none"
                      className="w-full h-10 px-3 rounded-xl bg-stone-50 dark:bg-stone-900/60 border border-stone-300 dark:border-stone-700 text-stone-900 dark:text-stone-100 text-xs focus:outline-none focus:ring-2 focus:ring-[#DE5D4E]/40"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="cook-password"
                      className="text-[11px] font-medium text-stone-600 dark:text-stone-400 mb-1 flex items-center gap-1"
                    >
                      <Key className="w-3 h-3 text-stone-400" />
                      <span>Passwort</span>
                    </label>
                    <div className="relative">
                      <input
                        id="cook-password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        value={loginPass}
                        onChange={(e) => setLoginPass(e.target.value)}
                        placeholder="••••••••"
                        autoComplete="current-password"
                        className="w-full h-10 pl-3 pr-8 rounded-xl bg-stone-50 dark:bg-stone-900/60 border border-stone-300 dark:border-stone-700 text-stone-900 dark:text-stone-100 text-xs focus:outline-none focus:ring-2 focus:ring-[#DE5D4E]/40"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
                        title={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
                      >
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                {loginError && (
                  <p className="text-[11px] text-rose-700 dark:text-rose-400 leading-relaxed">{loginError}</p>
                )}

                <button
                  type="submit"
                  disabled={isLoggingIn}
                  className="px-3.5 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-900 dark:bg-stone-200 dark:hover:bg-white text-white dark:text-stone-900 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs disabled:opacity-50"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>{isLoggingIn ? 'Melde an...' : 'Anmelden'}</span>
                </button>
              </form>
            )}
          </div>

          {/* Theme Option */}
          <div className="pt-2 border-t border-stone-200 dark:border-stone-800 flex items-center justify-between">
            <div>
              <span className="text-sm font-semibold text-stone-800 dark:text-stone-200">
                Erscheinungsbild
              </span>
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
  );
};
