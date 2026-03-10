"""
extract_manifest.py
───────────────────
Generates label-manifest.json from a DXF file and a labels list.
Includes full coordinate transform chain: DXF → SVG → PNG → Leaflet CRS.Simple

Usage:
    # SVG-only (no PNG yet) — produces manifest + debug SVG:
    python extract_manifest.py \
        --dxf drawing.dxf \
        --labels labels.txt \
        --svg drawing.svg \
        --transform transform.json \
        --out label-manifest.json \
        --debug-svg debug_labels.svg

    # With PNG (full Leaflet coords):
    python extract_manifest.py \
        --dxf drawing.dxf \
        --labels labels.txt \
        --svg drawing.svg \
        --transform transform.json \
        --out label-manifest.json \
        --debug-svg debug_labels.svg

    # Inline labels:
    python extract_manifest.py \
        --dxf drawing.dxf \
        --labels-inline DV001 EV301 HV201 \
        --transform transform.json

Requirements:
    pip install ezdxf lxml
"""

import argparse
import json
import math
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


# ──────────────────────────────────────────────
# 1.  DXF EXTRACTION
# ──────────────────────────────────────────────

def extract_dxf_text_entities(dxf_path: str) -> list[dict]:
    """Walk every TEXT and MTEXT entity in the DXF modelspace."""
    try:
        import ezdxf
    except ImportError:
        sys.exit("ezdxf not installed. Run: pip install ezdxf")

    doc = ezdxf.readfile(dxf_path)
    msp = doc.modelspace()
    entities = []
    for entity in msp:
        etype = entity.dxftype()
        if etype == "TEXT":
            raw = _parse_text(entity)
            if raw:
                entities.append(raw)
        elif etype == "MTEXT":
            raw = _parse_mtext(entity)
            if raw:
                entities.append(raw)
    return entities


def extract_dxf_extents(dxf_path: str) -> dict | None:
    """Scan entity bounding box for drawing extents."""
    try:
        import ezdxf
        from ezdxf.bbox import extents as bbox_extents
    except ImportError:
        sys.exit("ezdxf not installed. Run: pip install ezdxf")

    doc  = ezdxf.readfile(dxf_path)
    msp  = doc.modelspace()
    bbox = bbox_extents(msp)

    if bbox is None or not bbox.has_data:
        return None

    x_min, y_min = bbox.extmin.x, bbox.extmin.y
    x_max, y_max = bbox.extmax.x, bbox.extmax.y
    return {
        "x_min": round(x_min, 6), "y_min": round(y_min, 6),
        "x_max": round(x_max, 6), "y_max": round(y_max, 6),
        "width":  round(x_max - x_min, 6),
        "height": round(y_max - y_min, 6),
    }


def _parse_text(e) -> dict | None:
    try:
        text = (e.dxf.text or "").strip()
        if not text:
            return None
        insert   = e.dxf.insert
        rotation = getattr(e.dxf, "rotation", 0.0) or 0.0
        height   = getattr(e.dxf, "height", 0.0) or 0.0
        layer    = getattr(e.dxf, "layer", "0") or "0"
        style    = getattr(e.dxf, "style", "STANDARD") or "STANDARD"
        halign   = getattr(e.dxf, "halign", 0)
        valign   = getattr(e.dxf, "valign", 0)
        return {
            "handle":   e.dxf.handle,
            "type":     "TEXT",
            "text":     text,
            "layer":    layer,
            "insert":   [round(insert.x, 4), round(insert.y, 4)],
            "rotation": round(rotation, 4),
            "height":   round(height, 4),
            "style":    style,
            "halign":   halign,
            "valign":   valign,
        }
    except Exception:
        return None


