-- Phase-4 verification: Confirm, Input, Chat and Board retargeted onto ess_ui.gfx.
-- Everything is driven through the PUBLIC Ess.UI API, as a user's mod would.
--
--   P4.confirm()    modal yes/no -- then P4.pick()/P4.enter() to answer it
--   P4.longConfirm() a message longer than the old 2-line cap
--   P4.input()      typed prompt -- P4.type("hello") then P4.enter()
--   P4.chat()       message log -- P4.say(n) pushes n lines
--   P4.board()      two-pane board, now a composition
--   P4.boardNav()   drive the board's list through its own _keyvk
--   P4.api()        every documented method on all four, failures as text
--   P4.hide()       clean up

_G.P4 = _G.P4 or {}
local P4 = _G.P4

local function key(vk)
    local f = Ess.UI._S.focus
    if f and f._keyvk then f:_keyvk(vk, false) end
end

function P4.confirm()
    P4.result = nil
    Ess.UI.Confirm{
        text = "Delete the save file?",
        onResult = function(yes) P4.result = yes end,
    }
    return "confirm shown -- NO should be highlighted by default"
end

-- The old ui_confirm.gfx had exactly two message fields, so anything longer was cut.
function P4.longConfirm()
    P4.result = nil
    Ess.UI.Confirm{
        title = "LONG MESSAGE",
        text = "This message is deliberately far longer than two lines so that the old fixed-slot "
            .. "confirm dialog would have silently truncated it. The runtime creates as many "
            .. "lines as the wrapped text actually needs, and the yes/no strip is pushed down "
            .. "to make room rather than drawn on top of the text.",
        yes = "GOT IT", no = "CANCEL",
        onResult = function(yes) P4.result = yes end,
    }
    return "long confirm shown -- count the lines; the old cap was 2"
end

function P4.pick()
    key(Ess.UI.KEYS.left)
    local c = Ess.UI._S.confirm
    return "pick=" .. tostring(c and c._pick) .. " (0=yes, 1=no)"
end

function P4.enter() key(Ess.UI.KEYS.enter); return "result=" .. tostring(P4.result) end
function P4.esc() key(Ess.UI.KEYS.esc); return "result=" .. tostring(P4.result) end

function P4.input()
    P4.subText, P4.cancelled = nil, nil
    Ess.UI.Input{
        prompt = "NAME? -- ENTER SUBMIT   ESC CANCEL",
        onSubmit = function(t) P4.subText = t end,
        onCancel = function() P4.cancelled = true end,
    }
    return "input shown -- caret should be blinking"
end

-- Types through the REAL key path, so Ess.Input.VkToChar is exercised too.
function P4.type(s)
    for i = 1, #s do
        local ch = s:sub(i, i)
        local up = ch:upper()
        local vk = string.byte(up)
        -- shift is held for UPPERCASE. An earlier version had this backwards
        -- (ch ~= up), which typed "hELLO wORLD" and looked like an Input bug.
        local shift = (ch == up) and ch:match("%a") ~= nil
        local f = Ess.UI._S.focus
        if f and f._keyvk then f:_keyvk(vk, shift) end
    end
    local inp = Ess.UI._S.input
    return "buffer=" .. tostring(inp and inp._text)
end

-- NB: named subText, not `submitted` -- an earlier version used the same name for
-- this function AND the field it reports, so the field silently clobbered the function.
function P4.gotInput() return "submitted=" .. tostring(P4.subText) .. " cancelled=" .. tostring(P4.cancelled) end

function P4.chat()
    P4.ch = Ess.UI.Chat{ x = 20, y = 330, w = 380, title = "RADIO", lines = 6 }
    P4.ch:push("Misha: on my way")
    P4.ch:push("Ewan: copy that")
    return "chat shown with 2 lines (window = 6)"
end

function P4.say(n)
    if not P4.ch then return "run P4.chat() first" end
    n = tonumber(n) or 5
    for i = 1, n do P4.ch:push("Message number " .. i .. " -- pushed through the public :push()") end
    return "pushed " .. n .. " (log holds " .. #P4.ch._log .. ", window shows the last 6)"
end

function P4.chatPrompt()
    if not P4.ch then return "run P4.chat() first" end
    P4.ch:prompt(function(t) P4.chatSaid = t end)
    return "chat in input mode -- P4.type('hi there') then P4.enter()"
end

