import React, { useEffect, useRef, useState } from 'react';
import { X, Key, Trash2 } from 'lucide-react';
import { cookApi } from '../services/cookApi';

interface DeleteAccountDialogProps {
  isOpen: boolean;
  username: string;
  onClose: () => void;
  onDeleted: () => void;
}

/** Asks for the password again before the account is deleted. */
export const DeleteAccountDialog: React.FC<DeleteAccountDialogProps> = ({ isOpen, username, onClose, onDeleted }) => {
  const [password, setPassword] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    passwordRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isBusy) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isBusy]);

  if (!isOpen) return null;

  function close() {
    setPassword('');
    setError(null);
    onClose();
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('Bitte gib dein Passwort ein.');
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      await cookApi.deleteAccount(password);
      setPassword('');
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Das Konto konnte nicht gelöscht werden.');
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
        aria-labelledby="delete-account-title"
        className="w-full max-w-sm bg-[#FAF8F5] dark:bg-[#1A1816] rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 p-5 space-y-4 font-mela-sans"
      >
        <div className="flex items-center justify-between">
          <h2 id="delete-account-title" className="font-mela-serif text-lg font-bold text-rose-700 dark:text-rose-400">
            Konto löschen
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

        <div className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed space-y-2">
          <p>
            Das Konto <span className="font-semibold text-stone-800 dark:text-stone-200">{username}</span> wird
            endgültig gelöscht, außerdem alle Anmeldungen auf dem Server.
          </p>
          <p>
            <span className="font-semibold">Deine Rezepte bleiben erhalten.</span> Sie gehören keinem Konto und sind für
            alle Nutzenden des Servers sichtbar. Wenn du ein Rezept entfernt haben möchtest, sprich mit dem Serverbetreiber.
          </p>
          <p>Zur Bestätigung gib bitte dein Passwort ein.</p>
        </div>

        <div>
          <label htmlFor="delete-password" className="text-[11px] font-medium text-stone-600 dark:text-stone-400 mb-1 flex items-center gap-1">
            <Key className="w-3 h-3 text-stone-400" />
            <span>Passwort</span>
          </label>
          <input
            ref={passwordRef}
            id="delete-password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={isBusy}
            className="w-full h-10 px-3 rounded-xl bg-white dark:bg-stone-900/60 border border-stone-300 dark:border-stone-700 text-stone-900 dark:text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400/40"
          />
        </div>

        {error && (
          <p role="alert" className="text-xs text-rose-700 dark:text-rose-400 leading-relaxed">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={isBusy}
            className="h-10 px-4 rounded-xl bg-stone-200/70 dark:bg-stone-800 text-stone-700 dark:text-stone-300 text-xs font-semibold disabled:opacity-50"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={isBusy}
            className="h-10 px-4 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{isBusy ? 'Lösche...' : 'Konto endgültig löschen'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
