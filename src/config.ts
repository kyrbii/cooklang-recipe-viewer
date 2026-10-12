/**
 * Settings the app cannot change itself, so a login always goes to the same server.
 */

interface RuntimeConfig {
  apiUrl?: string;
}

/**
 * Written into /config.js when the Docker container starts (from its API_URL variable), so one
 * prebuilt image works for any server. public/config.js is the empty placeholder for development.
 */
const runtime: RuntimeConfig | undefined =
  typeof window !== 'undefined' ? (window as { STIR_CONFIG?: RuntimeConfig }).STIR_CONFIG : undefined;

/** Rezept-API. Order: container setting, VITE_API_URL at build time, then the local API from api/. */
export const API_URL: string = (runtime?.apiUrl || import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(
  /\/+$/,
  ''
);
