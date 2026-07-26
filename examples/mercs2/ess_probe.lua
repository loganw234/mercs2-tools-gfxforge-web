-- Phase-0 spike driver for the Ess.UI rework. Pairs with ess_probe.js/.gfx.
--
-- Not an OnLoad/OnKey script: it's designed to be sent into the live game in
-- pieces through tools/lua_repl.py, so each stage's result can be read back
-- before the next one runs. That matters because the movie loads a frame late —
-- separate REPL calls give it time to be ready without needing a timer.
--
-- SHARED CONTRACT with ess_probe.js:
--   asset          "ess_probe"     -> SetSwfFile("ess_probe.gfx")
--   Lua -> movie   RunProbe()      runs every check
--   Lua -> movie   Ping()          proves the call channel alone
--   movie -> Lua   fscommand("essProbe", "<k=v;...>")
--   movie -> Lua   fscommand("essProbeClick", "row0")   (runtime onRelease)
--
-- Usage, one lua_repl call per stage:
--   1) EssProbe.start()    build the widget + register the handlers
--   2) EssProbe.ping()     confirm Lua -> movie works at all
--   3) EssProbe.run()      run the capability checks
--   4) EssProbe.result()   read the reported line back

import("MrxGuiBase")
import("MrxGuiManager")

_G.EssProbe = _G.EssProbe or {}
local P = _G.EssProbe

P.report = P.report or "(none)"
P.clicked = P.clicked or "(none)"
P.events = P.events or 0

-- Stage 1. Build the widget and register both event handlers BEFORE anything is
-- called into the movie, so no result can be missed.
function P.start()
    local okp, player = pcall(Player.GetLocalPlayer)
    local ok, w = pcall(function()
        local wg = MrxGuiBase.FlashWidget:new()
        if okp and player then pcall(function() wg:SetOwner(player) end) end
        -- SetLocation takes CORNER coords (x1,y1,x2,y2), not (x,y,w,h) -- the
        -- bug Ess.Gfx.widget exists to make unrepeatable.
        wg:SetLocation(40, 60, 40 + 320, 60 + 200)
        wg:SetSwfFile("ess_probe.gfx", nil, nil)
        MrxGuiBase.AddWidget(wg)
        if okp and player then pcall(function() MrxGuiManager.AddWidgetToHud(player, wg) end) end
        return wg
    end)
    if not ok or not w then return "widget FAILED" end
    P.w = w

    -- The movie -> Lua channel. This whole direction is unproven in this kit
    -- (nothing in uilib uses fscommand), so it's being tested here too, not
    -- assumed.
    pcall(function()
        w:SetFlashEventHandler("essProbe", function(_, v)
            P.report = tostring(v)
            P.events = P.events + 1
            Loader.Printf("[essprobe] report: " .. tostring(v))
        end, {})
    end)
    pcall(function()
        w:SetFlashEventHandler("essProbeClick", function(_, v)
            P.clicked = tostring(v)
            Loader.Printf("[essprobe] click: " .. tostring(v))
        end, {})
    end)

    pcall(function() w:SetVisible(true) end)
    return "widget ok"
end

local function call(fn)
    if not P.w then return false end
    return (pcall(function() P.w:CallActionScriptCallback(fn, {}) end)) and true or false
end

-- Stage 2. Proves Lua -> movie calls land at all. If the report comes back
-- "ping=1;" then the call channel AND the fscommand channel both work, which
-- separates a movie-side failure from a plumbing failure in stage 3.
function P.ping()
    P.report = "(none)"
    local ok = call("Ping")
    return "ping sent=" .. tostring(ok)
end

-- Stage 3. The capability checks.
function P.run()
    P.report = "(none)"
    local ok = call("RunProbe")
    return "run sent=" .. tostring(ok)
end

-- Stage 4. Read back what the movie said. Single line by construction, because
-- lua_repl truncates at the first newline.
function P.result()
    return tostring(P.report) .. "  [events=" .. tostring(P.events) .. " click=" .. tostring(P.clicked) .. "]"
end

-- Also write into the movie's own status field, so anyone watching the screen
-- sees the same answer the log gets.
function P.echo(s)
    if not P.w then return false end
    return (pcall(function() P.w:CallActionScriptCallback("SetStatus", { tostring(s) }) end)) and true or false
end

function P.teardown()
    if P.w then pcall(function() P.w:SetVisible(false) end) end
    P.w = nil
    return "torn down"
end

return "EssProbe loaded"
