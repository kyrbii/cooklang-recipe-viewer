import { useEffect, useId, useRef } from 'react';

type LayerState = { layers?: string[] } | null;
const layersOf = () => (window.history.state as LayerState)?.layers ?? [];

/**
 * Lets the browser back button / Android back gesture close a view (sheet, dialog, selection, sub page).
 * While `active` is true there is one extra history entry. Back pops it and calls `onClose`;
 * closing through the UI pops the entry again so the history stays in step.
 */
export function useBackLayer(active: boolean, onClose: () => void): void {
  const id = useId();
  const pushed = useRef(false);
  const close = useRef(onClose);

  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (active && !pushed.current) {
      pushed.current = true;
      window.history.pushState({ ...window.history.state, layers: [...layersOf(), id] }, '');
    } else if (!active && pushed.current) {
      pushed.current = false;
      if (layersOf().at(-1) === id) window.history.back();
    }
  }, [active, id]);

  useEffect(() => {
    const onPopState = () => {
      if (pushed.current && !layersOf().includes(id)) {
        pushed.current = false;
        close.current();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [id]);
}
