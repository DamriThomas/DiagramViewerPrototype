# DXF → Leaflet Diagram Viewer Pipeline

## Overview

```
input.dxf + labels.txt
        │
        ├─── [1] EXTRACT ──────► dxf_labels.json
        │                        transform.json (partial)
        │
        ├─── [2] RENDER ───────► output.svg
        │                        transform.json (complete)
        │
        ├─── [3] RASTERISE ────► highres.png
        │
        ├─── [4] TILE ─────────► tiles/{z}/{x}/{y}.png
        │                        manifest.json
        │
        ├─── [5] COORDINATES ──► hitboxes.json
        │
        ├─── [6] VALIDATE ─────► debug_labels.svg  (dev only)
        │
        └─── [7] VIEWER ───────► Leaflet CRS.Simple
```

---

## Inputs

| File | Description |
|---|---|
| `input.dxf` | Raw CAD export from engineering team |
| `labels.txt` | Newline-separated list of text labels to locate and create hitboxes for |

---

## Stage 1 — Extract

**Tool:** `ezdxf` (Python)

**What it does:**
- Iterates all `TEXT` and `MTEXT` entities in the DXF modelspace
- Captures the DXF-space insert coordinate `(x, y)` for each text entity
- Captures drawing extents (`x_min`, `x_max`, `y_min`, `y_max`) via `ezdxf.bbox.extents()`

**Command:**
```bash
python extract_labels.py input.dxf
```

**Outputs:**

`dxf_labels.json` — ground-truth label positions in DXF coordinate space
```json
{
  "PUMP-01": { "dxf_x": 120.4, "dxf_y": 88.2 },
  "VALVE-03": { "dxf_x": 340.1, "dxf_y": 210.7 }
}
```

`transform.json` (partial) — drawing extents captured here, completed in Stage 2
```json
{
  "dxf": {
    "x_min": 0.0, "x_max": 841.0,
    "y_min": 0.0, "y_max": 594.0,
    "width": 841.0, "height": 594.0
  }
}
```

> **Note:** `dxf_labels.json` is the ground truth for all coordinate transforms. Never derive label positions from the rendered SVG or PNG — always derive from the DXF and transform forward.

---

## Stage 2 — Render SVG

**Tool:** `ezdxf` + `matplotlib`

**What it does:**
- Renders DXF at a fixed `figsize` with `DPI=96`
- Captures actual matplotlib axis limits (`xlim`/`ylim`) post-render — these are the true DXF coordinate window being rendered
- Saves as `output.svg`
- Completes `transform.json` with SVG dimensions and scale factor

**Command:**
```bash
python render_svg.py input.dxf --figsize 40 --dpi 96 --scale 8
# or using ezdxf CLI:
python -m ezdxf draw --fmt svg --out output.svg input.dxf
```

**Outputs:**

`output.svg` — full-fidelity vector SVG of the diagram

`transform.json` (complete) — single source of truth for all coordinate maths
```json
{
  "dxf": {
    "x_min": 0.0, "x_max": 841.0,
    "y_min": 0.0, "y_max": 594.0,
    "width": 841.0, "height": 594.0
  },
  "svg": {
    "width_px": 3840,
    "height_px": 2880
  },
  "png_scale": 8.0
}
```

> **Important:** `png_scale` in `transform.json` must match the scale factor used in Stage 3. If you change the scale, update this value before running Stage 5.

---

## Stage 3 — Rasterise

**Tool:** `cairosvg` (preferred) or `Inkscape CLI` (for very large outputs >20k px)

**What it does:**
- Converts `output.svg` to a high-resolution PNG
- Scale factor must match `png_scale` in `transform.json`
- Uses lanczos resampling for clean line art

**Commands:**
```bash
# cairosvg (recommended)
cairosvg output.svg --scale 8 -o highres.png

# Inkscape CLI (for very large drawings)
inkscape output.svg --export-type=png --export-filename=highres.png --export-dpi=600
```

**Output:**

`highres.png` — full-resolution raster, e.g. ~26,000 × 18,000 px for an A0 drawing at 8× scale

---

## Stage 4 — Tile

**Tool:** `gdal2tiles` (Python) or `sharp` (Node.js)

**What it does:**
- Slices `highres.png` into a 256×256 tile pyramid
- `--profile=raster` for non-geographic flat image (no map projection)
- `--resampling=lanczos` for line art quality
- Generates `manifest.json` with image dimensions and Leaflet bounds

**Commands:**
```bash
# gdal2tiles (recommended)
gdal2tiles.py \
  --profile=raster \
  --zoom=0-5 \
  --tilesize=256 \
  --resampling=lanczos \
  highres.png \
  ./tiles/

# Then generate manifest
python build_manifest.py highres.png ./tiles/manifest.json
```

**Outputs:**

`tiles/{z}/{x}/{y}.png` — Leaflet-ready tile pyramid
- `z=0` — whole drawing in one tile
- `z=5` — maximum detail

