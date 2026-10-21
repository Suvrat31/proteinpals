// Picks the data backend: Supabase when configured, otherwise the in-browser demo.
// Both expose the same async interface (see supabase-api.js).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isDemo = !SUPABASE_URL || !SUPABASE_ANON_KEY;

export const api = isDemo
  ? (await import('./local-api.js')).localApi
  : (await import('./supabase-api.js')).createSupabaseApi(SUPABASE_URL, SUPABASE_ANON_KEY);
