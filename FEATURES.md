# metime — Features

metime is a browser-based craft design studio and made-to-order kit storefront. Users design quilts, cross-stitch patterns, or punch-needle projects in the browser, get automatic materials estimates, download PDFs, save designs locally or to the cloud, and optionally purchase physical kits through Shopify checkout. A separate admin dashboard handles order fulfillment.

---

## Craft Studios

metime supports three craft types, each with a dedicated setup wizard and editor.

### Quilt Studio

**Setup Wizard**

- Size presets: Coasters (4× 5″ units), Wall Hanging (24×36″), Baby Blanket (30×36″), Throw (52×65″)
- Backing fabric selector with 790 Ruby Star Society fabric swatches across 29 collections, searchable by theme with enlarge/zoom previews
- Palette selector with 12 suggested Kona cotton palettes, sample palettes, photo-upload-to-palette extraction, or skip
- Template selector: Checkerboard, Nine-Patch, Rail Fence, Half-Square Triangles (with triangle color-swap for HST pairs)

**Editor**

- Three-column layout: tool rail, canvas, and materials panel
- Paint and erase tools with drag-rectangle drawing on the grid
- Click selection, shift+multi-select, drag-move, and 8-handle resize with ghost preview
- ~130 Kona cotton colors organized by group with search, filter pills, suggested palettes, saved "My Palette," custom colors, and pin/bookmark
- Coaster mode with 4 separate designs, tab bar, and copy-to-all
- Size controls: preset selector, columns/rows sliders, block size (finished inches), finished/cut size display
- Quilting overlay: SVG patterns (stitch-in-the-ditch, horizontal, vertical, diagonal, crosshatch, diagonal cross) with configurable spacing and thread color
- Backing and binding selection from the fabric library or photo with automatic yardage calculations
- Materials panel: per-color yardage (WOF 40″, ¼″ seam allowance, ⅛ yd rounding), batting, backing, binding, grand total, and patches-placed count
- Undo/redo (Ctrl/Cmd+Z, 100-step history)
- Zoom 25%–400% with keyboard shortcuts (+/−, 0 to reset)
- Fill All and Clear with confirmation modals
- Save and update designs with naming; cloud + local storage; auth gate when saving while logged out
- "My Quilts" drawer: load, preview modal, delete, reopen on canvas
- PDF downloads: template/cut list and assembly instructions
- Kit checkout: upload design to Shopify cart and redirect to checkout

### Cross-Stitch Studio

**Setup Wizard**

- Size presets: Coaster Set (40×40), Bookmark (30×120), Small Hoop (70×70), Medium Hoop (120×120)
- Pre-built chart templates (Alien, UFO, Celestial Moth, Floral Heart, Flower Bouquet, Alphabet Sampler, Cutout Leaves, Little Fish, Petal Scatter, Coral Wave, and more), RLE-encoded and resampled to the chosen size
- Photo-to-chart path: upload, drag-and-drop, paste, or URL entry with optional background removal, palette extraction, and auto-generated stitch grid
- Palette selector with 6 curated DMC floss palettes, photo-derived palette with editable swatches, or skip

**Editor**

- HTML5 canvas with pixel grid, 14-count gauge, and major gridlines every 10 cells
- Pen and eraser tools with nib sizes 1, 2, 3, and 5
- Color picker from active palette
- Text tool with three typefaces: serif (BC Civitas), sans (Söhne), and script (Dancing Script), rasterized to stitch cells
- Selection: tap color group, shift-add, marquee select, move, resize with 8 handles, aspect-ratio lock, and floating selection commit
- Background trace image with adjustable opacity slider
- 70+ Aida fabric color options (Wichelt 14ct range)
- Coaster set mode with 4 pages, copy-to-all, and merged materials stats
- Materials panel: stitch count per DMC color, skein estimates (1500 stitches/skein at 14ct), finished dimensions, and Aida cut size (+3″ margin per side)
- Save, design library, PDF download, and kit checkout (same patterns as quilt studio)
- Undo, zoom, and mobile bottom sheets for palette, text, and materials

### Punch Needle Studio

Uses the same grid editor as cross-stitch with craft-specific configuration.

**Setup Wizard**

- Size presets: Coaster (20×20 loops), Small Hoop (30×30), Wall Hanging (40×50), Pillow (70×70) — dimensions in loops at 5 per inch
- Templates: Sunburst, Wavy Stripes, Rolling Hills, Big Bloom
- DMC Laine Colbert tapestry wool color library with 6 wool palettes (max 8 colors)

**Editor**

- Same grid editor and tool set as cross-stitch
- Ground fabric: 16 monk's cloth color options
- Separate local storage drawer from cross-stitch (different gauge and color libraries)

