import { describe, expect, it } from 'vitest';
import { shareDraftFromParams } from './shareImport';

const params = (q: Record<string, string>) => new URLSearchParams(q);

describe('shareDraftFromParams', () => {
  it('liefert nichts ohne geteilte Inhalte', () => {
    expect(shareDraftFromParams(params({}))).toBeNull();
  });

  it('nimmt eine Rezept-URL in den URL-Modus', () => {
    expect(shareDraftFromParams(params({ url: 'https://www.example.de/rezept' }))).toEqual({
      mode: 'url',
      value: 'https://www.example.de/rezept'
    });
  });

  it('findet den Link im Text (Android)', () => {
    expect(shareDraftFromParams(params({ text: 'Pasta Rezept https://www.example.de/pasta.' }))).toEqual({
      mode: 'url',
      value: 'https://www.example.de/pasta'
    });
  });

  it('übernimmt bei Instagram die Beschreibung, wenn sie mitgeschickt wird', () => {
    const draft = shareDraftFromParams(
      params({ title: 'Instagram', text: 'Mein Lieblingskuchen: 2 Eier, 250 g Mehl https://www.instagram.com/reel/abc/' })
    );
    expect(draft?.mode).toBe('text');
    expect(draft?.value).toBe('Mein Lieblingskuchen: 2 Eier, 250 g Mehl');
    expect(draft?.notice).toBeUndefined();
  });

  it('nur der Instagram-Link bleibt leer und zeigt einen Hinweis', () => {
    const draft = shareDraftFromParams(params({ title: 'Instagram', text: 'https://www.instagram.com/reel/abc/' }));
    expect(draft).toEqual({ mode: 'text', value: '', notice: 'instagram-link' });
  });

  it('erkennt den Instagram-Link auch im url-Parameter', () => {
    const draft = shareDraftFromParams(params({ url: 'https://instagram.com/reel/abc/' }));
    expect(draft?.notice).toBe('instagram-link');
  });
});
