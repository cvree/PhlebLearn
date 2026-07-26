import { defineConfig } from "@playwright/test";

// verify (npm run verify) builds first and runs this against `vite preview`,
// which serves the production bundle under /PhlebLearn/ exactly like GitHub
// Pages does — see docs/DEPLOYMENT.md and docs/TESTING.md.
const PORT = 4175;
export const BASE_URL = `http://localhost:${PORT}/PhlebLearn/`;

export default defineConfig({
  testDir: "tests",
  timeout: 30000,
  retries: 0,
  // Every test in this suite drives a live WebGL context. Two headless
  // Chromium instances competing for the same software renderer makes
  // screenshots and bounding-box reads intermittently fail — a GPU-contention
  // artifact, not app behaviour. One worker keeps the suite deterministic.
  workers: 1,
  use: {
    baseURL: BASE_URL,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