### Shared Features Across Grid Crafts (Cross-Stitch & Punch Needle)

- Photo-to-chart pipeline with blur, speckle removal, edge cleanup, and simplify controls
- Template resampling via nearest-neighbor
- Custom DMC/wool color additions to palette

---

## Accounts & Authentication

- Email-based one-time-password (OTP) sign-in via Supabase — no passwords required
- 6-digit code sent to email using Supabase Magic Link templates
- Account menu with email display and sign-out
- Design library sync on sign-in: claim local designs once per device, hydrate from cloud, merge pending saves
- Graceful degradation: full design and PDF functionality works without an account; only cloud save requires sign-in

---

## Design Management

- **Local storage**: designs saved per-craft (`metime.savedQuilts.v1`, `metime.savedStitches.v1`, `metime.savedPunch.v1`)
- **Cloud storage**: designs synced to Supabase with user association
- **Guest designs**: unowned designs created for checkout (accessible by UUID)
- **Pending saves**: queued in `sessionStorage` when offline or unauthenticated, committed on sign-in
- **Design library**: browse, preview, rename, delete, and reopen saved designs
- **Design types**: quilt, cross-stitch, and punch-needle stored as validated JSONB payloads (max 256 KB)

---

## PDF Generation

- Server-rendered PDFs via Puppeteer-core and headless Chrome
- **Chart/template PDF**: quilt template with cut list; cross-stitch color chart with legend
- **Instructions PDF**: step-by-step assembly or stitching guide with kit contents list derived from the bill of materials
- Downloadable from the editor or previewable from the admin dashboard

---

## E-Commerce & Kit Checkout

- Shopify Storefront API integration for cart creation and checkout redirect
- Design UUID attached to kit line items as cart attributes
- Kit products configured for quilt and cross-stitch
- Shopify webhook (`orders/create`) processes incoming orders into the fulfillment queue
- Webhook-safe upserts: re-delivered webhooks do not reset fulfillment progress

---

## Bill of Materials (BOM) Engine

**Quilt**

- Per-color fabric yardage (width-of-fabric 40″, ¼″ seam allowance, ⅛ yd rounding)
- Batting, backing, and binding yardage
- Grand total and patch count

**Cross-Stitch**

- Aida fabric dimensions with 3″ margin per side
- Per-DMC-color stitch count and skein estimates (1500 stitches/skein at 14ct)
- Needle

---

## Admin Fulfillment Dashboard

- Token-gated access (`admin.html` with bearer auth)
- Order queue with status progression: New → Supplies Pulled → Printed → Shipped
- Per-item supply checklist
- Aggregate pull list across multiple orders
- Shipping address display
- PDF preview buttons for design charts and instructions
- Design-not-found warnings for missing or deleted designs

---

## Landing Page

- Hero section with tagline and craft overview
- Three craft cards (quilt, cross-stitch, punch needle)
- Saved designs section for returning users
- Responsive layout

---

## Mobile Support

- Bottom sheets for palette, size, fabrics, quilting pattern, materials, and text tool
- Collapsible right panel rail
- Touch-friendly canvas interactions

---

## Developer & Design Tools

- **Tweaks panel**: iframe `postMessage`-driven panel for adjusting border color/width, radius, and app/canvas background (design QA)
- **Asset generator scripts**: `gen-fabric-thumbs.mjs`, `gen-stitch-templates.mjs`, `gen-punch-templates.mjs`, `gen-tapestry-wool.mjs`

---

## Infrastructure

| Layer | Technology |
|-------|------------|
| Frontend | React 18 (UMD + Babel standalone), inline CSS, Iconoir icons |
| Typography | Söhne, BC Civitas, Söhne Mono (self-hosted); Dancing Script (Google Fonts) |
| Backend | Vercel serverless functions, Node 22 |
| Database & Auth | Supabase (Postgres + email OTP) |
| PDF Generation | Puppeteer-core + @sparticuz/chromium |
| E-Commerce | Shopify Storefront API + HMAC webhooks |
| Local Persistence | `localStorage` and `sessionStorage` |

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/designs` | GET | List user's designs (authenticated) |
| `/api/designs` | POST | Create a design (guest or authenticated) |
| `/api/designs/[id]` | GET | Read a design by UUID |
| `/api/designs/[id]` | PUT | Update a design |
| `/api/designs/[id]` | DELETE | Delete a design |
| `/api/render` | POST | Generate a PDF from a design |
| `/api/webhooks/order` | POST | Shopify order webhook → fulfillment queue |
| `/api/admin/orders` | GET | List orders for admin dashboard |
| `/api/admin/orders/[id]` | PATCH | Update order status or checklist |
| `/api/admin/render` | GET | Admin PDF preview by design ID |
