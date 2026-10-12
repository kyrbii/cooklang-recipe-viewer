import type { ConnectionStatus, Recipe, RecipeDraft, UpdateRecipeResult } from '../types/cook';
import { normalizeServerRecipe } from '../utils/cooklangParser';
import { API_URL } from '../config';

/**
 * Client for the Rezepte API (api/ in this repository):
 *   GET  /recipes          list with path, title, etag (public)
 *   GET  /recipe/{path}    raw .cook text, ETag header (public)
 *   PUT  /recipe/{path}    create or overwrite, needs a login token and If-Match for existing recipes
 *   POST /import           AI import (web page, text or photo → Cooklang), needs a login token
 *   POST /login, /logout   bearer token
 */

const STORAGE_KEYS = {
  TOKEN: 'cook_api_token',
  TOKEN_USER: 'cook_api_user',
  TOKEN_EXPIRES: 'cook_api_token_expires',
  WAKE_LOCK: 'cook_wake_lock_enabled',
  THEME: 'cook_theme',
  RECIPES_CACHE: 'cook_recipes_cache_v6',
  RECIPE_DETAIL_PREFIX: 'cook_recipe_detail_v6_',
  FAVORITES: 'cook_favorites',
  CHECKED_INGREDIENTS: 'cook_checked_ingredients',
  EDIT_DRAFT_PREFIX: 'cook_edit_draft_v1_'
};

/** Keys from the CookCLI version. Removed on start, so the old Basic Auth password does not stay in the browser. */
const LEGACY_KEYS = ['cook_server_url', 'cook_server_user', 'cook_server_pass', 'cook_recipes_cache_v5', 'cook_api_url'];
const LEGACY_DETAIL_PREFIX = 'cook_recipe_detail_v5_';

const normalizeEol = (s: string) => s.replace(/\r\n?/g, '\n');

/** Recipe path as the API uses it: no leading slash, no .cook suffix */
const cleanRecipePath = (recipePath: string) =>
  recipePath
    .trim()
    .replace(/^\/+/, '')
    .replace(/\.cook$/i, '');

const encodeRecipePath = (recipePath: string) =>
  cleanRecipePath(recipePath)
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

export interface CookApiSettings {
  wakeLockEnabled: boolean;
  theme: 'dark' | 'light';
}

export interface SyncResult {
  success: boolean;
  count: number;
  message: string;
  recipes: Recipe[];
}

export type ImportPayload = { url: string } | { text: string } | { image: string; mimeType: string };

/** The server allows 15 s for the page and 90 s for Gemini */
const IMPORT_TIMEOUT_MS = 120_000;

interface ListEntry {
  path: string;
  title: string;
  etag: string;
}

class CookApiService {
  private token: string = '';
  private tokenUser: string = '';
  private tokenExpires: number = 0;
  private connectionStatus: ConnectionStatus = 'disconnected';
  private statusListeners: Set<(status: ConnectionStatus) => void> = new Set();
  private sessionListeners: Set<() => void> = new Set();
  /** Last server text and ETag seen per recipe path, so saves can send If-Match */
  private serverVersions = new Map<string, { text: string; etag: string }>();

  constructor() {
    this.removeLegacyStorage();
    this.loadSettings();
  }

