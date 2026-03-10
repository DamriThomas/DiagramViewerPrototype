# render_svg.py
# Renders a DXF to SVG and writes transform.json.
# PNG generation is handled separately by your preferred tool.
#
# Usage:
#   python render_svg.py input.dxf [output.svg]
#
# Outputs:
#   output.svg      — vector SVG via ezdxf SVGBackend
#   transform.json  — coordinate transform manifest for extract_manifest.py

import sys, json, re
import ezdxf
from ezdxf.addons.drawing import RenderContext, Frontend
from ezdxf.addons.drawing.svg import SVGBackend
from ezdxf.addons.drawing.layout import Page, Settings, Units, Margins
from ezdxf.bbox import extents as bbox_extents

dxf_path = sys.argv[1] if len(sys.argv) > 1 else "test_diagram.dxf"
svg_path  = sys.argv[2] if len(sys.argv) > 2 else "test_diagram.svg"

doc = ezdxf.readfile(dxf_path)
msp = doc.modelspace()

# ── 1. DXF extents via entity bbox scan ───────────────────────────────
# Never trust $EXTMIN/$EXTMAX — often sentinel values (~1e20)
print("Scanning entity extents...")
bbox = bbox_extents(msp)
if bbox is None or not bbox.has_data:
    sys.exit("ERROR: Could not determine drawing extents")

dxf_x_min, dxf_y_min = bbox.extmin.x, bbox.extmin.y
dxf_x_max, dxf_y_max = bbox.extmax.x, bbox.extmax.y
dxf_w = dxf_x_max - dxf_x_min
dxf_h = dxf_y_max - dxf_y_min
print(f"DXF extents : x=[{dxf_x_min:.4f}, {dxf_x_max:.4f}]  y=[{dxf_y_min:.4f}, {dxf_y_max:.4f}]")
print(f"DXF size    : {dxf_w:.4f} x {dxf_h:.4f} units")

# ── 2. Render SVG via ezdxf native SVGBackend ─────────────────────────
print("Rendering SVG...")
ctx     = RenderContext(doc)
backend = SVGBackend()
Frontend(ctx, backend).draw_layout(msp)

# Page(width, height, units, margins) — 0,0 = auto-fit to content
page       = Page(0, 0, Units.mm, Margins(0, 0, 0, 0))
svg_string = backend.get_string(page, settings=Settings())

with open(svg_path, "w", encoding="utf-8") as f:
    f.write(svg_string)
print(f"SVG written : {svg_path}")

# ── 3. Parse SVG viewBox ──────────────────────────────────────────────
# ezdxf SVGBackend outputs viewBox in mm (Units.mm above)
vb_match = re.search(r'viewBox="([^"]+)"', svg_string)
svg_vb_x, svg_vb_y, svg_vb_w, svg_vb_h = 0, 0, dxf_w, dxf_h  # fallback
if vb_match:
    parts = [float(x) for x in vb_match.group(1).split()]
    if len(parts) == 4:
        svg_vb_x, svg_vb_y, svg_vb_w, svg_vb_h = parts
print(f"SVG viewBox : {svg_vb_w:.4f} x {svg_vb_h:.4f} mm")

# ── 4. Write transform.json ───────────────────────────────────────────
# svg.viewbox_* is in mm — used for debug dot injection.
# Once you generate a PNG externally, fill in the png block and
# scale_x/scale_y so extract_manifest.py can produce Leaflet coords.
transform = {
    "dxf": {
        "x_min": dxf_x_min, "y_min": dxf_y_min,
        "x_max": dxf_x_max, "y_max": dxf_y_max,
        "width": dxf_w,     "height": dxf_h,
    },
    "svg": {
        "viewbox_x": svg_vb_x,
        "viewbox_y": svg_vb_y,
        "viewbox_w": svg_vb_w,
        "viewbox_h": svg_vb_h,
    },
    # Fill these in after generating your PNG externally, then re-run
    # extract_manifest.py with --transform transform.json
    #
    # "png": { "width_px": 0, "height_px": 0, "dpi": 0 },
    # "scale_x": 0,
    # "scale_y": 0,
    # "leaflet_bounds": [[-png_h, 0], [0, png_w]],
}

with open("transform.json", "w") as f:
    json.dump(transform, f, indent=2)

print("transform.json written")
print()
print("Next steps:")
print("  1. Convert output SVG to high-res PNG using your preferred tool")
print("  2. Add to transform.json:")
print('       "png": { "width_px": <w>, "height_px": <h>, "dpi": <dpi> }')
print('       "scale_x": <png_w / dxf_w>')
print('       "scale_y": <png_h / dxf_h>')
print('       "leaflet_bounds": [[-png_h, 0], [0, png_w]]')
print("  3. python extract_manifest.py --dxf ... --labels ... --transform transform.json")
