import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Standard client — used for auth operations.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Type-safe database client — use for all table queries so TypeScript
// enforces column names, insert shapes, and return types.
export const db = createClient<Database>(supabaseUrl, supabaseAnonKey);