  private removeLegacyStorage(): void {
    try {
      for (const key of LEGACY_KEYS) localStorage.removeItem(key);
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith(LEGACY_DETAIL_PREFIX)) localStorage.removeItem(key);
      }
      // CookCLI paths ended in .cook, the API paths do not: keep favorites pointing at the same recipes
      const favs = localStorage.getItem(STORAGE_KEYS.FAVORITES);
      if (favs) {
        const list: string[] = JSON.parse(favs);
        if (list.some((id) => /\.cook$/i.test(id))) {
          localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(list.map(cleanRecipePath)));
        }
      }
    } catch {
      // LocalStorage might be restricted
    }
  }

  public loadSettings(): CookApiSettings {
    try {
      this.token = localStorage.getItem(STORAGE_KEYS.TOKEN) || '';
      this.tokenUser = localStorage.getItem(STORAGE_KEYS.TOKEN_USER) || '';
      this.tokenExpires = Number(localStorage.getItem(STORAGE_KEYS.TOKEN_EXPIRES) || 0);
    } catch {
      // LocalStorage might be restricted
    }
    if (this.token && this.tokenExpires * 1000 <= Date.now()) {
      this.clearSession();
    }
    return { wakeLockEnabled: this.getWakeLockEnabled(), theme: this.getTheme() };
  }

  // ---- Login ----

  public isLoggedIn(): boolean {
    return Boolean(this.token) && this.tokenExpires * 1000 > Date.now();
  }

  public getUsername(): string {
    return this.tokenUser;
  }

  /** Calls `callback` whenever the login state changes. Returns the unsubscribe function. */
  public subscribeSession(callback: () => void): () => void {
    this.sessionListeners.add(callback);
    return () => {
      this.sessionListeners.delete(callback);
    };
  }

  private notifySession(): void {
    this.sessionListeners.forEach((fn) => fn());
  }

  private storeSession(token: string, username: string, expiresAt: number): void {
    this.token = token;
    this.tokenUser = username;
    this.tokenExpires = expiresAt;
    try {
      localStorage.setItem(STORAGE_KEYS.TOKEN, token);
      localStorage.setItem(STORAGE_KEYS.TOKEN_USER, username);
      localStorage.setItem(STORAGE_KEYS.TOKEN_EXPIRES, String(expiresAt));
    } catch {
      // Ignore: the session then lasts until the page is reloaded
    }
    this.notifySession();
  }

  private clearSession(): void {
    const wasLoggedIn = this.token !== '';
    this.token = '';
    this.tokenUser = '';
    this.tokenExpires = 0;
    try {
      localStorage.removeItem(STORAGE_KEYS.TOKEN);
      localStorage.removeItem(STORAGE_KEYS.TOKEN_USER);
      localStorage.removeItem(STORAGE_KEYS.TOKEN_EXPIRES);
    } catch {
      // Ignore
    }
    if (wasLoggedIn) this.notifySession();
  }

  /** Signs in and stores the token. Throws with a readable message on failure. */
  public async login(username: string, password: string): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchApi('login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
    } catch {
      this.setStatus('disconnected');
      throw new Error('Server nicht erreichbar. Bitte die Server-Adresse prüfen.');
    }
    if (!res.ok) {
      if (res.status === 401) throw new Error('Benutzername oder Passwort falsch.');
      if (res.status === 429) {
        const wait = Math.ceil(Number(res.headers.get('Retry-After') || 60) / 60);
        throw new Error(`Zu viele Fehlversuche. Bitte in ${wait} Minute(n) erneut versuchen.`);
      }
      throw new Error(await this.readErrorMessage(res));
    }
    const data = (await res.json()) as { token: string; username: string; expires_at: number };
    this.storeSession(data.token, data.username, data.expires_at);
    this.setStatus('connected');
  }

  /** Revokes the token on the server (best effort) and forgets it locally */
  public async logout(): Promise<void> {
    if (this.token) {
      try {
        await this.fetchApi('logout', { method: 'POST' });
      } catch {
        // Offline: the token expires on its own
      }
    }
    this.clearSession();
  }

  public getAuthHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  // ---- Settings ----

  public setWakeLockEnabled(enabled: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEYS.WAKE_LOCK, String(enabled));
    } catch {
      // Ignore
    }
  }

  public getWakeLockEnabled(): boolean {
    try {
      const val = localStorage.getItem(STORAGE_KEYS.WAKE_LOCK);
      return val !== null ? val === 'true' : true;
    } catch {
      return true;
    }
  }

  public getTheme(): 'dark' | 'light' {
    try {
      const val = localStorage.getItem(STORAGE_KEYS.THEME);
      return val === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }

  public setTheme(theme: 'dark' | 'light'): void {
    try {
      localStorage.setItem(STORAGE_KEYS.THEME, theme);
    } catch {
      // Ignore
    }
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  public getFavorites(): string[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.FAVORITES);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  public toggleFavorite(recipeId: string): boolean {
    const favs = new Set(this.getFavorites());
    let isFav = false;
    if (favs.has(recipeId)) {
      favs.delete(recipeId);
      isFav = false;
    } else {
      favs.add(recipeId);
      isFav = true;
    }
    try {
      localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(Array.from(favs)));
    } catch {
      // Ignore
    }
    return isFav;
  }

  public getCheckedIngredients(recipeId: string): Set<string> {
    try {
      const key = `${STORAGE_KEYS.CHECKED_INGREDIENTS}_${recipeId}`;
      const data = localStorage.getItem(key);
      return data ? new Set(JSON.parse(data)) : new Set();
    } catch {
      return new Set();
    }
  }

  public setCheckedIngredients(recipeId: string, checked: Set<string>): void {
    try {
      const key = `${STORAGE_KEYS.CHECKED_INGREDIENTS}_${recipeId}`;
      localStorage.setItem(key, JSON.stringify(Array.from(checked)));
    } catch {
      // Ignore
    }
  }

  public onStatusChange(callback: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(callback);
    callback(this.connectionStatus);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  private setStatus(status: ConnectionStatus) {
    this.connectionStatus = status;
    this.statusListeners.forEach((fn) => fn(status));
  }

  public getStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  private async fetchApi(path: string, options: RequestInit = {}, timeoutMs = 4000): Promise<Response> {
    const cleanPath = path.replace(/^\/+/, '');
    const cleanBase = API_URL.replace(/\/+$/, '');

    // Reads are public: sending the token only on writes avoids a CORS preflight for every GET
    const method = (options.method || 'GET').toUpperCase();
    const authHeaders = method === 'GET' || method === 'HEAD' ? {} : this.getAuthHeaders();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${cleanBase}/${cleanPath}`, {
        ...options,
        signal: controller.signal,
        credentials: 'omit',
        headers: {
          Accept: 'application/json, text/plain, */*',
          ...authHeaders,
          ...(options.headers || {})
        }
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private rememberServerVersion(path: string, text: string, etag: string | null): void {
    if (etag) this.serverVersions.set(cleanRecipePath(path), { text, etag });
  }

  // ---- Cache ----

  public getCachedRecipes(): Recipe[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.RECIPES_CACHE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore
    }
    return [];
  }

  public setCachedRecipes(recipes: Recipe[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.RECIPES_CACHE, JSON.stringify(recipes));
      for (const recipe of recipes) {
        localStorage.setItem(`${STORAGE_KEYS.RECIPE_DETAIL_PREFIX}${recipe.path}`, JSON.stringify(recipe));
      }
    } catch {
      // Quota exceeded
    }
  }

  private getCachedRecipe(path: string): Recipe | null {
    try {
      const cached = localStorage.getItem(`${STORAGE_KEYS.RECIPE_DETAIL_PREFIX}${path}`);
      if (cached) return JSON.parse(cached);
      return this.getCachedRecipes().find((r) => r.path === path || r.id === path) ?? null;
    } catch {
      return null;
    }
  }

  private cacheRecipe(recipe: Recipe): void {
    try {
      localStorage.setItem(`${STORAGE_KEYS.RECIPE_DETAIL_PREFIX}${recipe.path}`, JSON.stringify(recipe));
    } catch {
      // Ignore quota error
    }
  }

  private parseRecipe(text: string, path: string, etag: string | null): Recipe {
    const recipe = normalizeServerRecipe(text, path);
    if (etag) recipe.etag = etag;
    return recipe;
  }

  // ---- Reading ----

  /**
   * Loads the list from the server. Recipes whose ETag matches the cached copy are reused,
   * only new or changed recipes are downloaded. Falls back to the cache when offline.
   */
  public async syncRecipes(): Promise<SyncResult> {
    this.setStatus('checking');

    try {
      const res = await this.fetchApi('recipes');
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
      const data = (await res.json()) as { recipes: ListEntry[] };

      const recipes = await Promise.all(data.recipes.map((entry) => this.loadListEntry(entry)));
      recipes.sort((a, b) => a.name.localeCompare(b.name));

      this.setStatus('connected');
      this.setCachedRecipes(recipes);

      return {
        success: true,
        count: recipes.length,
        message: `Synced ${recipes.length} recipe${recipes.length === 1 ? '' : 's'} successfully`,
        recipes
      };
    } catch (err: unknown) {
      this.setStatus('disconnected');
      const cached = this.getCachedRecipes();
      const msg = err instanceof Error ? err.message : 'Server unreachable';

      return {
        success: false,
        count: cached.length,
        message: cached.length > 0 ? `${msg} — showing ${cached.length} cached recipe(s)` : msg,
        recipes: cached
      };
    }
  }

  private async loadListEntry(entry: ListEntry): Promise<Recipe> {
    const cached = this.getCachedRecipe(entry.path);
    if (cached?.etag === entry.etag) return cached;

    const fresh = await this.getRecipe(entry.path).catch(() => null);
    if (fresh) return fresh;

    // Download failed: show the entry with what the list knows
    return {
      id: entry.path,
      path: entry.path,
      name: entry.title,
      folder: entry.path.includes('/') ? entry.path.split('/').slice(0, -1).join('/') : undefined,
      metadata: {},
      steps: [],
      ingredients: [],
      cookware: []
    };
  }

  /**
   * Main recipe list getter: attempts server sync, falls back to offline cache.
   */
  public async getRecipes(forceRefresh = false): Promise<Recipe[]> {
    const cached = this.getCachedRecipes();

    if (!forceRefresh && !navigator.onLine && cached.length > 0) {
      this.setStatus('disconnected');
      return cached;
    }

    const syncRes = await this.syncRecipes();
    return syncRes.success ? syncRes.recipes : cached;
  }

  /**
   * Fetches one recipe from the server and caches it. Falls back to the cache when offline.
   */
  public async getRecipe(recipePath: string): Promise<Recipe | null> {
    const path = cleanRecipePath(recipePath);

    try {
      const res = await this.fetchApi(`recipe/${encodeRecipePath(path)}`, {
        headers: { Accept: 'text/plain, */*' }
      });
      if (res.ok) {
        this.setStatus('connected');
        const text = await res.text();
        const etag = res.headers.get('ETag');
        this.rememberServerVersion(path, text, etag);
        const recipe = this.parseRecipe(text, path, etag);
        this.cacheRecipe(recipe);
        return recipe;
      }
    } catch {
      // Fallback to cache below
    }

    return this.getCachedRecipe(path);
  }

  /**
   * Raw .cook text straight from the server, never from the cache: editing needs the live version.
   */
  public async getRawRecipe(recipePath: string): Promise<string> {
    const path = cleanRecipePath(recipePath);

    let res: Response;
    try {
      res = await this.fetchApi(`recipe/${encodeRecipePath(path)}`, {
        cache: 'no-store',
        headers: { Accept: 'text/plain, */*' }
      });
    } catch (err) {
      this.setStatus('disconnected');
      throw err;
    }

    if (!res.ok) {
      throw new Error(await this.readErrorMessage(res));
    }

    this.setStatus('connected');
    const text = await res.text();
    this.rememberServerVersion(path, text, res.headers.get('ETag'));
    return text;
  }

  // ---- Writing ----

  /**
   * Readable message for a failed request. The API sends errors as {"detail": "..."}.
   */
  private async readErrorMessage(res: Response): Promise<string> {
    const text = await res.text().catch(() => '');
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.detail === 'string') detail = parsed.detail;
    } catch {
      // plain text body
    }
    switch (res.status) {
      case 400:
        return `Ungültiger Rezeptname oder Inhalt${detail ? `: ${detail}` : ''}.`;
      case 401:
        return 'Nicht angemeldet. Bitte in den Einstellungen anmelden.';
      case 404:
        return 'Rezeptdatei auf dem Server nicht gefunden (404).';
      case 413:
        return 'Das Rezept ist zu groß.';
      case 428:
        return 'Ein Rezept mit diesem Namen existiert bereits.';
      default:
        return `Server-Fehler (HTTP ${res.status})${detail ? `: ${detail}` : ''}`;
    }
  }

  private async put(path: string, content: string, ifMatch?: string): Promise<Response> {
    return this.fetchApi(`recipe/${encodeRecipePath(path)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        ...(ifMatch ? { 'If-Match': ifMatch } : {})
      },
      body: content
    });
  }

  /**
   * Creates a new recipe. Never overwrites: if the name is taken, the server answers 428.
   */
  public async saveRecipeToServer(
    recipeNameOrPath: string,
    content: string
  ): Promise<{ success: boolean; path: string; error?: string }> {
    const path = cleanRecipePath(recipeNameOrPath);
    if (!path) {
      return { success: false, path: '', error: 'Recipe name cannot be empty' };
    }

    try {
      const res = await this.put(path, content);
      if (!res.ok) {
        if (res.status === 401) this.clearSession();
        return { success: false, path, error: await this.readErrorMessage(res) };
      }
      this.setStatus('connected');
      this.rememberServerVersion(path, content, res.headers.get('ETag'));
      return { success: true, path };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, path, error: `Verbindung zum Server fehlgeschlagen: ${msg}` };
    }
  }

  /**
   * ETag to send as If-Match when saving `content` that was edited from `base`.
   * Returns a conflict when the server no longer has `base`.
   */
  private async versionToOverwrite(
    path: string,
    base: string | undefined,
    force: boolean
  ): Promise<{ etag: string } | { conflict: string }> {
    const known = this.serverVersions.get(path);
    if (known && (force || base === undefined || known.text === base)) {
      return { etag: known.etag };
    }
    // No ETag for this base yet (e.g. after a reload): ask the server for its current version
    const serverText = await this.getRawRecipe(path);
    const current = this.serverVersions.get(path)!;
    if (!force && base !== undefined && normalizeEol(serverText) !== normalizeEol(base)) {
      return { conflict: serverText };
    }
    return { etag: current.etag };
  }

  /**
   * Saves an edited recipe with an If-Match check, so changes made elsewhere are never overwritten silently.
   *
   * - base: the server text the edit started from. If the server has changed since, the result is a conflict.
   * - force: overwrite the latest server version the client has seen (after the user chose to in the conflict dialog).
   */
  public async updateRecipe(
    recipePath: string,
    content: string,
    baseContent?: string,
    options: { force?: boolean } = {}
  ): Promise<UpdateRecipeResult> {
    const path = cleanRecipePath(recipePath);
    let res: Response;

    try {
      const version = await this.versionToOverwrite(path, baseContent, Boolean(options.force));
      if ('conflict' in version) {
        return { status: 'conflict', serverContent: version.conflict };
      }
      res = await this.put(path, content, version.etag);
    } catch (err) {
      this.setStatus('disconnected');
      const isOffline = !navigator.onLine;
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 'error',
        message: isOffline
          ? 'Keine Internetverbindung. Dein Entwurf wurde lokal gesichert.'
          : `Verbindung zum Server fehlgeschlagen: ${msg}`,
        isOffline: true
      };
    }

    if (res.status === 412) {
      const serverText = await res.text();
      const etag = res.headers.get('ETag');
      if (!etag) {
        return { status: 'error', message: 'Das Rezept wurde auf dem Server gelöscht.', isOffline: false };
      }
      this.rememberServerVersion(path, serverText, etag);
      return { status: 'conflict', serverContent: serverText };
    }

    if (!res.ok) {
      if (res.status === 401) this.clearSession();
      return { status: 'error', message: await this.readErrorMessage(res), isOffline: false };
    }

    this.setStatus('connected');
    const etag = res.headers.get('ETag');
    this.rememberServerVersion(path, content, etag);
    this.clearDraft(path);

    const previous = this.getCachedRecipe(path);
    const updatedRecipe = this.parseRecipe(content, path, etag);
    if (!updatedRecipe.image && previous?.image) {
      updatedRecipe.image = previous.image;
    }

    this.upsertCachedRecipe(updatedRecipe);
    return { status: 'saved', recipe: updatedRecipe, content };
  }

  /**
   * AI import: turns a web page, a text or a photo into Cooklang. Needs a login.
   * Throws with a readable message on failure.
   */
  public async importRecipe(payload: ImportPayload): Promise<string> {
    if (!this.isLoggedIn()) {
      throw new Error('Für den KI-Import bitte in den Einstellungen anmelden.');
    }
    let res: Response;
    try {
      res = await this.fetchApi(
        'import',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
        IMPORT_TIMEOUT_MS
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('Die Umwandlung hat zu lange gedauert. Bitte erneut versuchen.');
      }
      throw new Error('Server nicht erreichbar. Bitte die Server-Adresse prüfen.');
    }
    const data = (await res.json().catch(() => ({}))) as { cooklang?: string; detail?: unknown };
    if (!res.ok) {
      if (res.status === 401) {
        this.clearSession();
        throw new Error('Die Anmeldung ist abgelaufen. Bitte in den Einstellungen neu anmelden.');
      }
      throw new Error(typeof data.detail === 'string' ? data.detail : `Umwandlung fehlgeschlagen (HTTP ${res.status}).`);
    }
    return data.cooklang ?? '';
  }

  /**
   * Upsert a recipe into the localStorage cache
   */
  public upsertCachedRecipe(recipe: Recipe): void {
    const list = this.getCachedRecipes();
    const idx = list.findIndex((r) => r.path === recipe.path || r.id === recipe.id);
    if (idx >= 0) {
      list[idx] = recipe;
    } else {
      list.push(recipe);
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    this.setCachedRecipes(list);
  }

  // ---- Local Edit Drafts (persisted during editing to prevent loss) ----

  public getDraft(recipePath: string): RecipeDraft | null {
    try {
      const raw = localStorage.getItem(`${STORAGE_KEYS.EDIT_DRAFT_PREFIX}${recipePath}`);
      return raw ? (JSON.parse(raw) as RecipeDraft) : null;
    } catch {
      return null;
    }
  }

  public hasDraft(recipePath: string): boolean {
    try {
      return localStorage.getItem(`${STORAGE_KEYS.EDIT_DRAFT_PREFIX}${recipePath}`) !== null;
    } catch {
      return false;
    }
  }

  public saveDraft(recipePath: string, base: string, content: string): RecipeDraft | null {
    const draft: RecipeDraft = { path: recipePath, base, content, updatedAt: Date.now() };
    try {
      localStorage.setItem(`${STORAGE_KEYS.EDIT_DRAFT_PREFIX}${recipePath}`, JSON.stringify(draft));
      return draft;
    } catch {
      return null;
    }
  }

  public clearDraft(recipePath: string): void {
    try {
      localStorage.removeItem(`${STORAGE_KEYS.EDIT_DRAFT_PREFIX}${recipePath}`);
    } catch {
      // Ignore
    }
  }

  // ---- Images ----
  private imageBlobCache = new Map<string, string>();

  /**
   * Loads an image as a blob URL. External hosts (e.g. from the recipe front matter) are used directly.
   * The API does not serve images yet, so server-relative images fail and the caller shows the placeholder.
   */
  public async fetchImageBlob(src: string): Promise<string> {
    if (!src) return '';
    if (src.startsWith('data:') || src.startsWith('blob:')) return src;

    if (/^https?:\/\//i.test(src)) {
      try {
        if (new URL(src).origin !== new URL(API_URL).origin) return src;
      } catch {
        return src;
      }
    }

    let fullUrl = src;
    if (!src.startsWith('http://') && !src.startsWith('https://')) {
      const base = API_URL.replace(/\/+$/, '');
      fullUrl = `${base}/${src.replace(/^\/+/, '')}`;
    }

    if (this.imageBlobCache.has(fullUrl)) {
      return this.imageBlobCache.get(fullUrl)!;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(fullUrl, {
        signal: controller.signal,
        credentials: 'omit',
        headers: { Accept: 'image/*,*/*' }
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        this.imageBlobCache.set(fullUrl, objectUrl);
        return objectUrl;
      }
    } catch {
      // Fehler unten weiterreichen, der Aufrufer zeigt dann den Platzhalter
    }
    throw new Error(`Bild konnte nicht geladen werden: ${fullUrl}`);
  }

  public clearImageCache(): void {
    for (const url of this.imageBlobCache.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore
      }
    }
    this.imageBlobCache.clear();
  }
}

export const cookApi = new CookApiService();
