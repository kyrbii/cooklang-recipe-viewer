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

  it('wechselt bei Instagram in den Text-Modus mit der Beschreibung', () => {
    const draft = shareDraftFromParams(
      params({ title: 'Reel', text: 'Mein Lieblingskuchen: 2 Eier, 250 g Mehl', url: 'https://www.instagram.com/reel/abc/' })
    );
    expect(draft?.mode).toBe('text');
    expect(draft?.value).toContain('250 g Mehl');
  });
});
