import http from 'node:http';
import dns from 'node:dns/promises';
import net from 'node:net';

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const PORT = Number(process.env.PORT) || 8787;

const MAX_BODY = 12 * 1024 * 1024; // Bilder als base64, Upload im Frontend auf 8 MB begrenzt
const MAX_PAGE = 2 * 1024 * 1024;
const MAX_TEXT = 50000;
const FETCH_TIMEOUT_MS = 15000;
const GEMINI_TIMEOUT_MS = 90000;

const SYSTEM = `Du bist ein Assistent, der Rezepte in Cooklang umwandelt.
Antworte ausschließlich mit gültigem Cooklang-Code, ohne Erklärungen und ohne Markdown-Zäune.
Schreibe alle Texte, Zutaten und Kochschritte auf Deutsch.
Zutaten: @Name{Menge%Einheit}, z. B. @Mehl{250%g}. Ohne Menge: @Salz{}.
Kochgeschirr: #Topf{}. Timer: ~{15%min}.
Metadaten als YAML-Frontmatter am Anfang: title, servings, source (falls bekannt).
Wenn der Inhalt kein Rezept enthält, antworte nur mit: KEIN_REZEPT`;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---- SSRF-Schutz: der Server ruft beliebige URLs ab, also keine internen Ziele ----

function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'Ungültige URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new HttpError(400, 'Nur http- und https-URLs sind erlaubt.');
  }
  if (url.username || url.password) {
    throw new HttpError(400, 'URLs mit Zugangsdaten sind nicht erlaubt.');
  }
  if (/(^|\.)instagram\.com$/i.test(url.hostname)) {
    throw new HttpError(
      422,
      'Instagram lässt den Abruf nicht zu. Kopiere die Beschreibung des Reels in den Reiter „Text“ oder lade einen Screenshot als Foto hoch.'
    );
  }
  const addresses = net.isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await dns.lookup(url.hostname, { all: true });
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new HttpError(400, 'Diese Adresse ist nicht erlaubt.');
  }
  return url;
}

// ---- Webseite abrufen und in Text umwandeln ----

async function fetchPage(start) {
  let url = await assertPublicUrl(start);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RezepteImport/1.0)',
        Accept: 'text/html,application/xhtml+xml'
      }
    });

    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      url = await assertPublicUrl(new URL(location, url).href);
      continue;
    }
    if (!res.ok) {
      throw new HttpError(502, `Die Seite ist nicht erreichbar (HTTP ${res.status}).`);
    }
    const type = res.headers.get('content-type') || '';
    if (!type.includes('html') && !type.includes('text')) {
      throw new HttpError(422, 'Die URL zeigt keine Webseite an.');
    }
    const buffer = await res.arrayBuffer();
    return new TextDecoder().decode(buffer.slice(0, MAX_PAGE));
  }
  throw new HttpError(502, 'Zu viele Weiterleitungen.');
}

function extractPageText(html) {
  // Viele Rezeptseiten haben strukturierte Daten (schema.org/Recipe), die sind am zuverlässigsten
  const jsonLd = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1].trim())
    .join('\n');
  const meta = [
    ...html.matchAll(/<meta[^>]+(?:property|name)=["'](og:title|og:description|description)["'][^>]*content=["']([^"']*)["']/gi)
  ]
    .map((m) => `${m[1]}: ${m[2]}`)
    .join('\n');
  const body = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return [
    jsonLd && `Strukturierte Daten (JSON-LD):\n${jsonLd}`,
    meta && `Meta-Tags:\n${meta}`,
    `Seitentext:\n${body}`
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_TEXT);
}

// ---- Titelbild aus der Webseite ----

function findPageImage(html, pageUrl) {
  const toAbsolute = (value) => {
    if (typeof value === 'object' && value) value = value.url || value['@id'];
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const abs = new URL(value.trim(), pageUrl);
      return ['http:', 'https:'].includes(abs.protocol) ? abs.href : null;
    } catch {
      return null;
    }
  };

  // 1. schema.org/Recipe im JSON-LD (image kann String, Objekt oder Liste sein)
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const nodes = [].concat(data, data?.['@graph'] ?? []);
    for (const node of nodes) {
      const types = [].concat(node?.['@type'] ?? []);
      if (!types.includes('Recipe')) continue;
      for (const img of [].concat(node.image ?? [])) {
        const abs = toAbsolute(img);
        if (abs) return abs;
      }
    }
  }

  // 2. Open Graph / Twitter Card (Attribute in beliebiger Reihenfolge)
  for (const tag of html.match(/<meta[^>]*>/gi) ?? []) {
    const key = tag.match(/(?:property|name)=["']([^"']+)["']/i)?.[1];
    if (key !== 'og:image' && key !== 'twitter:image') continue;
    const abs = toAbsolute(tag.match(/content=["']([^"']*)["']/i)?.[1]);
    if (abs) return abs;
  }
  return null;
}

