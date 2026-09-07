import { env } from '$env/dynamic/public';

export function getSupabaseConfig(): { url: string; publishableKey: string } {
  const url = env.PUBLIC_SUPABASE_URL;
  const publishableKey = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      'Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_PUBLISHABLE_KEY. See docs/development.md.'
    );
  }

  return { url, publishableKey };
}
