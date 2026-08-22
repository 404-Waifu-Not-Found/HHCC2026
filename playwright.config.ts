import { defineConfig } from "@playwright/test";

const baseURL = "http://localhost:8081";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL,
    browserName: "chromium",
    channel: "chrome",
    colorScheme: "light",
    reducedMotion: "reduce",
    locale: "en-US",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run web:e2e -w @clipquest/app",
    url: baseURL,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    // A cold Metro web bundle on a 2-vCPU CI runner can exceed the local
    // two-minute budget; give the dev server more headroom there.
    timeout: process.env.CI ? 360_000 : 120_000,
    env: {
      ...process.env,
      CI: "1",
      EXPO_PUBLIC_API_ORIGIN: baseURL,
    },
  },
});
