"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

type GraphNode = { id: string; name: string; type: string; documents: string[] };
type GraphEdge = { id: string; source: string; target: string; label: string };
type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

const TYPE_COLORS: Record<string, string> = {
  person: "#f59e0b",
  organisation: "#60a5fa",
  location: "#34d399",
  date: "#c084fc",
  clause: "#f87171",
  concept: "#94a3b8",
};

type Document = { id: string; original_filename: string };

export default function ReviewPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<string>("");
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractMsg, setExtractMsg] = useState("");
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });

  useEffect(() => {
    fetch("/api/documents?limit=100")
      .then((r) => r.json())
      .then((d) => setDocuments(Array.isArray(d.documents) ? d.documents : []));
  }, []);

  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      const e = entries[0];
      setDims({ w: e.contentRect.width, h: e.contentRect.height });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  async function loadGraph(docId: string) {
    if (!docId) { setGraph({ nodes: [], edges: [] }); return; }
    setLoading(true);
    const res = await fetch(`/api/graph?document_id=${docId}`);
    const data = await res.json();
    setGraph({ nodes: data.nodes ?? [], edges: data.edges ?? [] });
    setLoading(false);
  }

  async function extractEntities() {
    if (!selectedDoc) return;
    setExtracting(true);
    setExtractMsg("Extracting entities…");
    const res = await fetch("/api/ai/extract-entities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document_id: selectedDoc }),
    });
    const data = await res.json();
    if (res.ok) {
      setExtractMsg(`Found ${data.entities_found} entities, ${data.relations_stored} relations`);
      await loadGraph(selectedDoc);
    } else {
      setExtractMsg(`Error: ${data.error}`);
    }
    setExtracting(false);
  }

  const fgData = {
    nodes: graph.nodes.map((n) => ({ ...n, color: TYPE_COLORS[n.type] ?? "#94a3b8" })),
    links: graph.edges.map((e) => ({ source: e.source, target: e.target, label: e.label })),
  };

  return (
    <main style={{ height: "calc(100vh - 56px)", display: "flex", flexDirection: "column", backgroundColor: "#0d0d0d" }}>
      {/* Toolbar */}
      <div style={{ padding: "12px 20px", borderBottom: "1px solid #2a2a2a", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "14px", fontWeight: 700, color: "#ffffff" }}>Knowledge Graph</span>

        <select
          value={selectedDoc}
          onChange={(e) => { setSelectedDoc(e.target.value); loadGraph(e.target.value); setExtractMsg(""); }}
          style={{ padding: "6px 10px", fontSize: "13px", borderRadius: "6px", border: "1px solid #2a2a2a", backgroundColor: "#111", color: "#ffffff", outline: "none", minWidth: "220px" }}
        >
          <option value="">— Select a document —</option>
          {documents.map((d) => <option key={d.id} value={d.id}>{d.original_filename}</option>)}
        </select>

        <button
          onClick={extractEntities}
          disabled={!selectedDoc || extracting}
          style={{ padding: "6px 14px", fontSize: "13px", fontWeight: 600, borderRadius: "6px", backgroundColor: !selectedDoc || extracting ? "#333" : "#f59e0b", color: !selectedDoc || extracting ? "#555" : "#000", border: "none", cursor: !selectedDoc || extracting ? "not-allowed" : "pointer" }}
        >
          {extracting ? "Extracting…" : "⚡ Extract entities"}
        </button>

        {extractMsg && <span style={{ fontSize: "12px", color: "#9ca3af" }}>{extractMsg}</span>}

        {/* Legend */}
        <div style={{ marginLeft: "auto", display: "flex", gap: "10px", flexWrap: "wrap" }}>
          {Object.entries(TYPE_COLORS).map(([type, color]) => (
            <span key={type} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "#9ca3af" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: color, display: "inline-block" }} />
              {type}
            </span>
          ))}
        </div>
      </div>

      {/* Graph canvas */}
      <div ref={containerRef} style={{ flex: 1, position: "relative" }}>
        {loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280", fontSize: "14px" }}>
            Loading graph…
          </div>
        )}
        {!loading && graph.nodes.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px" }}>
            <span style={{ fontSize: "32px" }}>🔮</span>
            <p style={{ color: "#6b7280", fontSize: "14px" }}>
              {selectedDoc ? "No entities yet — click ⚡ Extract entities" : "Select a document to explore its knowledge graph"}
            </p>
          </div>
        )}
        {!loading && graph.nodes.length > 0 && (
          <ForceGraph2D
            width={dims.w}
            height={dims.h}
            graphData={fgData}
            backgroundColor="#0d0d0d"
            nodeLabel={(n) => `${(n as GraphNode).name} (${(n as GraphNode).type})`}
            nodeColor={(n) => (n as { color: string }).color}
            nodeRelSize={5}
            linkColor={() => "#374151"}
            linkWidth={1.5}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            linkLabel={(l) => (l as { label: string }).label}
            onNodeHover={(n) => setHoveredNode(n as GraphNode | null)}
            nodeCanvasObjectMode={() => "after"}
            nodeCanvasObject={(node, ctx, globalScale) => {
              const n = node as GraphNode & { x: number; y: number };
              const label = n.name;
              const fontSize = Math.max(10 / globalScale, 3);
              ctx.font = `${fontSize}px Sans-Serif`;
              ctx.fillStyle = "#e5e7eb";
              ctx.textAlign = "center";
              ctx.fillText(label, n.x, n.y + 8 / globalScale);
            }}
          />
        )}

        {/* Hover tooltip */}
        {hoveredNode && (
          <div style={{ position: "absolute", top: "12px", right: "12px", backgroundColor: "#111", border: "1px solid #2a2a2a", borderRadius: "8px", padding: "10px 14px", minWidth: "160px" }}>
            <p style={{ fontSize: "13px", fontWeight: 600, color: "#ffffff", marginBottom: "2px" }}>{hoveredNode.name}</p>
            <p style={{ fontSize: "11px", color: TYPE_COLORS[hoveredNode.type] ?? "#9ca3af" }}>{hoveredNode.type}</p>
            <p style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px" }}>
              {hoveredNode.documents.length} document{hoveredNode.documents.length !== 1 ? "s" : ""}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
