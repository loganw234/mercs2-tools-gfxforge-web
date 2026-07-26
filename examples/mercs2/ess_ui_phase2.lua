-- Phase-2 verification: the REAL Ess.UI.Panel / Bar / Toast, retargeted onto ess_ui.gfx.
--
-- Unlike ess_ui_test.lua (which drove the movie directly), this drives the PUBLIC Ess.UI
-- API exactly as a user's mod would. If these calls behave, existing scripts keep working.
--
-- Send with tools/lua_repl.py --file, then run the stages below.

_G.P2 = _G.P2 or {}
local P2 = _G.P2

-- Stage 1. The three retargeted widgets, driven only through their public API.
function P2.build()
    if not (Ess and Ess.UI and Ess.UI.Panel) then return "Ess.UI not loaded" end
    P2.p = Ess.UI.Panel{ x = 40, y = 60, title = "STATUS" }
    P2.p:line(0, "Health: 100")
    P2.p:line(1, "Ammo: 240")
    P2.p:line(2, "Fuel: 62%")
    P2.b = Ess.UI.Bar{ x = 40, y = 340, label = "FUEL  62%", value = 0.62 }
    return "built: panel + bar"
end

-- Stage 2. THE CAP TEST. The old ui_panel.gfx had eight text fields, so :line(8..) silently
-- did nothing and :fit() clamped at 8. Same public call, more lines.
function P2.caps()
    if not P2.p then return "run P2.build() first" end
    for i = 3, 13 do
        P2.p:line(i, "Line " .. (i + 1) .. (i >= 8 and "  <- past the old cap" or ""))
    end
    return "wrote lines 4..14 via the SAME public :line() API"
end

-- Stage 3. Ask the movie what it actually laid out, rather than trusting our arithmetic.
function P2.measure()
    if not P2.p then return "run P2.build() first" end
    P2.mw, P2.mh = nil, nil
    P2.p:measure(function(w, h) P2.mw, P2.mh = w, h end)
    return "measure requested"
end

function P2.measured()
    return "panel w=" .. tostring(P2.mw) .. " h=" .. tostring(P2.mh)
end

-- Stage 4. Toasts. TOAST_SLOTS was a ceiling (3 single-toast movies); now it's a tunable.
function P2.toasts()
    Ess.UI.Toast("First toast")
    Ess.UI.Toast("Second toast", { ttl = 20 })
    Ess.UI.Toast("Third one, deliberately long so the movie has to wrap it natively instead of Lua pre-cutting it to two lines", { ttl = 20 })
    return "3 toasts (slots=" .. tostring(Ess.UI.TOAST_SLOTS) .. ")"
end

function P2.moreToasts()
    -- Raising the tunable past 3 was impossible before: there were only three movies.
    Ess.UI.TOAST_SLOTS = 5
    Ess.UI.Toast("Fourth toast (slot 4)", { ttl = 20 })
    Ess.UI.Toast("Fifth toast (slot 5)", { ttl = 20 })
    return "TOAST_SLOTS raised to 5, two more toasts posted"
end

-- Stage 5. Theming through the documented user-facing route: assign, then apply.
function P2.theme()
    Ess.UI.Theme.accent = 0x59D0FF
    Ess.UI.Theme.accentText = 0x10151A
    Ess.UI.Theme.radius = 8
    Ess.UI.Theme.rowHeight = 22
    Ess.UI.Theme.apply()
    return "theme overridden via Ess.UI.Theme.<key> + apply()"
end

function P2.preset(name)
    Ess.UI.Theme.preset(name or "amber")
    return "preset applied: " .. tostring(name or "amber")
end

function P2.themeReset()
    Ess.UI.Theme.reset()
    return "theme reset to stock"
end

-- Stage 6. The load handshake. `queued` should be 0 and ready true once the movie is up;
-- the interesting number is WHICH path made it ready -- the engine logs that line.
function P2.rt()
    local S = Ess.UI._S
    local rt = S and S.rt
    if not rt then return "runtime not built yet" end
    return "ready=" .. tostring(rt.ready) .. " queued=" .. tostring(#rt.queue)
        .. " gfx=" .. tostring(rt.gfx ~= nil)
end

-- Stage 7. The API-compatibility sweep: every documented method on the three widgets, so a
-- signature that silently stopped working shows up as an error rather than a visual oddity.
function P2.api()
    local errs = {}
    local function try(label, fn)
        local ok, err = pcall(fn)
        if not ok then errs[#errs + 1] = label .. ": " .. tostring(err) end
    end
    local p = Ess.UI.Panel{ x = 380, y = 60, title = "API" }
    try("panel:title", function() p:title("API SWEEP") end)
    try("panel:line", function() p:line(0, "a") end)
    try("panel:fit", function() p:fit(3) end)
    try("panel:clear", function() p:clear() end)
    try("panel:show", function() p:show() end)
    try("panel:hide", function() p:hide() end)
    try("panel:focus", function() p:focus() end)
    try("panel:blur", function() p:blur() end)
    try("panel:destroy", function() p:destroy() end)
    local b = Ess.UI.Bar{ x = 380, y = 200, label = "B", value = 0.2 }
    try("bar:set", function() b:set(0.9) end)
    try("bar:label", function() b:label("BAR") end)
    try("bar:show", function() b:show() end)
    try("bar:hide", function() b:hide() end)
    try("bar:destroy", function() b:destroy() end)
    local t = Ess.UI.Toast("api toast", { ttl = 1 })
    try("toast:dismiss", function() t:dismiss() end)
    -- helpers that user scripts call directly and must keep working
    try("UI.wrap", function() assert(#Ess.UI.wrap("a b c", 3) >= 1) end)
    try("UI.comma", function() assert(Ess.UI.comma(1234567) == "1,234,567") end)
    try("UI.fmt_time", function() assert(Ess.UI.fmt_time(65) == "1:05") end)
    if #errs == 0 then return "API sweep: all OK" end
    return "API sweep FAILURES: " .. table.concat(errs, " | ")
end

function P2.hideAll()
    if P2.p then P2.p:hide() end
    if P2.b then P2.b:hide() end
    local S = Ess.UI._S
    if S and S.toasts then
        for i = 1, 8 do if S.toasts[i] then S.toasts[i]:dismiss() end end
    end
    return "hidden"
end

return "P2 loaded"