function P4.board()
    P4.b = Ess.UI.Board{
        x = 30, y = 40, w = 580, h = 400, rows = 8, focus = true,
        title = "CONTRACTS", hint = "UP/DOWN MOVE   ENTER ACCEPT   LEFT BACK",
        items = {
            { header = "AVAILABLE" },
            { label = "Oil Raid", k = 1 },
            { label = "Ambush at the Bridge", k = 2 },
            { label = "Escort the Convoy", k = 3 },
            { header = "IN PROGRESS" },
            { label = "Destroy the Radar", k = 4 },
        },
        onSelect = function(it, i, board)
            if it and not it.header then
                board:detail{
                    category = "DESTRUCTION",
                    -- 6 rewards and 10 objectives: both past the old fixed caps (4 and 8)
                    rewards = { "$8,000", "Fuel +300", "Ammo +150", "Rep +20", "Vehicle unlock", "Airstrike token" },
                    objectives = {
                        "Destroy 4 tanks", "Stay undetected", "Reach the LZ", "Rescue the pilot",
                        "Disable the AA gun", "Secure the depot", "Tag the convoy", "Extract",
                        "Do not lose the truck", "Finish under 8:00",
                    },
                    progress = i / 6,
                    progressText = i .. "/6 objectives",
                }
            end
        end,
        onChoose = function(it) P4.accepted = it and it.label end,
        onBack = function(b) b:hide() end,
    }
    P4.b:select(2)
    return "board shown -- 6 rewards + 10 objectives, past the old 4/8 caps"
end

function P4.boardNav(n)
    if not P4.b then return "run P4.board() first" end
    n = tonumber(n) or 1
    for _ = 1, n do P4.b:_keyvk(Ess.UI.KEYS.down) end
    local it, i = P4.b:selected()
    return "board sel=" .. tostring(i) .. " (" .. tostring(it and it.label) .. ")"
end

function P4.boardWrap()
    if not P4.b then return "run P4.board() first" end
    -- Board never had wrap-around; it inherits List's now that it composes one.
    P4.b:select(2)
    P4.b:_keyvk(Ess.UI.KEYS.up)
    local _, afterUp = P4.b:selected()
    return "up from first selectable -> " .. tostring(afterUp) .. " (6 = wrapped; Board's own copy never did this)"
end

function P4.api()
    local errs = {}
    local function try(label, fn)
        local ok, err = pcall(fn)
        if not ok then errs[#errs + 1] = label .. ": " .. tostring(err) end
    end
    try("Confirm", function() Ess.UI.Confirm{ text = "x", onResult = function() end } end)
    try("Confirm esc", function() key(Ess.UI.KEYS.esc) end)
    try("Input", function() Ess.UI.Input{ prompt = "p", onSubmit = function() end } end)
    try("Input esc", function() key(Ess.UI.KEYS.esc) end)
    local ch = Ess.UI.Chat{ x = 400, y = 330, title = "C" }
    try("chat:push", function() ch:push("a") end)
    try("chat:title", function() ch:title("T") end)
    try("chat:clear", function() ch:clear() end)
    try("chat:prompt", function() ch:prompt(function() end) end)
    try("chat:_endInput", function() ch:_endInput() end)
    try("chat:hide", function() ch:hide() end)
    try("chat:destroy", function() ch:destroy() end)
    local b = Ess.UI.Board{ x = 30, y = 40, title = "B", items = { { label = "a" } } }
    try("board:items", function() b:items({ { label = "x" }, { label = "y" } }) end)
    try("board:detail", function() b:detail{ category = "C", rewards = { "r" }, objectives = { "o" }, progress = 0.5 } end)
    try("board:selected", function() assert(select(2, b:selected()) ~= nil) end)
    try("board:select", function() b:select(1) end)
    try("board:title", function() b:title("T") end)
    try("board:hint", function() b:hint("H") end)
    try("board:paint", function() b:paint() end)
    try("board:_keyvk", function() b:_keyvk(Ess.UI.KEYS.down) end)
    try("board:show", function() b:show() end)
    try("board:hide", function() b:hide() end)
    try("board:focus", function() b:focus() end)
    try("board:blur", function() b:blur() end)
    try("board:destroy", function() b:destroy() end)
    if #errs == 0 then return "API sweep: all OK" end
    return "API sweep FAILURES: " .. table.concat(errs, " | ")
end

function P4.hide()
    if P4.ch then P4.ch:hide() end
    if P4.b then P4.b:hide() end
    local S = Ess.UI._S
    if S.confirm then S.confirm:hide() end
    if S.input then S.input:hide() end
    S.focus = nil
    return "hidden"
end


-- Asks the movie where its canvas edges actually are. Settles whether a widescreen
-- display widens the 640x480 canvas or just stretches it -- which decides whether
-- Ess.UI.CANVAS_W should stay 640, and therefore where the right edge is for toasts
-- and anything else anchored to it.
function P4.screen()
    P4.si = nil
    local rt = Ess.UI._S.rt
    if rt and rt.gfx then
        Ess.Gfx.onEvent(rt.gfx, "essuiScreen", function(v)
            P4.si = tostring(v)
            Loader.Printf("[essui] screen: " .. tostring(v))
        end)
    end
    Ess.UI._rtcall("ScreenInfo", {})
    local w, h, ratio = Ess.UI.screen()
    return "asked -- Lua side assumes canvas=" .. w .. "x" .. h .. " ratio=" .. tostring(ratio)
end

function P4.screenInfo() return "movie says: " .. tostring(P4.si) end

return "P4 loaded"
