import { useState, useRef, useEffect } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";

const C = {
  bg: "#0e1117",
  panel: "#161b22",
  border: "#21262d",
  accent: "#58a6ff",
  accentDim: "#1f4068",
  hit: "rgba(88,166,255,0.13)",
  hitBorder: "rgba(88,166,255,0.55)",
  hitHover: "rgba(88,166,255,0.30)",
  hitSel: "rgba(255,210,50,0.30)",
  hitSelBorder: "rgba(255,210,50,0.9)",
  text: "#c9d1d9",
  textDim: "#8b949e",
  green: "#3fb950",
  red: "#f85149",
  yellow: "#d29922",
  mono: "'JetBrains Mono','Fira Code','Cascadia Code',monospace",
};

function readText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = (e) => res(e.target.result);
    r.onerror = rej;
    r.readAsText(file);
  });
}

// Parse viewBox → {x, y, w, h}
function parseViewBox(svgText) {
  const m = svgText.match(/viewBox="([^"]+)"/);
  if (m) {
    const [x, y, w, h] = m[1]
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    return { x, y, w, h };
  }
  const wm = svgText.match(/\bwidth="([\d.]+)"/);
  const hm = svgText.match(/\bheight="([\d.]+)"/);
  if (wm && hm)
    return { x: 0, y: 0, w: parseFloat(wm[1]), h: parseFloat(hm[1]) };
  return null;
}

// Build hitboxes in px relative to the SVG's natural pixel size (1 viewBox unit = 1 px)
function buildHitboxes(manifest, vb) {
  if (!manifest?.labels || !vb) return [];
  return Object.entries(manifest.labels)
    .filter(([, v]) => v.found && v.coords)
    .map(([key, v]) => {
      const b = v.coords?.bbox?.svg;
      const pt = v.coords?.svg;
      if (b && b.width > 0 && b.height > 0) {
        // bbox is in SVG viewBox units — translate origin so (vb.x, vb.y) → (0,0)
        return {
          label: key,
          entry: v,
          x: b.x - vb.x,
          y: b.y - vb.y,
          w: b.width,
          h: b.height,
        };
      }
      if (pt) {
        const ph = (v.dxf?.height || 3) * 1.4;
        const pw = ph * key.length * 0.65;
        return {
          label: key,
          entry: v,
          x: pt.x - vb.x,
          y: pt.y - vb.y - ph,
          w: pw,
          h: ph,
        };
      }
      return null;
    })
    .filter(Boolean);
}

function FileBtn({ label, loaded, accept, onFile }) {
  return (
    <label style={{ cursor: "pointer" }}>
      <input
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => onFile(e.target.files[0])}
      />
      <span
        style={{
          fontSize: 11,
          padding: "4px 10px",
          fontFamily: C.mono,
          cursor: "pointer",
          background: "transparent",
          border: `1px solid ${loaded ? C.accent : C.border}`,
          borderRadius: 4,
          color: loaded ? C.accent : C.textDim,
          letterSpacing: "0.05em",
          userSelect: "none",
          display: "inline-block",
        }}
      >
        {loaded ? `✓ ${label}` : label}
      </span>
    </label>
  );
}

