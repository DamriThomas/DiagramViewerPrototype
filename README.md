render_svg.py — DXF→SVG + transform.json. Run as:
python render_svg.py test_diagram.dxf test_diagram.svg

extract_manifest.py :
python extract_manifest.py \
 --dxf test_diagram.dxf \
 --labels test_labels.txt \
 --svg test_diagram.svg \
 --transform transform.json \
 --out label-manifest.json \
 --debug-svg debug_labels.svg
