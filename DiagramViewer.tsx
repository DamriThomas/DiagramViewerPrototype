/**
 * DiagramViewer.tsx
 *
 * Two modes toggled from the header:
 *   INSPECT — standard viewer, click any fitting for details
 *   DEFECT  — diagram dims, defect markers appear over every affected fitting.
 *             Markers are coloured by worst severity and show defect count.
 *             At low zoom nearby markers cluster into a single larger bubble.
 *             Left panel switches to a defect summary / list.
 */

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
  TransformWrapper,
  TransformComponent,
  useTransformContext,
} from "react-zoom-pan-pinch";

// ─── Config ──────────────────────────────────────────────────────────────────
const SVG_URL = "/diagram.svg";
const W = 12000;
const H = 5000;
const HIT_W = 90;
const HIT_H = 20;

// ─── Parse label positions ────────────────────────────────────────────────────
function parseSVGPositions(svgText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const pos = {};
  doc.querySelectorAll("[data-interactive='true']").forEach((el) => {
    const label = el.getAttribute("data-label-id");
    const x = parseInt(el.getAttribute("data-x"), 10);
    const y = parseInt(el.getAttribute("data-y"), 10);
    if (label && !isNaN(x) && !isNaN(y)) pos[label] = { x, y };
  });
  return pos;
}

// ─── Manifest ────────────────────────────────────────────────────────────────
function buildManifest() {
  function seededRng(seed) {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      return (s >>> 0) / 0xffffffff;
    };
  }
  const rng = seededRng(42);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const SYSTEMS = [
    { name: "Vantor Engine Core", color: "#4f8ef7", prefix: "VEC" },
    { name: "Helix Propulsion Suite", color: "#f7a84f", prefix: "HPS" },
    { name: "Stratus Power Unit", color: "#f75f5f", prefix: "SPU" },
    { name: "Aurex Drive System", color: "#a084f7", prefix: "ADS" },
    { name: "Nexon Fuel Control", color: "#4ff7c4", prefix: "NFC" },
    { name: "Orion Cooling Loop", color: "#f74fa8", prefix: "OCL" },
  ];
  const TYPES = [
    {
      type: "Valve",
      subtypes: [
        "Gate valve",
        "Ball valve",
        "Butterfly valve",
        "Check valve",
        "Relief valve",
        "Needle valve",
        "Globe valve",
        "Solenoid valve",
      ],
    },
    {
      type: "Pipe",
      subtypes: [
        "High-pressure line",
        "Low-pressure line",
        "Return line",
        "Drain line",
        "Vent line",
        "Sample line",
      ],
    },
    {
      type: "Tank",
      subtypes: [
        "Oxidiser tank",
        "Fuel tank",
        "Buffer tank",
        "Accumulator",
        "Surge tank",
      ],
    },
    {
      type: "Actuator",
      subtypes: [
        "Linear actuator",
        "Rotary actuator",
        "Pneumatic actuator",
        "Hydraulic actuator",
      ],
    },
    {
      type: "Sensor",
      subtypes: [
        "Pressure transducer",
        "Temperature sensor",
        "Flow meter",
        "Level sensor",
        "Vibration sensor",
      ],
    },
    {
      type: "Pump",
      subtypes: [
        "Centrifugal pump",
        "Gear pump",
        "Piston pump",
        "Diaphragm pump",
      ],
    },
    {
      type: "Filter",
      subtypes: ["Strainer", "Coalescer", "Particulate filter", "Separator"],
    },
    {
      type: "Exchanger",
      subtypes: [
        "Shell & tube",
        "Plate exchanger",
        "Air cooler",
        "Brazed plate",
      ],
    },
  ];
  const MANUFACTURERS = [
    "Parker Aerospace",
    "Moog Inc.",
    "Honeywell Aerospace",
    "Curtiss-Wright",
    "Eaton Aerospace",
    "Woodward",
    "Triumph Group",
    "TransDigm",
    "Senior Aerospace",
    "Ducommun",
  ];
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const DEFECT_TITLES = [
    "Seal degradation",
    "Thread wear",
    "Actuator lag",
    "Corrosion on flange",
    "Pressure drop above threshold",
    "Sensor drift",
    "Bearing noise",
    "Valve stem binding",
    "Leak at fitting",
    "Coating failure",
    "Calibration error",
    "Filter bypass",
  ];
  const SEVS = [
    "high",
    "high",
    "medium",
    "medium",
    "medium",
    "low",
    "low",
    "low",
    "low",
  ];
  const manifest = {};
  for (let i = 0; i < 2000; i++) {
    const sys = SYSTEMS[i % SYSTEMS.length];
    const typeDef = pick(TYPES);
    const label = `${sys.prefix}-${String(i + 1).padStart(4, "0")}`;
    const dc = Math.floor(rng() * rng() * 5);
    manifest[label] = {
      label,
      type: typeDef.type,
      subtype: pick(typeDef.subtypes),
      system: sys.name,
      systemColor: sys.color,
      part_number: `${sys.prefix}-${String(Math.floor(rng() * 9000) + 1000).padStart(4, "0")}`,
      serial_number: `SN-${2019 + Math.floor(rng() * 6)}-${String(Math.floor(rng() * 90000) + 10000)}`,
      manufacturer: pick(MANUFACTURERS),
      weight: `${(rng() * 50 + 0.5).toFixed(1)} kg`,
      install_date: `${String(Math.floor(rng() * 28) + 1).padStart(2, "0")} ${MONTHS[Math.floor(rng() * 12)]} ${2019 + Math.floor(rng() * 6)}`,
      last_maintenance:
        rng() > 0.1
          ? `${String(Math.floor(rng() * 28) + 1).padStart(2, "0")} ${MONTHS[Math.floor(rng() * 12)]} ${2023 + Math.floor(rng() * 3)}`
          : "Not recorded",
      next_inspection:
        rng() > 0.2
          ? `${String(Math.floor(rng() * 28) + 1).padStart(2, "0")} ${MONTHS[Math.floor(rng() * 12)]} 2026`
          : "Not specified",
      description: `${typeDef.type} component in the ${sys.name} subsystem.`,
      defects: Array.from({ length: dc }, (_, di) => ({
        id: `DEF-${String(i * 10 + di).padStart(5, "0")}`,
        title: pick(DEFECT_TITLES),
        severity: pick(SEVS),
        date: `${String(Math.floor(rng() * 28) + 1).padStart(2, "0")} ${MONTHS[Math.floor(rng() * 12)]} ${2019 + Math.floor(rng() * 6)}`,
      })),
    };
  }
  return manifest;
}
const MANIFEST = buildManifest();
const ALL_LABELS = Object.keys(MANIFEST);
const SYSTEM_DEFS = [
  { name: "Vantor Engine Core", color: "#4f8ef7", prefix: "VEC" },
  { name: "Helix Propulsion Suite", color: "#f7a84f", prefix: "HPS" },
  { name: "Stratus Power Unit", color: "#f75f5f", prefix: "SPU" },
  { name: "Aurex Drive System", color: "#a084f7", prefix: "ADS" },
  { name: "Nexon Fuel Control", color: "#4ff7c4", prefix: "NFC" },
  { name: "Orion Cooling Loop", color: "#f74fa8", prefix: "OCL" },
];

