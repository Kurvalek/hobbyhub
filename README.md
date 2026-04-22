# Handoff: Quilt Studio

## Overview

Quilt Studio is a browser-based quilt design tool that lets users plan Kona Cotton fabric quilts on a grid canvas. Users draw colored rectangular blocks, arrange them into quilt patterns, and get automatic fabric yardage estimates for purchasing.

## About the Design Files

`Quilt Studio.html` is a **high-fidelity interactive prototype** built in React + Babel. It is a design reference — not production code. The task is to recreate this design in your target codebase (React app, Next.js, etc.) using its established patterns, component libraries, and state management. Do not ship the HTML file directly.

## Fidelity

**High-fidelity.** The prototype uses final colors, typography, spacing, and interactions. Recreate it pixel-accurately using your codebase's conventions.

---

## Layout

Three-column fixed layout filling the full viewport height. No page scrolling — each column scrolls independently.

```
┌─────────────┬──────────────────────────┬──────────────┐
│  Left Panel │     Center Canvas        │  Right Panel │
│   220px     │       flex: 1            │    240px     │
│  (palette)  │     (quilt grid)         │  (materials) │
└─────────────┴──────────────────────────┴──────────────┘
```

**Header:** Full-width, `padding: 20px 28px 16px`. Logo left, tool controls right. `border-bottom: 1px solid #000`.

**Column dividers:** `1px solid #000` between all columns.

**Card sections:** Within panels, sections are separated by `border-bottom: 1px solid #000` with `padding: 16px`.

---

## Design Tokens

### Colors
| Token | Value | Usage |
|-------|-------|-------|
| Background | `#ffffff` | App background |
| Canvas bg | `#fafafa` | Quilt grid background |
| Text primary | `#111111` | Headings, values |
| Text secondary | `#666666` | Labels |
| Text muted | `#999999` | Captions, hints |
| Text placeholder | `#cccccc` | Empty states |
| Border | `#000000` | Structural dividers |
| Border light | `#e0e0e0` | Input borders, chip borders |
| Grid line | `#ebebeb` | Inner grid lines |
| Grid border | `#e0e0e0` | Outer grid border |
| Btn dark bg | `#111111` | Primary buttons |
| Btn dark hover | `#333333` | Primary button hover |
| Btn bg | `#ffffff` | Secondary buttons |
| Btn bg hover | `#f5f5f5` | Secondary button hover |
| Pill active bg | `#111111` | Active filter pill |

### Typography
- **Font:** DM Sans (Google Fonts), weights 300/400/500
- **Display/logo:** DM Serif Display, regular + italic
- **Base size:** 13px
- **Label (section headers):** 10px, weight 500, letter-spacing 0.08em, uppercase, color `#999`
- **Yardage figures:** 26px, weight 600, tabular nums
- **Color name in bar:** 13px, weight 500

### Spacing
- Panel padding: `16px`
- Canvas outer padding: `24px` on all sides
- Dimension bar padding: `12px 24px`
- Gap between chips: `3–4px`
- Gap between palette rows: `8px`

### Borders & Radius
- Structural dividers: `1px solid #000`
- Input/select borders: `1px solid #e0e0e0`, radius `4px`
- Buttons: radius `4px`
- Filter pills: radius `2px`
- Color chips: radius `3px`
- Shape blocks on canvas: radius `1px`

---

## Screens / Views

### Header Bar
- **Logo:** `DM Serif Display`, 22px, `letter-spacing: -0.01em`. Text: `"Quilt Studio"`
- **Tool toggles:** Inline button group (Draw / Erase), `border: 1px solid #e5e5e5`, `border-radius: 6px`. Active state: `background: #111`, `color: #fff`
- **Fill All button:** Secondary button, fills entire grid with selected color
- **Clear button:** Secondary button, shows confirmation modal

---

### Left Panel — Palette

Scrollable. Sections from top to bottom:

**1. Suggested Palettes**
- 8 named palettes of 4–5 Kona colors
- Each row: horizontal color strip (`height: 22px`, `border-radius: 3px`) + palette name right-aligned
- Click a palette → loads colors into Saved Colors, selects first color
- Show 4 by default; toggle to show all 8
- Palettes: Coastal, Prairie, Berry Jam, Orchard, Slate, Forest, Desert, Coral Reef

