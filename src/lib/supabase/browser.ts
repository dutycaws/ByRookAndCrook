import { createBrowserClient } from '@supabase/ssr';
import { PUBLIC_SUPABASE_PUBLISHABLE_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import type { Database } from '$lib/database.types';

let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined;

/** Return the cookie-backed Supabase client used by browser Realtime subscriptions. */
export function getSupabaseBrowserClient() {
  if (typeof window === 'undefined') {
    throw new Error('The Supabase browser client can only be used in the browser.');
  }

  browserClient ??= createBrowserClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  return browserClient;
}