def _parse_mtext(e) -> dict | None:
    try:
        raw_text = e.plain_mtext().strip()
        if not raw_text:
            return None
        insert   = e.dxf.insert
        rotation = math.degrees(getattr(e.dxf, "rotation", 0.0) or 0.0)
        height   = getattr(e.dxf, "char_height", 0.0) or 0.0
        layer    = getattr(e.dxf, "layer", "0") or "0"
        return {
            "handle":   e.dxf.handle,
            "type":     "MTEXT",
            "text":     raw_text,
            "layer":    layer,
            "insert":   [round(insert.x, 4), round(insert.y, 4)],
            "rotation": round(rotation, 4),
            "height":   round(height, 4),
            "style":    None,
            "halign":   None,
            "valign":   None,
        }
    except Exception:
        return None


# ──────────────────────────────────────────────
# 2.  SVG TEXT EXTRACTION  (optional)
# ──────────────────────────────────────────────

def extract_svg_text_bboxes(svg_path: str) -> list[dict]:
    """
    Parse SVG <text> elements.
    ezdxf SVGBackend produces real <text> nodes (unlike matplotlib).
    """
    try:
        from lxml import etree
    except ImportError:
        print("Warning: lxml not installed — SVG text matching skipped.", file=sys.stderr)
        return []

    NS = "http://www.w3.org/2000/svg"
    tree = etree.parse(svg_path)
    root = tree.getroot()

    results = []
    for idx, el in enumerate(root.iter(f"{{{NS}}}text")):
        content = "".join(el.itertext()).strip()
        if not content:
            continue
        x         = _float_attr(el, "x")
        y         = _float_attr(el, "y")
        font_size = _parse_font_size(el)
        transform = el.get("transform", "") or _inherit_transform(el)
        approx_w  = round(len(content) * font_size * 0.6, 2) if font_size else None
        approx_h  = round(font_size * 1.2, 2) if font_size else None
        results.append({
            "element_index": idx,
            "text":          content,
            "x": x, "y": y,
            "font_size":     font_size,
            "transform":     transform,
            "bbox": {"x": x, "y": y, "width": approx_w, "height": approx_h}
                    if (x is not None and y is not None) else None,
        })
    return results


def _float_attr(el, attr) -> float | None:
    v = el.get(attr)
    if v is None:
        return None
    try:
        return round(float(v), 4)
    except ValueError:
        return None


def _parse_font_size(el) -> float | None:
    fs = el.get("font-size")
    if fs:
        try:
            return float(re.sub(r"[^\d.]", "", fs))
        except ValueError:
            pass
    m = re.search(r"font-size\s*:\s*([\d.]+)", el.get("style", ""))
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            pass
    return None


def _inherit_transform(el):
    parent = el.getparent()
    while parent is not None:
        t = parent.get("transform")
        if t:
            return t
        parent = parent.getparent()
    return ""


# ──────────────────────────────────────────────
# 3.  COORDINATE TRANSFORMS
#
#  Spaces:
#    DXF     — unitless CAD, Y-up, origin bottom-left
#    SVG     — mm (ezdxf viewBox), Y-down, origin top-left
#    PNG     — pixels, Y-down (only available after external PNG render)
#    Leaflet — CRS.Simple: lat=-png_y, lng=png_x
# ──────────────────────────────────────────────

