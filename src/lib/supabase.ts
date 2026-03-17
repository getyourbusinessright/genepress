import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Single type-safe client — used for both auth operations and table queries.
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

// Alias for readability in data-layer code.
export const db = supabase;