export default function DXFViewer() {
  const [svgText, setSvgText] = useState(null);
  const [vb, setVb] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [hitboxes, setHitboxes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [search, setSearch] = useState("");
  const transformRef = useRef(null);

  useEffect(() => {
    if (manifest && vb) setHitboxes(buildHitboxes(manifest, vb));
  }, [manifest, vb]);

  async function loadSVG(file) {
    if (!file) return;
    const text = await readText(file);
    setSvgText(text);
    setVb(parseViewBox(text));
  }

  async function loadManifest(file) {
    if (!file) return;
    try {
      setManifest(JSON.parse(await readText(file)));
    } catch {
      alert("Invalid JSON");
    }
  }

  // Zoom so hitbox fills ~30% of screen
  function zoomTo(hb) {
    if (!transformRef.current) return;
    const wrapper = document.getElementById("dxf-canvas-wrapper");
    if (!wrapper) return;
    const cw = wrapper.clientWidth;
    const ch = wrapper.clientHeight;
    const cx = hb.x + hb.w / 2;
    const cy = hb.y + hb.h / 2;
    const scale = Math.min(cw / (hb.w * 5), ch / (hb.h * 5), 30);
    transformRef.current.setTransform(
      cw / 2 - cx * scale,
      ch / 2 - cy * scale,
      scale,
      300,
    );
  }

  function selectLabel(label) {
    const next = label === selected ? null : label;
    setSelected(next);
    if (next) {
      const hb = hitboxes.find((h) => h.label === next);
      if (hb) zoomTo(hb);
    }
  }

  const allLabels = manifest?.labels
    ? Object.entries(manifest.labels).sort(([a], [b]) => a.localeCompare(b))
    : [];
  const filtered = search
    ? allLabels.filter(([k]) => k.toLowerCase().includes(search.toLowerCase()))
    : allLabels;
  const found = allLabels.filter(([, v]) => v.found).length;
  const notFound = allLabels.length - found;
  const selEntry = selected && manifest?.labels?.[selected];
  const selHb = selected && hitboxes.find((h) => h.label === selected);

  // Compute a scale that fits the SVG into the canvas on first load.
  // We don't know the canvas size until render, so we use window size minus
  // the sidebar (272px) and topbar (~42px) as a reasonable approximation.
  const [fitScale, setFitScale] = useState(1);
  useEffect(() => {
    if (!vb) return;
    const cw = window.innerWidth - 272;
    const ch = window.innerHeight - 42;
    const scale = Math.min(cw / vb.w, ch / vb.h) * 0.92;
    setFitScale(Math.max(scale, 0.0001));
  }, [vb]);

  // Re-fit when reset button is pressed (expose via ref pattern)
  function handleReset(resetTransform) {
    resetTransform();
    // After reset, re-centre — TransformWrapper centers at initialScale automatically
  }

  return (
    <div
      style={{
        fontFamily: C.mono,
        background: C.bg,
        color: C.text,
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            position: "fixed",
            left: tooltip.x + 14,
            top: tooltip.y - 10,
            zIndex: 9999,
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            padding: "3px 8px",
            fontSize: 11,
            color: C.accent,
            pointerEvents: "none",
            fontFamily: C.mono,
            whiteSpace: "nowrap",
          }}
        >
          {tooltip.label}
        </div>
      )}

      {/* Topbar */}
      <div
        style={{
          background: C.panel,
          borderBottom: `1px solid ${C.border}`,
          padding: "9px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            letterSpacing: "0.15em",
            color: C.accent,
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          DXF Viewer
        </span>
        <div style={{ width: 1, height: 18, background: C.border }} />
        <FileBtn
          label="Load SVG"
          loaded={!!svgText}
          accept=".svg"
          onFile={loadSVG}
        />
        <FileBtn
          label="Load Manifest"
          loaded={!!manifest}
          accept=".json"
          onFile={loadManifest}
        />
        {vb && (
          <span style={{ fontSize: 10, color: C.textDim, marginLeft: 4 }}>
            {vb.w.toFixed(0)} × {vb.h.toFixed(0)} SVG units
          </span>
        )}
        {manifest && (
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              gap: 16,
              fontSize: 11,
            }}
          >
            {[
              [C.green, `${found} found`],
              [C.red, `${notFound} missing`],
              [C.accent, `${hitboxes.length} hitboxes`],
            ].map(([col, lbl]) => (
              <span
                key={lbl}
                style={{
                  display: "flex",
                  gap: 5,
                  alignItems: "center",
                  color: C.textDim,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: col,
                    flexShrink: 0,
                  }}
                />
                {lbl}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Canvas */}
        <div
          id="dxf-canvas-wrapper"
          style={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
            background: "#080b10",
          }}
        >
          {svgText && vb ? (
            <TransformWrapper
              ref={transformRef}
              initialScale={fitScale}
              minScale={Math.min(fitScale * 0.1, 0.001)}
              maxScale={50}
              limitToBounds={false}
              wheel={{ disabled: true }}
              pinch={{ step: 2 }}
              centerOnInit={true}
              onInit={(instance) => {
                // Manual wheel handler — gentle exponential zoom centred on cursor
                const el = instance.instance.contentComponent?.parentElement;
                if (!el) return;
                el.addEventListener(
                  "wheel",
                  (e) => {
                    e.preventDefault();
                    const delta = e.deltaY < 0 ? 1 : -1;
                    const factor = 1 + delta * 0.08; // 8% per tick — tune here
                    const state = instance.instance.transformState;
                    const rect = el.getBoundingClientRect();
                    const mouseX = e.clientX - rect.left;
                    const mouseY = e.clientY - rect.top;
                    const currScale = state.scale;
                    const newScale = Math.min(
                      Math.max(
                        currScale * factor,
                        Math.min(fitScale * 0.1, 0.001),
                      ),
                      50,
                    );
                    const scaleRatio = newScale / currScale;
                    instance.setTransform(
                      mouseX - (mouseX - state.positionX) * scaleRatio,
                      mouseY - (mouseY - state.positionY) * scaleRatio,
                      newScale,
                      0, // 0ms = immediate, no animation lag between ticks
                    );
                  },
                  { passive: false },
                );
              }}
            >
              {({ zoomIn, zoomOut, resetTransform }) => (
                <>
                  <TransformComponent
                    wrapperStyle={{
                      width: "100%",
                      height: "100%",
                      overflow: "visible",
                    }}
                  >
                    {/*
                      Render at EXACT SVG natural size: vb.w × vb.h px.
                      Hitboxes use the same px coordinate system, so they align perfectly.
                    */}
                    <div
                      style={{
                        position: "relative",
                        width: vb.w,
                        height: vb.h,
                        flexShrink: 0,
                      }}
                    >
                      {/* SVG at natural 1:1 size */}
                      <div
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: vb.w,
                          height: vb.h,
                        }}
                        dangerouslySetInnerHTML={{
                          __html: svgText
                            // Force exact pixel dimensions, no scaling
                            .replace(/(<svg[^>]*)\bwidth="[^"]*"/, "$1")
                            .replace(/(<svg[^>]*)\bheight="[^"]*"/, "$1")
                            .replace(
                              /<svg/,
                              `<svg width="${vb.w}" height="${vb.h}"`,
                            ),
                        }}
                      />

                      {/* Hitboxes — same px space as SVG */}
                      {hitboxes.map((hb) => {
                        const sel = selected === hb.label;
                        const hov = hovered === hb.label;
                        return (
                          <div
                            key={hb.label}
                            style={{
                              position: "absolute",
                              left: hb.x,
                              top: hb.y,
                              width: Math.max(hb.w, 4),
                              height: Math.max(hb.h, 4),
                              border: `1px solid ${sel ? C.hitSelBorder : C.hitBorder}`,
                              background: sel
                                ? C.hitSel
                                : hov
                                  ? C.hitHover
                                  : C.hit,
                              borderRadius: 2,
                              cursor: "pointer",
                              boxSizing: "border-box",
                              transition: "background 0.1s, border-color 0.1s",
                              zIndex: sel ? 5 : 2,
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              selectLabel(hb.label);
                            }}
                            onMouseEnter={(e) => {
                              setHovered(hb.label);
                              setTooltip({
                                label: hb.label,
                                x: e.clientX,
                                y: e.clientY,
                              });
                            }}
                            onMouseMove={(e) =>
                              setTooltip({
                                label: hb.label,
                                x: e.clientX,
                                y: e.clientY,
                              })
                            }
                            onMouseLeave={() => {
                              setHovered(null);
                              setTooltip(null);
                            }}
                          />
                        );
                      })}
                    </div>
                  </TransformComponent>

                  {/* Zoom controls */}
                  <div
                    style={{
                      position: "absolute",
                      bottom: 16,
                      right: 16,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      zIndex: 20,
                    }}
                  >
                    {[
                      ["+", () => zoomIn(), "zoom in"],
                      ["−", () => zoomOut(), "zoom out"],
                      ["⊡", () => handleReset(resetTransform), "reset"],
                    ].map(([lbl, fn, title]) => (
                      <button
                        key={lbl}
                        title={title}
                        onClick={fn}
                        style={{
                          width: 32,
                          height: 32,
                          background: C.panel,
                          border: `1px solid ${C.border}`,
                          borderRadius: 4,
                          color: C.text,
                          cursor: "pointer",
                          fontSize: 15,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontFamily: C.mono,
                        }}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </TransformWrapper>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                gap: 12,
                color: C.textDim,
              }}
            >
              <div style={{ fontSize: 36, opacity: 0.2 }}>⬡</div>
              <div style={{ fontSize: 13, color: C.text }}>
                No drawing loaded
              </div>
              <div
                style={{ fontSize: 11, textAlign: "center", lineHeight: 1.7 }}
              >
                Load an SVG from render_svg.py,
                <br />
                then load label-manifest.json
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div
          style={{
            width: 272,
            background: C.panel,
            borderLeft: `1px solid ${C.border}`,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "9px 14px",
              borderBottom: `1px solid ${C.border}`,
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: C.textDim,
              fontWeight: 700,
            }}
          >
            Labels
          </div>

          {/* Selected card */}
          {selEntry && (
            <div
              style={{
                margin: 10,
                padding: 12,
                background: C.bg,
                border: `1px solid ${C.accentDim}`,
                borderRadius: 6,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  color: C.accent,
                  letterSpacing: "0.05em",
                  marginBottom: 8,
                }}
              >
                {selected}
              </div>
              {[
                ["layer", selEntry.dxf?.layer],
                ["type", selEntry.dxf?.type],
                selEntry.clustered
                  ? ["parts", selEntry.cluster_parts?.join(" + ")]
                  : null,
                selHb
                  ? ["size px", `${selHb.w.toFixed(0)} × ${selHb.h.toFixed(0)}`]
                  : null,
                selHb
                  ? ["origin", `(${selHb.x.toFixed(0)}, ${selHb.y.toFixed(0)})`]
                  : null,
              ]
                .filter(Boolean)
                .map(
                  ([k, v]) =>
                    v != null && (
                      <div
                        key={k}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 11,
                          color: C.textDim,
                          marginBottom: 3,
                        }}
                      >
                        <span>{k}</span>
                        <span style={{ color: C.text }}>{v}</span>
                      </div>
                    ),
                )}
              {selEntry.duplicate && (
                <div style={{ fontSize: 11, color: C.yellow, marginTop: 4 }}>
                  ⚠ duplicate match
                </div>
              )}
              {selEntry.fuzzy_match && (
                <div style={{ fontSize: 11, color: C.yellow, marginTop: 2 }}>
                  ~ fuzzy match
                </div>
              )}
              <button
                onClick={() => selHb && zoomTo(selHb)}
                style={{
                  marginTop: 10,
                  width: "100%",
                  padding: "4px 0",
                  fontSize: 11,
                  background: "transparent",
                  border: `1px solid ${C.border}`,
                  borderRadius: 4,
                  color: C.textDim,
                  cursor: "pointer",
                  fontFamily: C.mono,
                  letterSpacing: "0.05em",
                }}
              >
                zoom to label
              </button>
            </div>
          )}

          {/* Search */}
          {manifest && (
            <div
              style={{
                padding: "7px 12px",
                borderBottom: `1px solid ${C.border}`,
                flexShrink: 0,
              }}
            >
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="search labels..."
                style={{
                  width: "100%",
                  background: C.bg,
                  border: `1px solid ${C.border}`,
                  borderRadius: 4,
                  padding: "4px 8px",
                  color: C.text,
                  fontSize: 11,
                  fontFamily: C.mono,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
          )}

          {/* List */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {manifest ? (
              filtered.map(([key, val]) => (
                <div
                  key={key}
                  onClick={() => selectLabel(key)}
                  style={{
                    padding: "5px 14px",
                    fontSize: 11,
                    cursor: "pointer",
                    userSelect: "none",
                    background: selected === key ? C.accentDim : "transparent",
                    color: selected === key ? C.accent : C.text,
                    borderLeft: `2px solid ${selected === key ? C.accent : "transparent"}`,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>{key}</span>
                  <span
                    style={{
                      fontSize: 9,
                      padding: "1px 5px",
                      borderRadius: 3,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      fontWeight: 700,
                      background: val.found
                        ? "rgba(63,185,80,0.15)"
                        : "rgba(248,81,73,0.15)",
                      color: val.found ? C.green : C.red,
                      border: `1px solid ${val.found ? "rgba(63,185,80,0.3)" : "rgba(248,81,73,0.3)"}`,
                    }}
                  >
                    {val.found ? "found" : "miss"}
                  </span>
                </div>
              ))
            ) : (
              <div
                style={{ padding: "12px 14px", fontSize: 11, color: C.textDim }}
              >
                Load a manifest to see labels
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
