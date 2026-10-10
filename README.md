# Rezepte

Mobile-first PWA für deine Cooklang-Rezepte. Die App spricht mit einem [CookCLI](https://cooklang.org/)-Server, lädt die `.cook`-Dateien und funktioniert offline mit dem zuletzt geladenen Stand.

## Funktionen

- Rezeptliste mit Suche, Tags und Favoriten, Kachel- oder Listenansicht
- Rezeptansicht mit skalierbaren Portionen, abhakbarer Zutatenliste und Timern
- Zutaten werden zusammengefasst und nach Menge sortiert; die Einzelmengen stehen in Klammern
- Editor für `.cook`-Dateien mit Live-Vorschau, Entwurfsspeicherung und Konflikterkennung
- **KI-Import:** Rezept aus einer Webseite, aus Text oder aus einem Foto in Cooklang umwandeln (Gemini)
- Teilen: Rezeptlink mit lesbarem Namen, z. B. `#/rezept/backen-marmorkuchen`
- Teilen-Ziel auf Android: Reel-Text oder Link direkt aus einer App an „Rezepte“ schicken
- Hell- und Dunkelmodus, Wake Lock beim Kochen

## Entwicklung

```bash
npm install
npm run dev      # Entwicklungsserver
npm run build    # Typprüfung und Produktionsbuild
npm test         # Unit-Tests (Parser, Zutaten, Links, Teilen)
npm run lint     # oxlint
```

Die App spricht standardmäßig mit `https://cook.kyrbii.de`. Die Server-URL lässt sich in den Einstellungen ändern.

## KI-Import-Dienst

Der Ordner [`ai-import/`](ai-import/) enthält einen kleinen Node-Dienst ohne Abhängigkeiten. Er ruft Webseiten ab, liest Rezeptdaten und Titelbilder aus und schickt den Inhalt an Gemini. Der API-Schlüssel bleibt auf dem Server.

Konfiguration über Umgebungsvariablen (z. B. in einer `.env` neben der `docker-compose.yml`):

```env
GEMINI_API_KEY=dein-schluessel
GEMINI_MODEL=gemini-2.5-flash   # optional
```

Der Dienst läuft auf Port 8787 und wird über Nginx Proxy Manager unter `/ai/` mit Basic Auth veröffentlicht. Instagram-Links werden absichtlich abgelehnt, dort lässt sich nur die Beschreibung als Text importieren.

## Zugangsdaten

Die Basic-Auth-Zugangsdaten für den Reverse Proxy stehen in den Einstellungen. Der Benutzername wird lokal gespeichert, das Passwort nur für die aktuelle Sitzung. Die Anmeldung erfolgt über den `Authorization`-Header, der Browser-Login-Dialog erscheint nicht.

## Struktur

| Pfad | Inhalt |
|---|---|
| `src/App.tsx` | Hauptansicht, Rezeptauswahl, Teilen-Empfang |
| `src/services/cookApi.ts` | Server-Zugriff, Zugangsdaten, Cache, Bilder |
| `src/utils/cooklangParser.ts` | Cooklang-Parser, Zusammenfassen und Sortieren der Zutaten |
| `src/utils/recipeLink.ts` | Rezept-Slugs und Teilen-Links |
| `src/utils/shareImport.ts` | Auswertung geteilter Inhalte |
| `ai-import/server.mjs` | KI-Import-Dienst |
