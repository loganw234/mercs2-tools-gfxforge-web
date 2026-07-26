-- Phase-1 driver for ess_ui.gfx, the Ess.UI runtime movie.
--
-- Sent into the live game in pieces via tools/lua_repl.py (from the Ess repo),
-- so each stage's answer can be read before the next runs.
--
-- SHARED CONTRACT with ess_ui.js:
--   asset          "ess_ui"  -> SetSwfFile("ess_ui.gfx")
--   movie -> Lua   fscommand("essuiReady", "1")        movie finished loading
--                  fscommand("essui", "<k=v;...>")     diagnostics
--                  fscommand("essuiRow", "<id>:<i>")   a row was clicked
--
-- Stages:
--   EssUI.start()      build the widget + register handlers
--   EssUI.ready()      did the load signal arrive? (would replace warm-up repaints)
--   EssUI.diag()       run the movie's own diagnostics
--   EssUI.result()     read back whatever the movie last reported
--   EssUI.demo()       draw something LOOKABLE -- 12-line panel, rows, a bar
--   EssUI.theme(k, v)  push one theme override and redraw
--   EssUI.cyan()       a visible theme change, in one call
--   EssUI.mouse(on)    toggle opt-in mouse handlers, then click a row
--   EssUI.clicked()    what the last row click reported

import("MrxGuiBase")
import("MrxGuiManager")

_G.EssUI = _G.EssUI or {}
local U = _G.EssUI

U.report   = U.report   or "(none)"
U.click    = U.click    or "(none)"
U.readyAt  = U.readyAt  or nil
U.events   = U.events   or 0

local function call(fn, args)
    if not U.w then return false end
    return (pcall(function() U.w:CallActionScriptCallback(fn, args or {}) end)) and true or false
end
U.call = call

function U.start()
    local okp, player = pcall(Player.GetLocalPlayer)
    local ok, w = pcall(function()
        local wg = MrxGuiBase.FlashWidget:new()
        if okp and player then pcall(function() wg:SetOwner(player) end) end
        -- SetLocation takes CORNER coords, not (x, y, w, h)
        wg:SetLocation(0, 0, 640, 480)
        wg:SetSwfFile("ess_ui.gfx", nil, nil)
        MrxGuiBase.AddWidget(wg)
        if okp and player then pcall(function() MrxGuiManager.AddWidgetToHud(player, wg) end) end
        return wg
    end)
    if not ok or not w then return "widget FAILED" end
    U.w = w

    pcall(function()
        w:SetFlashEventHandler("essui", function(_, v)
            U.report = tostring(v); U.events = U.events + 1
            Loader.Printf("[essui] " .. tostring(v))
        end, {})
    end)
    pcall(function()
        w:SetFlashEventHandler("essuiRow", function(_, v)
            U.click = tostring(v)
            Loader.Printf("[essui] row click: " .. tostring(v))
        end, {})
    end)
    -- The load-readiness signal. The frame-1 PUSH is unreliable (it fires before
    -- this handler exists -- confirmed: readyAt came back nil), so the movie also
    -- exposes Ready() to be PULLED. Same handler serves both.
    pcall(function()
        w:SetFlashEventHandler("essuiReady", function(_, v)
            U.readyAt = tostring(v)
            Loader.Printf("[essui] READY " .. tostring(v))
        end, {})
    end)
    pcall(function()
        w:SetFlashEventHandler("essuiMetrics", function(_, v)
            U.metricsStr = tostring(v)
            Loader.Printf("[essui] metrics: " .. tostring(v))
        end, {})
    end)

    pcall(function() w:SetVisible(true) end)
    return "widget ok"
end

-- NOTE on ordering: the handler above is registered AFTER SetSwfFile, so if the
-- movie's frame-1 fscommand fires before registration completes this comes back
-- nil even though the movie is fine. A nil here is therefore evidence about
-- TIMING, not about whether the signal works at all -- which is exactly the
-- thing worth knowing before trusting it to replace the warm-up.
function U.ready()
    return "readyAt=" .. tostring(U.readyAt)
end

function U.diag()
    U.report = "(none)"
    return "diag sent=" .. tostring(call("Diag"))
end

function U.result()
    return tostring(U.report) .. "  [events=" .. tostring(U.events)
        .. " ready=" .. tostring(U.readyAt) .. " click=" .. tostring(U.click) .. "]"
end

function U.clicked()
    return "click=" .. tostring(U.click)
end

