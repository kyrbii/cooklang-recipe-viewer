import type { ConnectionStatus, Recipe, RecipeDraft, UpdateRecipeResult } from '../types/cook';
import { normalizeServerRecipe } from '../utils/cooklangParser';

const STORAGE_KEYS = {
  SERVER_URL: 'cook_server_url',
  SERVER_USER: 'cook_server_user',
  SERVER_PASS: 'cook_server_pass',
  WAKE_LOCK: 'cook_wake_lock_enabled',
  THEME: 'cook_theme',
  RECIPES_CACHE: 'cook_recipes_cache_v5',
  RECIPE_DETAIL_PREFIX: 'cook_recipe_detail_v5_',
  FAVORITES: 'cook_favorites',
  CHECKED_INGREDIENTS: 'cook_checked_ingredients',
  EDIT_DRAFT_PREFIX: 'cook_edit_draft_v1_'
};

const normalizeEol = (s: string) => s.replace(/\r\n?/g, '\n');

const encodeRecipePath = (recipePath: string) =>
  recipePath
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

export const DEFAULT_SERVER_URL = 'https://cook.kyrbii.de';

export interface CookApiSettings {
  serverUrl: string;
  serverUser?: string;
  serverPass?: string;
  wakeLockEnabled: boolean;
  theme: 'dark' | 'light';
}

export interface SyncResult {
  success: boolean;
  count: number;
  message: string;
  recipes: Recipe[];
}

export interface RecipePathItem {
  path: string;
  name?: string;
  folder?: string;
  initialMetadata?: Record<string, unknown>;
  initialImage?: string;
}

class CookApiService {
  private serverUrl: string = DEFAULT_SERVER_URL;
  private serverUser: string = '';
  private serverPass: string = '';
  private connectionStatus: ConnectionStatus = 'disconnected';
  private statusListeners: Set<(status: ConnectionStatus) => void> = new Set();

  constructor() {
    this.loadSettings();
  }

  public loadSettings(): CookApiSettings {
    let url = DEFAULT_SERVER_URL;
    let wakeLock = true;
    let theme: 'dark' | 'light' = 'light';

    try {
      const storedUrl = localStorage.getItem(STORAGE_KEYS.SERVER_URL);
      if (storedUrl) {
        url = storedUrl.trim();
      }
      const storedUser = localStorage.getItem(STORAGE_KEYS.SERVER_USER);
      if (storedUser) {
        this.serverUser = storedUser.trim();
      }
      // Passwort nur für die Sitzung. Alte Einträge aus localStorage werden entfernt.
      localStorage.removeItem(STORAGE_KEYS.SERVER_PASS);
      const storedPass = sessionStorage.getItem(STORAGE_KEYS.SERVER_PASS);
      if (storedPass) {
        this.serverPass = storedPass;
      }
      const storedWakeLock = localStorage.getItem(STORAGE_KEYS.WAKE_LOCK);
      if (storedWakeLock !== null) {
        wakeLock = storedWakeLock === 'true';
      }
      const storedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
      if (storedTheme === 'light' || storedTheme === 'dark') {
        theme = storedTheme;
      }
    } catch {
      // LocalStorage might be restricted
    }

    this.serverUrl = url;
    return {
      serverUrl: url,
      serverUser: this.serverUser,
      serverPass: this.serverPass,
      wakeLockEnabled: wakeLock,
      theme
    };
  }

  public setCredentials(user: string, pass: string): void {
    this.serverUser = user.trim();
    this.serverPass = pass;
    this.clearImageCache();
    try {
      if (this.serverUser) {
        localStorage.setItem(STORAGE_KEYS.SERVER_USER, this.serverUser);
      } else {
        localStorage.removeItem(STORAGE_KEYS.SERVER_USER);
      }
      if (this.serverPass) {
        sessionStorage.setItem(STORAGE_KEYS.SERVER_PASS, this.serverPass);
      } else {
        sessionStorage.removeItem(STORAGE_KEYS.SERVER_PASS);
      }
    } catch {
      // Ignore
    }
  }

  public getCredentials(): { user: string; pass: string } {
    return { user: this.serverUser, pass: this.serverPass };
  }