class CoordTransform:
    """
    Coordinate transform chain built from transform.json.

    transform.json is written by render_svg.py.
    If png block is present, Leaflet coords are also available.
    """

    def __init__(self, t: dict):
        self.dxf      = t["dxf"]
        self.svg      = t["svg"]
        self.has_png  = "png" in t and t.get("scale_x") is not None
        self.scale_x  = t.get("scale_x")
        self.scale_y  = t.get("scale_y")
        self.png_w    = t["png"]["width_px"]  if self.has_png else None
        self.png_h    = t["png"]["height_px"] if self.has_png else None

    def dxf_to_svg(self, dxf_x: float, dxf_y: float) -> tuple[float, float]:
        """
        DXF coords → SVG viewBox coords (mm).
        Y is flipped: DXF Y-up → SVG Y-down.
        Also accounts for viewbox_x/y offset (ezdxf may not start at 0,0).
        """
        nx =  (dxf_x - self.dxf["x_min"]) / self.dxf["width"]
        ny = 1.0 - (dxf_y - self.dxf["y_min"]) / self.dxf["height"]
        vb_x = self.svg["viewbox_x"]
        vb_y = self.svg["viewbox_y"]
        sx = vb_x + nx * self.svg["viewbox_w"]
        sy = vb_y + ny * self.svg["viewbox_h"]
        return round(sx, 4), round(sy, 4)

    def dxf_to_png(self, dxf_x: float, dxf_y: float) -> tuple[float, float]:
        """DXF coords → PNG pixel coords. Requires PNG data in transform.json."""
        if not self.has_png:
            raise ValueError("PNG dimensions not in transform.json — add png block first")
        px =  (dxf_x - self.dxf["x_min"]) * self.scale_x
        py = self.png_h - (dxf_y - self.dxf["y_min"]) * self.scale_y
        return round(px, 4), round(py, 4)

    def dxf_to_leaflet(self, dxf_x: float, dxf_y: float) -> dict | None:
        """DXF coords → Leaflet CRS.Simple {lat, lng}. Requires PNG data."""
        if not self.has_png:
            return None
        px, py = self.dxf_to_png(dxf_x, dxf_y)
        return {"lat": round(-py, 4), "lng": round(px, 4)}

    def leaflet_bounds(self) -> list | None:
        if not self.has_png:
            return None
        return [[-self.png_h, 0], [0, self.png_w]]

    def to_dict(self) -> dict:
        d = {
            "dxf": self.dxf,
            "svg": self.svg,
        }
        if self.has_png:
            d["png"]            = {"width_px": self.png_w, "height_px": self.png_h}
            d["scale_x"]        = self.scale_x
            d["scale_y"]        = self.scale_y
            d["leaflet_bounds"] = self.leaflet_bounds()
        return d


# ──────────────────────────────────────────────
# 4.  MATCHING
# ──────────────────────────────────────────────

def build_dxf_index(entities: list[dict]) -> dict[str, list[dict]]:
    index = defaultdict(list)
    for e in entities:
        index[e["text"].strip()].append(e)
    return dict(index)


def build_svg_index(svg_entities: list[dict]) -> dict[str, list[dict]]:
    index = defaultdict(list)
    for e in svg_entities:
        index[e["text"].strip()].append(e)
    return dict(index)


def pick_best_dxf_match(matches, layer_priority) -> tuple[dict, bool]:
    is_dup = len(matches) > 1
    if not is_dup:
        return matches[0], False
    for layer in [l.upper() for l in layer_priority]:
        for m in matches:
            if m["layer"].upper() == layer:
                return m, True
    return matches[0], True


def match_labels(
    target_labels:  list[str],
    dxf_index:      dict,
    svg_index:      dict,
    layer_priority: list[str],
    transform:      CoordTransform | None,
) -> dict:
    labels = {}
    for label in target_labels:
        key         = label.strip()
        dxf_matches = dxf_index.get(key, [])
        svg_matches = svg_index.get(key, [])

        if not dxf_matches:
            # Case-insensitive fuzzy fallback
            ci_key     = key.upper()
            ci_matches = [
                e for k, elist in dxf_index.items()
                if k.upper() == ci_key for e in elist
            ]
            if ci_matches:
                best, is_dup = pick_best_dxf_match(ci_matches, layer_priority)
                labels[key]  = _build_entry(key, best, svg_matches, is_dup,
                                            ci_matches if is_dup else None,
                                            fuzzy_match=True, transform=transform)
            else:
                labels[key] = _not_found_entry(key)
        else:
            best, is_dup = pick_best_dxf_match(dxf_matches, layer_priority)
            labels[key]  = _build_entry(key, best, svg_matches, is_dup,
                                        dxf_matches if is_dup else None,
                                        fuzzy_match=False, transform=transform)
    return labels


