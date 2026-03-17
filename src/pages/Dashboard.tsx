import { useEffect, useRef, useState } from "react";
import { logActivity } from "../lib/activity-log";
import { signOut } from "../lib/auth";
import { supabase } from "../lib/supabase";

type SmokeStatus = "pending" | "ok" | "error";
type IntakeStatus = "idle" | "loading" | "ok" | "error";

const VALID_CATEGORIES = ["hero", "services", "testimonials", "about", "cta", "footer"] as const;
type Category = typeof VALID_CATEGORIES[number];

export default function Dashboard() {
  const [smokeStatus, setSmokeStatus] = useState<SmokeStatus>("pending");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const ran = useRef(false);

  const [intakeStatus, setIntakeStatus] = useState<IntakeStatus>("idle");
  const [intakeResult, setIntakeResult] = useState<{
    component_id: string;
    source_id: string;
    raw_source_artifact_location: string;
  } | null>(null);
  const [intakeError, setIntakeError] = useState<string | null>(null);

  // Form state
  const [componentName, setComponentName] = useState("");
  const [category, setCategory] = useState<Category>("cta");
  const [rightsStatus, setRightsStatus] = useState("assumed");
  const [jsonFile, setJsonFile] = useState<File | null>(null);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    logActivity("auth_test", null, null, { status: "ok" })
      .then(() => setSmokeStatus("ok"))
      .catch((err) => {
        setSmokeStatus("error");
        setErrorMsg(err?.message ?? String(err));
      });
  }, []);

  async function handleIntakeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!jsonFile) return;

    setIntakeStatus("loading");
    setIntakeResult(null);
    setIntakeError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("No active session");

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

      const formData = new FormData();
      formData.append("source_type", "elementor_json");
      formData.append("component_name", componentName);
      formData.append("category", category);
      formData.append("rights_status", rightsStatus);
      formData.append("acquisition_method", "manual_export");
      formData.append("json_file", jsonFile);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000);

      const intakeUrl = `${supabaseUrl}/functions/v1/gp-intake`;
      console.log("[gp-intake] fetching:", intakeUrl);

      let response: Response;
      try {
        response = await fetch(intakeUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: anonKey,
          },
          body: formData,
          signal: controller.signal,
        });
      } catch (fetchErr) {
        if ((fetchErr as Error)?.name === "AbortError") {
          throw new Error("Request timed out.");
        }
        throw fetchErr;
      } finally {
        clearTimeout(timeoutId);
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      setIntakeStatus("ok");
      setIntakeResult({
        component_id: data.component_id,
        source_id: data.source_id,
        raw_source_artifact_location: data.raw_source_artifact_location,
      });
    } catch (err) {
      setIntakeStatus("error");
      setIntakeError((err as Error)?.message ?? String(err));
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-50 px-4">
      <h1 className="text-3xl font-bold text-gray-900">GenePress — authenticated</h1>

      <p className="text-sm text-gray-500">
        Activity log smoke test:{" "}
        {smokeStatus === "pending" && <span className="text-gray-400">writing…</span>}
        {smokeStatus === "ok" && (
          <span className="font-medium text-green-600">
            ✓ row written to genepress_activity_log
          </span>
        )}
        {smokeStatus === "error" && (
          <span className="font-medium text-red-600">
            ✗ write failed{errorMsg ? `: ${errorMsg}` : ""}
          </span>
        )}
      </p>

      <form
        onSubmit={handleIntakeSubmit}
        className="flex w-full max-w-sm flex-col gap-3 rounded border border-gray-200 bg-white p-6 shadow-sm"
      >
        <h2 className="text-base font-semibold text-gray-800">Component Intake</h2>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Component name
          <input
            type="text"
            value={componentName}
            onChange={(e) => setComponentName(e.target.value)}
            required
            placeholder="e.g. Call To Action 538"
            className="rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {VALID_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Rights status
          <select
            value={rightsStatus}
            onChange={(e) => setRightsStatus(e.target.value)}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <option value="verified">verified</option>
            <option value="assumed">assumed</option>
            <option value="disputed">disputed</option>
            <option value="restricted">restricted</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          JSON file
          <input
            type="file"
            accept=".json"
            required
            onChange={(e) => setJsonFile(e.target.files?.[0] ?? null)}
            className="text-sm text-gray-600"
          />
        </label>

        <button
          type="submit"
          disabled={intakeStatus === "loading" || !jsonFile}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {intakeStatus === "loading" ? "Uploading…" : "Submit Intake"}
        </button>

        {intakeStatus === "ok" && intakeResult && (
          <div className="rounded border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            <p><span className="font-medium">component_id:</span> {intakeResult.component_id}</p>
            <p><span className="font-medium">source_id:</span> {intakeResult.source_id}</p>
            <p><span className="font-medium">storage path:</span> {intakeResult.raw_source_artifact_location}</p>
          </div>
        )}

        {intakeStatus === "error" && (
          <p className="text-sm font-medium text-red-600">
            ✗ Intake failed: {intakeError}
          </p>
        )}
      </form>

      <button
        onClick={signOut}
        className="rounded bg-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-300"
      >
        Sign out
      </button>
    </div>
  );
}
