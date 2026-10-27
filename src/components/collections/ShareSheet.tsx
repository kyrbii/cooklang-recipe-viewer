import React, { useState } from 'react';
import { Info, LogOut, User, X } from 'lucide-react';
import type { Collection } from '../../types/cook';
import { cookApi } from '../../services/cookApi';
import { ConfirmDialog } from '../ConfirmDialog';
import { Avatar } from './Avatars';
import { Sheet } from './Sheet';

interface ShareSheetProps {
  collection: Collection;
  loginUser: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
  /** The signed-in person left, so the collection is no longer theirs */
  onLeft: () => void;
}

/** Invite by username, see everyone, remove people or leave. Every member may do all of it. */
export const ShareSheet: React.FC<ShareSheetProps> = ({ collection, loginUser, onClose, onChanged, onLeft }) => {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };

  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    void run(async () => {
      await cookApi.addCollectionMember(collection.id, name);
      setName('');
      await onChanged();
    });
  };

  const isOnlyMember = collection.members.length === 1;

  return (
    <>
      <Sheet title="Sammlung teilen" onClose={onClose}>
        <p className="px-5 pb-3.5 text-[13px] leading-snug text-stone-500 dark:text-stone-400">
          <b className="font-semibold text-stone-900 dark:text-stone-100">{collection.name}</b> gehört allen Mitgliedern gemeinsam.
        </p>
        <div className="px-5 flex flex-col gap-4">
          <form onSubmit={invite} className="flex gap-2">
            <label className="flex-1 h-11 flex items-center gap-2.5 px-3.5 rounded-xl bg-white dark:bg-[#121110] border border-stone-200 dark:border-stone-800 text-stone-400">
              <User className="w-4 h-4 shrink-0" />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Benutzername"
                aria-label="Benutzername"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="flex-1 min-w-0 bg-transparent text-sm text-stone-900 dark:text-stone-100 placeholder-stone-500 focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="h-11 px-4 rounded-xl bg-[#DE5D4E] hover:bg-[#cf5142] text-white text-sm font-semibold whitespace-nowrap disabled:opacity-50 cursor-pointer"
            >
              Hinzufügen
            </button>
          </form>
          {error && (
            <p role="alert" className="-mt-2 text-xs text-rose-700 dark:text-rose-400">
              {error}
            </p>
          )}

          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-stone-500 dark:text-stone-400">
              Mitglieder · {collection.members.length}
            </div>
            <ul className="rounded-2xl overflow-hidden bg-white dark:bg-[#121110] border border-stone-200 dark:border-stone-800 divide-y divide-stone-200 dark:divide-stone-800">
              {collection.members.map((member) => {
                const me = member === loginUser;
                return (
                  <li key={member} className="min-h-14 py-2 pl-3.5 pr-2 flex items-center gap-3">
                    <Avatar name={member} size="lg" />
                    <span className="flex-1 min-w-0">
                      <b className="block text-sm font-semibold text-stone-900 dark:text-stone-100 truncate">
                        {member}
                        {me ? ' (du)' : ''}
                      </b>
                      {member === collection.createdBy && (
                        <span className="block text-xs text-stone-500 dark:text-stone-400">Hat die Sammlung angelegt</span>
                      )}
                    </span>
                    {!me && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await cookApi.removeCollectionMember(collection.id, member);
                            await onChanged();
                          })
                        }
                        aria-label={`${member} entfernen`}
                        className="w-10 h-10 flex items-center justify-center rounded-full text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-50 cursor-pointer"
                      >
                        <X className="w-[18px] h-[18px]" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex gap-2.5 text-xs leading-normal text-stone-500 dark:text-stone-400">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Alle Mitglieder dürfen Rezepte hinzufügen und entfernen sowie weitere Personen einladen. Die Rezepte selbst sind für alle sichtbar.
            </span>
          </div>

          <button
            type="button"
            onClick={() => setLeaving(true)}
            className="h-11 flex items-center justify-center gap-2 rounded-xl border border-stone-200 dark:border-stone-800 text-sm font-semibold text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Sammlung verlassen
          </button>
        </div>
      </Sheet>
      <ConfirmDialog
        isOpen={leaving}
        title="Sammlung verlassen?"
        message={
          isOnlyMember
            ? 'Du bist das einzige Mitglied. Die Sammlung wird dabei gelöscht, die Rezepte bleiben erhalten.'
            : 'Die anderen Mitglieder behalten die Sammlung. Du kannst nur wieder rein, wenn dich jemand einlädt.'
        }
        confirmLabel="Verlassen"
        busy={busy}
        error={null}
        onCancel={() => setLeaving(false)}
        onConfirm={() =>
          run(async () => {
            await cookApi.removeCollectionMember(collection.id, loginUser);
            await onChanged();
            onLeft();
          })
        }
      />
    </>
  );
};
