-- HappyEditor UI runtime: scene tree indexing, visibility and group geometry.

UiTree = UiTree or {}
local Tree = UiTree
Tree.RUNTIME_VERSION = "3"

function Tree.topLeft(node)
    local anchor = node.anchor
    local ax = anchor and anchor.x or 0
    local ay = anchor and anchor.y or 0
    return node.x - ax * node.w, node.y - ay * node.h
end

function Tree.visible(node, state)
    if node.visible == false then return false end
    local states = node.states
    if states == nil or #states == 0 then return true end
    for i = 1, #states do
        if states[i] == state then return true end
    end
    return false
end

function Tree.index(nodes, index, image_nodes, parents, parent)
    if nodes == nil then return end
    for i = 1, #nodes do
        local node = nodes[i]
        if node and node.id then index[node.id] = node end
        if node and parent and parents then parents[node] = parent end
        if node and node.type == "image" and image_nodes then
            image_nodes[#image_nodes + 1] = node
        end
        if node and node.type == "group" then
            Tree.index(node.children, index, image_nodes, parents, node)
        end
    end
end

function Tree.shiftDescendants(node, dx, dy, on_shift)
    if node.type ~= "group" then return end
    local children = node.children or {}
    for i = 1, #children do
        local child = children[i]
        local old_x = child.x or 0
        local old_y = child.y or 0
        child.x = old_x + dx
        child.y = old_y + dy
        if on_shift then on_shift(child, old_x, old_y, child.x, child.y) end
        Tree.shiftDescendants(child, dx, dy, on_shift)
    end
end

function Tree.applyGroupXYCascade(node, new_x, new_y, on_shift)
    if node.type ~= "group" then return end
    local dx = new_x ~= nil and new_x - (node.x or 0) or 0
    local dy = new_y ~= nil and new_y - (node.y or 0) or 0
    if dx ~= 0 or dy ~= 0 then Tree.shiftDescendants(node, dx, dy, on_shift) end
end

return Tree
