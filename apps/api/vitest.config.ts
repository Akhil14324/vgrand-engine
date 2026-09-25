import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // env.ts refuses to boot without Supabase config — the tests only need
    // values that parse, not real credentials.
    env: {
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      API_PUBLIC_URL: "http://localhost:4000",
    },
  },
});
