--[[
  HappyEditor fixture — Playdate harness for happy-editor-playdate.

  Loads ActiveScene (written by the web editor / run-simulator API)
  through a tiny Ui runtime and draws it 1:1 on device.

  When VisualCapturePath is set (visual-parity tests), dumps the
  framebuffer via playdate.simulator.writeToFile and exits.
]]

import "CoreLibs/graphics"
import "CoreLibs/nineslice"

import "visual_capture"
import "ui"
import "active_scene"

local gfx <const> = playdate.graphics

Ui.load(ActiveScene)

local frame = 0
local captured = false

function playdate.update()
    frame += 1

    -- Runtime API examples (uncomment + match node ids in your scene):
    --
    -- -- Score text
    -- Ui.setText("score", "Score: " .. tostring(frame))
    --
    -- -- Popup group: slide in once
    -- if frame == 1 then
    --     Ui.setVisible("popup", true)
    --     Ui.set("popup", { y = 80 })
    --     Ui.animate("popup", { y = 40 }, {
    --         duration = 0.3,
    --         ease = "inOut",
    --         -- onComplete = function() print("popup in") end,
    --     })
    -- end
    --
    -- end

    local dt = playdate.getElapsedTime()
    playdate.resetElapsedTime()
    -- Advances imagetable animation + Ui.animate tweens.
    Ui.update(dt)

    gfx.clear(gfx.kColorWhite)
    Ui.draw()

    -- Frame 1's getDisplayImage is often still blank; wait one present cycle.
    if VisualCapturePath and playdate.isSimulator and not captured and frame >= 2 then
        captured = true
        local img = gfx.getDisplayImage()
        if img then
            playdate.simulator.writeToFile(img, VisualCapturePath)
        end
        playdate.simulator.exit()
        return
    end

    if not VisualCapturePath then
        playdate.drawFPS(2, 2)
    end
end