def _not_found_entry(key: str) -> dict:
    return {
        "text": key, "found": False, "duplicate": False,
        "fuzzy_match": False, "dxf": None, "svg": None,
        "coords": None, "all_dxf_matches": [], "meta": {},
    }


def _build_entry(key, dxf_match, svg_matches, is_duplicate,
                 all_dxf, fuzzy_match, transform) -> dict:
    svg_primary = svg_matches[0] if svg_matches else None
    dxf_x, dxf_y = dxf_match["insert"]

    # ── Coordinate transforms ──────────────────────────────────────────
    coords = None
    if transform is not None:
        svg_xy  = transform.dxf_to_svg(dxf_x, dxf_y)
        leaflet = transform.dxf_to_leaflet(dxf_x, dxf_y)  # None if no PNG
        coords  = {
            "dxf":     {"x": dxf_x,     "y": dxf_y},
            "svg":     {"x": svg_xy[0],  "y": svg_xy[1]},
            "leaflet": leaflet,
        }
        if transform.has_png:
            png_xy          = transform.dxf_to_png(dxf_x, dxf_y)
            coords["png"]   = {"x": png_xy[0], "y": png_xy[1]}

    entry = {
        "text":        key,
        "found":       True,
        "duplicate":   is_duplicate,
        "fuzzy_match": fuzzy_match,
        "dxf": {
            "handle":   dxf_match["handle"],
            "type":     dxf_match["type"],
            "insert":   dxf_match["insert"],
            "rotation": dxf_match["rotation"],
            "height":   dxf_match["height"],
            "layer":    dxf_match["layer"],
            "style":    dxf_match["style"],
            "halign":   dxf_match["halign"],
            "valign":   dxf_match["valign"],
        },
        "svg": {
            "element_index": svg_primary["element_index"],
            "bbox":          svg_primary["bbox"],
            "transform":     svg_primary["transform"],
            "font_size":     svg_primary["font_size"],
        } if svg_primary else None,
        "coords": coords,
        "meta":   {},
    }

    entry["all_dxf_matches"] = [
        {"handle": m["handle"], "layer": m["layer"], "insert": m["insert"]}
        for m in all_dxf
    ] if (is_duplicate and all_dxf) else []

    return entry


# ──────────────────────────────────────────────
# 5.  HITBOXES  (flat Leaflet-ready list)
# ──────────────────────────────────────────────

def build_hitboxes(labels: dict) -> list[dict]:
    """Flat list consumed directly by the Leaflet viewer."""
    hitboxes = []
    for key, entry in labels.items():
        if not entry["found"] or entry["coords"] is None:
            continue
        leaflet = entry["coords"].get("leaflet")
        hitboxes.append({
            "label":   entry["text"],
            "found":   True,
            "dxf":     entry["coords"]["dxf"],
            "svg":     entry["coords"]["svg"],
            "leaflet": leaflet,   # None until PNG dims are added to transform.json
            "meta": {
                "layer":       entry["dxf"]["layer"],
                "type":        entry["dxf"]["type"],
                "handle":      entry["dxf"]["handle"],
                "duplicate":   entry["duplicate"],
                "fuzzy_match": entry["fuzzy_match"],
            },
        })
    return hitboxes


# ──────────────────────────────────────────────
# 6.  DEBUG SVG
# ──────────────────────────────────────────────

