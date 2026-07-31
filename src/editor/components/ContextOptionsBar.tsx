import {
  AlignBottomSimple,
  AlignCenterVerticalSimple,
  AlignTopSimple,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
} from '@phosphor-icons/react'
import type {
  FrameStyle,
  SceneNode,
  ShapeFill,
  ShapeStroke,
} from '../../core/scene/types'
import { DITHER_PATTERNS } from '../../core/scene/types'
import { IconButton } from './IconButton'
import { NumericField } from './NumericField'
import { ChoiceTiles } from './ChoiceTiles'
import { AssetPicker } from './AssetPicker'
import { FontPicker } from './FontPicker'
import {
  DitherPatternPreview,
  FillKindPreview,
  FrameStylePreview,
  InkSwatch,
  StrokeKindPreview,
} from './PropertyPreviews'
import {
  createFillFromKind,
  createStrokeFromKind,
} from '../render/procedural'
import { useEditorContext } from '../state/EditorContext'
import { StateMembership } from './StateMembership'

/** Photoshop-style options strip — contextual to the current selection. */
export function ContextOptionsBar() {
  const {
    selected,
    selectedNodes,
    selectedIds,
    patchNode,
    scene,
    setNodeStates,
  } = useEditorContext()

  if (!selected || selectedNodes.length === 0) {
    return (
      <div className="context-options context-options--empty">
        <span className="hint">Select a node for contextual options</span>
      </div>
    )
  }

  const multi = selectedNodes.length > 1
  const locked = selectedNodes.some((n) => n.locked)

  // Mixed membership across multi-select → show as All visually only if all empty
  const membershipValue = (() => {
    if (!multi) return selected.states
    const first = selectedNodes[0]!.states
    const same = selectedNodes.every(
      (n) =>
        n.states.length === first.length &&
        n.states.every((s, i) => s === first[i]),
    )
    return same ? first : []
  })()

  const statesBlock = (
    <>
      <span className="toolbar-sep" />
      <span className="context-options__label">States</span>
      <StateMembership
        sceneStates={scene.states}
        value={membershipValue}
        disabled={locked}
        onChange={(next) => setNodeStates(selectedIds, next)}
      />
    </>
  )

  if (multi) {
    return (
      <div className="context-options">
        <span className="hint">{selectedNodes.length} selected</span>
        {statesBlock}
      </div>
    )
  }

  const patch = (p: Partial<SceneNode>, label: string) =>
    patchNode(selected.id, p, label)

  return (
    <div className="context-options">
      <span className={`kind kind-${selected.type}`}>{selected.type}</span>
      {statesBlock}
      <span className="toolbar-sep" />
      <NumericField
        label="X"
        value={Math.round(selected.x - selected.anchor.x * selected.w)}
        disabled={locked}
        onChange={(left) => {
          const top = selected.y - selected.anchor.y * selected.h
          patch(
            {
              x: left + selected.anchor.x * selected.w,
              y: top + selected.anchor.y * selected.h,
            },
            'Move',
          )
        }}
      />
      <NumericField
        label="Y"
        value={Math.round(selected.y - selected.anchor.y * selected.h)}
        disabled={locked}
        onChange={(top) => {
          const left = selected.x - selected.anchor.x * selected.w
          patch(
            {
              x: left + selected.anchor.x * selected.w,
              y: top + selected.anchor.y * selected.h,
            },
            'Move',
          )
        }}
      />
      <NumericField
        label="W"
        value={selected.w}
        min={1}
        disabled={locked}
        onChange={(w) => {
          const left = selected.x - selected.anchor.x * selected.w
          const top = selected.y - selected.anchor.y * selected.h
          const nw = Math.max(1, w)
          patch(
            {
              w: nw,
              x: left + selected.anchor.x * nw,
              y: top + selected.anchor.y * selected.h,
            },
            'Resize',
          )
        }}
      />
      <NumericField
        label="H"
        value={selected.h}
        min={1}
        disabled={locked}
        onChange={(h) => {
          const left = selected.x - selected.anchor.x * selected.w
          const top = selected.y - selected.anchor.y * selected.h
          const nh = Math.max(1, h)
          patch(
            {
              h: nh,
              x: left + selected.anchor.x * selected.w,
              y: top + selected.anchor.y * nh,
            },
            'Resize',
          )
        }}
      />
      <NumericField
        label="°"
        value={selected.rotation ?? 0}
        disabled={locked}
        onChange={(rotation) => patch({ rotation }, 'Rotate')}
      />

      {selected.type === 'text' && (
        <>
          <span className="toolbar-sep" />
          <div className="context-align">
            {(
              [
                ['left', TextAlignLeft],
                ['center', TextAlignCenter],
                ['right', TextAlignRight],
              ] as const
            ).map(([align, Icon]) => (
              <IconButton
                key={align}
                icon={Icon}
                title={`Align ${align}`}
                active={selected.align === align}
                disabled={locked}
                onClick={() => patch({ align }, 'Align')}
              />
            ))}
          </div>
          <div className="context-align">
            {(
              [
                ['top', AlignTopSimple],
                ['middle', AlignCenterVerticalSimple],
                ['bottom', AlignBottomSimple],
              ] as const
            ).map(([valign, Icon]) => (
              <IconButton
                key={valign}
                icon={Icon}
                title={`Vertical ${valign}`}
                active={(selected.valign ?? 'top') === valign}
                disabled={locked}
                onClick={() => patch({ valign }, 'VAlign')}
              />
            ))}
          </div>
          <div className="context-font">
            <FontPicker
              compact
              value={selected.font}
              disabled={locked}
              onChange={(font) => patch({ font }, 'Edit font')}
            />
          </div>
          <NumericField
            label="×"
            value={selected.scale ?? 1}
            min={1}
            max={8}
            step={1}
            disabled={locked}
            onChange={(raw) => {
              const scale = Math.max(1, Math.min(8, Math.floor(raw)))
              patch(
                { scale: scale === 1 ? undefined : scale },
                'Text scale',
              )
            }}
          />
          <ChoiceTiles
            label="Ink"
            value={selected.color ?? 'black'}
            disabled={locked}
            columns={2}
            options={(['black', 'white'] as const).map((color) => ({
              value: color,
              label: color,
              preview: <InkSwatch color={color} />,
            }))}
            onChange={(color) => patch({ color }, 'Text color')}
          />
          <input
            className="context-text"
            value={selected.text}
            disabled={locked}
            placeholder="Text…"
            onChange={(e) => patch({ text: e.target.value }, 'Edit text')}
          />
        </>
      )}

      {selected.type === 'frame' && (
        <>
          <span className="toolbar-sep" />
          <ChoiceTiles
            value={selected.style}
            disabled={locked}
            columns={3}
            options={(['line', 'double', 'ticks'] as FrameStyle[]).map(
              (style) => ({
                value: style,
                label: style,
                preview: <FrameStylePreview style={style} />,
              }),
            )}
            onChange={(style) => patch({ style }, 'Style')}
          />
          <NumericField
            label="T"
            value={selected.thickness}
            min={1}
            disabled={locked}
            onChange={(thickness) =>
              patch({ thickness: Math.max(1, thickness) }, 'Thickness')
            }
          />
        </>
      )}

      {selected.type === 'shape' && (
        <>
          <span className="toolbar-sep" />
          <ChoiceTiles
            value={selected.fill.kind}
            disabled={locked}
            columns={4}
            options={(
              ['none', 'solid', 'dither', 'gradient'] as ShapeFill['kind'][]
            ).map((kind) => ({
              value: kind,
              label: kind,
              preview: <FillKindPreview kind={kind} />,
            }))}
            onChange={(kind) =>
              patch(
                { fill: createFillFromKind(kind, selected.fill) },
                'Fill kind',
              )
            }
          />
          <ChoiceTiles
            value={selected.stroke.kind}
            disabled={locked}
            columns={5}
            options={(
              [
                'none',
                'solid',
                'double',
                'dashed',
                'ticks',
              ] as ShapeStroke['kind'][]
            ).map((kind) => ({
              value: kind,
              label: kind,
              preview: <StrokeKindPreview kind={kind} />,
            }))}
            onChange={(kind) =>
              patch(
                {
                  stroke: createStrokeFromKind(kind, selected.stroke),
                },
                'Stroke kind',
              )
            }
          />
          <NumericField
            label="R"
            value={selected.cornerRadius}
            min={0}
            disabled={locked}
            onChange={(cornerRadius) =>
              patch(
                { cornerRadius: Math.max(0, Math.round(cornerRadius)) },
                'Corner radius',
              )
            }
          />
        </>
      )}

      {(selected.type === 'image' || selected.type === 'panel') && (
        <>
          <span className="toolbar-sep" />
          <div className="context-asset">
            <AssetPicker
              value={selected.asset}
              disabled={locked}
              kinds={selected.type === 'panel' ? ['slice'] : ['image']}
              onChange={(asset) => patch({ asset }, 'Asset')}
            />
          </div>
          {selected.type === 'image' && (
            <ChoiceTiles
              label="Tint"
              value={selected.tint ?? 'none'}
              disabled={locked}
              columns={3}
              options={
                (
                  [
                    ['none', 'copy'],
                    ['black', 'black'],
                    ['white', 'white'],
                  ] as const
                ).map(([value, label]) => ({
                  value,
                  label,
                  preview:
                    value === 'none' ? (
                      <InkSwatch color="black" />
                    ) : (
                      <InkSwatch color={value} />
                    ),
                }))
              }
              onChange={(tint) => patch({ tint }, 'Image tint')}
            />
          )}
        </>
      )}
    </div>
  )
}

