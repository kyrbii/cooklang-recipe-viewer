export interface ShareDraft {
  mode: 'url' | 'text';
  value: string;
  /** Hinweis für die Oberfläche, z. B. wenn Instagram nur den Link schickt */
  notice?: 'instagram-link';
}

const URL_PATTERN = /https?:\/\/[^\s]+/i;
const INSTAGRAM = /(^|\.)instagram\.com/i;

/**
 * Liest geteilte Inhalte aus den Query-Parametern (PWA share_target: title, text, url).
 * Android hängt den Link oft an `text` an, deshalb wird er dort auch gesucht.
 * Instagram-Links lassen sich nicht abrufen. Instagram schickt beim Teilen meist nur den Link,
 * die Beschreibung muss der Nutzer kopieren, dann übernimmt der Text-Modus sie.
 */
export function shareDraftFromParams(params: URLSearchParams): ShareDraft | null {
  const title = params.get('title')?.trim() ?? '';
  const text = params.get('text')?.trim() ?? '';
  const explicitUrl = params.get('url')?.trim() ?? '';

  const combined = [title, text, explicitUrl].filter(Boolean).join('\n');
  if (!combined) return null;

  const found = (explicitUrl || combined.match(URL_PATTERN)?.[0] || '').replace(/[.,;)]+$/, '');
  const isHttp = /^https?:\/\//i.test(found);

  if (isHttp && INSTAGRAM.test(new URL(found).hostname)) {
    // Beschreibung ist alles außer dem Link und dem allgemeinen Titel „Instagram“
    const caption = combined
      .split(found)
      .join('')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !/^instagram$/i.test(line))
      .join('\n');
    return caption
      ? { mode: 'text', value: caption }
      : { mode: 'text', value: '', notice: 'instagram-link' };
  }

  if (isHttp) {
    return { mode: 'url', value: found };
  }
  return { mode: 'text', value: combined };
}
