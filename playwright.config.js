import { defineConfig } from "@playwright/test";

// verify (npm run verify) builds first and runs this against `vite preview`,
// which serves the production bundle under /PhlebLearn/ exactly like GitHub
// Pages does — see docs/DEPLOYMENT.md and docs/TESTING.md.
const PORT = 4175;
export const BASE_URL = `http://localhost:${PORT}/PhlebLearn/`;

export default defineConfig({
  testDir: "tests",
  /* The unit suite and the browser suite share a directory, so the browser
     runner has to be told which is which. Without this, `npx playwright test`
     with no arguments picks up the node:test files too and fails on the first
     one that uses a node-only API — which looks exactly like a broken e2e
     test and is not one. */
  testMatch: /\.e2e\.spec\.js$|smoke\.spec\.js$/,
  /* Every test here drives a live WebGL context, and a runner with no GPU
     falls back to a software rasteriser that renders this scene at about 3
     frames a second — measured, and identical before and after the redesign,
     so it is a property of the machine rather than of the app. A gesture made
     of forty pointer samples is genuinely slow there, and 30 seconds was
     timing out on the runner rather than on anything the app did. */
  timeout: 90000,
  retries: 0,
  // Every test in this suite drives a live WebGL context. Two headless
  // Chromium instances competing for the same software renderer makes
  // screenshots and bounding-box reads intermittently fail — a GPU-contention
  // artifact, not app behaviour. One worker keeps the suite deterministic.
  workers: 1,
  use: {
    baseURL: BASE_URL,
    screenshot: "only-on-failure",
    // Some sandboxes ship a Chromium that Playwright did not download itself
    // (a different build number in a fixed location). Pointing at it is a
    // property of the MACHINE, not of this project, so it arrives as an
    // environment variable rather than a committed path — see docs/TESTING.md.
    launchOptions: {
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
      /* A runner with no GPU still has to produce a real WebGL context: every
         test here drives one, and a Chromium that silently refuses falls back
         to the accessible controls path, which looks exactly like a broken
         3D gesture and is not one. */
      args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
    },
  },
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    /* `npm run preview` builds first, and a cold build on a small runner takes
       longer than Playwright's 60-second default allows. */
    timeout: 120000,
  },
});
