-- Phase-3 verification: Ess.UI.List retargeted onto ess_ui.gfx, and Ess.UI.Menu riding on
-- top of it UNCHANGED (49_ui_menu.lua was not edited -- it only ever used List's public API,
-- so if that held, Menu came along for free).
--
-- Send with tools/lua_repl.py --file, then run the stages.
--
--   P3.list()      a plain List with headers, to eyeball rows/selection/scrollbar/crumb/hint
--   P3.nav(n)      drive the cursor n steps DOWN through _keyvk, exactly as the heartbeat does
--   P3.wrap()      cursor wrap-around at both ends, and header skipping
--   P3.big()       900 items -- the scale case your spawn menu represents
--   P3.menu()      a small Ess.UI.Menu, drilling into a category
--   P3.api()       every documented List + Menu method, failures reported as text
--   P3.ease()      shrink then grow, to see the movie-side easing
--   P3.hide()      clean up

_G.P3 = _G.P3 or {}
local P3 = _G.P3

local function items()
    return {
        { header = "VEHICLES" },
        { label = "Tank", k = 1 },
        { label = "Humvee", k = 2 },
        { label = "Helicopter", k = 3 },
        { header = "INFANTRY" },
        { label = "Guerilla", k = 4 },
        { label = "Sniper", k = 5 },
        { header = "AIR" },
        { label = "Jet", k = 6 },
        { label = "Bomber", k = 7 },
        { label = "Gunship", k = 8 },
        { label = "Transport", k = 9 },
    }
end

function P3.list()
    if not (Ess and Ess.UI and Ess.UI.List) then return "Ess.UI not loaded" end
    P3.chosen, P3.backs = nil, 0
    P3.l = Ess.UI.List{
        x = 40, y = 60, title = "SPAWN", crumb = "SPAWN > root",
        hint = "UP/DOWN MOVE   ENTER PICK   LEFT BACK",
        items = items(), focus = true,
        onChoose = function(it) P3.chosen = it.label end,
        onBack = function() P3.backs = P3.backs + 1 end,
    }
    local it, i = P3.l:selected()
    return "list built; sel=" .. tostring(i) .. " (" .. tostring(it and it.label) .. ")"
        .. " -- headers must be skipped, so sel should be 2 not 1"
end

-- Drives the REAL key path (_keyvk with the real vk codes), not a shortcut, so this
-- exercises what the heartbeat does.
function P3.nav(n)
    if not P3.l then return "run P3.list() first" end
    n = tonumber(n) or 1
    for _ = 1, n do P3.l:_keyvk(Ess.UI.KEYS.down) end
    local it, i = P3.l:selected()
    return "after " .. n .. " down: sel=" .. tostring(i) .. " (" .. tostring(it and it.label)
        .. ") off=" .. tostring(P3.l._off)
end

-- NOTE on an earlier version of this test: it tried to reach an end by pressing up 30
-- times, then checked that one more press wrapped. That can never work -- the cursor wraps,
-- so repeated presses CYCLE through the selectable items rather than parking at an end.
-- (With 9 selectable items, 30 presses is just 30 mod 9 = 3 net steps.) The list was
-- behaving correctly and the test was wrong. Go to a known end explicitly instead.
function P3.wrap()
    if not P3.l then return "run P3.list() first" end
    local n = #P3.l._items
    -- first and last SELECTABLE indices (1 and 5 and 8 are headers)
    local first, last
    for i = 1, n do
        local it = P3.l._items[i]
        if it and not it.header then
            if not first then first = i end
            last = i
        end
    end
    P3.l:select(first)
    P3.l:_keyvk(Ess.UI.KEYS.up)
    local _, afterUp = P3.l:selected()
    P3.l:select(last)
    P3.l:_keyvk(Ess.UI.KEYS.down)
    local _, afterDown = P3.l:selected()
    local ok = (afterUp == last) and (afterDown == first)
    return "first=" .. first .. " last=" .. last
        .. " | up-from-first -> " .. afterUp .. " (want " .. last .. ")"
        .. " | down-from-last -> " .. afterDown .. " (want " .. first .. ")"
        .. " | " .. (ok and "WRAP OK" or "WRAP WRONG")
end

function P3.choose()
    if not P3.l then return "run P3.list() first" end
    P3.l:_keyvk(Ess.UI.KEYS.enter)
    return "chosen=" .. tostring(P3.chosen)
end

function P3.back()
    if not P3.l then return "run P3.list() first" end
    P3.l:_keyvk(Ess.UI.KEYS.esc)
    return "onBack fired " .. tostring(P3.backs) .. " time(s)"
end

