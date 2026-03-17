import { useEffect, useRef, useState } from "react";
import { logActivity } from "../lib/activity-log";
import { signOut } from "../lib/auth";
import { supabase } from "../lib/supabase";

type SmokeStatus = "pending" | "ok" | "error";
type IntakeStatus = "idle" | "loading" | "ok" | "error";

// Small sample of the call538 CTA component Elementor JSON
const SAMPLE_CALL538_JSON = {
  content: [
    {
      id: "call538sec",
      elType: "section",
      settings: {
        structure: "20",
        background_color: "#FFFFFF",
        padding: { unit: "px", top: "80", right: "40", bottom: "80", left: "40" },
      },
      elements: [
        {
          id: "call538col1",
          elType: "column",
          settings: { _column_size: 50 },
          elements: [
            {
              id: "call538h1",
              elType: "widget",
              widgetType: "heading",
              settings: {
                title: "Ready to Get Started?",
                title_color: "#1A1A1A",
                typography_font_size: { unit: "px", size: 42 },
                typography_font_weight: "700",
              },
            },
            {
              id: "call538txt",
              elType: "widget",
              widgetType: "text-editor",
              settings: {
                editor: "<p>Take your business to the next level with our proven solutions.</p>",
              },
            },
          ],
        },
        {
          id: "call538col2",
          elType: "column",
          settings: { _column_size: 50 },
          elements: [
            {
              id: "call538btn",
              elType: "widget",
              widgetType: "button",
              settings: {
                text: "Book a Call",
                background_color: "#0066FF",
                border_radius: { unit: "px", size: 8 },
                typography_font_size: { unit: "px", size: 16 },
              },
            },
          ],
        },
      ],
    },
  ],
};

export default function Dashboard() {
  const [smokeStatus, setSmokeStatus] = useState<SmokeStatus>("pending");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const ran = useRef(false);

  const [intakeStatus, setIntakeStatus] = useState<IntakeStatus>("idle");
  const [intakeResult, setIntakeResult] = useState<{
    component_id: string;
    source_id: string;
  } | null>(null);
  const [intakeError, setIntakeError] = useState<string | null>(null);

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

  async function handleTestIntake() {
    setIntakeStatus("loading");
    setIntakeResult(null);
    setIntakeError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("No active session");

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const response = await fetch(`${supabaseUrl}/functions/v1/gp-intake`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          source_type: "elementor_json",
          component_name: "Call To Action 538",
          category: "cta",
          json_content: SAMPLE_CALL538_JSON,
          rights_status: "assumed",
          acquisition_method: "manual_export",
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      setIntakeStatus("ok");
      setIntakeResult({
        component_id: data.component_id,
        source_id: data.source_id,
      });
    } catch (err) {
      setIntakeStatus("error");
      setIntakeError((err as Error)?.message ?? String(err));
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-50">
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

      <div className="flex flex-col items-center gap-3">
        <button
          onClick={handleTestIntake}
          disabled={intakeStatus === "loading"}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {intakeStatus === "loading" ? "Submitting…" : "Test Intake"}
        </button>

        {intakeStatus === "ok" && intakeResult && (
          <div className="rounded border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            <p>
              <span className="font-medium">component_id:</span> {intakeResult.component_id}
            </p>
            <p>
              <span className="font-medium">source_id:</span> {intakeResult.source_id}
            </p>
          </div>
        )}

        {intakeStatus === "error" && (
          <p className="text-sm font-medium text-red-600">
            ✗ Intake failed: {intakeError}
          </p>
        )}
      </div>

      <button
        onClick={signOut}
        className="rounded bg-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-300"
      >
        Sign out
      </button>
    </div>
  );
}
