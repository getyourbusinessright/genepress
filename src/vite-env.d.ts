/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_SENTRY_DSN: string;
  readonly ANTHROPIC_API_KEY: string;
  readonly VITE_FIGMA_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
