import { useState, useRef, useEffect, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// ─── theme ────────────────────────────────────────────────────────────────────
const C = {
  bg: "#0e1117",
  panel: "#161b22",
  border: "#21262d",
  accent: "#58a6ff",
  accentDim: "#1f4068",
  text: "#c9d1d9",
  textDim: "#8b949e",
  green: "#3fb950",
  red: "#f85149",
  yellow: "#d29922",
  mono: "'JetBrains Mono','Fira Code','Cascadia Code',monospace",

  // hitbox colours by match status
  status: {
    found: {
      fill: "rgba(63,185,80,0.13)",
      stroke: "rgba(63,185,80,0.55)",
      hover: "rgba(63,185,80,0.30)",
    },
    clustered: {
      fill: "rgba(88,166,255,0.13)",
      stroke: "rgba(88,166,255,0.55)",
      hover: "rgba(88,166,255,0.30)",
    },
    fuzzy_match: {
      fill: "rgba(210,153,34,0.13)",
      stroke: "rgba(210,153,34,0.55)",
      hover: "rgba(210,153,34,0.30)",
    },
    duplicate: {
      fill: "rgba(210,153,34,0.13)",
      stroke: "rgba(210,153,34,0.55)",
      hover: "rgba(210,153,34,0.30)",
    },
    not_found: {
      fill: "rgba(248,81,73,0.13)",
      stroke: "rgba(248,81,73,0.55)",
      hover: "rgba(248,81,73,0.30)",
    },
    selected: {
      fill: "rgba(255,210,50,0.28)",
      stroke: "rgba(255,210,50,0.90)",
      hover: "rgba(255,210,50,0.28)",
    },
  } as Record<string, { fill: string; stroke: string; hover: string }>,
};

// ─── types ────────────────────────────────────────────────────────────────────
interface TileMeta {
  max_zoom: number;
  tile_size: number;
  full_width_px: number;
  full_height_px: number;
  svg_viewbox_width: number;
  svg_viewbox_height: number;
  px_per_dxf_unit: number;
}

interface ManifestEntry {
  found: boolean;
  clustered?: boolean;
  duplicate?: boolean;
  fuzzy_match?: boolean;
  cluster_parts?: string[];
  status?: string;
  dxf?: { layer?: string; type?: string; height?: number };
  coords?: {
    bbox?: { svg?: { x: number; y: number; width: number; height: number } };
    svg?: { x: number; y: number };
  };
  db_attributes?: Record<string, unknown>;
}

interface Hitbox {
  label: string;
  entry: ManifestEntry;
  // in SVG viewBox units (Y-down)
  x: number;
  y: number;
  w: number;
  h: number;
  status: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function readText(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = (e) => res(e.target!.result as string);
    r.onerror = rej;
    r.readAsText(file);
  });
}

function resolveStatus(entry: ManifestEntry): string {
  if (!entry.found) return "not_found";
  if (entry.duplicate) return "duplicate";
  if (entry.fuzzy_match) return "fuzzy_match";
  if (entry.clustered) return "clustered";
  return "found";
}

function buildHitboxes(
  manifest: { labels: Record<string, ManifestEntry> } | null,
  tileMeta: TileMeta | null,
): Hitbox[] {
  if (!manifest?.labels || !tileMeta) return [];

  return Object.entries(manifest.labels)
    .map(([key, v]) => {
      const b = v.coords?.bbox?.svg;
      const pt = v.coords?.svg;

      let x: number, y: number, w: number, h: number;

      if (b && b.width > 0 && b.height > 0) {
        x = b.x;
        y = b.y;
        w = b.width;
        h = b.height;
      } else if (pt) {
        const ph = (v.dxf?.height || 3) * 1.4;
        const pw = ph * key.length * 0.65;
        x = pt.x;
        y = pt.y - ph;
        w = pw;
        h = ph;
      } else {
        return null;
      }

      return { label: key, entry: v, x, y, w, h, status: resolveStatus(v) };
    })
    .filter(Boolean) as Hitbox[];
}

// Convert SVG viewBox coords → Leaflet CRS.Simple pixel coords
// SVG: (0,0) top-left, Y-down
// Leaflet CRS.Simple: (0,0) bottom-left, Y-up
function svgToLeaflet(x: number, y: number, tileMeta: TileMeta): L.PointTuple {
  const px = x * tileMeta.px_per_dxf_unit;
  const py = tileMeta.full_height_px - y * tileMeta.px_per_dxf_unit;
  return [py, px]; // Leaflet is [lat=Y, lng=X]
}

