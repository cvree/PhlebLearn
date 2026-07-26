# Deployment

## GitHub Pages setup

- Repo: `cvree/PhlebLearn`, a **project page** (not a user/org root page), so
  it's served from `https://cvree.github.io/PhlebLearn/` — every path
  underneath that prefix.
- Pages config: legacy build, branch **`gh-pages`**, path `/`. `main` holds
  source only; the built `dist/` output is published to the root of the
  orphan-style `gh-pages` branch. Verify with:

  ```bash
  gh api repos/cvree/PhlebLearn/pages
  ```

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

The Pages source is the `gh-pages` branch at `/`, so the **built** files live
at the root of `gh-pages` while `main` keeps source only. The workflow:

1. On the feature branch: `npm run verify` passes.
2. Merge to `main` and push.
3. `npm run build`, then publish `dist/*` to the root of `gh-pages`:

   ```bash
   npm run build
   git worktree add ../phleblearn-pages gh-pages
   # replace the tracked files at the worktree root with dist/*, keep .nojekyll
   ```

   (A GitHub Actions workflow doing this on push to `main` would be an
   improvement, but a prior commit on this repo explicitly removed an
   Actions-based Pages deploy in favour of the simpler legacy static build;
   re-litigating that is out of scope for a gameplay branch.)
4. Push `gh-pages`.
5. Poll `gh api repos/cvree/PhlebLearn/pages/builds/latest` until
   `status: "built"`.
6. Load `https://cvree.github.io/PhlebLearn/` in a real browser and confirm
   it works (console clean, canvas renders, Clock In screen appears) — a
   200 response is not sufficient proof, per the base-path pitfall above.