def write_debug_svg(svg_path: str, labels: dict, output_path: str,
                    transform: CoordTransform) -> None:
    """
    Inject red dots at each label's SVG viewBox coordinates.
    Open in a browser — dots should sit on the matching text entities.
    Uses SVG coords so no PNG required.
    """
    import xml.etree.ElementTree as ET
    ET.register_namespace("", "http://www.w3.org/2000/svg")
    tree = ET.parse(svg_path)
    root = tree.getroot()
    ns   = "http://www.w3.org/2000/svg"

    vb_w = transform.svg["viewbox_w"]
    vb_h = transform.svg["viewbox_h"]
    dot_r      = round(vb_w * 0.003, 2)
    font_size  = round(vb_h * 0.012, 2)
    label_dx   = round(vb_w * 0.004, 4)

    for key, entry in labels.items():
        if not entry["found"] or entry["coords"] is None:
            continue

        sx = entry["coords"]["svg"]["x"]
        sy = entry["coords"]["svg"]["y"]

        dot = ET.SubElement(root, f"{{{ns}}}circle")
        dot.set("cx",           str(sx))
        dot.set("cy",           str(sy))
        dot.set("r",            str(dot_r))
        dot.set("fill",         "red")
        dot.set("opacity",      "0.8")
        dot.set("stroke",       "white")
        dot.set("stroke-width", str(round(dot_r * 0.2, 2)))

        lbl = ET.SubElement(root, f"{{{ns}}}text")
        lbl.set("x",         str(round(sx + label_dx, 4)))
        lbl.set("y",         str(round(sy + label_dx, 4)))
        lbl.set("font-size", str(font_size))
        lbl.set("fill",      "red")
        lbl.text = key

    tree.write(output_path, xml_declaration=True, encoding="unicode")
    print(f"Debug SVG written: {output_path}")
    print("  → Open in browser — red dots should sit on matching text entities.")


# ──────────────────────────────────────────────
# 7.  MANIFEST ASSEMBLY
# ──────────────────────────────────────────────

def build_manifest(
    dxf_path:       str,
    svg_path:       str | None,
    target_labels:  list[str],
    layer_priority: list[str],
    transform:      CoordTransform | None,
) -> dict:
    print(f"[1/4] Reading DXF: {dxf_path}")
    dxf_entities = extract_dxf_text_entities(dxf_path)
    print(f"      → {len(dxf_entities)} text entities found")

    svg_entities = []
    if svg_path:
        print(f"[2/4] Reading SVG: {svg_path}")
        svg_entities = extract_svg_text_bboxes(svg_path)
        print(f"      → {len(svg_entities)} <text> elements found")
        if not svg_entities:
            print("      (no <text> elements — SVG may use outlined paths, DXF coords used instead)")
    else:
        print("[2/4] No SVG provided — skipping SVG text extraction")

    print(f"[3/4] Matching {len(target_labels)} labels...")
    dxf_index = build_dxf_index(dxf_entities)
    svg_index = build_svg_index(svg_entities)
    labels    = match_labels(target_labels, dxf_index, svg_index,
                             layer_priority, transform)

    found      = sum(1 for v in labels.values() if v["found"])
    not_found  = sum(1 for v in labels.values() if not v["found"])
    duplicates = sum(1 for v in labels.values() if v["duplicate"])
    fuzzy      = sum(1 for v in labels.values() if v.get("fuzzy_match"))
    has_coords = sum(1 for v in labels.values() if v.get("coords") is not None)
    has_leaflet= sum(1 for v in labels.values()
                     if v.get("coords") and v["coords"].get("leaflet"))

    hitboxes = build_hitboxes(labels)

    manifest = {
        "version":        "1.2",
        "source_dxf":     os.path.basename(dxf_path),
        "source_svg":     os.path.basename(svg_path) if svg_path else None,
        "generated_at":   datetime.now(timezone.utc).isoformat(),
        "layer_priority": layer_priority,
        "transform":      transform.to_dict() if transform else None,
        "hitboxes":       hitboxes,
        "labels":         labels,
        "stats": {
            "total_searched":    len(target_labels),
            "found":             found,
            "not_found":         not_found,
            "duplicate_matches": duplicates,
            "fuzzy_matches":     fuzzy,
            "with_coords":       has_coords,
            "with_leaflet":      has_leaflet,
        },
    }

    print(f"[4/4] Done.")
    print(f"      found={found}  not_found={not_found}  duplicates={duplicates}"
          f"  fuzzy={fuzzy}  coords={has_coords}  leaflet={has_leaflet}")

    if has_leaflet == 0 and transform and not transform.has_png:
        print()
        print("  ℹ  No Leaflet coords yet — add PNG dimensions to transform.json")
        print("     then re-run to get hitboxes.leaflet populated.")

    return manifest


