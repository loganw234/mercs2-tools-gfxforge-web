# Phase-0 spike results — runtime GFx API in Mercenaries 2

**Run:** 2026-07-26, live game, Ess v0.5.0, `ess_probe.gfx` (3707 bytes) injected as a new
asset into `vz-patch.wad` via `gfx_tool new`.

**Verdict: every capability the procedural Ess.UI design depends on works. No degradation
needed — the full design is on.**

## Raw result

```
cec=1;bw=120;bh=40;grad=1;ctf=1;tfm=1;tw=62;twe=62;th=14;atw=62;am=1;evt=1;nhd=521;rm=1;
```

## Reading it

| Key | Value | Meaning |
|---|---|---|
| `cec` | 1 | `createEmptyMovieClip` returns a usable clip |
| `bw` / `bh` | 120 / 40 | `getBounds` on the drawn clip reports exactly the geometry drawn (`moveTo`/`lineTo`/**`curveTo`**/`endFill` with `lineStyle` + `beginFill`). Real geometry reached the display list. |
| `grad` | 1 | `beginGradientFill` produced a filled shape with non-zero extents |
| `ctf` | 1 | `createTextField` created a field |
| `tfm` | 1 | `new TextFormat()` constructed |
| **`tw`** | **62** | **A runtime-created text field resolved the movie's *imported* `_normal_Font` and measured "PROBE0123" at 62px.** This was the load-bearing unknown. |
| `twe` | 62 | Same width with `embedFonts = true`, so it works either way |
| `th` | 14 | `textHeight` reports correctly (needed for auto-sizing) |
| **`atw`** | **62** | The **authored** control field measures the *same* 62px |
| `am` | 1 | `attachMovie("ProbeRow", …)` instantiated an `ExportAssets` symbol |
| `evt` | 1 | A runtime-assigned `onRelease` was retained and readable on the attached clip |
| `nhd` | 521 | `getNextHighestDepth` works |
| `rm` | 1 | `removeMovieClip` worked — the holder became `undefined` |

**The decisive detail is `atw == tw` (62 == 62).** A runtime-created field measured text
*identically* to an authored one. That isn't a coincidental non-zero; it's the same font,
resolved the same way. Font resolution on runtime fields was the single risk that would have
forced the design back to pooled `attachMovie` rows, and it's settled.

## Also newly proven: the movie → Lua channel

Nothing in the existing uilib kit uses `fscommand`, so that direction was entirely unverified.
It works:

```
EssProbe.ping()   -> ping sent=true
EssProbe.result() -> ping=1;  [events=1]
```

`fscommand("essProbe", …)` inside the movie reached
`widget:SetFlashEventHandler("essProbe", cb, {})` in Lua. Consequences:

- **Mouse support is viable** — a clicked row can tell Lua about it.
- **The load-readiness signal is viable** — a `load` handler can replace the blind 8-tick
  warm-up re-paint.
- It also confirms this codebase's `fscommand` lowering (`GetURL2` with an `FSCommand:` prefix)
  produces bytecode the real player accepts.

## Visual confirmation (from screenshots, after the fact)

Two screenshots of the live widget resolved something the harness could not.

**Before `RunProbe()`:** the orange header, `PROBE0123` (the authored control field), and
`(waiting)` — and **no panel background**, with the game's terrain showing through.

**After `RunProbe()`:** a dark navy rectangle has appeared over the left of the header bar.
Nothing authored is that colour or in that position, so **a procedurally drawn clip rendered
on screen.** That upgrades the drawing result from "`getBounds` says geometry exists at the
right size" to "it actually draws", which `getBounds` alone could not establish.

Two follow-ups fall out of it:

- **The stage background colour is never drawn in-game.** Expected — the HUD widget composites
  transparent, and `ui_panel.json` already works around it by making its first item an explicit
  `clip` filled `[24,26,31,235]`. Recording it here because the probe's missing background looks
  like a bug and isn't. **`ess_ui.gfx` must draw its own panel fill.**
- **`beginGradientFill` probably needs an explicit matrix.** The call in this probe passed none:
  `beginGradientFill("linear", [0x59D0FF, 0x1A1C22], [100, 100], [0, 255])`. A cyan→dark
  gradient should be obvious, and the visible rectangle is flat dark. Which of the two drawn
  clips is on screen is genuinely ambiguous from the screenshot — `probeHolder` was removed
  (`rm=1`) while `probeGrad` never was, so the survivor is most likely `probeGrad` rendering its
  gradient as a flat colour because the matrix defaulted to something degenerate. `grad=1` only
  checked that bounds were non-zero, so it would not have caught this. **Pass a matrix in Phase 1
  and confirm; don't assume gradients work from `grad=1` alone.**

## What is still NOT proven

Being explicit, because the temptation is to over-read a clean result:

1. **Mouse click *dispatch*.** `evt=1` proves the handler was assigned and is readable — not
   that a real click invokes it. The test harness drives a virtual *controller*, not a mouse,
   so this needs either a manual click or a different approach. **Do not build mouse
   interaction on the assumption it fires until this is checked.**
2. **Scale.** One clip, one text field, one attached row. Not 50 rows with pooling, which is
   what an unbounded list actually needs. Worth a second spike before Phase 3.
3. **AS2 payload size at runtime scale.** This movie's script is small. A full UI toolkit is a
   much larger `DoAction`; parse cost and load time are unmeasured.
4. **`setMask`**, used for list clipping/scrolling, wasn't exercised.
5. **Colour correctness.** A drawn clip demonstrably renders (see above), but nothing has
   verified that fills come out the *intended* colour, and the gradient looks like it did not.
   Solid fills and stroke colours are still only confirmed as geometry.
6. **Whether `removeMovieClip` clears the clip from the screen**, as opposed to just removing it
   from the AS2 namespace. `rm=1` only proved `_root.probeHolder == undefined`. If the visible
   rectangle turns out to be `probeHolder` rather than `probeGrad`, that distinction matters a
   lot for pooling, and the answer is the opposite of what `rm=1` suggests.

## Reproducing

```bash
node examples/mercs2/ess_probe.js          # -> ess_probe.gfx
# inject as a NEW asset, merging the existing patch:
gfx_tool new --wad vz.wad --name ess_probe --movie ess_probe.gfx \
             --out vz-patch.new.wad --merge vz-patch.wad
# then, in the live game (tools/lua_repl.py from the Ess repo):
#   --file examples/mercs2/ess_probe.lua
#   --code 'return EssProbe.start()'
#   --code 'return EssProbe.ping()'    ; --code 'return EssProbe.result()'
#   --code 'return EssProbe.run()'     ; --code 'return EssProbe.result()'
```
