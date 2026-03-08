"""
extract_manifest.py
───────────────────
Generates label-manifest.json from a DXF file and a target text array.

Usage:
    python extract_manifest.py \
        --dxf path/to/drawing.dxf \
        --labels labels.txt \        # one label per line  OR
        --labels-inline A11 M24 AC52 \
        --svg path/to/drawing.svg \  # optional – adds svg.bbox data
        --out label-manifest.json \
        --layer-priority TAGS EQUIP ANNO \
        --verbose

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
# 1.  DXF EXTRACTION  (requires ezdxf)
# ──────────────────────────────────────────────

def extract_dxf_text_entities(dxf_path: str) -> list[dict]:
    """
    Walk every TEXT and MTEXT entity in an exploded DXF.
    Returns a flat list of raw entity dicts.
    """
    try:
        import ezdxf
        from ezdxf.math import Matrix44
    except ImportError:
        sys.exit(
            "ezdxf not installed. Run:  pip install ezdxf"
        )

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


def _parse_text(e) -> dict | None:
    """Parse a TEXT entity into a normalised dict."""
    try:
        text = (e.dxf.text or "").strip()
        if not text:
            return None

        insert = e.dxf.insert          # Vec3
        rotation = getattr(e.dxf, "rotation", 0.0) or 0.0
        height   = getattr(e.dxf, "height", 0.0) or 0.0
        layer    = getattr(e.dxf, "layer", "0") or "0"
        style    = getattr(e.dxf, "style", "STANDARD") or "STANDARD"
        halign   = getattr(e.dxf, "halign", 0)
        valign   = getattr(e.dxf, "valign", 0)
        handle   = e.dxf.handle

        return {
            "handle":   handle,
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
    except Exception as exc:
        return None


def _parse_mtext(e) -> dict | None:
    """
    Parse an MTEXT entity.
    MTEXT can contain inline formatting codes – we strip them for matching.
    """
    try:
        raw_text = e.plain_mtext().strip()
        if not raw_text:
            return None

        insert   = e.dxf.insert
        rotation = math.degrees(
            getattr(e.dxf, "rotation", 0.0) or 0.0
        )
        height   = getattr(e.dxf, "char_height", 0.0) or 0.0
        layer    = getattr(e.dxf, "layer", "0") or "0"
        handle   = e.dxf.handle

        return {
            "handle":   handle,
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
# 2.  SVG BBOX EXTRACTION  (optional, requires lxml)
# ──────────────────────────────────────────────

def extract_svg_text_bboxes(svg_path: str) -> list[dict]:
    """
    Parse an SVG and extract every <text> element with:
      - element index (document order)
      - text content (stripped)
      - x, y attributes
      - transform attribute
      - font-size
    Note: true rendered bbox needs a browser; we approximate from attributes.
    """
    try:
        from lxml import etree
    except ImportError:
        print("Warning: lxml not installed – SVG matching skipped.", file=sys.stderr)
        return []

    NS = "http://www.w3.org/2000/svg"

    tree = etree.parse(svg_path)
    root = tree.getroot()

    results = []
    for idx, el in enumerate(root.iter(f"{{{NS}}}text")):
        # Collect all text content including tspans
        content = "".join(el.itertext()).strip()
        if not content:
            continue

        x         = _float_attr(el, "x")
        y         = _float_attr(el, "y")
        font_size = _parse_font_size(el)
        transform = el.get("transform", "") or _inherit_transform(el)

        # Approximate width from character count × font_size × 0.6
        char_count = len(content)
        approx_w   = round(char_count * font_size * 0.6, 2) if font_size else None
        approx_h   = round(font_size * 1.2, 2) if font_size else None

        results.append({
            "element_index": idx,
            "text":          content,
            "x":             x,
            "y":             y,
            "font_size":     font_size,
            "transform":     transform,
            "bbox": {
                "x":      x,
                "y":      y,
                "width":  approx_w,
                "height": approx_h,
            } if (x is not None and y is not None) else None,
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
    """Check font-size attribute and inline style."""
    fs = el.get("font-size")
    if fs:
        try:
            return float(re.sub(r"[^\d.]", "", fs))
        except ValueError:
            pass
    style = el.get("style", "")
    m = re.search(r"font-size\s*:\s*([\d.]+)", style)
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            pass
    return None


def _inherit_transform(el):
    """Walk up the tree collecting the first ancestor transform."""
    parent = el.getparent()
    while parent is not None:
        t = parent.get("transform")
        if t:
            return t
        parent = parent.getparent()
    return ""


# ──────────────────────────────────────────────
# 3.  MATCHING
# ──────────────────────────────────────────────

def build_dxf_index(entities: list[dict]) -> dict[str, list[dict]]:
    """Index DXF entities by their text value for O(1) lookup."""
    index = defaultdict(list)
    for e in entities:
        key = e["text"].strip()
        index[key].append(e)
    return dict(index)


def build_svg_index(svg_entities: list[dict]) -> dict[str, list[dict]]:
    """Index SVG text elements by content."""
    index = defaultdict(list)
    for e in svg_entities:
        key = e["text"].strip()
        index[key].append(e)
    return dict(index)


def pick_best_dxf_match(
    matches: list[dict],
    layer_priority: list[str]
) -> tuple[dict, bool]:
    """
    Given multiple DXF matches for one label string, pick the best one.
    Priority order: layer_priority list, then first found.
    Returns (chosen_match, is_duplicate).
    """
    is_duplicate = len(matches) > 1

    if not is_duplicate:
        return matches[0], False

    # Try layer priority
    priority_upper = [l.upper() for l in layer_priority]
    for layer in priority_upper:
        for m in matches:
            if m["layer"].upper() == layer:
                return m, True

    # Fallback: first match
    return matches[0], True


def match_labels(
    target_labels: list[str],
    dxf_index:     dict[str, list[dict]],
    svg_index:     dict[str, list[dict]],
    layer_priority: list[str],
) -> dict:
    """
    For each target label string, find its DXF entity and (optionally) SVG element.
    Returns the full labels dict for the manifest.
    """
    labels = {}

    for label in target_labels:
        key = label.strip()
        dxf_matches = dxf_index.get(key, [])
        svg_matches = svg_index.get(key, [])

        if not dxf_matches:
            # ── NOT FOUND ──
            # Try fuzzy: case-insensitive
            ci_key = key.upper()
            ci_matches = [
                e for k, e_list in dxf_index.items()
                if k.upper() == ci_key
                for e in e_list
            ]

            if ci_matches:
                best, is_dup = pick_best_dxf_match(ci_matches, layer_priority)
                labels[key] = _build_entry(
                    key, best, svg_matches, is_dup,
                    ci_matches if is_dup else None,
                    fuzzy_match=True
                )
            else:
                labels[key] = {
                    "text":      key,
                    "found":     False,
                    "duplicate": False,
                    "fuzzy_match": False,
                    "dxf":       None,
                    "svg":       None,
                    "all_dxf_matches": [],
                    "meta":      {},
                }
        else:
            # ── FOUND ──
            best, is_dup = pick_best_dxf_match(dxf_matches, layer_priority)
            labels[key] = _build_entry(
                key, best, svg_matches, is_dup,
                dxf_matches if is_dup else None,
                fuzzy_match=False
            )

    return labels


def _build_entry(
    key:         str,
    dxf_match:   dict,
    svg_matches: list[dict],
    is_duplicate: bool,
    all_dxf:     list[dict] | None,
    fuzzy_match: bool,
) -> dict:
    svg_primary = svg_matches[0] if svg_matches else None

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
        "meta": {},
    }

    # For duplicates, include all matches for manual review
    if is_duplicate and all_dxf:
        entry["all_dxf_matches"] = [
            {
                "handle": m["handle"],
                "layer":  m["layer"],
                "insert": m["insert"],
            }
            for m in all_dxf
        ]
    else:
        entry["all_dxf_matches"] = []

    return entry


# ──────────────────────────────────────────────
# 4.  MANIFEST ASSEMBLY
# ──────────────────────────────────────────────

def build_manifest(
    dxf_path:       str,
    svg_path:       str | None,
    target_labels:  list[str],
    layer_priority: list[str],
) -> dict:
    print(f"[1/4] Reading DXF: {dxf_path}")
    dxf_entities = extract_dxf_text_entities(dxf_path)
    print(f"      → {len(dxf_entities)} text entities found in DXF")

    svg_entities = []
    if svg_path:
        print(f"[2/4] Reading SVG: {svg_path}")
        svg_entities = extract_svg_text_bboxes(svg_path)
        print(f"      → {len(svg_entities)} text elements found in SVG")
    else:
        print("[2/4] No SVG provided – skipping SVG bbox extraction")

    print(f"[3/4] Matching {len(target_labels)} labels...")
    dxf_index = build_dxf_index(dxf_entities)
    svg_index = build_svg_index(svg_entities)
    labels    = match_labels(target_labels, dxf_index, svg_index, layer_priority)

    # Stats
    found         = sum(1 for v in labels.values() if v["found"])
    not_found     = sum(1 for v in labels.values() if not v["found"])
    duplicates    = sum(1 for v in labels.values() if v["duplicate"])
    fuzzy         = sum(1 for v in labels.values() if v.get("fuzzy_match"))
    missing_svg   = sum(
        1 for v in labels.values()
        if v["found"] and v["svg"] is None
    )

    manifest = {
        "version":        "1.0",
        "source_dxf":     os.path.basename(dxf_path),
        "source_svg":     os.path.basename(svg_path) if svg_path else None,
        "generated_at":   datetime.now(timezone.utc).isoformat(),
        "layer_priority": layer_priority,
        "labels":         labels,
        "stats": {
            "total_searched":   len(target_labels),
            "found":            found,
            "not_found":        not_found,
            "duplicate_matches": duplicates,
            "fuzzy_matches":    fuzzy,
            "missing_svg_bbox": missing_svg,
        },
    }

    print(f"[4/4] Done.")
    print(f"      found={found}  not_found={not_found}  "
          f"duplicates={duplicates}  fuzzy={fuzzy}  missing_svg={missing_svg}")

    return manifest


# ──────────────────────────────────────────────
# 5.  CLI
# ──────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(
        description="Generate label-manifest.json from DXF + text array"
    )
    p.add_argument("--dxf",    required=True,  help="Path to .dxf file")
    p.add_argument("--svg",    default=None,   help="Path to .svg file (optional)")
    p.add_argument("--out",    default="label-manifest.json",
                               help="Output path (default: label-manifest.json)")

    # Label input: file or inline
    label_group = p.add_mutually_exclusive_group(required=True)
    label_group.add_argument(
        "--labels", metavar="FILE",
        help="Path to text file with one label per line"
    )
    label_group.add_argument(
        "--labels-inline", nargs="+", metavar="LABEL",
        help="Labels passed directly on the command line"
    )

    p.add_argument(
        "--layer-priority", nargs="*",
        default=["TAGS", "EQUIP", "ANNO", "TEXT"],
        metavar="LAYER",
        help="Layer names in priority order for resolving duplicates"
    )
    p.add_argument("--verbose", action="store_true")
    return p.parse_args()


def load_labels_from_file(path: str) -> list[str]:
    with open(path, "r", encoding="utf-8") as f:
        return [
            line.strip()
            for line in f
            if line.strip() and not line.startswith("#")
        ]


def main():
    args = parse_args()

    # Load label list
    if args.labels:
        target_labels = load_labels_from_file(args.labels)
    else:
        target_labels = args.labels_inline

    # Deduplicate while preserving order
    seen = set()
    unique_labels = []
    for l in target_labels:
        if l not in seen:
            seen.add(l)
            unique_labels.append(l)
    if len(unique_labels) < len(target_labels):
        print(f"Warning: removed {len(target_labels) - len(unique_labels)} "
              f"duplicate entries from label list")

    manifest = build_manifest(
        dxf_path=args.dxf,
        svg_path=args.svg,
        target_labels=unique_labels,
        layer_priority=args.layer_priority,
    )

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(f"\nManifest written to: {out_path}")

    # Print not-found labels for easy debugging
    not_found = [k for k, v in manifest["labels"].items() if not v["found"]]
    if not_found:
        print(f"\n⚠  Unmatched labels ({len(not_found)}):")
        for label in not_found:
            print(f"   - {label}")


if __name__ == "__main__":
    main()
