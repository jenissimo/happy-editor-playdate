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

print("runtime smoke: ok")