**2. Selected Color Card**
- 36×36px color swatch + name (13px, weight 500) + hex/code (11px, monospace, `#999`)
- Bookmark icon right: pins color to Saved Colors. Filled when pinned.

**3. Saved Colors**
- Label: "Saved colors"
- 6-column chip grid, `gap: 4px`. Each chip: square, `border-radius: 3px`, `border: 1px solid rgba(0,0,0,0.1)`. Selected chip has `outline: 2.5px solid #111`, `outline-offset: 2px`.
- Hover reveals ×  remove button (13px circle, `background: #111`, top-right corner)

**4. Search + Filter**
- Search input with search icon left-aligned (paddingLeft: 30px)
- Filter pills: All, White, Neutral, Brown, Grey, Red, Pink, Orange, Yellow, Green, Blue, Purple
- Pill active: `background: #111`, `color: #fff`, `border-color: #111`

**5. Full Library**
- Section label: "All colors (N)"
- 6-column chip grid, same style as Saved Colors
- Empty state: "No matches" centered, `color: #ccc`

**6. Add Custom Color**
- Collapsed: text link "＋ Add custom color"
- Expanded: name input, color picker + hex input, Add (dark btn) + Cancel

---

### Center Panel — Canvas

**Dimension Bar** (not scrollable, `border-bottom: 1px solid #000`):
- 4-column grid: Preset select | Columns slider | Rows slider | Block size slider | Finished size display
- Preset dropdown: Custom, Mug Rug (8×10"), Mini, Stroller, Baby, Crib, Lap/Throw, Twin, Full, Queen, King
- Sliders: `accent-color: #111`. Label left, current value right (weight 500, tabular nums)
- Finished size: "Finished size" label (11px, `#999`), value (14px, weight 500), cut size (11px, `#bbb`, monospace)

**Selection Sticky Bar** (visible when ≥1 shape selected, `position: sticky; top: 0`):
- `background: #fff`, `border-bottom: 1px solid #000`, `box-shadow: 0 2px 8px rgba(0,0,0,0.06)`
- Left: color swatch (16×16) + color name + dimensions (single selection) OR "N shapes selected" (multi)
- Hint: "Shift+click to add/remove" (italic, `#bbb`)
- Right: Apply color button (shows active color swatch) | Duplicate | Delete

**Quilt Grid Canvas:**
- Background `#fafafa`, surrounded by `24px` padding on all sides
- `aspect-ratio: cols/rows`
- Grid lines rendered as SVG overlay: inner lines `#ebebeb` / `strokeWidth: 0.04`, outer border `#e0e0e0` / `0.08`
- Shapes: absolutely positioned divs with `background: color.hex`, `outline: 2px solid #111` (selected), `1px solid rgba(0,0,0,0.08)` (unselected), `border-radius: 1px`
- Ghost preview while drawing: `opacity: 0.5`, `outline: 2px dashed #111`
- Resize handles (single selection): 8×8px white squares, `border: 1.5px solid #111`, `border-radius: 2px`, at corners + edge midpoints
- Quilting overlay: SVG dashed lines over shapes

**Hint Strip** (below canvas):
- `font-size: 11px`, `color: #bbb`. Text: "Drag to draw · Click to select · Shift+click for multi-select · Drag corners to resize"

---

### Right Panel — Finishing & Materials

Scrollable. Sections from top:

**Quilting Pattern**
- Eye icon toggle (show/hide stitch overlay)
- Pattern select dropdown
- Spacing slider (when pattern ≠ none/ditch)
- Thread color swatch + "Set to selected" button

**Backing**
- "Set color" (dark btn) + "Clear" (secondary)
- When set: swatch + name + dimensions + yardage value (15px, weight 600)
- When empty: italic placeholder `color: #ccc`

**Binding** — same structure as Backing

**Materials Summary**
- 2-col grid: Patches placed (large number + "of N") | Grand total yardage
- Large numbers: 26px, weight 600, `font-variant-numeric: tabular-nums`

**Quilt Top · By Color** (scrollable list)
- Each row: 26×26 swatch + name + strip count + yardage
- `border-bottom: 1px solid #f0f0f0`
- Empty state: italic placeholder

**Footer note:** 11px, `#ccc`, explains yardage assumptions

---

## Interactions & Behavior

### Canvas Drawing
- **Pointer down on empty area:** Begin drawing. Drag defines rectangle size. Ghost preview shown.
- **Pointer up:** Shape placed. Shape auto-selected.
- **Pointer down on shape (no shift):** Select shape. Drag to move.
- **Shift + pointer down on shape:** Add/remove from multi-selection.
- **Pointer down on handle (single selection):** Resize. 8 handles (corners + edge midpoints).
- **Erase tool + pointer down/drag:** Delete shapes under cursor.

### Multi-select
- `selIds`: a `Set<id>` tracking selected shape IDs
- Shift+click toggles membership
- Click empty area (no shift): clear selection
- All sticky bar actions apply to every shape in `selIds`

### Apply Color
- Click color in palette/library: sets active color. If `selIds.size > 0`, also recolors all selected shapes.
- "Apply color" button in sticky bar: recolors all selected shapes to current active color.

### Quilting Overlay
- SVG overlay rendered on top of shapes using `preserveAspectRatio="none"` and a `viewBox` of `0 0 cols rows`
- Dashed lines for pattern types: ditch, horizontal, vertical, diagonal, crosshatch, diagonal cross

---

## State

```ts
shapes: Array<{ id: number, r: number, c: number, h: number, w: number, color: KonaColor }>
selIds: Set<number>
cols: number          // default 16
rows: number          // default 16
blockSize: number     // finished inches, default 3
preset: string        // "Custom" | preset name
tool: "paint" | "erase"
selectedColor: KonaColor
pinnedColors: KonaColor[]
customColors: KonaColor[]
search: string
colorGroup: string    // "All" | group name
backing: KonaColor | null
binding: KonaColor | null
quiltPattern: string
quiltSpacing: number
quiltColor: KonaColor
showQuilting: boolean
```

### Derived / computed
- `flatGrid`: rows×cols 2D array, shapes painted in order (last wins). Used for yardage math.
- `materials`: per-color counts, yardage, strip counts
- `backing.yards`, `binding.yards`: from standard formulas (see below)

---

## Yardage Formulas

```
WOF = 40"         // usable width of fabric
SEAM = 0.5"       // total seam allowance (¼" per side)

cutSize = blockSize + SEAM
piecesPerStrip = floor(WOF / cutSize)
strips = ceil(count / piecesPerStrip)
yards = ceil((strips * cutSize / 36) * 8) / 8   // round up to nearest ⅛yd

// Backing (4" extra on each side = 8" total per dimension)
backingW = finishedW + 8
backingH = finishedH + 8
// Choose orientation that uses less fabric, then round up to nearest ⅛yd

// Binding (2.5" double-fold)
perimeter = 2 * (finishedW + finishedH)
strips = ceil((perimeter + 10) / WOF)
yards = ceil((strips * 2.5 / 36) * 8) / 8
```

---

## Kona Color Data

The app includes ~130 Kona Cotton solid colors grouped by family (White, Neutral, Brown, Grey, Red, Pink, Orange, Yellow, Green, Blue, Purple). Each color:

```ts
interface KonaColor {
  name: string    // e.g. "Navy"
  code: string    // Kona SKU e.g. "1243"
  hex: string     // e.g. "#1A2E4C"
  group: string   // e.g. "Blue"
  custom?: boolean
}
```

Full color list is in `Quilt Studio.html` as the `KONA` array.

---

## Assets

- **Icons:** Inline SVG (no icon library needed). All icons are simple 24×24 path-based SVGs at `strokeWidth: 1.75`. See `Quilt Studio.html` for all icon implementations.
- **Fonts:** DM Sans + DM Serif Display from Google Fonts
- **No images**

---

## Files

| File | Description |
|------|-------------|
| `Quilt Studio.html` | Complete high-fidelity interactive prototype. Open in browser to explore all interactions. |

---

## Notes for Implementation

1. The prototype uses inline React/Babel — convert to proper JSX/TSX components.
2. Extract `GridCanvas` as its own component file; it handles all pointer interactions.
3. The `shapes` array (not a cell grid) is the source of truth. Flatten to a grid only for yardage calculation.
4. Pointer capture (`element.setPointerCapture(e.pointerId)`) is critical for smooth drag behavior — keep it.
5. Use `useRef` for drag state (not `useState`) to avoid re-renders during pointer move.
6. The `selIds` Set should be lifted to a context or top-level state so the palette can recolor selected shapes on color click.
7. Tweakable CSS variables (`--div-border`, `--app-bg`, `--canvas-bg`) can be wired to a theme system.
