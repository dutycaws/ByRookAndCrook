import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '$lib/database.types';

declare global {
  namespace App {
    interface Locals {
      supabase: SupabaseClient<Database>;
      getVerifiedUser: () => Promise<User | null>;
    }
  }
}

export {};
