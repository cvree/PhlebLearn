# Deployment

## GitHub Pages setup

- Repo: `cvree/PhlebLearn`, a **project page** (not a user/org root page), so
  it's served from `https://cvree.github.io/PhlebLearn/` — every path
  underneath that prefix.
- Pages config: legacy build, branch `main`, path `/` (serves whatever is
  committed at the repo root — currently that means we commit the **built**
  `dist/` output to the repo root, not source files).

## Build

```bash
npm install
npm run build
```

Outputs to `dist/`:
- `dist/index.html`
- `dist/assets/build/*.js` / `*.css` (hashed, cache-busted)
- `dist/assets/audio/`, `dist/assets/models/`, `dist/assets/textures/`,
  `dist/assets/icons/` (copied verbatim from `public/assets/`)
- `dist/phlebshift3dlab.html` (a redirect stub to `./`, preserving the old
  bookmarked URL from before Phase 0 — see `public/phlebshift3dlab.html`)

## The base-path pitfall (read this before touching `vite.config.js`)

`vite.config.js` sets `base: "/PhlebLearn/"` **unconditionally** — not
`command === "build" ? "/PhlebLearn/" : "/"`. That conditional looks
reasonable and is wrong: `vite preview` does not report `command: "build"`
when it re-reads the config, so a conditional base silently makes `vite
preview` serve everything at `/` while `dist/index.html` (built with the
`/PhlebLearn/` prefix baked into every asset URL) requests
`/PhlebLearn/assets/build/...`. The preview server's SPA fallback then
returns `index.html` with a **200 status** for those requests — so a naive
check ("did the page return 200?") passes while the app is actually
completely broken (blank canvas, no JS ever executes). This exact bug shipped
partway through Phase 0 and was only caught by testing the real preview
server, not just `npm run build`'s exit code — see `docs/TESTING.md`.

Local dev gets `/` back via an explicit CLI override instead:
`"dev": "vite --base /"` in `package.json`. `--base` on the command line wins
over the config file, so dev stays at `http://localhost:5173/` for
convenience while build and preview both consistently use `/PhlebLearn/`.

## Verifying before merge

```bash
npm run verify
```

Runs, in order: unit tests → production build → Playwright smoke tests
**against that exact build** via `vite preview`. See `docs/TESTING.md`.

## Publishing to GitHub Pages

The Pages source is `main` branch, `/` path — meaning the **built** files
need to live at the repo root on `main`, not `src/`. The workflow:

1. On the feature/refactor branch: `npm run verify` passes.
2. Merge to `main`.
3. Build (`npm run build`) and copy `dist/*` to the repo root, replacing the
   previous build output. (A future improvement would be a GitHub Actions
   workflow that does this on push to `main` — deliberately not added in
   Phase 0, since a prior commit on this repo explicitly removed an
   Actions-based Pages deploy in favor of the simpler legacy static build;
   changing that decision again is out of scope here.)
4. Push `main`.
5. Poll `gh api repos/cvree/PhlebLearn/pages/builds/latest` until
   `status: "built"`.
6. Load `https://cvree.github.io/PhlebLearn/` in a real browser and confirm
   it works (console clean, canvas renders, Clock In screen appears) — a
   200 response is not sufficient proof, per the base-path pitfall above.
