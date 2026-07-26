# Phase-1 results — the ess_ui runtime movie

**Run:** 2026-07-26, live game, Ess v0.5.0, `ess_ui.gfx` (18,623 bytes, 36 AS2 functions)
injected as a new asset into `vz-patch.wad`.

**Verdict: the procedural design works.** Panels, lists and bars are drawn entirely at runtime
from theme parameters, every capacity cap is gone, and a theme really is just data. Two features
did not survive contact: gradients don't render, and mouse input is not usable in-game.

---

## Confirmed working

| Capability | Evidence |
|---|---|
| Procedural panel / list / bar | Drawn and screenshotted — chrome, title bar, alternating row fills, selection highlight, progress fill |
| **Capacity caps gone** | A **12-line** panel rendered, lines 9–12 labelled "was impossible". The old kit hard-capped at 8. |
| Scale | `rows=50; ms=0` — 50 pooled rows built and populated in under 1 ms (getTimer resolution) |
| Pooling / reuse | `hid=0` → `regrow=1`: shrinking to 5 hid row 9, regrowing to 50 brought the same clip back. No leak, no re-creation. |
| Font in nested runtime fields | `rtxt=1; rtw=27` — a text field created inside a runtime clip inside a runtime clip resolves the imported font and measures correctly |
| `setMask` | `mask=1` — applied cleanly (needed for scroll clipping) |
| Panel alpha over the game | Screenshot shows the game's own HUD faintly through the panel at `panelAlpha 92` |
| **Theme as data** | `cyan()` changed accent, radius 4→8 and rowHeight 18→22 live, with no re-export |
| Theme reverts gracefully | `classic()` passes `nil` per key; `Metrics` went 134 → 158 → 134, so `nil` falls back to the default rather than drawing nothing |
| **`Ready()` pull** | `readyAt=1` — see below |
| **`Metrics(id)`** | `p:x=40;y=60;w=260;h=254;rows=12;kind=panel` — the real fitted height |

---

## Bug found and fixed: `ThemeApply` has to re-fit, not just repaint

The first `cyan()` attempt visibly broke the list — the selection highlight straddled *two* rows
and every label sat offset from its background.

Cause: `ThemeApply()` only called `Redraw()`. `Redraw()` paints row backgrounds at the current
`rowHeight`, but the row *clips* are positioned by `RowsFit()`/`PanelFit()`, which never re-ran.
So chrome moved to the new 22px geometry while the clips stayed on the old 18px.

Fixed by having `ThemeApply()` re-run the appropriate fit per widget kind. Also added
`RestyleText()`, because a pooled text field outlives the theme it was created under and kept its
original font size and box until it was re-pushed.

Verified arithmetically rather than by eye: a 6-row list reported `h=134` (26 + 6×18) before,
`h=158` (26 + 6×22) after, `h=134` again once reverted.

## Design gap found: the caller could not ask how tall a widget ended up

The first demo drew a bar straight through the middle of the 12-line panel. The panel had
auto-fit to 254px while the demo placed the bar as if it were still the 200px passed to
`Panel()`.

That is a real API gap, not just a demo bug — Lua would otherwise have to duplicate the movie's
layout arithmetic and stay in sync with it. `Metrics(id)` now reports the actual box.

## Design gap found: the readiness PUSH fires too early

`fscommand("essuiReady")` on frame 1 never arrived (`readyAt=nil`) even though everything else
worked, because Lua registers its handler *after* `SetSwfFile` returns. The signal fires into the
void.

Inverted to a PULL: Lua calls `Ready()` and waits for the reply, which is immune to registration
ordering. Confirmed working (`readyAt=1`). **This is what should replace `Ess.UI._WARMUP`'s
8-tick blind re-paint** — poll until it answers, then paint once.

---

## Not working: gradients

`beginGradientFill` renders **flat at every rotation tested** — 0, π/2, π and π/4 all produced
the same uniform slate, with no trace of the cyan stop. Tested with the mandatory 5th matrix
argument present (`{matrixType:"box", x, y, w, h, r}`), which the SDK explicitly supports
(`GFx_SpriteCreateGradient`, `GFxSprite.cpp`).

What was ruled out:

- **The missing-matrix bug.** Phase 0 called it with 4 args, which the SDK skips entirely
  (`fn.NArgs > 4`). Phase 1 passed 5. Still flat, so that was a real bug but not the only one.
- **Rotation.** Four angles, all identical.
- **Array shapes.** The SDK requires `colors`, `alphas` and `ratios` to be equal-length arrays of
  size > 0; all were length 2, with colours as `0xRRGGBB`, alphas 0–100 and ratios 0–255.

Remaining untested hypothesis: `GASGradientBoxMagicNumber` may scale the box so the visible band
samples a single point of the ramp. A real `Matrix` object would bypass the box path, but `Matrix`
is only registered inside the **`flash.geom` package**, not as a bare global, so it would need
`new flash.geom.Matrix()` to be reachable.

**Decision: parked.** Gradients are cosmetic, solid fills work perfectly, and this has already
cost two live tests. `gradientHeader` stays in the theme as a documented no-op rather than being
removed, so nothing breaks if it is ever fixed. If a gradient look is wanted before then, a few
stacked solid bands approximate one at no risk.

## Not usable: mouse input

More nuanced than a plain failure, and worth recording precisely:

- **`onRollOver` DOES fire.** Hovering a row changed its highlight. So the game genuinely feeds
  mouse *coordinates* into Flash widgets — the movie is receiving mouse movement.
- **...but only after alt-tabbing.** The game keeps the cursor captured for camera-look, so the
  OS cursor is not over the window during normal play. Mouse UI is unusable without a way to
  release it.
- **`onRelease` did NOT reach Lua.** `clicked()` returned `(none)`. Either button events aren't
  routed, or the click was consumed refocusing the window — the two cannot be separated from this
  run.
- **No native to release mouse capture exists** in Ess's native map. Searched for
  mouse/cursor/input/capture/menu/focus; the `LTIInput*` family are the options-menu screen's own
  handlers, not runtime input-mode control. `MrxGuiDialogBox._HandleMouseUpdate` shows the game
  does this for its *own* dialog class, so a mechanism exists somewhere, but it isn't exposed.

**Decision: mouse stays opt-in and off by default**, which is what was wanted anyway — plenty of
users would rather keep the mouse on camera-look and navigate with the arrow keys they already
use.

**The better lead for non-keyboard navigation is `FlashWidget:HandleLeftAnalogInput` /
`HandleRightAnalogInput`.** Those are on `FlashWidget` itself, which strongly suggests they are
how the game's own menus take controller input. Worth its own spike before any more mouse work.

---

## Reproducing

```bash
node examples/mercs2/ess_ui.js     # -> ess_ui.gfx
gfx_tool new --wad vz.wad --name ess_ui --movie ess_ui.gfx \
             --out vz-patch.new.wad --merge vz-patch.wad
# in the live game, via tools/lua_repl.py from the Ess repo:
#   --file examples/mercs2/ess_ui_test.lua
#   --code 'return EssUI.start()'      --code 'return EssUI.pollReady()'
#   --code 'return EssUI.diag()'       --code 'return EssUI.result()'
#   --code 'return EssUI.demo()'       --code 'return EssUI.metrics("p")'
#   --code 'return EssUI.cyan()'       --code 'return EssUI.classic()'
#   --code 'return EssUI.grad()'       --code 'return EssUI.mouse(true)'
```
