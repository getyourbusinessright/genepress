import { useEffect, useRef, useState } from "react";
import { logActivity } from "../lib/activity-log";
import { signOut } from "../lib/auth";

type SmokeStatus = "pending" | "ok" | "error";

export default function Dashboard() {
  const [smokeStatus, setSmokeStatus] = useState<SmokeStatus>("pending");
  const ran = useRef(false);

  useEffect(() => {
    // Guard against StrictMode double-invoke
    if (ran.current) return;
    ran.current = true;

    logActivity("auth_test", null, null, { status: "ok" })
      .then(() => setSmokeStatus("ok"))
      .catch(() => setSmokeStatus("error"));
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-50">
      <h1 className="text-3xl font-bold text-gray-900">GenePress — authenticated</h1>

      <p className="text-sm text-gray-500">
        Activity log smoke test:{" "}
        {smokeStatus === "pending" && <span className="text-gray-400">writing…</span>}
        {smokeStatus === "ok" && <span className="font-medium text-green-600">✓ row written to genepress_activity_log</span>}
        {smokeStatus === "error" && <span className="font-medium text-red-600">✗ write failed — check Sentry</span>}
      </p>

      <button
        onClick={signOut}
        className="rounded bg-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-300"
      >
        Sign out
      </button>
    </div>
  );
}