function withImage(cooklang, imageUrl) {
  if (!imageUrl) return cooklang;
  const line = `image: ${JSON.stringify(imageUrl)}`;
  const fm = cooklang.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fm) return `---\n${line}\n---\n\n${cooklang}`;
  const yaml = fm[1]
    .split('\n')
    .filter((l) => !/^image\s*:/i.test(l))
    .concat(line)
    .join('\n');
  return `---\n${yaml}\n---\n${cooklang.slice(fm[0].length)}`;
}

// ---- Gemini ----

async function gemini(parts) {
  if (!GEMINI_KEY) throw new HttpError(500, 'GEMINI_API_KEY ist auf dem Server nicht gesetzt.');

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts }]
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS)
  });

  if (!res.ok) {
    console.error('Gemini-Fehler:', res.status, await res.text());
    const hint = res.status === 429 ? ' Das Kontingent ist erschöpft, bitte später erneut versuchen.' : '';
    throw new HttpError(502, `Gemini-Fehler (HTTP ${res.status}).${hint}`);
  }

  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text || '').join('');
  const cooklang = text
    .replace(/^\s*```[a-zA-Z]*\s*/, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  if (!cooklang || cooklang === 'KEIN_REZEPT') {
    throw new HttpError(422, 'In diesem Inhalt wurde kein Rezept gefunden.');
  }
  return cooklang;
}

// ---- Routing ----

async function handleImport(body) {
  let parts;
  if (body.url) {
    const pageUrl = String(body.url);
    const html = await fetchPage(pageUrl);
    parts = [{ text: `Wandle das Rezept aus dieser Webseite in Cooklang um.\n\n${extractPageText(html)}` }];
    const cooklang = await gemini(parts);
    return { cooklang: withImage(cooklang, findPageImage(html, pageUrl)) };
  } else if (body.text) {
    const text = String(body.text);
    if (text.length > MAX_TEXT) throw new HttpError(413, 'Der Text ist zu lang.');
    parts = [{ text: `Wandle folgenden Rezepttext in Cooklang um:\n\n${text}` }];
  } else if (body.image) {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic'].includes(body.mimeType)) {
      throw new HttpError(400, 'Bildformat wird nicht unterstützt (JPG, PNG, WebP, HEIC).');
    }
    parts = [
      { inlineData: { mimeType: body.mimeType, data: body.image } },
      { text: 'Wandle das Rezept auf diesem Bild in Cooklang um.' }
    ];
  } else {
    throw new HttpError(400, 'Bitte url, text oder image angeben.');
  }
  return { cooklang: await gemini(parts) };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Die Datei ist zu groß (max. 8 MB).'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
      } catch {
        reject(new HttpError(400, 'Ungültiges JSON.'));
      }
    });
    req.on('error', reject);
  });
}

http
  .createServer(async (req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    };

    if (req.method !== 'POST' || req.url !== '/import') {
      return send(404, { error: 'Nicht gefunden.' });
    }

    try {
      send(200, await handleImport(await readJson(req)));
    } catch (err) {
      if (err instanceof HttpError) return send(err.status, { error: err.message });
      console.error(err);
      send(500, { error: 'Interner Fehler beim Import.' });
    }
  })
  .listen(PORT, '0.0.0.0', () => {
    console.log(`ai-import läuft auf Port ${PORT} (Modell: ${MODEL})`);
  });