// ─── sub-components ───────────────────────────────────────────────────────────
function FileBtn({
  label,
  loaded,
  accept,
  onFile,
}: {
  label: string;
  loaded: boolean;
  accept: string;
  onFile: (f: File) => void;
}) {
  return (
    <label style={{ cursor: "pointer" }}>
      <input
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
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

function ZoomControls({ map }: { map: L.Map | null }) {
  if (!map) return null;

  const drawingBounds = (map as any)._dxfBounds as L.LatLngBounds | undefined;

  const btns: [string, () => void, string][] = [
    ["+", () => map.zoomIn(0.5), "zoom in"],
    ["−", () => map.zoomOut(0.5), "zoom out"],
    ["⊡", () => drawingBounds && map.fitBounds(drawingBounds), "fit drawing"],
  ];

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      {btns.map(([lbl, fn, title]) => (
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
  );
}

interface TooltipState {
  label: string;
  status: string;
  x: number;
  y: number;
}

function Tooltip({ tooltip }: { tooltip: TooltipState | null }) {
  if (!tooltip) return null;
  const sc = C.status[tooltip.status] ?? C.status.not_found;
  return (
    <div
      style={{
        position: "fixed",
        left: tooltip.x + 14,
        top: tooltip.y - 10,
        zIndex: 9999,
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 4,
        padding: "4px 10px",
        fontSize: 11,
        color: C.text,
        pointerEvents: "none",
        fontFamily: C.mono,
        whiteSpace: "nowrap",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span style={{ color: C.accent, fontWeight: 700 }}>{tooltip.label}</span>
      <span
        style={{
          fontSize: 9,
          padding: "1px 5px",
          borderRadius: 3,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          fontWeight: 700,
          background: sc.fill,
          color: sc.stroke,
          border: `1px solid ${sc.stroke}`,
        }}
      >
        {tooltip.status.replace("_", " ")}
      </span>
    </div>
  );
}

// ─── main viewer ──────────────────────────────────────────────────────────────
export default function LeafletDXFViewer() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const rectLayersRef = useRef<Map<string, L.Rectangle>>(new Map());

  const [tileMeta, setTileMeta] = useState<TileMeta | null>(null);
  const [manifest, setManifest] = useState<{
    labels: Record<string, ManifestEntry>;
  } | null>(null);
  const [hitboxes, setHitboxes] = useState<Hitbox[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [search, setSearch] = useState("");

  // ── file loaders ────────────────────────────────────────────────────────────
  async function loadTileMeta(file: File) {
    try {
      setTileMeta(JSON.parse(await readText(file)));
    } catch {
      alert("Invalid tile_meta.json");
    }
  }

  async function loadManifest(file: File) {
    try {
      setManifest(JSON.parse(await readText(file)));
    } catch {
      alert("Invalid manifest JSON");
    }
  }

  // ── build hitboxes when both are loaded ─────────────────────────────────────
  useEffect(() => {
    setHitboxes(buildHitboxes(manifest, tileMeta));
  }, [manifest, tileMeta]);

  // ── init Leaflet map once tile meta is loaded ────────────────────────────────
  useEffect(() => {
    if (!tileMeta || !mapContainerRef.current || mapRef.current) return;

    const { max_zoom, tile_size, full_width_px, full_height_px } = tileMeta;

    const map = L.map(mapContainerRef.current, {
      crs: L.CRS.Simple,
      minZoom: 0,
      maxZoom: max_zoom + 2, // allow a couple of levels over-zoom
      zoomControl: false,
      attributionControl: false,
      keyboard: false,
      doubleClickZoom: false,
      scrollWheelZoom: false, // own this
      touchZoom: false,
      zoomSnap: 0.1,
      zoomDelta: 0.5,
    });

    // Tile layer — expects /tiles/{z}/{x}/{y}.png on the dev server
    L.tileLayer("/tiles/{z}/{x}/{y}.png", {
      tileSize: tile_size,
      minZoom: 0,
      maxZoom: max_zoom,
      noWrap: true,
      bounds: [
        [0, 0],
        [full_height_px, full_width_px],
      ] as L.LatLngBoundsLiteral,
    }).addTo(map);

    // Leaflet CRS.Simple: lng=X (right), lat=Y (up from bottom)
    const drawingBounds = L.latLngBounds(
      [0, 0],
      [full_height_px, full_width_px],
    );
    (map as any)._dxfBounds = drawingBounds;
    map.fitBounds(drawingBounds);

    // ── custom wheel handler — 8% per tick, cursor-centred ───────────────────
    mapContainerRef.current.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        const factor = 1 + delta * 0.08;
        const currentZoom = map.getZoom();
        const newZoom = currentZoom + Math.log2(factor);

        // Zoom towards cursor position
        const containerPoint = map.mouseEventToContainerPoint(
          e as unknown as MouseEvent,
        );
        const latlng = map.containerPointToLatLng(containerPoint);
        map.setZoomAround(latlng, newZoom, { animate: false });
      },
      { passive: false },
    );

    mapRef.current = map;

    // Dismiss tooltip on map click (not on a hitbox)
    map.on("click", () => {
      setSelected(null);
      setTooltip(null);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [tileMeta]);

  // ── render / update hitbox rectangles ───────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !tileMeta) return;

    // Remove old rectangles
    rectLayersRef.current.forEach((r) => r.remove());
    rectLayersRef.current.clear();

    hitboxes.forEach((hb) => {
      const sc = C.status[hb.status] ?? C.status.not_found;

      // SVG viewBox units → Leaflet CRS.Simple pixel coords
      const sw = svgToLeaflet(hb.x, hb.y, tileMeta); // top-left  (higher lat in L)
      const ne = svgToLeaflet(hb.x + hb.w, hb.y + hb.h, tileMeta); // bot-right (lower lat in L)

      // Leaflet bounds: [[minLat, minLng], [maxLat, maxLng]]
      const bounds: L.LatLngBoundsLiteral = [
        [Math.min(sw[0], ne[0]), Math.min(sw[1], ne[1])],
        [Math.max(sw[0], ne[0]), Math.max(sw[1], ne[1])],
      ];

      const rect = L.rectangle(bounds, {
        color: sc.stroke,
        weight: 1,
        fillColor: sc.fill,
        fillOpacity: 1,
        interactive: true,
        className: `dxf-hb dxf-hb-${hb.status}`,
        bubblingMouseEvents: false,
      }).addTo(map);

      rect.on("mouseover", (e: L.LeafletMouseEvent) => {
        if (selected !== hb.label) {
          rect.setStyle({ fillColor: sc.hover, color: sc.stroke, weight: 1.5 });
        }
        setTooltip({
          label: hb.label,
          status: hb.status,
          x: e.originalEvent.clientX,
          y: e.originalEvent.clientY,
        });
      });

      rect.on("mousemove", (e: L.LeafletMouseEvent) => {
        setTooltip((t) =>
          t
            ? { ...t, x: e.originalEvent.clientX, y: e.originalEvent.clientY }
            : t,
        );
      });

      rect.on("mouseout", () => {
        if (selected !== hb.label) {
          rect.setStyle({ fillColor: sc.fill, color: sc.stroke, weight: 1 });
        }
        setTooltip(null);
      });

      rect.on("click", (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        setSelected((prev) => (prev === hb.label ? null : hb.label));
      });

      rectLayersRef.current.set(hb.label, rect);
    });
  }, [hitboxes, tileMeta]);

  // ── update rect styles when selection changes ────────────────────────────────
  useEffect(() => {
    rectLayersRef.current.forEach((rect, label) => {
      const hb = hitboxes.find((h) => h.label === label);
      if (!hb) return;
      const sc =
        selected === label
          ? C.status.selected
          : (C.status[hb.status] ?? C.status.not_found);
      rect.setStyle({
        color: sc.stroke,
        weight: selected === label ? 1.5 : 1,
        fillColor: sc.fill,
        fillOpacity: 1,
      });
      if (selected === label) rect.bringToFront();
    });
  }, [selected, hitboxes]);

  // ── zoom to label ────────────────────────────────────────────────────────────
  const zoomToLabel = useCallback(
    (label: string) => {
      const map = mapRef.current;
      if (!map || !tileMeta) return;
      const hb = hitboxes.find((h) => h.label === label);
      if (!hb) return;

      const sw = svgToLeaflet(hb.x, hb.y + hb.h, tileMeta);
      const ne = svgToLeaflet(hb.x + hb.w, hb.y, tileMeta);
      const bounds = L.latLngBounds([sw, ne]);
      map.fitBounds(bounds, { padding: [80, 80], maxZoom: tileMeta.max_zoom });
    },
    [hitboxes, tileMeta],
  );

  function selectLabel(label: string) {
    const next = label === selected ? null : label;
    setSelected(next);
    if (next) zoomToLabel(next);
  }

  // ── sidebar data ─────────────────────────────────────────────────────────────
  const allLabels = manifest?.labels
    ? Object.entries(manifest.labels).sort(([a], [b]) => a.localeCompare(b))
    : [];
  const filtered = search
    ? allLabels.filter(([k]) => k.toLowerCase().includes(search.toLowerCase()))
    : allLabels;
  const foundCount = allLabels.filter(([, v]) => v.found).length;
  const notFoundCount = allLabels.length - foundCount;
  const selEntry = selected && manifest?.labels?.[selected];
  const selHb = selected && hitboxes.find((h) => h.label === selected);

  // ── render ───────────────────────────────────────────────────────────────────
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
      <Tooltip tooltip={tooltip} />

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
          label="tile_meta.json"
          loaded={!!tileMeta}
          accept=".json"
          onFile={loadTileMeta}
        />
        <FileBtn
          label="manifest.json"
          loaded={!!manifest}
          accept=".json"
          onFile={loadManifest}
        />

        {tileMeta && (
          <span style={{ fontSize: 10, color: C.textDim, marginLeft: 4 }}>
            {tileMeta.full_width_px} × {tileMeta.full_height_px} px · z0–
            {tileMeta.max_zoom}
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
            {(
              [
                [C.green, `${foundCount} found`],
                [C.red, `${notFoundCount} missing`],
                [C.accent, `${hitboxes.length} hitboxes`],
              ] as [string, string][]
            ).map(([col, lbl]) => (
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
        {/* Map canvas */}
        <div
          style={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
            background: "#080b10",
          }}
        >
          {/* Leaflet container — always mounted so the map can init */}
          <div
            ref={mapContainerRef}
            style={{
              width: "100%",
              height: "100%",
              display: tileMeta ? "block" : "none",
            }}
          />

          {/* Empty state */}
          {!tileMeta && (
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
                Load <code>tile_meta.json</code> from rasterise_tiles.py,
                <br />
                then load <code>label-manifest.json</code>
              </div>
            </div>
          )}

          {/* Floating zoom controls */}
          <ZoomControls map={mapRef.current} />
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
          {selEntry && selEntry && (
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

              {/* Status badge */}
              {(() => {
                const status = resolveStatus(selEntry);
                const sc = C.status[status] ?? C.status.not_found;
                return (
                  <div style={{ marginBottom: 8 }}>
                    <span
                      style={{
                        fontSize: 9,
                        padding: "2px 6px",
                        borderRadius: 3,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        fontWeight: 700,
                        background: sc.fill,
                        color: sc.stroke,
                        border: `1px solid ${sc.stroke}`,
                      }}
                    >
                      {status.replace("_", " ")}
                    </span>
                  </div>
                );
              })()}

              {(
                [
                  ["layer", selEntry.dxf?.layer],
                  ["type", selEntry.dxf?.type],
                  selEntry.clustered
                    ? ["parts", selEntry.cluster_parts?.join(" + ")]
                    : null,
                  selHb
                    ? [
                        "size px",
                        `${(selHb as Hitbox).w.toFixed(0)} × ${(selHb as Hitbox).h.toFixed(0)}`,
                      ]
                    : null,
                  selHb
                    ? [
                        "origin",
                        `(${(selHb as Hitbox).x.toFixed(0)}, ${(selHb as Hitbox).y.toFixed(0)})`,
                      ]
                    : null,
                ] as ([string, string | undefined] | null)[]
              )
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

              {/* DB attributes (Sprint 2) */}
              {selEntry.db_attributes &&
                Object.keys(selEntry.db_attributes).length > 0 && (
                  <div
                    style={{
                      marginTop: 8,
                      paddingTop: 8,
                      borderTop: `1px solid ${C.border}`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 9,
                        color: C.textDim,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        marginBottom: 6,
                      }}
                    >
                      DB attributes
                    </div>
                    {Object.entries(selEntry.db_attributes)
                      .slice(0, 8)
                      .map(([k, v]) => (
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
                          <span
                            style={{
                              color: C.text,
                              maxWidth: 120,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {String(v)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}

              <button
                onClick={() => selected && zoomToLabel(selected)}
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

          {/* Label list */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {manifest ? (
              filtered.map(([key, val]) => {
                const status = resolveStatus(val);
                const sc = C.status[status] ?? C.status.not_found;
                return (
                  <div
                    key={key}
                    onClick={() => selectLabel(key)}
                    style={{
                      padding: "5px 14px",
                      fontSize: 11,
                      cursor: "pointer",
                      userSelect: "none",
                      background:
                        selected === key ? C.accentDim : "transparent",
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
                        background: sc.fill,
                        color: sc.stroke,
                        border: `1px solid ${sc.stroke}`,
                      }}
                    >
                      {status.replace("_", " ")}
                    </span>
                  </div>
                );
              })
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
