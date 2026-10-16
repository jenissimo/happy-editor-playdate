package.path = "playdate/Source/?.lua;playdate/Source/?/?.lua;" .. package.path

local saved_require = require
local saved_import = import
playdate = { graphics = {} }
Ui = nil
UiAssets = nil
UiTree = nil
UiCache = nil
UiAnimation = nil
UiRenderer = nil
import = function(path)
    dofile("playdate/Source/" .. path .. ".lua")
end
require = nil
dofile("playdate/Source/ui.lua")
require = saved_require
import = saved_import

local function check(condition, message)
    assert(condition, message)
end

check(Ui and Ui.RUNTIME_VERSION, "runtime should load through Playdate imports")

local Animation = require("ui.animation")
local Cache = require("ui.cache")
local Renderer = require("ui.renderer")
local Tree = require("ui.tree")

-- Pinning a literal version here only ever produced a false failure on every
-- deliberate bump. What actually matters is that a host project cannot end up
-- with a half-updated install: ui.lua refuses to run if a sibling disagrees,
-- so assert the agreement instead of the number.
for name, module in pairs({
    UiAssets = require("ui.assets"), UiMemory = require("ui.memory"),
    UiTree = Tree, UiCache = Cache, UiAnimation = Animation, UiRenderer = Renderer,
}) do
    check(module.RUNTIME_VERSION == Ui.RUNTIME_VERSION,
        name .. " must ship the same runtime version as ui.lua")
end

local frames = { 1, 1 }
local nodes = {
    { fps = 2, frame = 2 },
    { fps = 2, frame = 2 },
}
local assets = { frame = function(_, node) return true, node.frame end }
check(Animation.updateImageFrames(nodes, 1, assets, frames),
    "multiple animated nodes should invalidate together")
check(frames[1] == 2 and frames[2] == 2,
    "multiple animated nodes should advance together")