// ─── Severity helpers ─────────────────────────────────────────────────────────
const SEV = {
  high: { bg: "rgba(247,95,95,0.15)", color: "#f75f5f", label: "High" },
  medium: { bg: "rgba(247,168,79,0.15)", color: "#f7a84f", label: "Medium" },
  low: { bg: "rgba(79,247,164,0.15)", color: "#4ff7a4", label: "Low" },
};
// Solid marker colours for defect mode
const SEV_MARKER = {
  high: {
    fill: "#f75f5f",
    glow: "rgba(247,95,95,0.45)",
    ring: "rgba(247,95,95,0.2)",
  },
  medium: {
    fill: "#f7a84f",
    glow: "rgba(247,168,79,0.45)",
    ring: "rgba(247,168,79,0.2)",
  },
  low: {
    fill: "#4ff7a4",
    glow: "rgba(79,247,164,0.45)",
    ring: "rgba(79,247,164,0.2)",
  },
};
function worstSeverity(defects) {
  if (defects.some((d) => d.severity === "high")) return "high";
  if (defects.some((d) => d.severity === "medium")) return "medium";
  return "low";
}

// ─── Clustering ───────────────────────────────────────────────────────────────
// Groups nearby defective fittings into single cluster markers based on zoom.
// At scale < 0.15 clusters merge aggressively; above 0.5 every fitting is solo.
function computeClusters(positions, scale) {
  // Only fittings that have defects
  const defective = ALL_LABELS.filter(
    (l) => MANIFEST[l].defects.length > 0 && positions[l],
  );

  // Cluster radius in SVG coordinate space — shrinks as you zoom in
  const radius = Math.max(60, 600 / scale);

  const assigned = new Set();
  const clusters = [];

  for (const label of defective) {
    if (assigned.has(label)) continue;
    const pos = positions[label];
    // Find all unassigned neighbours within radius
    const members = defective.filter((l2) => {
      if (assigned.has(l2)) return false;
      const p2 = positions[l2];
      const dx = pos.x - p2.x,
        dy = pos.y - p2.y;
      return Math.sqrt(dx * dx + dy * dy) < radius;
    });
    members.forEach((l) => assigned.add(l));

    // Centroid
    const cx = members.reduce((s, l) => s + positions[l].x, 0) / members.length;
    const cy = members.reduce((s, l) => s + positions[l].y, 0) / members.length;

    // Aggregate defects
    const allDefects = members.flatMap((l) => MANIFEST[l].defects);
    clusters.push({
      id: members.join("|"),
      x: cx,
      y: cy,
      members,
      count: allDefects.length,
      worst: worstSeverity(allDefects),
      isSingle: members.length === 1,
      label: members.length === 1 ? members[0] : null,
    });
  }
  return clusters;
}

