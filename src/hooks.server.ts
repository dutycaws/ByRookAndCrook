import { createServerClient } from '@supabase/ssr';
import type { Handle } from '@sveltejs/kit';
import { getSupabaseConfig } from '$lib/server/config';
import type { Database } from '$lib/database.types';

export const handle: Handle = async ({ event, resolve }) => {
  const { url, publishableKey } = getSupabaseConfig();

  event.locals.supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll: () => event.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          event.cookies.set(name, value, {
            ...options,
            path: '/',
            secure: event.url.protocol === 'https:'
          });
        }
      }
    }
  });

  let userPromise: ReturnType<typeof event.locals.supabase.auth.getUser> | undefined;
  event.locals.getVerifiedUser = async () => {
    userPromise ??= event.locals.supabase.auth.getUser();
    const { data, error } = await userPromise;
    return error ? null : data.user;
  };

  return resolve(event, {
    filterSerializedResponseHeaders(name) {
      return name === 'content-range' || name === 'x-supabase-api-version';
    }
  });
};
