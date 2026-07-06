-- gfxforge-web — FULL BATTERY TEST (host side). Pairs with battery_test.js,
-- asset "battery". Drop in <game>/scripts/OnKey/ and bind a key in
-- lua_loader.ini ([OnKey] battery_test.lua=delete).
--
-- Get in-world, press Delete to build it; Delete again pauses/resumes the value
-- cycle. It drives every dynamic part so you can eyeball what actually renders:
--   * variable-bound text        SetHealth / (Move sets sel_val) / Diagnostics
--   * an AVM1-scaled bar         SetSync -> _root.bar._xscale
--   * compiled for/while/arrays  Diagnostics -> calc_val (=12) + list_val
--   * a compiled menu            Move / Choose / SetSelected (arrow keys + enter)
--   * movie -> Lua events        warn / choose / diag  (SetFlashEventHandler)
-- The static swatches (solid / rounded / stroke / gradients / bitmap) render on
-- their own the instant the movie loads; this script only exercises behaviour.
local KEYVAL = "delete"                        -- must be in the first 10 lines

import("MrxGuiBase")
import("MrxGuiManager")

local VK_UP, VK_DOWN, VK_ENTER = 0x26, 0x28, 0x0D   -- arrows + Enter (tune freely)
local CYCLE = 0.30                                    -- value-cycle interval (s)
local POLL  = 0.05                                    -- key-poll interval (s)
local LABELS = { [0] = "RESUPPLY", [1] = "AIRSTRIKE", [2] = "EVAC", [3] = "ABORT" }

_G.BATT = _G.BATT or { step = 0, paused = false }
local S = _G.BATT

local function call(fn, args)                  -- Lua -> movie (guarded)
  if S.w then pcall(function() S.w:CallActionScriptCallback(fn, args or {}) end) end
end

local function build()
  local player = Player.GetLocalPlayer()
  local w = MrxGuiBase.FlashWidget:new()
  pcall(function() w:SetOwner(player) end)
  w:SetLocation(20, 40, 540, 440)              -- 520x400 movie
  w:SetSwfFile("battery.gfx", nil, nil)
  MrxGuiBase.AddWidget(w)
  pcall(function() w:SetVisible(true) end)
  pcall(function() MrxGuiManager.AddWidgetToHud(player, w) end)
  S.w = w
  -- movie -> Lua events
  pcall(function() w:SetFlashEventHandler("warn", function(_, v)
    Loader.Printf("[battery] <- warn hp=" .. tostring(v))
  end, {}) end)
  pcall(function() w:SetFlashEventHandler("choose", function(_, v)
    Loader.Printf("[battery] <- choose i=" .. tostring(v) .. " (" .. tostring(LABELS[tonumber(v) or 0]) .. ")")
  end, {}) end)
  pcall(function() w:SetFlashEventHandler("diag", function(_, v)
    Loader.Printf("[battery] <- diag checksum=" .. tostring(v) .. " (expect 12)")
  end, {}) end)
  -- NOTE: do NOT call Diagnostics() here — SetSwfFile is async, so the movie's
  -- script hasn't defined it yet. It's called from the first timer tick (below),
  -- by which point the movie has loaded.
  return w
end

-- value cycle: HEALTH sweeps through <25 (fires warn), SYNC sweeps the bar
local function start_cycle()
  if S.cycleOn then return end
  S.cycleOn = true
  local function tick()
    Event.Create(Event.TimerRelative, { CYCLE }, tick)
    if not S.w then return end
    -- run the compiled for/while/array diagnostics once, now that the movie has
    -- loaded, so CALC (=12) and LIST populate.
    if not S.diagDone then S.diagDone = true; call("Diagnostics", {}) end
    if S.paused then return end
    S.step = (S.step or 0) + 1
    call("SetHealth", { 100 - (S.step * 11) % 100 })   -- number, so AS2 n<25 works
    call("SetSync",   { (S.step * 9) % 101 })           -- 0..100 -> bar._xscale
  end
  tick()
end

-- menu nav via the lua-loader key watch (edge-triggered)
local function start_keys()
  if S.keysOn then return end
  S.keysOn = true
  local pu, pd, pe = false, false, false
  local function poll()
    Event.Create(Event.TimerRelative, { POLL }, poll)
    if not S.w then return end
    local u, d, e = Loader.IsKeyDown(VK_UP), Loader.IsKeyDown(VK_DOWN), Loader.IsKeyDown(VK_ENTER)
    if u and not pu then call("Move", { -1 }) end
    if d and not pd then call("Move", { 1 }) end
    if e and not pe then call("Choose", {}) end
    pu, pd, pe = u, d, e
  end
  poll()
end

local ok, err = pcall(function()
  if not S.w then
    build(); S.paused = false
    start_cycle(); start_keys()
    Loader.Printf("[battery] built; cycle + key watch running (up/dn move, enter choose)")
  else
    S.paused = not S.paused
    call("Diagnostics", {})   -- re-run diagnostics too (so CALC/LIST fill without a relaunch)
    Loader.Printf("[battery] value cycle " .. (S.paused and "PAUSED" or "RESUMED"))
  end
end)
if not ok then Loader.Printf("[battery] ERROR: " .. tostring(err)) end
