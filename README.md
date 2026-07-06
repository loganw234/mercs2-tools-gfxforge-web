# gfxforge-web

A browser-based visual editor for authoring Scaleform GFx 2.x (`.gfx`) HUD
movies for Mercenaries 2 (PC) — no Adobe tools, no Python, no install. This is
a from-scratch JS port + significant extension of the original
[gfxforge](https://github.com/loganw234/mercs2-tools-gfxforge) Python library
and its tkinter editor.

Open `index.html` in a browser and go. Everything runs client-side: no
server, no build step required to *use* it (only to modify it — see below).

## What it does

- Place and edit rectangles, text fields, buttons, movie clips, and images on
  a canvas, with drag/resize, snapping, undo/redo, multi-select,
  align/distribute, and touch support.
- Solid or gradient fills (linear/radial), strokes, and rounded corners.
- Write behaviour in a small AS2-like scripting language (variables, `if`/
  `while`/`for`, functions, arrays, `fscommand`), compiled to real AVM1
  bytecode.
- **Play mode**: an actual AVM1 interpreter runs your script in-browser, so
  you can click buttons and manually call script functions to watch the
  stage update *before* ever loading it in the game.
- Export a ready-to-inject `.gfx` file, or save/load a JSON project file that
  a human (or an LLM) can hand-author directly.
- Autosave to `localStorage`, undo/redo, and a reference-image underlay for
  tracing against a real game screenshot.

## Running it

Just open `index.html`. That's the whole install process.

If you want a single self-contained HTML file instead (e.g. to email
someone, or paste into a tool that wants one file), see **Building the
bundle** below — `dist/gfxforge-editor.bundled.html` is a pre-built one,
already up to date as of this commit.

## File layout

```
index.html              the app shell — loads everything below in order
css/style.css            all styling
js/codec/                pure format/logic, no DOM access at all
  bitio.js                bit-level primitives: RECT, MATRIX, twips
  swf.js                  SWF/GFX tag encoders (shapes, text, buttons, sprites...)
  avm1.js                 AVM1 bytecode assembler (push, get/set, branches...)
  compiler.js              AS2-subset -> AVM1 compiler (lexer/parser/codegen)
  movie.js                the Movie authoring API (.rect(), .button(), .build()...)
  verify.js                structural validator for a built .gfx
  avm1-interpreter.js      executes compiled bytecode, for Play mode
  bitmap.js                image -> DefineBitsLossless2 (incl. a hand-rolled
                           zlib "stored block" encoder — see confidence notes)
js/editor/                DOM/canvas/UI logic
  project-io.js            state defaults, project JSON <-> editor state
  render.js                canvas drawing, state object, history (undo/redo)
  interaction.js            mouse/keyboard, selection, drag/resize/marquee
  touch.js                  touch equivalents (drag, pinch-zoom, double-tap)
  panels.js                 the Properties tab: all the field/fill/stroke editors
  layers-script.js          Layers tab, Script tab, movie-building
  play.js                   Play mode: button clicks, call-function panel, log
  reference-image.js        the tracing-reference underlay
  wiring.js                 toolbar/menu wiring, save/open/export, modals
  autosave.js               localStorage persistence
  init.js                   sample project, format-reference help text, boot
tests/                    Node-based test suite (see Testing below)
dist/                     pre-built single-file bundle (regenerate with build.sh)
build.sh / build.py       bundler: splices css/js into one HTML file
```

Load order in `index.html` matters (each module is a plain `<script>`, not an
ES module, deliberately — so it still works when opened via `file://` without
hitting CORS restrictions on `import`). Codec files load before editor files;
within each, dependencies load before their dependents. A few places
reference a later-loading module from *inside* a function body rather than a
top-level alias — that's always safe (function bodies only run after
everything's loaded), and it's commented at each spot where it's load-order
sensitive rather than just style.

## Building the bundle

```
./build.sh
```

Regenerates `dist/gfxforge-editor.bundled.html` from the current
`index.html` + `css/` + `js/`. Requires `python3` at build time only — the
output itself has zero dependencies, same as the split version. Run this
after editing anything under `css/` or `js/` if you want the bundle to stay
current.

## Testing

```
node tests/run.js
```

Runs the whole suite (100+ assertions across ~15 files) in a couple of
seconds — no browser, no dependencies beyond Node itself. It loads the real
source files (not the bundle) into a sandboxed `vm` context with a minimal
DOM stub, so it can exercise real application code without a browser. It
cannot exercise actual canvas pixels or real mouse/touch event dispatch —
what it verifies is everything DOM-independent: codec byte output, the
compiler, the AVM1 interpreter, project load/save, multi-select math,
autosave, and so on. Add new tests as `tests/suite.*.js`; each is picked up
automatically.

Two specific tests shell out to a real `python3` to cross-check output
against ground truth that isn't just "this code agrees with itself" — the
zlib compression (`suite.bitmap.js`) is verified against Python's actual
`zlib.decompress`. If `python3` isn't on your PATH those specific assertions
are skipped (logged, not silently ignored) rather than failing.

## Confidence notes — what's actually verified, and how

Being specific about this matters more here than in most projects, because
the whole point is generating a binary format for a game to load — a subtly
wrong byte is a silent bug, not a crash.

**Solid, byte-for-byte verified against the original Python library:**
`bitio.js`, `swf.js`'s original tag encoders, `avm1.js`, the original
compiler feature set, `movie.js`'s original rect/text/button/clip/menu path.
Every one of these was checked by generating the same output from both the
Python original and this port and diffing the hex byte-for-byte — not just
"looks right," but literally identical output. See git history / the
original port conversation for the methodology; the 54-case compiler
baseline in `tests/fixture.compiler-baseline.json` is a frozen snapshot of
that verification and is re-checked on every test run.

**New features, independently verified (no Python original to compare
against, since the original library didn't have these):**
- The scripting extensions (`for`/`break`/`continue`, compound assignment,
  arrays) and the AVM1 interpreter are verified by direct behavioural
  assertion — there's no reference AVM1 player available, so correctness
  rests on careful reading of the AVM1 bytecode spec plus extensive test
  coverage (`tests/suite.interpreter.js`, `tests/suite.scripting-features.js`).
- Rounded corners, strokes, and gradients (`defineShapeEx` in `swf.js`) are
  verified by an *independent* decoder (`tests/shape-decoder.js`, written
  from the SWF spec rather than by inverting the encoder) that reconstructs
  the geometry and checks it's correct — closed paths, control points at the
  right corners, gradient matrices landing ratio=0/255 at the right edges,
  etc. This is real verification, not circular, but it's still one person's
  reading of the spec rather than a second independent implementation.

**Least verified — treat as experimental:** image import
(`bitmap.js`/`DefineBitsLossless2`). The zlib container is cross-checked
against Python's real `zlib` and is solid. What is *not* independently
verified is the exact bitmap pixel format GFx expects (byte order, whether
alpha is premultiplied) — there's no reference renderer available to confirm
colors/transparency come out right in practice. If you rely on this for real
assets, check a test image in-engine first. The in-app Format Reference
(Format ref button in the toolbar) repeats this same note.

## Project JSON format

Click **Format ref** in the app for the full schema with examples — it's
also reproduced in `js/editor/init.js` (`buildHelpBody`). Field names
deliberately mirror the original Python library's keyword arguments
(`fill`, `var`, `label_color`, snake_case throughout) so it reads the same as
gfxforge's own README and is easy for an LLM to generate directly: describe
the HUD you want, ask for JSON in this format, paste it in with "Paste
JSON…" in the app.
