/* =========================================================================
   FOCUS, FOR THE FOUR FULL-SCREEN OVERLAYS.

   Settings, the shop, the sticker book and "How this works" are modal in
   every respect that matters — a dimmed backdrop, Esc closes them, clicking
   outside closes them — except the one a keyboard notices. Opening one left
   focus on the button behind it, so the first Tab walked into the game
   underneath: the Recenter button, the coach panel, the canvas. Closing it
   dropped focus on `<body>`, so the next Tab started again from the top of
   the document rather than from the control the player had just used.

   Three rules, and nothing else:

     · opening moves focus into the card,
     · Tab and Shift-Tab stay inside it,
     · closing puts focus back on whatever opened it.

   A dependency LEAF, like dom.js: no imports beyond the DOM, so any overlay
   can use it without a cycle.
   ========================================================================= */

/* `details > summary` is in here because the challenge picker is one, and it
   is the only way into "Make it harder" from the keyboard. */
const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled])",
  "select:not([disabled])", "textarea:not([disabled])",
  "details > summary", '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Which element had focus when each overlay was opened. */
const openers = new WeakMap();

function focusables(el){
  // offsetParent is null for anything display:none — inside a collapsed
  // <details>, or in an overlay that is not showing.
  return [...el.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent !== null);
}

function focus(el){
  if(!el) return;
  try{ el.focus({ preventScroll: true }); }catch(_){ try{ el.focus(); }catch(__){} }
}

function onKey(e){
  if(e.key !== "Tab") return;
  const el = e.currentTarget;
  const items = focusables(el);
  if(!items.length) return;
  const first = items[0], last = items[items.length - 1];
  const at = document.activeElement;
  // Wrap at both ends, and pull focus back in if it has escaped entirely
  // (which happens when the element that had it was replaced by a re-render).
  if(!el.contains(at)){ e.preventDefault(); focus(e.shiftKey ? last : first); return; }
  if(e.shiftKey && at === first){ e.preventDefault(); focus(last); }
  else if(!e.shiftKey && at === last){ e.preventDefault(); focus(first); }
}

/**
 * Call immediately AFTER the overlay is shown.
 *
 * Idempotent: the shop re-renders itself in place on every purchase and calls
 * this again, and the second call must not record the buy button that has
 * since been thrown away as the thing to return focus to.
 *
 * @param {HTMLElement} el       the overlay (the backdrop, not the card)
 * @param {string} [label]       accessible name for the dialog
 */
export function overlayOpened(el, label){
  if(!el) return;
  const reopened = openers.has(el);
  if(!reopened){
    openers.set(el, document.activeElement);
    el.addEventListener("keydown", onKey);
  }
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  if(label) el.setAttribute("aria-label", label);
  // On a re-render, only take focus if the element holding it has just been
  // destroyed — otherwise the player is typing into something and we would
  // yank the cursor out of it.
  if(reopened && el.contains(document.activeElement)) return;
  focus(focusables(el)[0]);
}

/** Call immediately AFTER the overlay is hidden. */
export function overlayClosed(el){
  if(!el || !openers.has(el)) return;
  el.removeEventListener("keydown", onKey);
  const prev = openers.get(el);
  openers.delete(el);
  el.removeAttribute("aria-modal");
  if(prev && prev !== document.body && document.contains(prev)) focus(prev);
}