-- The scale case. Your AllInOneSpawnMenu has 831 entries across 201 categories; a flat 900
-- is a harsher version of the same shape. The list is WINDOWED, so the movie should only
-- ever hold `rows` row clips no matter how big this gets.
function P3.big()
    if not P3.l then return "run P3.list() first" end
    local t = {}
    for i = 1, 900 do
        if i % 50 == 1 then t[#t + 1] = { header = "BLOCK " .. math.floor(i / 50 + 1) } end
        t[#t + 1] = { label = "Entry " .. i, k = i }
    end
    local t0 = Ess.Time and Ess.Time.now and Ess.Time.now() or 0
    P3.l:items(t)
    -- jump most of the way down so the scrollbar has to be near the end
    for _ = 1, 500 do P3.l:_keyvk(Ess.UI.KEYS.down) end
    local _, i = P3.l:selected()
    return "items=" .. #t .. " sel=" .. i .. " off=" .. P3.l._off
        .. " (scrollbar should sit near the bottom)"
end

function P3.small()
    if not P3.l then return "run P3.list() first" end
    P3.l:items(items())
    return "back to " .. #items() .. " items"
end

-- Shrink then grow, to watch the movie-side easing that replaced the Lua heartbeat lerp.
function P3.ease()
    if not P3.l then return "run P3.list() first" end
    P3.l:items({ { label = "one" }, { label = "two" } })
    return "shrunk to 2 -- run P3.small() to grow it back and watch it glide"
end

-- Ess.UI.Menu, UNCHANGED source, on the retargeted List.
function P3.menu()
    P3.hits = {}
    local m = Ess.UI.Menu{ title = "P3 MENU", id = "p3menu", key = "shift+f9" }
    m:entry("Plain entry", function(ctx) P3.hits[#P3.hits + 1] = "plain"; ctx:hint("plain picked") end)
    m:switch("A Toggle", function() return P3.tog end, function(v) P3.tog = v end)
    m:category("Vehicles", function(c)
        c:header("GROUND")
        c:entry("Tank", function(ctx) P3.hits[#P3.hits + 1] = "tank"; ctx:hint("tank") end)
        c:entry("Humvee", function(ctx) P3.hits[#P3.hits + 1] = "humvee" end)
        c:category("Air", function(cc)
            cc:entry("Jet", function(ctx) P3.hits[#P3.hits + 1] = "jet" end)
        end)
    end)
    P3.m = m
    m:open()
    return "menu opened; isOpen=" .. tostring(m:isOpen())
end

-- Drill into the category and pick something, through the real key path.
function P3.menuDrill()
    if not P3.m then return "run P3.menu() first" end
    local l = Ess.UI._S.menus.p3menu.list
    if not l then return "menu has no list" end
    -- move to the "Vehicles  >" row and enter it
    for _ = 1, 2 do l:_keyvk(Ess.UI.KEYS.down) end
    local it, i = l:selected()
    l:_keyvk(Ess.UI.KEYS.enter)
    local it2, i2 = l:selected()
    return "was sel=" .. i .. "(" .. tostring(it and it.label) .. ") now sel=" .. i2
        .. "(" .. tostring(it2 and it2.label) .. ") crumb should read 'P3 MENU > Vehicles'"
end

function P3.menuHits()
    return "hits=" .. table.concat(P3.hits or {}, ",") .. " toggle=" .. tostring(P3.tog)
end

function P3.api()
    local errs = {}
    local function try(label, fn)
        local ok, err = pcall(fn)
        if not ok then errs[#errs + 1] = label .. ": " .. tostring(err) end
    end
    local l = Ess.UI.List{ x = 380, y = 60, title = "API", items = items() }
    try("list:items", function() l:items(items()) end)
    try("list:selected", function() assert(select(2, l:selected()) ~= nil) end)
    try("list:select", function() l:select(3) end)
    try("list:paint", function() l:paint() end)
    try("list:title", function() l:title("T") end)
    try("list:crumb", function() l:crumb("C") end)
    try("list:hint", function() l:hint("H") end)
    try("list:_keyvk", function() l:_keyvk(Ess.UI.KEYS.down) end)
    try("list:show", function() l:show() end)
    try("list:hide", function() l:hide() end)
    try("list:focus", function() l:focus() end)
    try("list:blur", function() l:blur() end)
    try("list:destroy", function() l:destroy() end)
    local m = Ess.UI.Menu{ title = "API MENU", id = "p3api" }
    try("menu:entry", function() m:entry("a", function() end) end)
    try("menu:header", function() m:header("H") end)
    try("menu:switch", function() m:switch("s", function() return false end, function() end) end)
    try("menu:category", function() m:category("c", function(c) c:entry("x", function() end) end) end)
    try("menu:open", function() m:open() end)
    try("menu:isOpen", function() assert(m:isOpen() == true) end)
    try("menu:close", function() m:close() end)
    try("menu:toggle", function() m:toggle(); m:toggle() end)
    if #errs == 0 then return "API sweep: all OK" end
    return "API sweep FAILURES: " .. table.concat(errs, " | ")
end

function P3.hide()
    if P3.l then P3.l:hide() end
    if P3.m then P3.m:close() end
    local S = Ess.UI._S
    if S.menus then for _, rt in pairs(S.menus) do if rt.list then rt.list:hide() end end end
    return "hidden"
end

return "P3 loaded"
