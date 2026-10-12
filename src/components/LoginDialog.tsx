import React, { useEffect, useRef, useState } from 'react';
import { X, User, Key, Eye, EyeOff, LogIn } from 'lucide-react';
import { cookApi } from '../services/cookApi';

interface LoginDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LoginDialog: React.FC<LoginDialogProps> = ({ isOpen, onClose }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    usernameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isBusy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isBusy, onClose]);

  if (!isOpen) return null;

  const close = () => {
    setPassword('');
    setShowPassword(false);
    setError(null);
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Bitte Benutzername und Passwort eingeben.');
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      await cookApi.login(username.trim(), password);
      setUsername('');
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen.');
    } finally {
      setIsBusy(false);
      setPassword('');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isBusy) close();
      }}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-dialog-title"
        className="w-full max-w-sm bg-[#FAF8F5] dark:bg-[#1A1816] rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 p-5 space-y-4 font-mela-sans"
      >
        <div className="flex items-center justify-between">
          <h2 id="login-dialog-title" className="font-mela-serif text-lg font-bold text-stone-900 dark:text-stone-100">
            Anmelden
          </h2>
          <button
            type="button"
            onClick={close}
            disabled={isBusy}
            aria-label="Schließen"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-stone-200/70 dark:bg-stone-800 text-stone-600 dark:text-stone-300 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed">
          Zum Speichern, Bearbeiten und für den KI-Import wird ein Konto gebraucht. Konten legt der Serverbetreiber an.
        </p>

        <div className="space-y-3">
          <div>
            <label htmlFor="login-username" className="text-[11px] font-medium text-stone-600 dark:text-stone-400 mb-1 flex items-center gap-1">
              <User className="w-3 h-3 text-stone-400" />
              <span>Benutzername</span>
            </label>
            <input
              ref={usernameRef}
              id="login-username"
              name="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              disabled={isBusy}
              className="w-full h-10 px-3 rounded-xl bg-white dark:bg-stone-900/60 border border-stone-300 dark:border-stone-700 text-stone-900 dark:text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-[#DE5D4E]/40"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="text-[11px] font-medium text-stone-600 dark:text-stone-400 mb-1 flex items-center gap-1">
              <Key className="w-3 h-3 text-stone-400" />
              <span>Passwort</span>
            </label>
            <div className="relative">
              <input
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={isBusy}
                className="w-full h-10 pl-3 pr-9 rounded-xl bg-white dark:bg-stone-900/60 border border-stone-300 dark:border-stone-700 text-stone-900 dark:text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-[#DE5D4E]/40"
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

        {error && (
          <p role="alert" className="text-xs text-rose-700 dark:text-rose-400 leading-relaxed">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isBusy}
          className="w-full h-10 rounded-xl bg-[#DE5D4E] hover:bg-[#cf5142] text-white text-sm font-semibold flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-all disabled:opacity-50"
        >
          <LogIn className="w-4 h-4" />
          <span>{isBusy ? 'Melde an...' : 'Anmelden'}</span>
        </button>
      </form>
    </div>
  );
};