local offset = 9
local saved_offsets = {}
local raster_offset, composite_offset, raster_count
local gfx = {
    kColorWhite = 1,
    kColorClear = -1,
    kDrawModeCopy = 0,
}
gfx.image = {
    new = function()
        return { draw = function() composite_offset = offset end }
    end,
}
gfx.pushContext = function()
    saved_offsets[#saved_offsets + 1] = offset
end
gfx.popContext = function()
    offset = table.remove(saved_offsets)
end
gfx.setDrawOffset = function(x) offset = x end
gfx.getDrawOffset = function() return offset, 0 end
gfx.clearClipRect = function() end
gfx.clearStencilImage = function() end
gfx.setImageDrawMode = function() end
gfx.clear = function() end

local cache = Cache.new(gfx, 400, 240)
local node = { id = "node", w = 20, h = 10 }
local image = cache:drawNode(node, function()
    raster_offset = offset
    raster_count = (raster_count or 0) + 1
end)
check(raster_offset == 0, "node rasterization should use local coordinates")
image:draw(0, 0)
check(composite_offset == 9, "cache composite should preserve caller offset")
Cache.recordMutation(cache, node, "x")
cache:drawNode(node, function() raster_count = raster_count + 1 end)
check(raster_count == 1, "movement should preserve a node raster")
Cache.recordMutation(cache, node, "text")
cache:drawNode(node, function() raster_count = raster_count + 1 end)
check(raster_count == 2, "visual changes should invalidate one node raster")

local draw_order = {}
local rotated_degrees = nil
Renderer.draw(
    { { type = "group", children = { { type = "shape", id = "child", rotation = 2 } } } },
    "default",
    function(node) draw_order[#draw_order + 1] = node.id end,
    function(node, _, _, degrees)
        draw_order[#draw_order + 1] = node.id
        rotated_degrees = degrees
    end,
    function() return true end,
    function() return 0, 0 end
)
check(draw_order[1] == "child", "renderer should traverse group children")
check(rotated_degrees == 2, "renderer should forward rotation")

local mutation_cache = Cache.new(gfx, 400, 240)
local child = { id = "child", type = "shape", x = 10, y = 0 }
local group = { id = "group", type = "group", x = 0, y = 0, children = { child } }
local function record_child_shift(node, old_x, old_y, new_x, new_y)
    if old_x ~= new_x then Cache.recordMutation(mutation_cache, node, "x") end
    if old_y ~= new_y then Cache.recordMutation(mutation_cache, node, "y") end
end
Tree.applyGroupXYCascade(group, 5, nil, record_child_shift)
Cache.recordMutation(mutation_cache, group, "x")
group.x = 5
Cache.recordMutation(mutation_cache, child, "x")
child.x = 20
Tree.applyGroupXYCascade(group, 0, nil, record_child_shift)
Cache.recordMutation(mutation_cache, group, "x")
group.x = 0
local version_after_cascade = mutation_cache:version(child)
Cache.recordMutation(mutation_cache, child, "x")
child.x = 20
check(version_after_cascade == mutation_cache:version(child),
    "group cascades should preserve child rasters")
Cache.recordMutation(mutation_cache, child, "asset")
check(version_after_cascade ~= mutation_cache:version(child),
    "visual changes should invalidate child rasters")

-- Gate invalidation is narrowed to the islands an affected member sits in.
local gate_cache = Cache.new(gfx, 400, 240)
local m1, m2, m3, m4 = { id = "m1" }, { id = "m2" }, { id = "m3" }, { id = "m4" }
gate_cache.islands = {
    { members = { m1, m2 }, promoted = false, dirty = false },
    { members = { m3, m4 }, promoted = false, dirty = false },
}
gate_cache:invalidateUnpromotedGates(function(member) return member == m3 end)
check(not gate_cache.islands[1].dirty, "a gate change should leave unaffected islands clean")
check(gate_cache.islands[2].dirty, "a gate change should rebuild the island holding an affected member")
gate_cache.islands[2].dirty = false
gate_cache:invalidateUnpromotedGates()
check(gate_cache.islands[1].dirty and gate_cache.islands[2].dirty, "no predicate should still rebuild every island")

-- Native dither/gradient fills paint exactly the pixels of the per-pixel
-- reference: a framebuffer model of setColor / setStencilPattern (8 rows, bit
-- 7 leftmost, 1 = draw, anchored to the device past the draw offset -- what
-- the SDK does, measured in the Simulator) / fillRect / drawPixel, random
-- shapes over a random background, every pixel compared.
do
    local pgfx = playdate.graphics
    pgfx.kColorBlack, pgfx.kColorWhite = 0, 1
    local fb, color, stencil, ox, oy = {}, 0, nil, 0, 0
    local function plot(x, y)
        local X, Y = x + ox, y + oy
        if stencil and (stencil[(Y & 7) + 1] & (0x80 >> (X & 7))) == 0 then return end
        fb[Y * 4096 + X] = color
    end
    pgfx.setColor = function(c) color = (c == pgfx.kColorWhite) and 1 or 0 end
    pgfx.setStencilPattern = function(t)
        stencil = {}
        for i = 1, 8 do stencil[i] = t[i] end
    end
    pgfx.clearStencil = function() stencil = nil end
    pgfx.fillRect = function(x, y, w, h)
        for yy = y, y + h - 1 do for xx = x, x + w - 1 do plot(xx, yy) end end
    end
    pgfx.drawPixel = plot
    pgfx.setDrawOffset = function(x, y) ox, oy = x, y end
    pgfx.getDrawOffset = function() return ox, oy end

    local seed = 12345
    local function rand(lo, hi)
        seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
        return lo + (seed >> 8) % (hi - lo + 1)
    end
    local function render(native, fill, x, y, w, h, radius, dx, dy, origin_x, origin_y, background)
        fb = {}
        for k, v in pairs(background) do fb[k] = v end
        ox, oy = dx, dy
        Ui._debugSetNativeDither(native)
        Ui._debugFillShape(fill, x, y, w, h, radius, origin_x, origin_y)
        Ui._debugSetNativeDither(true)
        return fb
    end
    local PATTERNS = { "bayer2", "bayer4", "bayer8", "horizontal", "vertical",
        "diagonal", "screen", "checker", "dots", "unknown" }
    for case = 1, 400 do
        local fill
        if case % 2 == 0 then
            fill = { kind = "dither", pattern = PATTERNS[rand(1, #PATTERNS)],
                color = rand(0, 1) == 0 and "black" or "white" }
        else
            fill = { kind = "gradient", axis = rand(0, 1) == 0 and "h" or "v",
                from = rand(-20, 120) / 100, to = rand(-20, 120) / 100,
                color = rand(0, 1) == 0 and "black" or "white" }
        end
        local w, h = rand(1, 48), rand(1, 48)
        local x, y = rand(-12, 30) + (rand(0, 3) == 0 and 0.5 or 0), rand(-12, 30)
        local radius, dx, dy = rand(0, 14), rand(-9, 9), rand(-9, 9)
        local origin_x, origin_y = rand(-9, 9), rand(-9, 9)
        local background = {}
        for _ = 1, 200 do background[rand(-20, 90) * 4096 + rand(-20, 90)] = rand(0, 1) end
        local want = render(false, fill, x, y, w, h, radius, dx, dy, origin_x, origin_y, background)
        local got = render(true, fill, x, y, w, h, radius, dx, dy, origin_x, origin_y, background)
        local same = true
        for k, v in pairs(want) do if got[k] ~= v then same = false end end
        for k, v in pairs(got) do if want[k] ~= v then same = false end end
        check(same, string.format("native %s fill should match the reference (case %d: %s %dx%d r%d)",
            fill.kind, case, fill.pattern or fill.axis, w, h, radius))
    end
end

print("runtime smoke: ok")
