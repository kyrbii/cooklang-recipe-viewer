# stir

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
| `DELETE` | `/recipe/{pfad}` | ja, mit `If-Match` |
| `GET` | `/recipe-photo/{pfad}` | nein |
| `PUT` | `/recipe-photo/{pfad}` | ja, Foto als JPG, PNG oder WebP (max. 10 MB; die App verkleinert vorher auf 1600 px und entfernt EXIF/GPS) |
| `DELETE` | `/recipe-photo/{pfad}` | ja |
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

## Deployment (Docker)

GitHub Actions testet bei jedem Push App und API und baut daraus zwei Images (amd64 + arm64): `ghcr.io/kyrbii/stir-web` und `ghcr.io/kyrbii/stir-api`. Tags: `latest` (Branch `main`), der Branch-Name für andere Branches (z. B. `feat-clean-room-api`), `1.2.3` für einen Git-Tag `v1.2.3`.

Auf dem Server reichen `docker-compose.yml` und eine `.env`, davor z. B. Nginx Proxy Manager mit je einem Proxy Host:

```bash
curl -fsSLO https://raw.githubusercontent.com/kyrbii/cooklang-recipe-viewer/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/kyrbii/cooklang-recipe-viewer/main/deploy.env.example
# .env ausfüllen: öffentliche URLs, Ports, Image-Version, Gemini-Key
docker compose up -d
docker compose exec api python scripts/create_user.py <name>
```

- Die API-URL wird erst beim Start des App-Containers gesetzt (`PUBLIC_API_URL` → `config.js` und CSP). Ein Image passt so für jeden Server.
- `PUBLIC_APP_URL` wird automatisch als erlaubter CORS-Origin der API gesetzt.
- Rezepte, Fotos und `api.db` liegen im `DATA_DIR` auf dem Host (Besitzer uid 1000). Diesen Ordner sichern.
- Die API vertraut `X-Forwarded-For` (für die Login-Sperre). Den API-Port daher nur für den Proxy erreichbar machen.
- Beide Container haben einen Healthcheck (`docker compose ps` zeigt `healthy`), Logs sind auf 3 × 10 MB begrenzt.
- Die App sendet Sicherheits-Header (CSP u. a., siehe `docker/default.conf.template`).
- Suchmaschinen: `robots.txt` und `noindex` auf App und API, die Rezepte sind öffentlich lesbar, aber nicht auffindbar.
- Update: `docker compose pull && docker compose up -d`.
- Selbst bauen statt ziehen: `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.

### Backup

```bash
docker compose exec -T api python scripts/backup.py /backups
```

Schreibt `api.db` (sicher kopiert, auch im laufenden Betrieb) und alle Rezepte samt Fotos und Dateizeiten als `.tar.gz` nach `BACKUP_DIR` und behält die neuesten 14. Täglich per Cron auf dem Host, z. B.:

```
30 3 * * * cd /pfad/zu/cooklang && docker compose exec -T api python scripts/backup.py /backups
```

Wiederherstellen: API stoppen, Archiv in `DATA_DIR` entpacken, API starten. Die Archive zusätzlich vom Server wegkopieren.

## Struktur

| Pfad | Inhalt |
|---|---|
| `src/App.tsx` | Hauptansicht, Rezeptauswahl, Teilen-Empfang |
| `src/services/cookApi.ts` | API-Zugriff, Anmeldung, Cache, Konfliktprüfung |
| `src/utils/cooklangParser.ts` | Anbindung des offiziellen Cooklang-Parsers (cooklang-rs als WASM), Mengen, Zusammenfassen und Sortieren der Zutaten |
| `src/utils/recipeLink.ts` | Rezept-Slugs und Teilen-Links |
| `src/utils/shareImport.ts` | Auswertung geteilter Inhalte |
| `api/` | Rezept-API mit KI-Import |
