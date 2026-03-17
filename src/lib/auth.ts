import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/**
 * Returns the currently authenticated Supabase user, or null if not signed in.
 */
export async function getCurrentUser(): Promise<User | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/**
 * Returns true if the given user has is_super_admin === true in their
 * raw_user_meta_data. This flag is set directly on the Supabase auth user
 * record and is the single source of truth for Super Admin access.
 */
export function isSuperAdmin(user: User | null): boolean {
  if (!user) return false;
  return user.user_metadata?.is_super_admin === true;
}

/**
 * Throws if the current user is not a Super Admin.
 * Use at the top of any server-side or async pipeline action that must be
 * gated to Super Admins only.
 */
export async function requireSuperAdmin(): Promise<User> {
  const user = await getCurrentUser();
  if (!isSuperAdmin(user)) {
    throw new Error("Access denied: Super Admin required.");
  }
  return user!;
}

/**
 * Signs the current user out and redirects to /login.
 * Safe to call from any context — swallows sign-out errors since the
 * redirect will clear client-side state regardless.
 */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut().catch(() => {});
  window.location.replace("/login");
}
