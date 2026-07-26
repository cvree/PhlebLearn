# Third-Party Licenses

Everything Tiny Vials depends on that we did not write, and the licence it is
used under. Kept alongside `docs/ASSET_SOURCES.md`, which covers art and audio.

Last verified against the installed tree: **2026-07-26**.

---

## Shipped in the production bundle

These end up inside `dist/` and are served to every player.

| Package | Version | Licence | Role |
|---|---|---|---|
| [three](https://github.com/mrdoob/three.js) | 0.185.1 | MIT | WebGL renderer, scene graph, geometry and material primitives. Bundled as its own chunk (`vite.config.js` → `manualChunks.three`). |

`three`'s MIT licence permits redistribution and modification with the copyright
notice retained; the notice travels inside the bundled source. `GLTFLoader`
(`three/addons/loaders/GLTFLoader.js`) is part of the same MIT-licensed
distribution.

## Loaded at runtime from a CDN (progressive enhancement)

These are `<script>` tags in `index.html` with `onerror` fallbacks. The game is
fully playable without any of them — they add motion polish only, and none is
required by the venipuncture gameplay.

| Library | Version | Licence | Role | If blocked |
|---|---|---|---|---|
| [GSAP](https://gsap.com/) | 3.12.5 (cdnjs) | GreenSock standard "No Charge" licence — covers this non-commercial educational use | Panel and prop tweens (`src/fx.js`) | Animations are skipped; every code path has a non-GSAP branch |
| [Lenis](https://github.com/darkroomengineering/lenis) | 1.0.42 (jsDelivr) | MIT | Smooth scrolling in long panels | Native scrolling |
| [Vanta.js](https://www.vantajs.com/) (fog effect) | 0.5.24 (cdnjs) | MIT | Animated backdrop on the loading screen | Static background |

> **Open item.** GSAP is the only dependency whose licence is not a plain
> permissive OSS licence, and GreenSock's terms have changed more than once.
> Re-check <https://gsap.com/licensing/> before any commercial distribution.
> It is used for decorative motion only, and every call site already has a
> non-GSAP branch, so dropping it is always an option.

## Development only (never shipped)

| Package | Version | Licence | Role |
|---|---|---|---|
| [vite](https://vitejs.dev/) | 5.4.21 | MIT | Dev server and production bundler |
| [@playwright/test](https://playwright.dev/) | 1.62.0 | Apache-2.0 | Browser acceptance tests |

Transitive dev dependencies are recorded in `package-lock.json`. To regenerate a
full report:

```bash
npx license-checker --production --summary
```

---

## Art and audio

Covered in [docs/ASSET_SOURCES.md](./ASSET_SOURCES.md). Summary: all gameplay
geometry and every texture is generated at runtime by code in this repository
and carries no third-party licence obligation. The single external media file is
`public/assets/audio/lobby.mp3`, whose provenance is **unverified** and which is
flagged there as an open item.

## Fonts

No web fonts are loaded. The UI uses the platform font stack (`Nunito` if the
system provides it, then `-apple-system`, `system-ui`, `Segoe UI`,
`sans-serif`), and canvas-drawn equipment labels use
`ui-sans-serif, system-ui, sans-serif`. Nothing is downloaded, so nothing is
redistributed.
