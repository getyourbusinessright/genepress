import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { isSuperAdmin as checkSuperAdmin } from "../lib/auth";

interface AuthState {
  user: User | null;
  isSuperAdmin: boolean;
  loading: boolean;
}

/**
 * Single source of truth for auth state across the app.
 *
 * - Listens to onAuthStateChange so session is always in sync with Supabase.
 * - Redirects to /login if the user is not authenticated or not Super Admin.
 * - Exposes loading so callers can avoid rendering before auth resolves.
 */
export function useAuth(): AuthState {
  const navigate = useNavigate();
  const [state, setState] = useState<AuthState>({
    user: null,
    isSuperAdmin: false,
    loading: true,
  });

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const user = session?.user ?? null;
        const superAdmin = checkSuperAdmin(user);

        setState({ user, isSuperAdmin: superAdmin, loading: false });

        if (!user || !superAdmin) {
          navigate("/login", { replace: true });
        }
      },
    );

    return () => subscription.unsubscribe();
  }, [navigate]);

  return state;
}
