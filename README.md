# Rezepte

Mobile-first PWA für deine [Cooklang](https://cooklang.org/)-Rezepte. Die App spricht mit einer eigenen kleinen API ([`api/`](api/)), lädt die `.cook`-Dateien und funktioniert offline mit dem zuletzt geladenen Stand.

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

Die App spricht standardmäßig mit der lokalen API unter `http://localhost:8000`. Die Server-URL lässt sich in den Einstellungen ändern.

### Lokal testen

```bash
cd api && cp .env.example .env && uv sync
uv run python scripts/create_user.py <name>
uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --workers 1
```

Dann `npm run dev` im Hauptordner und in den Einstellungen anmelden. Lesen geht ohne Anmeldung, Speichern braucht sie.
`ALLOWED_ORIGINS` in `api/.env` muss die Adresse der App enthalten (Standard `http://localhost:5173`).
Für den KI-Import `GEMINI_API_KEY` in `api/.env` eintragen.

## Rezept-API

Der Ordner [`api/`](api/) enthält die API (Python, FastAPI, uv). Details und Entscheidungen stehen in [`api/PLAN.md`](api/PLAN.md).

| Methode | Pfad | Anmeldung |
|---|---|---|
| `GET` | `/recipes` | nein |
| `GET` | `/recipe/{pfad}` | nein |
| `PUT` | `/recipe/{pfad}` | ja, mit `If-Match` beim Überschreiben |
| `POST` | `/import` | ja (KI-Import) |
| `POST` | `/login`, `/logout` | – |
| `DELETE` | `/account` | ja, mit Passwort |

Konten legt nur das Skript `api/scripts/create_user.py` an, eine Registrierung gibt es nicht. Löschen geht über die App (Einstellungen → Konto) oder mit `api/scripts/delete_user.py`. Die Datenschutzerklärung steht in der App unter Einstellungen → Datenschutz.

## KI-Import

`POST /import` in der API wandelt eine Webseite, einen Text oder ein Foto mit Gemini in Cooklang um. Bei Webseiten werden strukturierte Rezeptdaten (JSON-LD) bevorzugt und das Titelbild als `>> image:`-Zeile übernommen. Der Server ruft nur öffentliche Adressen ab, auch nach Weiterleitungen. Der Import braucht eine Anmeldung, weil jeder Aufruf Gemini-Kontingent kostet.

Konfiguration in `api/.env`:

```env
GEMINI_API_KEY=dein-schluessel
GEMINI_MODEL=gemini-3.5-flash-lite   # optional
```

Instagram-Links werden absichtlich abgelehnt, dort lässt sich nur die Beschreibung als Text importieren.

## Anmeldung

Die Anmeldung in den Einstellungen liefert einen Token, der im Browser (`localStorage`) gespeichert wird, bis du dich abmeldest oder er abläuft (Standard 30 Tage). Das Passwort selbst wird nicht gespeichert. Jeder Skript-Code auf derselben Seite könnte den Token auslesen, für eine persönliche App ist das vertretbar. Beim Abmelden wird der Token auch auf dem Server ungültig.

## Struktur

| Pfad | Inhalt |
|---|---|
| `src/App.tsx` | Hauptansicht, Rezeptauswahl, Teilen-Empfang |
| `src/services/cookApi.ts` | API-Zugriff, Anmeldung, Cache, Konfliktprüfung |
| `src/utils/cooklangParser.ts` | Cooklang-Parser, Zusammenfassen und Sortieren der Zutaten |
| `src/utils/recipeLink.ts` | Rezept-Slugs und Teilen-Links |
| `src/utils/shareImport.ts` | Auswertung geteilter Inhalte |
| `api/` | Rezept-API mit KI-Import |