  public getAuthHeaders(): Record<string, string> {
    const user = this.serverUser;
    const pass = this.serverPass;
    if (user) {
      try {
        const str = `${user}:${pass || ''}`;
        const encoded = btoa(unescape(encodeURIComponent(str)));
        return { Authorization: `Basic ${encoded}` };
      } catch {
        // Fallback
      }
    }
    return {};
  }

  public setServerUrl(url: string): void {
    const cleanUrl = url.trim().replace(/\/+$/, '');
    this.serverUrl = cleanUrl || DEFAULT_SERVER_URL;
    try {
      localStorage.setItem(STORAGE_KEYS.SERVER_URL, this.serverUrl);
    } catch {
      // Ignore
    }
  }

  public getServerUrl(): string {
    return this.serverUrl;
  }

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

  private async fetchApi(path: string, options: RequestInit = {}): Promise<Response> {
    const cleanPath = path.replace(/^\/+/, '');
    const cleanBase = this.serverUrl.replace(/\/+$/, '');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    try {
      return await fetch(`${cleanBase}/${cleanPath}`, {
        ...options,
        signal: controller.signal,
        credentials: 'omit',
        headers: {
          Accept: 'application/json, text/plain, */*',
          ...this.getAuthHeaders(),
          ...(options.headers || {})
        }
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

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

  /**
   * Synchronize recipes from Cook CLI server.
   * If server is reachable, updates cache and returns fresh recipes.
   * If unreachable, falls back to cache. Never uses mock/sample recipes.
   */
  public async syncRecipes(): Promise<SyncResult> {
    this.setStatus('checking');

    try {
      const res = await this.fetchApi('api/recipes');

      if (!res.ok) {
        if (res.status === 401) {
          this.setStatus('error');
          throw new Error('401 Unauthorized (Zugangsdaten erforderlich oder fehlerhaft)');
        }
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      this.setStatus('connected');
      const data = await res.json();
      const recipes = await this.parseRecipesListResponse(data);

      this.setCachedRecipes(recipes);

      return {
        success: true,
        count: recipes.length,
        message: `Synced ${recipes.length} recipe${recipes.length === 1 ? '' : 's'} successfully`,
        recipes
      };
    } catch (err: unknown) {
      if (this.connectionStatus !== 'error') {
        this.setStatus('disconnected');
      }
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

  /**
   * Main recipe list getter: attempts server sync, falls back to offline cache.
   */
  public async getRecipes(forceRefresh = false): Promise<Recipe[]> {
    const cached = this.getCachedRecipes();

    // If offline and not forcing refresh, return cache immediately
    if (!forceRefresh && !navigator.onLine && cached.length > 0) {
      this.setStatus('disconnected');
      return cached;
    }

    // Try to sync with server
    const syncRes = await this.syncRecipes();
    if (syncRes.success) {
      return syncRes.recipes;
    }

    return cached;
  }

  /**
   * Parse various response formats from Cook CLI:
   * Handles directory trees (with children as objects or arrays),
   * flat paths, arrays of objects, or full recipe objects.
   */
  private async parseRecipesListResponse(data: unknown): Promise<Recipe[]> {
    if (!data) return [];

    // Check if data is already an array of full recipes
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && ('steps' in data[0] || 'sections' in data[0])) {
      return data.map((r, i) => normalizeServerRecipe(r, r.path || `recipe_${i}.cook`));
    }

    // Extract all recipe leaf paths from directory tree or list
    const items = this.extractRecipePaths(data);
    if (items.length === 0) return [];

    // Fetch full recipe details for all discovered items
    const recipes: Recipe[] = [];
    await Promise.all(
      items.map(async (item) => {
        try {
          const recipe = await this.getRecipe(item.path);
          if (recipe) {
            if (!recipe.image && item.initialImage) {
              recipe.image = item.initialImage;
            }
            recipes.push(recipe);
            return;
          }
        } catch {
          // Ignore
        }

        // Fallback stub entry using initial metadata
        const filename = item.path.split('/').pop()?.replace(/\.cook$/i, '') || 'Recipe';
        recipes.push({
          id: item.path,
          path: item.path,
          name: item.name || filename.replace(/[-_]/g, ' '),
          folder: item.folder,
          metadata: item.initialMetadata || {},
          steps: [],
          ingredients: [],
          cookware: [],
          image: item.initialImage
        });
      })
    );

    // Sort alphabetically by recipe name
    recipes.sort((a, b) => a.name.localeCompare(b.name));
    return recipes;
  }

  /**
   * Recursively traverses Cook CLI directory tree or array to find leaf recipe files.
   * Accurately handles Cook CLI's directory structure where `children` is an object map of items.
   */
  private extractRecipePaths(data: unknown): RecipePathItem[] {
    if (!data) return [];
    const items: RecipePathItem[] = [];
    const visited = new Set<string>();

    const rootPath = (typeof data === 'object' && data !== null && typeof (data as Record<string, unknown>).path === 'string')
      ? ((data as Record<string, unknown>).path as string).replace(/\/+$/, '')
      : '';

    const traverse = (node: unknown, currentFolder = '') => {
      if (!node) return;

      // Plain string path e.g. "Kuchen.cook"
      if (typeof node === 'string') {
        const clean = node.trim().replace(/^\/+/, '');
        if (clean && !visited.has(clean)) {
          visited.add(clean);
          items.push({
            path: clean,
            name: clean.split('/').pop()?.replace(/\.cook$/i, '') || clean,
            folder: clean.includes('/') ? clean.split('/').slice(0, -1).join('/') : currentFolder || undefined
          });
        }
        return;
      }

      // Array of nodes
      if (Array.isArray(node)) {
        for (const child of node) {
          traverse(child, currentFolder);
        }
        return;
      }

      // Object node
      if (typeof node === 'object') {
        const obj = node as Record<string, unknown>;

        // 1. Check if children exists (can be an ARRAY or a MAP / OBJECT)
        if (obj.children) {
          let hasTraversedChildren = false;

          // If children is an Array
          if (Array.isArray(obj.children) && obj.children.length > 0) {
            hasTraversedChildren = true;
            const folderName = obj.name && obj.name !== 'recipes' ? String(obj.name) : '';
            const nextFolder = folderName ? (currentFolder ? `${currentFolder}/${folderName}` : folderName) : currentFolder;
            for (const child of obj.children) {
              traverse(child, nextFolder);
            }
          }
          // If children is an Object / Map (standard cook server format)
          else if (typeof obj.children === 'object' && obj.children !== null && Object.keys(obj.children).length > 0) {
            hasTraversedChildren = true;
            const folderName = obj.name && obj.name !== 'recipes' ? String(obj.name) : '';
            const nextFolder = folderName ? (currentFolder ? `${currentFolder}/${folderName}` : folderName) : currentFolder;
            for (const childNode of Object.values(obj.children)) {
              traverse(childNode, nextFolder);
            }
          }

          if (hasTraversedChildren) {
            return;
          }
        }

        // 2. Check if recipes exists (array or object)
        if (obj.recipes) {
          if (Array.isArray(obj.recipes) && obj.recipes.length > 0) {
            for (const child of obj.recipes) {
              traverse(child, currentFolder);
            }
            return;
          } else if (typeof obj.recipes === 'object' && obj.recipes !== null && Object.keys(obj.recipes).length > 0) {
            for (const child of Object.values(obj.recipes)) {
              traverse(child, currentFolder);
            }
            return;
          }
        }

        // 3. Leaf node with a path
        if (typeof obj.path === 'string' && obj.path.trim() !== '') {
          let rawPath = obj.path.trim();

          // If path is absolute from server root, calculate relative path
          if (rootPath && rawPath.startsWith(rootPath)) {
            rawPath = rawPath.slice(rootPath.length).replace(/^\/+/, '');
          } else if (rawPath.startsWith('/')) {
            rawPath = rawPath.split('/').pop() || rawPath;
          }

          // Skip root directory reference
          if (!rawPath || rawPath === '.' || rawPath === '/') {
            return;
          }

          if (!visited.has(rawPath)) {
            visited.add(rawPath);

            const rawRecipe = obj.recipe && typeof obj.recipe === 'object' ? (obj.recipe as Record<string, unknown>) : null;
            const rawMeta = rawRecipe && rawRecipe.metadata && typeof rawRecipe.metadata === 'object'
              ? (rawRecipe.metadata as Record<string, unknown>)
              : {};
            const title = (rawMeta.title as string) || (typeof obj.name === 'string' ? obj.name : rawPath.split('/').pop()?.replace(/\.cook$/i, '') || rawPath);
            const image = (rawMeta.image as string) || (rawMeta.picture as string) || undefined;

            items.push({
              path: rawPath,
              name: title,
              folder: rawPath.includes('/') ? rawPath.split('/').slice(0, -1).join('/') : currentFolder || undefined,
              initialMetadata: rawMeta,
              initialImage: image
            });
          }
          return;
        }

        // 4. Fallback dictionary keys
        for (const [key, val] of Object.entries(obj)) {
          if (['children', 'recipes', 'metadata', 'steps', 'ingredients', 'cookware', 'recipe'].includes(key)) {
            continue;
          }
          if (key.endsWith('.cook')) {
            const itemPath = currentFolder ? `${currentFolder}/${key}` : key;
            if (!visited.has(itemPath)) {
              visited.add(itemPath);
              items.push({
                path: itemPath,
                name: key.replace(/\.cook$/i, ''),
                folder: currentFolder || undefined
              });
            }
          } else if (typeof val === 'object' && val !== null) {
            traverse(val, currentFolder ? `${currentFolder}/${key}` : key);
          }
        }
      }
    };

    traverse(data);
    return items;
  }

  /**
   * Fetches full recipe detail
   */
  public async getRecipe(recipePath: string): Promise<Recipe | null> {
    const cleanPath = recipePath.replace(/^\/+/, '');
    const detailKey = `${STORAGE_KEYS.RECIPE_DETAIL_PREFIX}${cleanPath}`;

    // Try server first if reachable
    try {
      const encodedPath = cleanPath
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');

      const res = await this.fetchApi(`api/recipes/${encodedPath}`);

      if (res.ok) {
        this.setStatus('connected');
        const contentType = res.headers.get('content-type') || '';
        let recipeData: unknown;
        if (contentType.includes('application/json')) {
          recipeData = await res.json();
        } else {
          recipeData = await res.text();
        }

        const normalized = normalizeServerRecipe(recipeData, cleanPath);

        // Cache in localStorage
        try {
          localStorage.setItem(detailKey, JSON.stringify(normalized));
        } catch {
          // Ignore quota error
        }
        return normalized;
      }
    } catch {
      // Fallback to cache below
    }

    // Check localStorage cache
    try {
      const cached = localStorage.getItem(detailKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Check full list cache
      const listCache = localStorage.getItem(STORAGE_KEYS.RECIPES_CACHE);
      if (listCache) {
        const list: Recipe[] = JSON.parse(listCache);
        const match = list.find((r) => r.path === cleanPath || r.id === cleanPath);
        if (match) return match;
      }
    } catch {
      // Ignore
    }

    return null;
  }

  /**
   * Official Cook CLI endpoint:
   * PUT /api/recipes/{*path} creates or overwrites a recipe.
   * The body is the plain text content of the .cook file.
   */
  public async saveRecipeToServer(
    recipeNameOrPath: string,
    content: string
  ): Promise<{ success: boolean; path: string; error?: string }> {
    const trimmed = recipeNameOrPath.trim();
    if (!trimmed) {
      return { success: false, path: '', error: 'Recipe name cannot be empty' };
    }

    // Remove leading slashes and strip trailing .cook (Cook CLI automatically appends .cook)
    const cleanPath = trimmed
      .replace(/^\/+/, '')
      .replace(/\.cook$/i, '');

    const encodedPath = cleanPath
      .split('/')
      .map((segment) => encodeURIComponent(segment.trim()))
      .filter(Boolean)
      .join('/');

    try {
      const res = await this.fetchApi(`api/recipes/${encodedPath}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8'
        },
        body: content
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`Server returned HTTP ${res.status}: ${errorText || res.statusText}`);
      }

      this.setStatus('connected');
      return { success: true, path: cleanPath };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, path: cleanPath, error: msg };
    }
  }
  /**
   * Extract user-friendly error message from response
   */
  private async readErrorMessage(res: Response): Promise<string> {
    const text = await res.text().catch(() => '');
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.error === 'string') detail = parsed.error;
    } catch {
      // plain text body
    }
    if (res.status === 401) return 'Nicht autorisiert (401). Bitte Zugangsdaten in den Einstellungen prüfen.';
    if (res.status === 403) return 'Zugriff verweigert (403). Der Cook Server erlaubt diese Anfrage nicht.';
    if (res.status === 404) return 'Rezeptdatei auf dem Server nicht gefunden (404).';
    return `Server-Fehler (HTTP ${res.status})${detail ? `: ${detail}` : ''}`;
  }

  /**
   * GET /api/recipes/raw/{*path}
   * Fetches the raw .cook text directly from the server.
   * Never cached: editing requires fresh content directly from the remote server.
   */
  public async getRawRecipe(recipePath: string): Promise<string> {
    const cleanPath = recipePath.replace(/^\/+/, '');
    const encoded = encodeRecipePath(cleanPath);

    let res: Response;
    try {
      res = await this.fetchApi(`api/recipes/raw/${encoded}`, {
        cache: 'no-store',
        headers: { Accept: 'text/plain, */*' }
      });
    } catch (err) {
      this.setStatus('disconnected');
      throw err;
    }

    if (!res.ok) {
      if (res.status === 401) this.setStatus('error');
      const msg = await this.readErrorMessage(res);
      throw new Error(msg);
    }

    this.setStatus('connected');
    return res.text();
  }

  /**
   * Update an existing recipe file directly on the Cook CLI server.
   *
   * Local vs Remote handling:
   * 1. If baseContent is given and force is false, verifies remote content hasn't drifted.
   * 2. Issues PUT /api/recipes/{*path} with text/plain body.
   * 3. On success: clears local draft, updates local cache, and returns parsed Recipe.
   */
  public async updateRecipe(
    recipePath: string,
    content: string,
    baseContent?: string,
    options: { force?: boolean } = {}
  ): Promise<UpdateRecipeResult> {
    const cleanPath = recipePath.replace(/^\/+/, '');
    const encoded = encodeRecipePath(cleanPath);

    try {
      // Optimistic concurrency check: if someone else modified the recipe remotely
      if (!options.force && typeof baseContent === 'string') {
        const currentServerText = await this.getRawRecipe(cleanPath);
        if (normalizeEol(currentServerText) !== normalizeEol(baseContent)) {
          return { status: 'conflict', serverContent: currentServerText };
        }
      }

      const res = await this.fetchApi(`api/recipes/${encoded}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8'
        },
        body: content
      });

      if (!res.ok) {
        const errorMsg = await this.readErrorMessage(res);
        return { status: 'error', message: errorMsg, isOffline: false };
      }

      this.setStatus('connected');
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

    // Successfully saved remotely: clear local draft!
    this.clearDraft(cleanPath);

    // Re-fetch or parse recipe to update local cache
    const previous = this.getCachedRecipes().find((r) => r.path === cleanPath || r.id === cleanPath);
    let updatedRecipe = await this.getRecipe(cleanPath).catch(() => null);
    if (!updatedRecipe) {
      updatedRecipe = normalizeServerRecipe(content, cleanPath);
    }
    if (!updatedRecipe.image && previous?.image) {
      updatedRecipe.image = previous.image;
    }

    this.upsertCachedRecipe(updatedRecipe);
    return { status: 'saved', recipe: updatedRecipe, content };
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

  // ---- Authenticated Image Caching ----
  private imageBlobCache = new Map<string, string>();

  /**
   * Fetches an image using Cook API auth headers and returns a local blob URL.
   * Prevents browser native HTTP Basic Auth prompts from being triggered on images.
   */
  public async fetchImageBlob(src: string): Promise<string> {
    if (!src) return '';
    if (src.startsWith('data:') || src.startsWith('blob:')) return src;

    // Fremde Bild-Hosts (z. B. aus dem Rezept-Frontmatter) ohne Zugangsdaten direkt laden
    if (/^https?:\/\//i.test(src)) {
      try {
        if (new URL(src).origin !== new URL(this.serverUrl).origin) return src;
      } catch {
        return src;
      }
    }

    let fullUrl = src;
    if (!src.startsWith('http://') && !src.startsWith('https://')) {
      const base = this.serverUrl.replace(/\/+$/, '');
      fullUrl = `${base}/${src.replace(/^\/+/, '')}`;
    }

    if (this.imageBlobCache.has(fullUrl)) {
      return this.imageBlobCache.get(fullUrl)!;
    }

    try {
      const authHeaders = this.getAuthHeaders();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(fullUrl, {
        signal: controller.signal,
        credentials: 'omit',
        headers: {
          Accept: 'image/*,*/*',
          ...authHeaders
        }
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