// ═══════════════════════════════════════════════════════
// SHARED SMALL COMPONENTS
// ═══════════════════════════════════════════════════════
function Badge({ severity }) {
  const s = SEV[severity] || SEV.low;
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "monospace",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {s.label}
    </span>
  );
}
function PSection({ title, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div
        style={{
          fontSize: 10,
          color: "#4f8ef7",
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}
function PField({ label, value }) {
  return (
    <div
      style={{
        marginBottom: 10,
        paddingBottom: 10,
        borderBottom: "1px solid #1e2333",
      }}
    >
      <div style={{ fontSize: 11, color: "#4a5270", marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: "#e8ecf4" }}>{value || "—"}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// MODE TOGGLE — header pill
// ═══════════════════════════════════════════════════════
function ModeToggle({ mode, onChange }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        background: "#1a1f2e",
        border: "1px solid #2a3050",
        borderRadius: 8,
        padding: 3,
        gap: 2,
      }}
    >
      {[
        { id: "inspect", label: "⊹ Inspect" },
        { id: "defect", label: "⚠ Defects" },
      ].map((m) => {
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            style={{
              padding: "4px 14px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              fontSize: 11,
              fontFamily: "monospace",
              fontWeight: active ? 600 : 400,
              background: active
                ? m.id === "defect"
                  ? "rgba(247,95,95,0.18)"
                  : "rgba(79,142,247,0.18)"
                : "transparent",
              color: active
                ? m.id === "defect"
                  ? "#f75f5f"
                  : "#4f8ef7"
                : "#4a5270",
              transition: "all 0.15s",
            }}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// TOOLTIP (inspect mode)
// ═══════════════════════════════════════════════════════
function Tooltip({ entry, x, y }) {
  const dc = entry.defects.length;
  const hasHigh = entry.defects.some((d) => d.severity === "high");
  return (
    <div
      style={{
        position: "fixed",
        left: x + 18,
        top: y - 12,
        zIndex: 9999,
        background: "#181c27f5",
        backdropFilter: "blur(16px)",
        border: "1px solid #2a3050",
        borderRadius: 10,
        padding: "11px 15px",
        minWidth: 210,
        pointerEvents: "none",
        boxShadow: "0 8px 40px rgba(0,0,0,0.55)",
        animation: "ttIn 0.08s ease",
      }}
    >
      <div
        style={{
          fontFamily: "monospace",
          fontWeight: 700,
          fontSize: 13,
          color: "#e8ecf4",
          marginBottom: 4,
        }}
      >
        {entry.label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 4,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: entry.systemColor,
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 11, color: "#7a85a3" }}>{entry.system}</span>
      </div>
      <div
        style={{ fontSize: 11, color: "#7a85a3", marginBottom: dc > 0 ? 6 : 0 }}
      >
        {entry.type} · {entry.subtype}
      </div>
      {dc > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            color: hasHigh ? "#f75f5f" : "#f7a84f",
          }}
        >
          <span>⚠</span>
          <span>
            {dc} defect{dc !== 1 ? "s" : ""}
          </span>
        </div>
      )}
      <div
        style={{
          marginTop: 8,
          paddingTop: 7,
          borderTop: "1px solid #2a3050",
          fontSize: 10,
          color: "#4f8ef7",
        }}
      >
        Click to inspect →
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// CLUSTER TOOLTIP (defect mode)
// ═══════════════════════════════════════════════════════
function ClusterTooltip({ cluster, x, y }) {
  const s = SEV_MARKER[cluster.worst];
  const highC = cluster.members
    .flatMap((l) => MANIFEST[l].defects)
    .filter((d) => d.severity === "high").length;
  const medC = cluster.members
    .flatMap((l) => MANIFEST[l].defects)
    .filter((d) => d.severity === "medium").length;
  const lowC = cluster.members
    .flatMap((l) => MANIFEST[l].defects)
    .filter((d) => d.severity === "low").length;
  return (
    <div
      style={{
        position: "fixed",
        left: x + 18,
        top: y - 12,
        zIndex: 9999,
        background: "#181c27f5",
        backdropFilter: "blur(16px)",
        border: `1px solid ${s.fill}44`,
        borderRadius: 10,
        padding: "11px 15px",
        minWidth: 210,
        pointerEvents: "none",
        boxShadow: `0 8px 40px rgba(0,0,0,0.55), 0 0 20px ${s.glow}`,
        animation: "ttIn 0.08s ease",
      }}
    >
      {cluster.isSingle ? (
        <>
          <div
            style={{
              fontFamily: "monospace",
              fontWeight: 700,
              fontSize: 13,
              color: "#e8ecf4",
              marginBottom: 4,
            }}
          >
            {cluster.label}
          </div>
          <div style={{ fontSize: 11, color: "#7a85a3", marginBottom: 6 }}>
            {MANIFEST[cluster.label].type} · {MANIFEST[cluster.label].subtype}
          </div>
        </>
      ) : (
        <div
          style={{
            fontFamily: "monospace",
            fontWeight: 700,
            fontSize: 13,
            color: "#e8ecf4",
            marginBottom: 4,
          }}
        >
          {cluster.members.length} fittings
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
        {highC > 0 && (
          <span
            style={{
              background: "rgba(247,95,95,0.15)",
              color: "#f75f5f",
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "monospace",
            }}
          >
            H:{highC}
          </span>
        )}
        {medC > 0 && (
          <span
            style={{
              background: "rgba(247,168,79,0.15)",
              color: "#f7a84f",
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "monospace",
            }}
          >
            M:{medC}
          </span>
        )}
        {lowC > 0 && (
          <span
            style={{
              background: "rgba(79,247,164,0.15)",
              color: "#4ff7a4",
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "monospace",
            }}
          >
            L:{lowC}
          </span>
        )}
      </div>
      <div
        style={{
          marginTop: 8,
          paddingTop: 7,
          borderTop: `1px solid ${s.fill}33`,
          fontSize: 10,
          color: s.fill,
        }}
      >
        Click to inspect →
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// HIT OVERLAY (inspect mode)
// ═══════════════════════════════════════════════════════
const HitOverlay = ({ positions, selected, onSelect, onMove, onLeave }) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      width: W,
      height: H,
      pointerEvents: "none",
    }}
  >
    {ALL_LABELS.map((label) => {
      const pos = positions[label];
      if (!pos) return null;
      const isSel = selected?.label === label;
      return (
        <div
          key={label}
          id={`hit-${label}`}
          onClick={() => onSelect(MANIFEST[label])}
          onPointerMove={(e) => onMove(label, e.clientX, e.clientY)}
          onPointerLeave={onLeave}
          style={{
            position: "absolute",
            left: pos.x,
            top: pos.y - 16,
            width: HIT_W,
            height: HIT_H,
            cursor: "pointer",
            pointerEvents: "all",
            borderRadius: 3,
            background: isSel ? "rgba(79,142,247,0.15)" : "transparent",
            border: isSel
              ? "1.5px solid rgba(79,142,247,0.6)"
              : "1.5px solid transparent",
            boxShadow: isSel ? "0 0 10px rgba(79,142,247,0.3)" : "none",
            transition: "background 0.15s, border-color 0.15s",
          }}
        />
      );
    })}
  </div>
);

// ═══════════════════════════════════════════════════════
// DEFECT MARKER OVERLAY
// Clustered bubbles, severity coloured, pulsing if high
// ═══════════════════════════════════════════════════════
const DefectOverlay = ({
  positions,
  clusters,
  onSelect,
  onClusterHover,
  onLeave,
  selectedCluster,
}) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      width: W,
      height: H,
      pointerEvents: "none",
    }}
  >
    {clusters.map((cluster) => {
      const s = SEV_MARKER[cluster.worst];
      const isHigh = cluster.worst === "high";
      const isSel = selectedCluster?.id === cluster.id;
      // Size scales with defect count, capped
      const size = Math.min(44, 26 + cluster.count * 3);
      const isCluster = cluster.members.length > 1;

      return (
        <div
          key={cluster.id}
          onClick={() => {
            if (cluster.isSingle) onSelect(MANIFEST[cluster.label]);
            else onSelect(MANIFEST[cluster.members[0]]); // zoom to first, panel shows it
          }}
          onPointerMove={(e) => onClusterHover(cluster, e.clientX, e.clientY)}
          onPointerLeave={onLeave}
          style={{
            position: "absolute",
            left: cluster.x - size / 2,
            top: cluster.y - size / 2,
            width: size,
            height: size,
            pointerEvents: "all",
            cursor: "pointer",
            zIndex: isHigh ? 3 : isCluster ? 2 : 1,
          }}
        >
          {/* Pulse ring for high severity */}
          {isHigh && (
            <div
              style={{
                position: "absolute",
                inset: -6,
                borderRadius: "50%",
                border: `1.5px solid ${s.fill}`,
                animation: "defectPulse 2s ease-out infinite",
                pointerEvents: "none",
              }}
            />
          )}
          {/* Outer glow ring */}
          <div
            style={{
              position: "absolute",
              inset: -3,
              borderRadius: "50%",
              background: s.ring,
              border: `1px solid ${s.fill}55`,
              transition: "transform 0.15s",
              transform: isSel ? "scale(1.15)" : "scale(1)",
            }}
          />
          {/* Main bubble */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: `radial-gradient(circle at 35% 35%, ${s.fill}ee, ${s.fill}99)`,
              border: `1.5px solid ${s.fill}`,
              boxShadow: isSel
                ? `0 0 0 3px ${s.fill}55, 0 4px 16px ${s.glow}`
                : `0 2px 10px ${s.glow}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "box-shadow 0.15s, transform 0.15s",
              transform: isSel ? "scale(1.12)" : "scale(1)",
            }}
          >
            <span
              style={{
                fontSize: size > 34 ? 12 : 10,
                fontWeight: 700,
                fontFamily: "monospace",
                color: "#0f1117",
                lineHeight: 1,
                userSelect: "none",
              }}
            >
              {cluster.count > 99 ? "99+" : cluster.count}
            </span>
          </div>
          {/* Cluster badge — small corner pip showing member count */}
          {isCluster && (
            <div
              style={{
                position: "absolute",
                top: -4,
                right: -4,
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "#1e2333",
                border: "1px solid #2a3050",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 8,
                fontWeight: 700,
                fontFamily: "monospace",
                color: "#7a85a3",
              }}
            >
              {cluster.members.length > 9 ? "9+" : cluster.members.length}
            </div>
          )}
        </div>
      );
    })}
  </div>
);

// ═══════════════════════════════════════════════════════
// ZOOM CONTROLS
// ═══════════════════════════════════════════════════════
function ZoomControls() {
  const { zoomIn, zoomOut, resetTransform } = useTransformContext();
  return (
    <div
      style={{
        position: "absolute",
        bottom: 20,
        right: 20,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        zIndex: 10,
      }}
    >
      {[
        { label: "+", fn: () => zoomIn(0.5, 200) },
        { label: "−", fn: () => zoomOut(0.5, 200) },
        { label: "⊡", fn: () => resetTransform() },
      ].map((b) => (
        <button
          key={b.label}
          onClick={b.fn}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#2a3060dd")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "#1e2333dd")}
          style={{
            width: 34,
            height: 34,
            background: "#1e2333dd",
            backdropFilter: "blur(8px)",
            border: "1px solid #2a3050",
            borderRadius: 7,
            color: "#e8ecf4",
            fontSize: 17,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.12s",
          }}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// VIRTUAL LIST
// ═══════════════════════════════════════════════════════
function VirtualList({ items, selected, onSelect }) {
  const outerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(500);
  const ITEM_H = 34;

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!selected || !outerRef.current) return;
    const idx = items.findIndex((e) => e.label === selected.label);
    if (idx < 0) return;
    const top = idx * ITEM_H,
      vis = outerRef.current.scrollTop;
    if (top < vis || top + ITEM_H > vis + height)
      outerRef.current.scrollTop = top - height / 2 + ITEM_H / 2;
  }, [selected, items, height]);

  const overscan = 5;
  const startIdx = Math.max(0, Math.floor(scrollTop / ITEM_H) - overscan);
  const endIdx = Math.min(
    items.length,
    startIdx + Math.ceil(height / ITEM_H) + overscan * 2,
  );

  return (
    <div
      ref={outerRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      style={{ height: "100%", overflowY: "auto" }}
    >
      <div style={{ height: items.length * ITEM_H, position: "relative" }}>
        {items.slice(startIdx, endIdx).map((entry, i) => {
          const idx = startIdx + i,
            isSel = selected?.label === entry.label;
          const hasHigh = entry.defects.some((d) => d.severity === "high"),
            dc = entry.defects.length;
          return (
            <div
              key={entry.label}
              style={{
                position: "absolute",
                top: idx * ITEM_H,
                width: "100%",
                height: ITEM_H,
              }}
            >
              <button
                onClick={() => onSelect(entry)}
                style={{
                  width: "100%",
                  height: "100%",
                  background: isSel ? "rgba(79,142,247,0.12)" : "none",
                  border: "none",
                  borderLeft: `2px solid ${isSel ? "#4f8ef7" : "transparent"}`,
                  padding: "0 12px 0 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: entry.systemColor,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 11,
                    color: isSel ? "#e8ecf4" : "#c8cfe8",
                    flex: 1,
                  }}
                >
                  {entry.label}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: "#4a5270",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 70,
                  }}
                >
                  {entry.subtype}
                </span>
                {dc > 0 && (
                  <span
                    style={{
                      background: hasHigh ? "#f75f5f" : "#f7a84f",
                      color: "#fff",
                      borderRadius: 8,
                      padding: "1px 5px",
                      fontSize: 10,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {dc}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// SEARCH PANEL (inspect mode, left)
// ═══════════════════════════════════════════════════════
function SearchPanel({ selected, onSelect, fileInputRef, isDemo }) {
  const [search, setSearch] = useState("");
  const [sysFilter, setSysFilter] = useState(null);

  const filtered = useMemo(() => {
    let items = Object.values(MANIFEST);
    if (sysFilter) items = items.filter((e) => e.system === sysFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (e) =>
          e.label.toLowerCase().includes(q) ||
          e.subtype.toLowerCase().includes(q) ||
          e.type.toLowerCase().includes(q),
      );
    }
    return items;
  }, [search, sysFilter]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          padding: "12px 14px 10px",
          borderBottom: "1px solid #2a3050",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: "#e8ecf4" }}>
            Fittings
          </span>
          <span
            style={{
              fontSize: 10,
              fontFamily: "monospace",
              color: "#4f8ef7",
              background: "rgba(79,142,247,0.12)",
              border: "1px solid rgba(79,142,247,0.2)",
              borderRadius: 4,
              padding: "2px 7px",
            }}
          >
            {ALL_LABELS.length.toLocaleString()}
          </span>
        </div>
        <div style={{ position: "relative", marginBottom: 7 }}>
          <span
            style={{
              position: "absolute",
              left: 8,
              top: "50%",
              transform: "translateY(-50%)",
              color: "#4a5270",
              fontSize: 14,
              pointerEvents: "none",
            }}
          >
            ⌕
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search fittings..."
            style={{
              width: "100%",
              padding: "6px 8px 6px 26px",
              background: "#1e2333",
              border: "1px solid #2a3050",
              borderRadius: 5,
              color: "#e8ecf4",
              fontSize: 11,
              fontFamily: "inherit",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 6 }}
        >
          <button
            onClick={() => setSysFilter(null)}
            style={{
              fontSize: 9,
              padding: "2px 7px",
              borderRadius: 10,
              cursor: "pointer",
              fontFamily: "monospace",
              border: "1px solid",
              background: !sysFilter ? "rgba(255,255,255,0.1)" : "none",
              borderColor: !sysFilter ? "#7a85a3" : "#2a3050",
              color: !sysFilter ? "#e8ecf4" : "#4a5270",
            }}
          >
            All
          </button>
          {SYSTEM_DEFS.map((s) => (
            <button
              key={s.prefix}
              onClick={() =>
                setSysFilter((f) => (f === s.name ? null : s.name))
              }
              style={{
                fontSize: 9,
                padding: "2px 7px",
                borderRadius: 10,
                cursor: "pointer",
                fontFamily: "monospace",
                border: "1px solid",
                background: sysFilter === s.name ? s.color + "22" : "none",
                borderColor: sysFilter === s.name ? s.color : "#2a3050",
                color: sysFilter === s.name ? s.color : "#4a5270",
              }}
            >
              {s.prefix}
            </button>
          ))}
        </div>
        <div
          style={{ fontSize: 10, color: "#4a5270", fontFamily: "monospace" }}
        >
          {filtered.length.toLocaleString()} results
        </div>
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>
        <VirtualList items={filtered} selected={selected} onSelect={onSelect} />
      </div>
      <div
        style={{ padding: 10, borderTop: "1px solid #2a3050", flexShrink: 0 }}
      >
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            width: "100%",
            padding: 7,
            background: "#1e2333",
            border: "1px solid #2a3050",
            borderRadius: 5,
            color: "#e8ecf4",
            fontSize: 11,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {isDemo ? "⊕  Load SVG file" : "⊕  Replace SVG"}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// DEFECT PANEL (defect mode, left)
// ═══════════════════════════════════════════════════════
function DefectPanel({ onSelect }) {
  const [sevFilter, setSevFilter] = useState(null); // null | "high" | "medium" | "low"
  const [sortBy, setSortBy] = useState("severity"); // "severity" | "count" | "system"

  // Pre-compute all defective fittings with their worst severity
  const defectiveEntries = useMemo(() => {
    return Object.values(MANIFEST)
      .filter((e) => e.defects.length > 0)
      .map((e) => ({ ...e, worst: worstSeverity(e.defects) }));
  }, []);

  const totalHigh = useMemo(
    () =>
      defectiveEntries.reduce(
        (n, e) => n + e.defects.filter((d) => d.severity === "high").length,
        0,
      ),
    [defectiveEntries],
  );
  const totalMed = useMemo(
    () =>
      defectiveEntries.reduce(
        (n, e) => n + e.defects.filter((d) => d.severity === "medium").length,
        0,
      ),
    [defectiveEntries],
  );
  const totalLow = useMemo(
    () =>
      defectiveEntries.reduce(
        (n, e) => n + e.defects.filter((d) => d.severity === "low").length,
        0,
      ),
    [defectiveEntries],
  );

  // System breakdown
  const bySystem = useMemo(() => {
    const map = {};
    SYSTEM_DEFS.forEach((s) => {
      map[s.name] = { ...s, count: 0, high: 0 };
    });
    defectiveEntries.forEach((e) => {
      map[e.system].count += e.defects.length;
      map[e.system].high += e.defects.filter(
        (d) => d.severity === "high",
      ).length;
    });
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [defectiveEntries]);

  const filtered = useMemo(() => {
    let items = sevFilter
      ? defectiveEntries.filter((e) => e.worst === sevFilter)
      : defectiveEntries;
    if (sortBy === "severity") {
      const order = { high: 0, medium: 1, low: 2 };
      items = [...items].sort(
        (a, b) =>
          order[a.worst] - order[b.worst] ||
          b.defects.length - a.defects.length,
      );
    } else if (sortBy === "count") {
      items = [...items].sort((a, b) => b.defects.length - a.defects.length);
    } else {
      items = [...items].sort((a, b) => a.system.localeCompare(b.system));
    }
    return items;
  }, [defectiveEntries, sevFilter, sortBy]);

  const ITEM_H = 38;
  const outerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const overscan = 4;
  const startIdx = Math.max(0, Math.floor(scrollTop / ITEM_H) - overscan);
  const endIdx = Math.min(
    filtered.length,
    startIdx + Math.ceil(height / ITEM_H) + overscan * 2,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Summary stats */}
      <div
        style={{
          padding: "12px 14px 10px",
          borderBottom: "1px solid #2a3050",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: "#e8ecf4" }}>
            Defect Overview
          </span>
          <span
            style={{
              fontSize: 10,
              fontFamily: "monospace",
              color: "#f75f5f",
              background: "rgba(247,95,95,0.12)",
              border: "1px solid rgba(247,95,95,0.2)",
              borderRadius: 4,
              padding: "2px 7px",
            }}
          >
            {defectiveEntries.length} affected
          </span>
        </div>

        {/* Severity summary cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 6,
            marginBottom: 10,
          }}
        >
          {[
            {
              key: "high",
              label: "High",
              count: totalHigh,
              color: "#f75f5f",
              bg: "rgba(247,95,95,0.08)",
            },
            {
              key: "medium",
              label: "Med",
              count: totalMed,
              color: "#f7a84f",
              bg: "rgba(247,168,79,0.08)",
            },
            {
              key: "low",
              label: "Low",
              count: totalLow,
              color: "#4ff7a4",
              bg: "rgba(79,247,164,0.08)",
            },
          ].map((s) => (
            <button
              key={s.key}
              onClick={() => setSevFilter((f) => (f === s.key ? null : s.key))}
              style={{
                background: sevFilter === s.key ? s.bg : "#1a1f2e",
                border: `1px solid ${sevFilter === s.key ? s.color + "55" : "#2a3050"}`,
                borderRadius: 7,
                padding: "8px 6px",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                transition: "all 0.15s",
              }}
            >
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  fontFamily: "monospace",
                  color: s.color,
                  lineHeight: 1,
                }}
              >
                {s.count}
              </span>
              <span
                style={{
                  fontSize: 9,
                  color: "#4a5270",
                  fontFamily: "monospace",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {s.label}
              </span>
            </button>
          ))}
        </div>

        {/* System breakdown mini-bars */}
        <div style={{ marginBottom: 8 }}>
          <div
            style={{
              fontSize: 9,
              color: "#4a5270",
              fontFamily: "monospace",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 6,
            }}
          >
            By System
          </div>
          {bySystem
            .filter((s) => s.count > 0)
            .map((s) => {
              const maxCount = bySystem[0].count;
              const pct = (s.count / maxCount) * 100;
              return (
                <div key={s.name} style={{ marginBottom: 5 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 2,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        fontFamily: "monospace",
                        color: s.color,
                      }}
                    >
                      {s.prefix}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        fontFamily: "monospace",
                        color: "#4a5270",
                      }}
                    >
                      {s.high > 0 && (
                        <span style={{ color: "#f75f5f", marginRight: 4 }}>
                          {s.high}H
                        </span>
                      )}
                      {s.count}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 3,
                      background: "#1e2333",
                      borderRadius: 2,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${pct}%`,
                        background: s.color,
                        borderRadius: 2,
                        opacity: 0.7,
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                </div>
              );
            })}
        </div>

        {/* Sort control */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span
            style={{ fontSize: 9, color: "#4a5270", fontFamily: "monospace" }}
          >
            Sort:
          </span>
          {[
            { key: "severity", label: "Severity" },
            { key: "count", label: "Count" },
            { key: "system", label: "System" },
          ].map((s) => (
            <button
              key={s.key}
              onClick={() => setSortBy(s.key)}
              style={{
                fontSize: 9,
                padding: "2px 7px",
                borderRadius: 10,
                cursor: "pointer",
                fontFamily: "monospace",
                border: "1px solid",
                background:
                  sortBy === s.key ? "rgba(255,255,255,0.08)" : "none",
                borderColor: sortBy === s.key ? "#7a85a3" : "#2a3050",
                color: sortBy === s.key ? "#e8ecf4" : "#4a5270",
              }}
            >
              {s.label}
            </button>
          ))}
          <span
            style={{
              marginLeft: "auto",
              fontSize: 9,
              color: "#4a5270",
              fontFamily: "monospace",
            }}
          >
            {filtered.length}
          </span>
        </div>
      </div>

      {/* Virtual defect list */}
      <div
        ref={outerRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        style={{ flex: 1, overflowY: "auto" }}
      >
        <div style={{ height: filtered.length * ITEM_H, position: "relative" }}>
          {filtered.slice(startIdx, endIdx).map((entry, i) => {
            const idx = startIdx + i;
            const s = SEV_MARKER[entry.worst];
            const dc = entry.defects.length;
            const highC = entry.defects.filter(
              (d) => d.severity === "high",
            ).length;
            return (
              <div
                key={entry.label}
                style={{
                  position: "absolute",
                  top: idx * ITEM_H,
                  width: "100%",
                  height: ITEM_H,
                }}
              >
                <button
                  onClick={() => onSelect(entry)}
                  style={{
                    width: "100%",
                    height: "100%",
                    background: "none",
                    border: "none",
                    borderLeft: `2px solid transparent`,
                    padding: "0 12px 0 10px",
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "rgba(255,255,255,0.03)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "none")
                  }
                >
                  {/* Severity dot */}
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: s.fill,
                      boxShadow: `0 0 5px ${s.glow}`,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontSize: 11,
                      color: "#c8cfe8",
                      flex: 1,
                    }}
                  >
                    {entry.label}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color: "#4a5270",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 60,
                    }}
                  >
                    {entry.subtype}
                  </span>
                  {/* Count badges */}
                  <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                    {highC > 0 && (
                      <span
                        style={{
                          background: "rgba(247,95,95,0.15)",
                          color: "#f75f5f",
                          borderRadius: 6,
                          padding: "1px 5px",
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {highC}
                      </span>
                    )}
                    {dc - highC > 0 && (
                      <span
                        style={{
                          background: "rgba(247,168,79,0.12)",
                          color: "#f7a84f",
                          borderRadius: 6,
                          padding: "1px 5px",
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {dc - highC}
                      </span>
                    )}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// DETAIL PANEL (right, both modes)
// ═══════════════════════════════════════════════════════
function DetailPanel({ entry, onClose }) {
  const [tab, setTab] = useState("general");
  const dc = entry.defects.length;
  useEffect(() => setTab("general"), [entry.label]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          padding: "12px 14px 0",
          borderBottom: "1px solid #2a3050",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "#7a85a3",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: entry.systemColor,
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            <span>{entry.system}</span>
          </div>
          <button
            onClick={onClose}
            title="Close"
            onMouseEnter={(e) => (e.currentTarget.style.color = "#e8ecf4")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#4a5270")}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#4a5270",
              fontSize: 18,
              padding: "0 0 0 8px",
              lineHeight: 1,
              transition: "color 0.12s",
            }}
          >
            ×
          </button>
        </div>
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 18,
            fontWeight: 700,
            color: "#e8ecf4",
            marginBottom: 3,
          }}
        >
          {entry.label}
        </div>
        <div style={{ fontSize: 12, color: "#7a85a3", marginBottom: 10 }}>
          {entry.type} · {entry.subtype}
        </div>
        <div style={{ display: "flex" }}>
          {["general", "defects", "other"].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "5px 12px 9px",
                fontFamily: "monospace",
                fontSize: 11,
                color: tab === t ? "#e8ecf4" : "#7a85a3",
                borderBottom: `2px solid ${tab === t ? "#4f8ef7" : "transparent"}`,
                textTransform: "capitalize",
                flexShrink: 0,
              }}
            >
              {t}
              {t === "defects" && dc > 0 && (
                <span
                  style={{
                    marginLeft: 4,
                    color: "#fff",
                    borderRadius: 8,
                    padding: "1px 5px",
                    fontSize: 10,
                    fontWeight: 700,
                    background: dc >= 2 ? "#f75f5f" : "#f7a84f",
                  }}
                >
                  {dc}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
        {tab === "general" && (
          <>
            <PSection title="Identification">
              <PField label="Part Number" value={entry.part_number} />
              <PField label="Serial Number" value={entry.serial_number} />
              <PField label="Manufacturer" value={entry.manufacturer} />
              <PField label="Weight" value={entry.weight} />
            </PSection>
            <PSection title="Lifecycle">
              <PField label="Install Date" value={entry.install_date} />
              <PField label="Last Maintenance" value={entry.last_maintenance} />
              <PField label="Next Inspection" value={entry.next_inspection} />
            </PSection>
            <PSection title="Description">
              <p
                style={{
                  fontSize: 13,
                  color: "#7a85a3",
                  lineHeight: 1.65,
                  margin: 0,
                }}
              >
                {entry.description}
              </p>
            </PSection>
          </>
        )}
        {tab === "defects" && (
          <>
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: "#7a85a3" }}>
                {dc} defect{dc !== 1 ? "s" : ""}
              </span>
            </div>
            {dc === 0 ? (
              <p
                style={{
                  fontSize: 13,
                  color: "#4a5270",
                  textAlign: "center",
                  marginTop: 40,
                }}
              >
                No defects recorded
              </p>
            ) : (
              entry.defects.map((d) => (
                <div
                  key={d.id}
                  style={{
                    padding: "10px 12px",
                    marginBottom: 7,
                    background: "#1e2333",
                    borderRadius: 6,
                    border: "1px solid #2a3050",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        color: "#e8ecf4",
                        fontWeight: 500,
                        lineHeight: 1.4,
                      }}
                    >
                      {d.title}
                    </span>
                    <Badge severity={d.severity} />
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      color: "#4a5270",
                      fontFamily: "monospace",
                    }}
                  >
                    {d.id} · {d.date}
                  </span>
                </div>
              ))
            )}
          </>
        )}
        {tab === "other" && (
          <p
            style={{
              fontSize: 13,
              color: "#4a5270",
              textAlign: "center",
              marginTop: 40,
            }}
          >
            No additional data
          </p>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// RESIZE HANDLE
// ═══════════════════════════════════════════════════════
function ResizeHandle({ onDrag, side }) {
  const dragging = useRef(false);
  const lastX = useRef(0);
  const onPointerDown = useCallback((e) => {
    dragging.current = true;
    lastX.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);
  const onPointerMove = useCallback(
    (e) => {
      if (!dragging.current) return;
      const delta = e.clientX - lastX.current;
      lastX.current = e.clientX;
      onDrag(side === "right" ? delta : -delta);
    },
    [onDrag, side],
  );
  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onMouseEnter={(e) =>
        (e.currentTarget.querySelector(".handle-line").style.background =
          "rgba(79,142,247,0.6)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.querySelector(".handle-line").style.background =
          "#2a3050")
      }
      style={{
        width: 5,
        flexShrink: 0,
        cursor: "col-resize",
        position: "relative",
        zIndex: 5,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        className="handle-line"
        style={{
          width: 1,
          height: "100%",
          background: "#2a3050",
          transition: "background 0.15s",
        }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// SCALE READER — reads current zoom from TransformContext
// Lets parent component recompute clusters on zoom change
// ═══════════════════════════════════════════════════════
function ScaleReader({ onScale }) {
  const { transformState } = useTransformContext();
  useEffect(() => {
    onScale(transformState.scale);
  }, [transformState.scale, onScale]);
  return null;
}

// ═══════════════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════════════
export default function DiagramViewer() {
  const fileInputRef = useRef(null);
  const transformRef = useRef(null);

  const [leftW, setLeftW] = useState(240);
  const [rightW, setRightW] = useState(290);

  const [svgUrl, setSvgUrl] = useState(SVG_URL);
  const [isDemo, setIsDemo] = useState(true);
  const [svgLoaded, setSvgLoaded] = useState(false);
  const [positions, setPositions] = useState({});
  const [selected, setSelected] = useState(null);
  const [tooltip, setTooltip] = useState(null);

  // Mode: "inspect" | "defect"
  const [mode, setMode] = useState("inspect");

  // Current zoom scale — used for clustering
  const [scale, setScale] = useState(0.07);

  // Cluster tooltip in defect mode
  const [clusterTip, setClusterTip] = useState(null);

  useEffect(() => {
    fetch(svgUrl)
      .then((r) => r.text())
      .then((text) => setPositions(parseSVGPositions(text)))
      .catch((err) => console.warn("SVG position parse failed:", err));
  }, [svgUrl]);

  // Recompute clusters when scale or positions change
  const clusters = useMemo(
    () => computeClusters(positions, scale),
    [positions, scale],
  );

  const handleSelect = useCallback((entry) => {
    setSelected(entry);
    setTooltip(null);
    setClusterTip(null);
    setTimeout(
      () => transformRef.current?.zoomToElement(`hit-${entry.label}`, 4, 350),
      50,
    );
  }, []);

  const handleClose = useCallback(() => setSelected(null), []);
  const handleMove = useCallback(
    (label, x, y) => setTooltip({ entry: MANIFEST[label], x, y }),
    [],
  );
  const handleLeave = useCallback(() => {
    setTooltip(null);
    setClusterTip(null);
  }, []);

  const handleClusterHover = useCallback((cluster, x, y) => {
    setClusterTip({ cluster, x, y });
  }, []);

  const handleModeChange = useCallback((m) => {
    setMode(m);
    setSelected(null);
    setTooltip(null);
    setClusterTip(null);
  }, []);

  const handleUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setSvgUrl((prev) => {
      URL.revokeObjectURL(prev);
      return url;
    });
    setIsDemo(false);
    setSelected(null);
    setTooltip(null);
    setSvgLoaded(false);
    e.target.value = "";
  }, []);

  const dragLeft = useCallback(
    (d) => setLeftW((w) => Math.max(160, Math.min(500, w + d))),
    [],
  );
  const dragRight = useCallback(
    (d) => setRightW((w) => Math.max(200, Math.min(540, w + d))),
    [],
  );

  const totalDefects = useMemo(
    () => Object.values(MANIFEST).reduce((n, e) => n + e.defects.length, 0),
    [],
  );
  const highDefects = useMemo(
    () =>
      Object.values(MANIFEST).reduce(
        (n, e) => n + e.defects.filter((d) => d.severity === "high").length,
        0,
      ),
    [],
  );

  const isDefectMode = mode === "defect";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        background: "#0f1117",
        color: "#e8ecf4",
        fontFamily: "'DM Sans', system-ui, sans-serif",
        overflow: "hidden",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');
        @keyframes ttIn      { from { opacity:0; transform:translateY(3px)  } to { opacity:1; transform:none } }
        @keyframes panelIn   { from { opacity:0; transform:translateX(8px)  } to { opacity:1; transform:none } }
        @keyframes fadeUp    { from { opacity:0; transform:translateY(6px)  } to { opacity:1; transform:none } }
        @keyframes defectPulse {
          0%   { transform: scale(1);   opacity: 0.8; }
          60%  { transform: scale(1.5); opacity: 0;   }
          100% { transform: scale(1.5); opacity: 0;   }
        }
        ::-webkit-scrollbar       { width: 4px }
        ::-webkit-scrollbar-track { background: transparent }
        ::-webkit-scrollbar-thumb { background: #2a3050; border-radius: 2px }
        input::placeholder { color: #4a5270 }
        button { font-family: inherit; }
      `}</style>

      {/* ── Header ── */}
      <header
        style={{
          height: 46,
          display: "flex",
          alignItems: "center",
          padding: "0 18px",
          borderBottom: "1px solid #2a3050",
          background: "#0d0f1acc",
          backdropFilter: "blur(14px)",
          flexShrink: 0,
          gap: 14,
          zIndex: 20,
        }}
      >
        <span
          style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 500 }}
        >
          Vantor Engine · System Diagram
        </span>
        <div style={{ width: 1, height: 18, background: "#2a3050" }} />
        <span
          style={{ fontSize: 11, fontFamily: "monospace", color: "#4a5270" }}
        >
          {ALL_LABELS.length.toLocaleString()} fittings
        </span>
        <span
          style={{ fontSize: 11, fontFamily: "monospace", color: "#f75f5f" }}
        >
          {highDefects} high defects
        </span>
        <span
          style={{ fontSize: 11, fontFamily: "monospace", color: "#7a85a3" }}
        >
          {totalDefects} total
        </span>
        <div style={{ flex: 1 }} />
        {/* Mode toggle — centred */}
        <ModeToggle mode={mode} onChange={handleModeChange} />
        <div style={{ flex: 1 }} />
        <div
          style={{
            fontSize: 11,
            fontFamily: "monospace",
            color: "#4a5270",
            background: "#1e2333",
            border: "1px solid #2a3050",
            borderRadius: 5,
            padding: "3px 10px",
          }}
        >
          {W.toLocaleString()} × {H.toLocaleString()} · scroll to zoom · drag to
          pan
        </div>
      </header>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left panel — switches with mode */}
        <div
          style={{
            width: leftW,
            flexShrink: 0,
            height: "100%",
            background: "#13172199",
            backdropFilter: "blur(12px)",
            overflow: "hidden",
            borderRight: "1px solid #2a3050",
          }}
        >
          {isDefectMode ? (
            <DefectPanel onSelect={handleSelect} />
          ) : (
            <SearchPanel
              selected={selected}
              onSelect={handleSelect}
              fileInputRef={fileInputRef}
              isDemo={isDemo}
            />
          )}
        </div>

        <ResizeHandle onDrag={dragLeft} side="right" />

        {/* Canvas */}
        <div
          style={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
            background: "#eef0f5",
          }}
        >
          <TransformWrapper
            ref={transformRef}
            initialScale={0.07}
            minScale={0.03}
            maxScale={3}
            wheel={{ step: 0.035, smoothStep: 0.002 }}
            doubleClick={{ step: 0.5, animationTime: 300 }}
            panning={{ velocityDisabled: false }}
            velocityAnimation={{
              sensitivity: 1,
              animationTime: 500,
              equalToMove: true,
            }}
            limitToBounds={false}
            centerOnInit
          >
            <TransformComponent
              wrapperStyle={{ width: "100%", height: "100%" }}
              contentStyle={{ width: W, height: H }}
            >
              {/* Layer 1: SVG image — dimmed in defect mode */}
              <img
                src={svgUrl}
                width={W}
                height={H}
                draggable={false}
                onLoad={() => setSvgLoaded(true)}
                style={{
                  display: "block",
                  userSelect: "none",
                  transition: "filter 0.4s ease, opacity 0.4s ease",
                  filter: isDefectMode
                    ? "saturate(0.25) brightness(0.6)"
                    : "none",
                  opacity: isDefectMode ? 0.85 : 1,
                }}
              />

              {/* Layer 2a: hit boxes (inspect mode) */}
              {!isDefectMode && (
                <HitOverlay
                  positions={positions}
                  selected={selected}
                  onSelect={handleSelect}
                  onMove={handleMove}
                  onLeave={handleLeave}
                />
              )}

              {/* Layer 2b: defect markers (defect mode) */}
              {isDefectMode && (
                <DefectOverlay
                  positions={positions}
                  clusters={clusters}
                  onSelect={handleSelect}
                  onClusterHover={handleClusterHover}
                  onLeave={handleLeave}
                  selectedCluster={clusterTip?.cluster ?? null}
                />
              )}
            </TransformComponent>

            <ZoomControls />
            <ScaleReader onScale={setScale} />
          </TransformWrapper>

          {/* Selected pill */}
          {selected && (
            <div
              style={{
                position: "absolute",
                top: 13,
                left: "50%",
                transform: "translateX(-50%)",
                background: "#1e2333dd",
                backdropFilter: "blur(10px)",
                border: "1px solid #2a3050",
                borderRadius: 20,
                padding: "4px 14px",
                fontSize: 11,
                fontFamily: "monospace",
                color: "#e8ecf4",
                pointerEvents: "none",
                display: "flex",
                alignItems: "center",
                gap: 8,
                whiteSpace: "nowrap",
                zIndex: 10,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: selected.systemColor,
                }}
              />
              {selected.label} · {selected.subtype}
            </div>
          )}

          {/* Defect mode legend */}
          {isDefectMode && svgLoaded && (
            <div
              style={{
                position: "absolute",
                bottom: 20,
                left: 14,
                display: "flex",
                flexDirection: "column",
                gap: 5,
                background: "#181c27cc",
                backdropFilter: "blur(10px)",
                border: "1px solid #2a3050",
                borderRadius: 8,
                padding: "10px 12px",
                zIndex: 10,
                animation: "fadeUp 0.3s ease",
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: "#4a5270",
                  fontFamily: "monospace",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 2,
                }}
              >
                Severity
              </div>
              {[
                { label: "High", color: "#f75f5f" },
                { label: "Medium", color: "#f7a84f" },
                { label: "Low", color: "#4ff7a4" },
              ].map((s) => (
                <div
                  key={s.label}
                  style={{ display: "flex", alignItems: "center", gap: 7 }}
                >
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: s.color,
                      boxShadow: `0 0 5px ${s.color}88`,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: "monospace",
                      color: "#7a85a3",
                    }}
                  >
                    {s.label}
                  </span>
                </div>
              ))}
              <div
                style={{
                  marginTop: 4,
                  paddingTop: 6,
                  borderTop: "1px solid #2a3050",
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    color: "#4a5270",
                    fontFamily: "monospace",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 4,
                  }}
                >
                  Marker size
                </div>
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "monospace",
                    color: "#7a85a3",
                  }}
                >
                  = defect count
                </span>
              </div>
            </div>
          )}

          {!svgLoaded && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#0f1117bb",
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontFamily: "monospace",
                  color: "#4a5270",
                }}
              >
                Loading diagram…
              </span>
            </div>
          )}

          {isDemo && svgLoaded && !selected && !isDefectMode && (
            <div
              style={{
                position: "absolute",
                bottom: 20,
                left: "50%",
                transform: "translateX(-50%)",
                background: "#181c27cc",
                border: "1px solid #2a3050",
                borderRadius: 8,
                padding: "7px 16px",
                fontSize: 11,
                color: "#7a85a3",
                pointerEvents: "none",
                fontFamily: "monospace",
                whiteSpace: "nowrap",
                animation: "fadeUp 0.4s ease",
                zIndex: 10,
              }}
            >
              {ALL_LABELS.length.toLocaleString()} interactive labels · hover to
              preview · click to inspect
            </div>
          )}
        </div>

        {/* Right: detail panel */}
        {selected && (
          <>
            <ResizeHandle onDrag={dragRight} side="left" />
            <div
              style={{
                width: rightW,
                flexShrink: 0,
                height: "100%",
                background: "#13172199",
                backdropFilter: "blur(12px)",
                borderLeft: "1px solid #2a3050",
                overflow: "hidden",
                animation: "panelIn 0.18s ease",
              }}
            >
              <DetailPanel entry={selected} onClose={handleClose} />
            </div>
          </>
        )}
      </div>

      {/* Tooltips — above everything */}
      {!isDefectMode && tooltip && (
        <Tooltip entry={tooltip.entry} x={tooltip.x} y={tooltip.y} />
      )}
      {isDefectMode && clusterTip && (
        <ClusterTooltip
          cluster={clusterTip.cluster}
          x={clusterTip.x}
          y={clusterTip.y}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".svg"
        style={{ display: "none" }}
        onChange={handleUpload}
      />
    </div>
  );
}
