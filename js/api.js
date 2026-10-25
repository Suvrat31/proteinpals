// Picks the data backend: Supabase when configured, otherwise the in-browser demo.
// Both expose the same async interface (see supabase-api.js).
// Add ?demo to the URL to force demo mode, e.g. to try changes without touching real data.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isDemo = !SUPABASE_URL || !SUPABASE_ANON_KEY || new URLSearchParams(location.search).has('demo');

export const api = isDemo
  ? (await import('./local-api.js')).localApi
  : (await import('./supabase-api.js')).createSupabaseApi(SUPABASE_URL, SUPABASE_ANON_KEY);