-- Something worth looking at: a panel with TWELVE lines (the old kit capped at
-- eight), a row list, and a bar. If the caps are really gone, lines 9-12 render.
function U.demo()
    call("DiagClean")
    call("Panel", { "p", 40, 60, 260, 200 })
    call("PanelTitle", { "p", "STATUS" })
    local labels = {
        "Health: 100", "Ammo: 240", "Fuel: 62%", "Heat: nominal",
        "Contracts: 3 open", "Faction: AN +120", "Zone: Maracaibo",
        "Line 8 -- old cap ended here",
        "Line 9  (was impossible)", "Line 10 (was impossible)",
        "Line 11 (was impossible)", "Line 12 (was impossible)",
    }
    for i = 1, #labels do call("PanelLine", { "p", i - 1, labels[i] }) end

    call("Rows", { "l", 330, 60, 220, 6 })
    call("PanelTitle", { "l", "PICK ONE" })
    call("RowSet", { "l", 0, "GROUP", true })
    call("RowSet", { "l", 1, "Alpha", false })
    call("RowSet", { "l", 2, "Bravo", false })
    call("RowSet", { "l", 3, "Charlie", false })
    call("RowSet", { "l", 4, "Delta", false })
    call("RowSet", { "l", 5, "Echo", false })
    call("RowSelect", { "l", 2 })

    -- The panel AUTO-FITS, so its height is whatever 12 lines needs:
    --   titleHeight 26 + padding 8 + 12*rowHeight 18 + padding/2 4 = 254
    -- Placing the bar at y=280 (as if the panel were still the 200 passed to
    -- Panel()) drew it straight through the panel's last two lines. Sitting it
    -- below the fitted height instead.
    --
    -- This is the real gap the overlap exposed: the caller has no way to ASK the
    -- movie how tall a fitted widget ended up, so it has to duplicate the
    -- layout arithmetic. Metrics() in the next movie build fixes that properly.
    call("Bar", { "b", 40, 60 + 254 + 10, 260, 34, "FUEL  62%", 0.62 })
    return "demo drawn: 12-line panel (auto-fit to 254px), 6 rows, 1 bar"
end

function U.theme(k, v)
    call("ThemeSet", { k, v })
    call("ThemeApply", {})
    return "theme " .. tostring(k) .. "=" .. tostring(v)
end

-- One visible theme change, to confirm a theme really is just data: cyan accent,
-- taller rows, bigger radius.
--
-- The gradient header is deliberately NOT part of this preset any more. The first
-- attempt turned it on together with a dark accentText, and the header rendered
-- dark -- so the title was dark-on-dark and unreadable, which made a theme bug
-- look like a rendering bug. Gradients now get their own isolated test
-- (U.grad()), and this preset keeps light title text so it stays legible.
function U.cyan()
    call("ThemeSet", { "accent", 0x59D0FF })
    call("ThemeSet", { "accentText", 0x10151A })
    call("ThemeSet", { "radius", 8 })
    call("ThemeSet", { "rowHeight", 22 })
    call("ThemeApply", {})
    return "cyan theme applied (rows should be 22px and aligned with their labels)"
end

-- Four large gradient swatches at different box-matrix rotations, labelled.
-- getBounds cannot tell a ramp from a flat fill, so this one is settled by eye.
function U.grad()
    call("Show", { "p", 0 }); call("Show", { "l", 0 }); call("Show", { "b", 0 })
    call("GradTest", {})
    return "4 gradient swatches drawn -- which ones actually ramp?"
end

function U.gradOff()
    call("GradTestClean", {})
    return "gradient test cleared"
end

-- Pull-based readiness, replacing the frame-1 push that fired before Lua's
-- handler existed. Poll this instead of blind warm-up re-painting.
function U.pollReady()
    U.readyAt = nil
    call("Ready", {})
    return "Ready() called -- readyAt=" .. tostring(U.readyAt)
end

-- Ask the movie how tall a widget actually ended up, instead of duplicating its
-- layout arithmetic in Lua (which is what put a bar through the 12-line panel).
function U.metrics(id)
    U.metricsStr = nil
    call("Metrics", { id })
    return "metrics=" .. tostring(U.metricsStr)
end

function U.classic()
    call("ThemeSet", { "accent", nil })
    call("ThemeSet", { "accentText", nil })
    call("ThemeSet", { "radius", nil })
    call("ThemeSet", { "rowHeight", nil })
    call("ThemeSet", { "gradientHeader", 0 })
    call("ThemeApply", {})
    return "classic theme restored (nil falls back to defaults)"
end

-- Mouse is OPT-IN. Handlers are only attached when the theme flag is set, and
-- rows must be rebuilt for existing ones to pick them up. Whether a real click
-- dispatches is the open question -- click a row after calling this, then check
-- EssUI.clicked().
function U.mouse(on)
    call("ThemeSet", { "hoverEnabled", on and 1 or 0 })
    -- force fresh row clips so the handlers get attached
    call("Show", { "l", 0 })
    call("Rows", { "lm", 330, 300, 220, 4 })
    call("PanelTitle", { "lm", on and "CLICK A ROW" or "MOUSE OFF" })
    call("RowSet", { "lm", 0, "Click me 0", false })
    call("RowSet", { "lm", 1, "Click me 1", false })
    call("RowSet", { "lm", 2, "Click me 2", false })
    call("RowSet", { "lm", 3, "Click me 3", false })
    return "mouse=" .. tostring(on and 1 or 0) .. " -- click a row, then EssUI.clicked()"
end

function U.hide()
    call("Show", { "p", 0 }); call("Show", { "l", 0 })
    call("Show", { "b", 0 }); call("Show", { "lm", 0 })
    call("DiagClean")
    if U.w then pcall(function() U.w:SetVisible(false) end) end
    return "hidden"
end

return "EssUI test driver loaded"
