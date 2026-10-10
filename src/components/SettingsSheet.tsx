import React, { useState } from 'react';
import {
  X,
  Server,
  Wifi,
  Sun,
  Moon,
  CheckCircle2,
  AlertCircle,
  Terminal,
  Trash2,
  RefreshCw,
  Lock,
  User,
  Key,
  Eye,
  EyeOff,
  LogOut
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
  const [serverUser, setServerUser] = useState(() => cookApi.getCredentials().user);
  const [serverPass, setServerPass] = useState(() => cookApi.getCredentials().pass);
  const [showPassword, setShowPassword] = useState(false);
  const [theme, setThemeState] = useState<'dark' | 'light'>(() => cookApi.getTheme());
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    tested: boolean;
    success?: boolean;
    latencyMs?: number;
    message?: string;
  }>({ tested: false });
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [authSavedFeedback, setAuthSavedFeedback] = useState(false);

  if (!isOpen) return null;

  const handleUrlChange = (val: string) => {
    setServerUrl(val);
    cookApi.setServerUrl(val);
  };

  const handleUserChange = (val: string) => {
    setServerUser(val);
    cookApi.setCredentials(val, serverPass);
    setAuthSavedFeedback(true);
    setTimeout(() => setAuthSavedFeedback(false), 2000);
  };

  const handlePassChange = (val: string) => {
    setServerPass(val);
    cookApi.setCredentials(serverUser, val);
    setAuthSavedFeedback(true);
    setTimeout(() => setAuthSavedFeedback(false), 2000);
  };

  const handleSaveCredentials = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    cookApi.setCredentials(serverUser, serverPass);
    setAuthSavedFeedback(true);
    setTimeout(() => setAuthSavedFeedback(false), 3000);
  };

  const handleSaveAndTest = async () => {
    setIsTesting(true);
    setTestResult({ tested: false });

    cookApi.setServerUrl(serverUrl);
    cookApi.setCredentials(serverUser, serverPass);
    const result = await cookApi.testConnection(serverUrl, serverUser, serverPass);

    setIsTesting(false);
    setTestResult({
      tested: true,
      success: result.success,
      latencyMs: result.latencyMs,
      message: result.message
    });
  };

  const handleSyncNow = async () => {
    cookApi.setServerUrl(serverUrl);
    cookApi.setCredentials(serverUser, serverPass);
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

  const handleClearCache = () => {
    cookApi.clearCache();
    setSyncFeedback('Offline recipe cache cleared');
    setTimeout(() => setSyncFeedback(null), 3000);
  };

  const handleLogout = async () => {
    setServerUser('');
    setServerPass('');
    cookApi.setCredentials('', '');

    // Invalidate browser's in-memory HTTP Basic Auth session by sending an intentionally invalid request
    try {
      const cleanBase = serverUrl.trim().replace(/\/+$/, '');
      if (cleanBase) {
        await fetch(`${cleanBase}/api/recipes`, {
          headers: {
            Authorization: 'Basic ' + btoa('logout:invalid_password')
          }
        });
      }
    } catch {
      // Ignore
    }

    setSyncFeedback('Zugangsdaten gelöscht & ausgeloggt');
    setTimeout(() => setSyncFeedback(null), 3500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm transition-opacity">
      <div className="w-full max-w-lg bg-[#FAF8F5] dark:bg-[#1A1816] rounded-t-3xl sm:rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 overflow-hidden max-h-[90dvh] flex flex-col pb-safe animate-slideUp">
        {/* Sheet Grabber / Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200 dark:border-stone-800">
          <div className="flex items-center gap-2">
            <span className="font-mela-serif text-lg font-bold text-stone-900 dark:text-stone-100">
              Einstellungen & Cook CLI
            </span>
          </div>
          <button
            onClick={onClose}
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
                <span>Cook CLI Server URL</span>
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
              placeholder="http://192.168.1.50:9080"
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

              {/* Test Connection Button */}
              <button
                onClick={handleSaveAndTest}
                disabled={isTesting}
                className="h-10 px-3.5 rounded-xl bg-stone-200 dark:bg-stone-800 text-stone-800 dark:text-stone-200 text-xs font-medium hover:bg-stone-300 dark:hover:bg-stone-700 flex items-center gap-1.5 active:scale-95"
              >
                <Wifi className="w-3.5 h-3.5" />
                <span>{isTesting ? 'Prüfe...' : 'Testen'}</span>
              </button>

              <button
                onClick={() => setServerUrl(DEFAULT_SERVER_URL)}
                className="h-10 px-3 rounded-xl bg-stone-200/60 dark:bg-stone-800/60 text-stone-600 dark:text-stone-400 text-xs font-medium hover:bg-stone-300 dark:hover:bg-stone-700"
              >
                Zurücksetzen
              </button>
            </div>

            {/* Test result feedback */}
            {testResult.tested && (
              <div
                className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
                  testResult.success
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}

            {/* Sync feedback */}
            {syncFeedback && (
              <div className="p-2.5 rounded-xl text-xs flex items-center gap-2 bg-stone-100 dark:bg-stone-900 text-stone-800 dark:text-stone-200 border border-stone-200 dark:border-stone-800">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-[#DE5D4E]" />
                <span>{syncFeedback}</span>
              </div>
            )}
          </div>

          {/* Authentication Card (HTTP Basic Auth for Nginx Proxy Manager) */}
          <form
            onSubmit={handleSaveCredentials}
            className="space-y-3 p-4 rounded-2xl bg-white dark:bg-[#121110] border border-stone-200 dark:border-stone-800 shadow-xs"
          >
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-stone-700 dark:text-stone-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-stone-500" />
                <span>HTTP Basic Auth (optional)</span>
              </label>
              <div className="flex items-center gap-2">
                {authSavedFeedback && (
                  <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full flex items-center gap-1 animate-fadeIn">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    <span>Gespeichert</span>
                  </span>
                )}
                {(serverUser.trim() || serverPass) && !authSavedFeedback && (
                  <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span>Aktiv</span>
                  </span>
                )}
              </div>
            </div>

            <p className="text-[11px] text-stone-500 dark:text-stone-400 leading-relaxed">
              Für Nginx Proxy Manager / Reverse Proxy Schutz. Wird automatisch im Hintergrund als Authorization-Header bei allen API- und Bildabfragen mitgesendet, ohne den Browser-Login-Dialog auszulösen.
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
                  value={serverUser}
                  onChange={(e) => handleUserChange(e.target.value)}
                  placeholder="Benutzername"
                  autoComplete="username"
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
                    value={serverPass}
                    onChange={(e) => handlePassChange(e.target.value)}
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

            <div className="pt-1 flex items-center justify-between gap-2">
              <button
                type="submit"
                className="px-3.5 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-900 dark:bg-stone-200 dark:hover:bg-white text-white dark:text-stone-900 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 dark:text-emerald-600" />
                <span>Zugangsdaten speichern</span>
              </button>

              {(serverUser.trim() || serverPass) && (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="px-3 py-1.5 rounded-xl bg-stone-100 dark:bg-stone-900 text-stone-700 dark:text-stone-300 hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-950/60 dark:hover:text-rose-300 text-xs font-semibold flex items-center gap-1.5 transition-colors border border-stone-200 dark:border-stone-800"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Ausloggen / Löschen</span>
                </button>
              )}
            </div>
          </form>

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

          {/* Cache Management */}
          <div className="pt-2 border-t border-stone-200 dark:border-stone-800 space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 block">
              Offline-Speicher
            </span>
            <button
              onClick={handleClearCache}
              className="px-3 py-2 rounded-xl bg-stone-200/80 dark:bg-stone-800 text-stone-700 dark:text-stone-300 text-xs font-medium flex items-center gap-1.5 hover:bg-stone-300 active:scale-95"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Offline-Cache leeren</span>
            </button>
          </div>

          {/* Quick Info */}
          <div className="p-3 rounded-xl bg-stone-100 dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800/80 text-[11px] text-stone-500 dark:text-stone-400 space-y-1">
            <div className="font-semibold text-stone-700 dark:text-stone-300 flex items-center gap-1">
              <Terminal className="w-3.5 h-3.5 text-[#DE5D4E]" />
              <span>So funktioniert die Synchronisation:</span>
            </div>
            <p>
              Wenn dein Cook CLI Server läuft (z. B. <code>cook server</code>), werden Rezepte beim Öffnen der App automatisch synchronisiert. Klicke oben auf <strong>Rezepte jetzt synchronisieren</strong>, um neue oder bearbeitete <code>.cook</code>-Dateien sofort zu laden.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
