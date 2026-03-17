import type { ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";

interface Props {
  children: ReactNode;
}

/**
 * Wraps any route that requires Super Admin access.
 *
 * - Shows a loading screen while auth state is resolving.
 * - useAuth handles the redirect to /login if the check fails.
 * - Only renders children once auth is confirmed.
 */
export default function ProtectedRoute({ children }: Props) {
  const { loading, isSuperAdmin } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  if (!isSuperAdmin) {
    // useAuth is already navigating to /login; render nothing while that happens.
    return null;
  }

  return <>{children}</>;
}
