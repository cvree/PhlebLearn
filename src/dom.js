/* Tiny DOM accessors shared across every layer. Zero state, zero imports —
   sits alongside config.js/utils.js as a leaf module.
   `panel` is grabbed once at import time, same as the original monolith —
   safe because #panel is static markup in index.html, never recreated. */
export const $ = id => document.getElementById(id);
export const panel = document.getElementById("panel");
