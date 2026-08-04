-- HappyEditor UI runtime: imagetable frame invalidation.

UiAnimation = UiAnimation or {}
local Animation = UiAnimation
Animation.RUNTIME_VERSION = "3"

function Animation.updateImageFrames(image_nodes, time, assets, frames, on_change)
    local changed = false
    for i = 1, #image_nodes do
        local node = image_nodes[i]
        if (node.fps or 0) > 0 then
            local _, frame = assets:frame(node, time)
            if frame then
                local previous = frames[i]
                frames[i] = frame
                if previous ~= nil and previous ~= frame then
                    changed = true
                    if on_change then on_change(node, i, previous, frame) end
                end
            end
        end
    end
    return changed
end

return Animation
