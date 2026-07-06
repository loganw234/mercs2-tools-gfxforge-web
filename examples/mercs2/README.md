# Mercenaries 2 — full battery test

A paired sample that authors a movie exercising **every** gfxforge-web capability
and drives it live in *Mercenaries 2: World in Flames*. Its main purpose is to
confirm, in the real GFx 2.x renderer, which of the **newer** features actually
render — the core (solid rects, text, buttons, menus, basic AVM1) is
byte-identical to the in-game-proven Python `gfxforge`, but rounded corners,
strokes, gradients, embedded bitmaps, and the extended compiler
(`for`/arrays/`break`/`continue`) have no independent reference.

| File | Role |
|---|---|
| `battery_test.js` | generates `battery.gfx` — all shape/fill variants, a bitmap, static + dynamic text, a named clip, a menu, and a full compiled AS2 program |
| `battery_test.lua` | host script — loads the movie, cycles values on a timer, runs the diagnostics, drives the menu from key input, handles the movie→Lua events |

Both files begin with the **shared contract** (asset name + the
function/variable/event/clip names they agree on).

## Deploy

```
node examples/mercs2/battery_test.js         # -> examples/mercs2/battery.gfx
```

Then inject `battery.gfx` as asset `battery` with your WAD tool and install the
host script (see the sibling `gfxforge` Python repo's `tools/pack.py`, which can
do generate/verify/round-trip/deploy in one step, or `gfx_tool` directly):

```
gfx_tool new --wad "<game>/data/vz.wad" --name battery --movie battery.gfx \
             --merge "<game>/data/vz-patch.wad" --out vz-patch.wad
copy /Y vz-patch.wad "<game>/data/vz-patch.wad"
copy battery_test.lua "<game>/scripts/OnKey/"
# then add to <game>/scripts/lua_loader.ini under [OnKey]:  battery_test.lua=delete
```

Launch, get in-world, press **Delete**. Delete again pauses/resumes the value
cycle; **up/down** move the menu selection, **enter** chooses.

## What each part proves

- **Static swatches** (SOLID / ROUNDED / STROKE / GRAD linear-V / linear-H /
  radial / combo / BITMAP) render on load — the direct read on the new vector +
  bitmap surface.
- **HEALTH / SELECT** updating → variable-bound dynamic text (host→movie).
- **SYNC bar** filling → an AVM1 function scaling a named `clip` (`_xscale`).
- **CALC = 12 / LIST** → the compiled `for` loop with `break`/`continue` and the
  `while` loop joining an **array** (proves the extended compiler).
- **Menu highlight** on up/down + **choose** on enter → `menu()` + compiled
  `Move`/`Choose`.
- Log lines `[battery] <- warn/choose/diag …` → the movie→Lua `fscommand` bridge.

Input uses the lua-loader key watch (`Loader.IsKeyDown`), so it works with no
native mouse/controller routing to a HUD widget.
