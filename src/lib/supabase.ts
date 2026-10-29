import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

declare global {
  interface Window {
    __VARTALAAP_CONFIG__?: {
      supabaseUrl?: string;
      supabaseAnonKey?: string;
    };
  }
}

const supabaseUrl =
  window.__VARTALAAP_CONFIG__?.supabaseUrl ||
  (import.meta.env.VITE_SUPABASE_URL as string | undefined);
const supabaseAnonKey =
  window.__VARTALAAP_CONFIG__?.supabaseAnonKey ||
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
