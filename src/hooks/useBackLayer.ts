import { useEffect, useId, useRef } from 'react';

type LayerState = { layers?: string[] } | null;
const layersOf = () => (window.history.state as LayerState)?.layers ?? [];

// history.back() is async. A layer opened while one is still closing (e.g. a selection mode handing
// over to a sheet) must push only after that back has landed, or the back pops the new entry instead.
let pendingBacks = 0;
const queuedPushes: Array<() => void> = [];

// Registered at module load, so it runs before the per-layer listeners below.
window.addEventListener('popstate', () => {
  if (pendingBacks === 0) return;
  pendingBacks--;
  if (pendingBacks === 0) queuedPushes.splice(0).forEach((push) => push());
});

const goBack = () => {
  pendingBacks++;
  window.history.back();
};

const pushLayer = (id: string) => {
  const push = () => window.history.pushState({ ...window.history.state, layers: [...layersOf(), id] }, '');
  if (pendingBacks > 0) queuedPushes.push(push);
  else push();
};

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
      pushLayer(id);
    } else if (!active && pushed.current) {
      pushed.current = false;
      if (layersOf().at(-1) === id) goBack();
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