export function ShapePropertyEditors({
  node,
  locked,
  patch,
}: {
  node: Extract<SceneNode, { type: 'shape' }>
  locked: boolean
  patch: (p: Partial<Extract<SceneNode, { type: 'shape' }>>, label: string) => void
}) {
  const fill = node.fill
  const stroke = node.stroke

  return (
    <>
      <p className="section-label">Shape</p>
      <NumericField
        label="Corner"
        value={node.cornerRadius}
        min={0}
        disabled={locked}
        onChange={(cornerRadius) =>
          patch(
            { cornerRadius: Math.max(0, Math.round(cornerRadius)) },
            'Corner radius',
          )
        }
      />

      <p className="section-label">Fill</p>
      <ChoiceTiles
        value={fill.kind}
        disabled={locked}
        columns={2}
        options={(
          ['none', 'solid', 'dither', 'gradient'] as ShapeFill['kind'][]
        ).map((kind) => ({
          value: kind,
          label: kind,
          preview: <FillKindPreview kind={kind} />,
        }))}
        onChange={(kind) =>
          patch({ fill: createFillFromKind(kind, fill) }, 'Fill kind')
        }
      />
      {fill.kind !== 'none' && (
        <ChoiceTiles
          label="Ink"
          value={fill.color}
          disabled={locked}
          columns={2}
          options={(['black', 'white'] as const).map((color) => ({
            value: color,
            label: color,
            preview: <InkSwatch color={color} />,
          }))}
          onChange={(color) =>
            patch({ fill: { ...fill, color } }, 'Fill color')
          }
        />
      )}
      {fill.kind === 'dither' && (
        <ChoiceTiles
          label="Pattern"
          value={fill.pattern}
          disabled={locked}
          columns={2}
          options={DITHER_PATTERNS.map((pattern) => ({
            value: pattern,
            label: pattern,
            preview: <DitherPatternPreview pattern={pattern} />,
          }))}
          onChange={(pattern) =>
            patch({ fill: { ...fill, pattern } }, 'Fill pattern')
          }
        />
      )}
      {fill.kind === 'gradient' && (
        <>
          <ChoiceTiles
            label="Axis"
            value={fill.axis}
            disabled={locked}
            columns={2}
            options={[
              { value: 'h' as const, label: 'horizontal' },
              { value: 'v' as const, label: 'vertical' },
            ]}
            onChange={(axis) =>
              patch({ fill: { ...fill, axis } }, 'Gradient axis')
            }
          />
          <div className="field-row">
            <NumericField
              label="From"
              value={fill.from}
              min={0}
              max={1}
              step={0.05}
              disabled={locked}
              onChange={(from) =>
                patch({ fill: { ...fill, from } }, 'Gradient from')
              }
            />
            <NumericField
              label="To"
              value={fill.to}
              min={0}
              max={1}
              step={0.05}
              disabled={locked}
              onChange={(to) =>
                patch({ fill: { ...fill, to } }, 'Gradient to')
              }
            />
          </div>
        </>
      )}

      <p className="section-label">Stroke</p>
      <ChoiceTiles
        value={stroke.kind}
        disabled={locked}
        columns={2}
        options={(
          [
            'none',
            'solid',
            'double',
            'dashed',
            'ticks',
          ] as ShapeStroke['kind'][]
        ).map((kind) => ({
          value: kind,
          label: kind,
          preview: <StrokeKindPreview kind={kind} />,
        }))}
        onChange={(kind) =>
          patch(
            { stroke: createStrokeFromKind(kind, stroke) },
            'Stroke kind',
          )
        }
      />
      {stroke.kind !== 'none' && (
        <>
          <ChoiceTiles
            label="Ink"
            value={stroke.color}
            disabled={locked}
            columns={2}
            options={(['black', 'white'] as const).map((color) => ({
              value: color,
              label: color,
              preview: <InkSwatch color={color} />,
            }))}
            onChange={(color) =>
              patch({ stroke: { ...stroke, color } }, 'Stroke color')
            }
          />
          <NumericField
            label="Thick"
            value={stroke.thickness}
            min={1}
            disabled={locked}
            onChange={(thickness) =>
              patch(
                {
                  stroke: {
                    ...stroke,
                    thickness: Math.max(1, Math.round(thickness)),
                  },
                },
                'Stroke thickness',
              )
            }
          />
        </>
      )}
      {stroke.kind === 'double' && (
        <NumericField
          label="Gap"
          value={stroke.gap}
          min={1}
          disabled={locked}
          onChange={(gap) =>
            patch(
              {
                stroke: {
                  ...stroke,
                  gap: Math.max(1, Math.round(gap)),
                },
              },
              'Stroke gap',
            )
          }
        />
      )}
      {stroke.kind === 'dashed' && (
        <div className="field-row">
          <NumericField
            label="Dash"
            value={stroke.dash}
            min={1}
            disabled={locked}
            onChange={(dash) =>
              patch(
                {
                  stroke: {
                    ...stroke,
                    dash: Math.max(1, Math.round(dash)),
                  },
                },
                'Dash length',
              )
            }
          />
          <NumericField
            label="Gap"
            value={stroke.gap}
            min={1}
            disabled={locked}
            onChange={(gap) =>
              patch(
                {
                  stroke: {
                    ...stroke,
                    gap: Math.max(1, Math.round(gap)),
                  },
                },
                'Dash gap',
              )
            }
          />
        </div>
      )}
      {stroke.kind === 'ticks' && (
        <NumericField
          label="Step"
          value={stroke.step}
          min={2}
          disabled={locked}
          onChange={(step) =>
            patch(
              {
                stroke: {
                  ...stroke,
                  step: Math.max(2, Math.round(step)),
                },
              },
              'Tick step',
            )
          }
        />
      )}
    </>
  )
}
