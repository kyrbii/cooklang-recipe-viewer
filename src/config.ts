/**
 * Build-time settings. The app does not let users change them, so a login always goes to the same server.
 */

/**
 * Rezept-API. Set VITE_API_URL when building for a server (the Docker build passes it in);
 * without it the app talks to the local API from api/ on port 8000.
 */
export const API_URL: string = import.meta.env.VITE_API_URL || 'http://localhost:8000';
