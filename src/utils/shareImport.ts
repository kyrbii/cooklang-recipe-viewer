export interface ShareDraft {
  mode: 'url' | 'text';
  value: string;
}

const URL_PATTERN = /https?:\/\/[^\s]+/i;

/**
 * Liest geteilte Inhalte aus den Query-Parametern (PWA share_target: title, text, url).
 * Android hängt den Link oft an `text` an, deshalb wird er dort auch gesucht.
 * Instagram-Links lassen sich nicht abrufen, dort zählt die Beschreibung (Text-Modus).
 */
export function shareDraftFromParams(params: URLSearchParams): ShareDraft | null {
  const title = params.get('title')?.trim() ?? '';
  const text = params.get('text')?.trim() ?? '';
  const explicitUrl = params.get('url')?.trim() ?? '';

  const combined = [title, text, explicitUrl].filter(Boolean).join('\n');
  if (!combined) return null;

  const found = (explicitUrl || combined.match(URL_PATTERN)?.[0] || '').replace(/[.,;)]+$/, '');
  const isInstagram = /(^|\.)instagram\.com/i.test(found);

  if (found && !isInstagram && /^https?:\/\//i.test(found)) {
    return { mode: 'url', value: found };
  }
  return { mode: 'text', value: combined };
}