# ──────────────────────────────────────────────
# 8.  CLI
# ──────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(
        description="Generate label-manifest.json from DXF + labels list."
    )
    p.add_argument("--dxf",       required=True, help="Path to .dxf file")
    p.add_argument("--svg",       default=None,  help="Path to .svg file (from render_svg.py)")
    p.add_argument("--transform", default=None,  help="Path to transform.json (from render_svg.py)")
    p.add_argument("--out",       default="label-manifest.json")

    grp = p.add_mutually_exclusive_group(required=True)
    grp.add_argument("--labels",        metavar="FILE",
                     help="Text file, one label per line")
    grp.add_argument("--labels-inline", nargs="+", metavar="LABEL")

    p.add_argument("--layer-priority", nargs="*",
                   default=["TAGS", "EQUIP", "ANNO", "TEXT"],
                   metavar="LAYER")
    p.add_argument("--debug-svg", default=None, metavar="PATH",
                   help="Write debug SVG with red dots at label SVG positions")
    p.add_argument("--verbose",   action="store_true")
    return p.parse_args()


def load_labels_from_file(path: str) -> list[str]:
    with open(path, "r", encoding="utf-8") as f:
        return [l.strip() for l in f if l.strip() and not l.startswith("#")]


def main():
    args = parse_args()

    target_labels = (load_labels_from_file(args.labels)
                     if args.labels else args.labels_inline)

    # Deduplicate, preserve order
    seen, unique = set(), []
    for l in target_labels:
        if l not in seen:
            seen.add(l)
            unique.append(l)
    if len(unique) < len(target_labels):
        print(f"Warning: removed {len(target_labels) - len(unique)} duplicate labels")

    # Load transform
    transform = None
    if args.transform:
        with open(args.transform, "r", encoding="utf-8") as f:
            transform = CoordTransform(json.load(f))
        print(f"Transform loaded: {args.transform}")
        if transform.has_png:
            print(f"  PNG: {transform.png_w}px × {transform.png_h}px  "
                  f"scale_x={transform.scale_x:.4f} scale_y={transform.scale_y:.4f}")
        else:
            print("  PNG dims not present — Leaflet coords will be null")
    else:
        print("No --transform provided — coords will be null")

    manifest = build_manifest(
        dxf_path=args.dxf,
        svg_path=args.svg,
        target_labels=unique,
        layer_priority=args.layer_priority,
        transform=transform,
    )

    # Write manifest
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"\nManifest written : {out_path}")

    # Write hitboxes.json alongside
    hitboxes_path = out_path.parent / "hitboxes.json"
    with open(hitboxes_path, "w", encoding="utf-8") as f:
        json.dump(manifest["hitboxes"], f, indent=2, ensure_ascii=False)
    print(f"Hitboxes written : {hitboxes_path}")

    # Debug SVG
    if args.debug_svg:
        if not args.svg:
            print("Warning: --debug-svg requires --svg", file=sys.stderr)
        elif transform is None:
            print("Warning: --debug-svg requires --transform", file=sys.stderr)
        else:
            write_debug_svg(args.svg, manifest["labels"], args.debug_svg, transform)

    # Unmatched labels
    missing = [k for k, v in manifest["labels"].items() if not v["found"]]
    if missing:
        print(f"\n⚠  Unmatched labels ({len(missing)}):")
        for label in missing:
            print(f"   - {label}")


if __name__ == "__main__":
    main()