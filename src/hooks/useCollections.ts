import { useCallback, useEffect, useState } from 'react';
import type { Collection } from '../types/cook';
import { cookApi } from '../services/cookApi';

/** The signed-in person's collections. Empty when logged out, loaded again on login. */
export function useCollections(loginUser: string) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!cookApi.isLoggedIn()) {
      setCollections([]);
      setLoaded(false);
      return;
    }
    try {
      setCollections(await cookApi.listCollections());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sammlungen konnten nicht geladen werden.');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Laden vom Server ist ein externes System, daher ist der Effekt richtig
    // oxlint-disable-next-line react/set-state-in-effect
    void reload();
  }, [loginUser, reload]);

  return { collections, loaded, error, reload };
}
