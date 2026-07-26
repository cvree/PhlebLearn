#!/usr/bin/env node
/* Full pre-merge verification: unit tests -> production build -> Playwright
   smoke tests against that exact build (via `vite preview`). Run before
   merging any phase branch — see docs/TESTING.md. */
import { spawnSync } from "node:child_process";

function run(label, cmd, args){
  console.log(`\n▶ ${label}`);
  // shell:true + a single pre-joined string (not an args array) avoids Node's
  // shell-injection deprecation warning while still resolving `npm` on Windows.
  const result = spawnSync([cmd, ...args].join(" "), { stdio: "inherit", shell: true });
  if(result.status !== 0){
    console.error(`\n✗ ${label} failed (exit ${result.status})`);
    process.exit(result.status || 1);
  }
  console.log(`✓ ${label} passed`);
}

run("Unit tests (clinical rules, procedure state)", "npm", ["test"]);
run("Production build", "npm", ["run", "build"]);
run("Playwright smoke tests (against the production build)", "npm", ["run", "test:e2e"]);

console.log("\n✅ All verification checks passed.");