`manifest.json` — Leaflet bounds and tile config
```json
{
  "width": 26000,
  "height": 18000,
  "tileSize": 256,
  "minZoom": 0,
  "maxZoom": 5,
  "bounds": [[-18000, 0], [0, 26000]]
}
```

---

## Stage 5 — Coordinates

**Tool:** Python, using `transform.json` + `dxf_labels.json` + `labels.txt`

**What it does:**
- Reads `labels.txt` and looks up each label in `dxf_labels.json`
- Applies `dxf_to_leaflet()` transform using `transform.json`
- Outputs `hitboxes.json` with Leaflet coordinates for every matched label

**Transform chain for `dxf_to_leaflet()`:**
```
1. Normalise DXF coords to 0..1 range using DXF extents
2. Flip Y axis  →  DXF is Y-up, SVG/PNG are Y-down
3. Scale to PNG pixels using png_scale
4. Convert to Leaflet CRS.Simple: [-png_y, png_x]
```

**Command:**
```bash
python build_hitboxes.py \
  --labels labels.txt \
  --dxf-labels dxf_labels.json \
  --transform transform.json \
  --out hitboxes.json
```

**Output:**

`hitboxes.json` — per-label Leaflet coordinates, used directly by the viewer
```json
[
  {
    "label": "PUMP-01",
    "dxf":     { "x": 120.4, "y": 88.2 },
    "leaflet": { "lat": -7056.0, "lng": 5523.2 }
  }
]
```

> **Note:** `dxf_to_svg()` and `dxf_to_png()` are not needed in production. Leaflet is the sole rendering target. The PNG tiles and SVG are the visual backdrop — all interactive layers (hitboxes, markers, tooltips) are Leaflet layers using `dxf_to_leaflet()` coordinates only.

---

## Stage 6 — Validate (Development Only)

**Tool:** Python + `xml.etree.ElementTree`

**What it does:**
- Injects red dots at each label's SVG coordinates into `output.svg`
- Open result in a browser — if dots sit on the correct text entities, the full coordinate chain is correct
- Fix any misalignment here before touching PNG or Leaflet layers

**Command:**
```bash
python debug_labels.py \
  --svg output.svg \
  --hitboxes hitboxes.json \
  --transform transform.json \
  --out debug_labels.svg
```

**Output:**

`debug_labels.svg` — `output.svg` with red debug dots overlaid at each label position

---

## Stage 7 — Viewer

**Tool:** Leaflet.js with `CRS.Simple`

**What it does:**
- Loads tile pyramid as the base layer
- Adds `L.svgOverlay` for crisp vector rendering at high zoom
- Places `L.marker` or `L.rectangle` hitboxes from `hitboxes.json`

**Setup:**
```js
const map = L.map('viewer', {
  crs: L.CRS.Simple,
  minZoom: manifest.minZoom,
  maxZoom: manifest.maxZoom,
  zoomSnap: 0.5,
})

// Tile base layer
L.tileLayer('tiles/{z}/{x}/{y}.png', {
  tileSize: 256,
  noWrap: true,
  bounds: manifest.bounds,
}).addTo(map)

// SVG overlay at high zoom only
map.on('zoomend', () => {
  if (map.getZoom() > 3) svgOverlay.addTo(map)
  else svgOverlay.remove()
})

// Hitboxes from hitboxes.json
hitboxes.forEach(h => {
  L.marker([h.leaflet.lat, h.leaflet.lng])
   .bindTooltip(h.label)
   .addTo(map)
})

map.fitBounds(manifest.bounds)
```

---

## Key Files Summary

| File | Stage | Purpose |
|---|---|---|
| `input.dxf` | Input | Source CAD drawing |
| `labels.txt` | Input | Labels to locate |
| `dxf_labels.json` | 1 | Ground-truth label positions (DXF space) |
| `transform.json` | 1–2 | **KEY** — complete coordinate transform chain |
| `output.svg` | 2 | Vector SVG for high-zoom Leaflet overlay |
| `highres.png` | 3 | High-res raster, input to tiler |
| `tiles/{z}/{x}/{y}.png` | 4 | Leaflet tile pyramid |
| `manifest.json` | 4 | Leaflet bounds and zoom config |
| `hitboxes.json` | 5 | **KEY** — Leaflet coordinates for all labels |
| `debug_labels.svg` | 6 | Dev-only coordinate validation |

---

## Coordinate Spaces Reference

| Space | Origin | Y direction | Units |
|---|---|---|---|
| DXF | Bottom-left | Up | Unitless CAD |
| SVG | Top-left | Down | Pixels (96 DPI) |
| PNG | Top-left | Down | Pixels (scaled) |
| Leaflet CRS.Simple | Top-left | Down (`-y`) | `[lat, lng]` = `[-png_y, png_x]` |

The Y-flip between DXF and all raster/screen spaces is the most common source of misaligned hitboxes.
