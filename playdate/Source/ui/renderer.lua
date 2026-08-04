-- HappyEditor UI runtime: scene traversal and geometry boundary.

UiRenderer = UiRenderer or {}
local Renderer = UiRenderer
Renderer.RUNTIME_VERSION = "3"

local function visit(node, state, draw_content, draw_rotated, visible, top_left)
    if not node or not visible(node, state) then return end
    if node.type == "group" then
        local children = node.children or {}
        for i = 1, #children do
            visit(children[i], state, draw_content, draw_rotated, visible, top_left)
        end
        return
    end

    local x, y = top_left(node)
    if (node.rotation or 0) == 0 then
        draw_content(node, x, y)
    else
        draw_rotated(node, x, y, node.rotation or 0)
    end
end

function Renderer.draw(nodes, state, draw_content, draw_rotated, visible, top_left)
    nodes = nodes or {}
    for i = 1, #nodes do
        visit(nodes[i], state, draw_content, draw_rotated, visible, top_left)
    end
end

return Renderer
