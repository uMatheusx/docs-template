import { AlertTriangle, Code2, Maximize2, Minus, Plus, RotateCcw, Workflow } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";

import { CopyButton } from "@/components/markdown/copy-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Hint } from "@/components/ui/tooltip";
import { useTheme } from "@/hooks/use-theme";
import { bodyFont } from "@/lib/content/typography";
import { cn } from "@/lib/utils";

type MermaidApi = typeof import("mermaid").default;
let loader: Promise<MermaidApi> | null = null;
const loadMermaid = () => (loader ??= import("mermaid").then((m) => m.default));

let counter = 0;
// Renderizações em série: mermaid.initialize é global.
let queue: Promise<unknown> = Promise.resolve();

const THEMES = {
  light: {
    background: "transparent",
    primaryColor: "#FFF1E3",
    primaryBorderColor: "#EC7000",
    primaryTextColor: "#0B1A45",
    secondaryColor: "#EEF3FF",
    tertiaryColor: "#FFF8EF",
    lineColor: "#5B6788",
    textColor: "#0B1A45",
    clusterBkg: "#FFF8F0",
    clusterBorder: "#FFC48A",
    noteBkgColor: "#FFF4D1",
    noteBorderColor: "#FFC20E",
    actorBkg: "#FFF1E3",
    actorBorder: "#EC7000",
    signalColor: "#0B1A45",
    pie1: "#EC7000",
    pie2: "#003399",
    pie3: "#FFC20E",
    pie4: "#7E9BE6",
    edgeLabelBackground: "#FFFFFF",
  },
  dark: {
    background: "transparent",
    primaryColor: "#1A1F3D",
    primaryBorderColor: "#FF8A1F",
    primaryTextColor: "#F1F4FB",
    secondaryColor: "#0F1A45",
    tertiaryColor: "#131A36",
    lineColor: "#93A0C3",
    textColor: "#E7ECF7",
    clusterBkg: "#0E1430",
    clusterBorder: "#9E4700",
    noteBkgColor: "#2A2410",
    noteBorderColor: "#FFC20E",
    actorBkg: "#1A1F3D",
    actorBorder: "#FF8A1F",
    signalColor: "#E7ECF7",
    pie1: "#FF8A1F",
    pie2: "#7E9BE6",
    pie3: "#FFC20E",
    pie4: "#1F4FC2",
    edgeLabelBackground: "#0E1430",
  },
};

async function renderDiagram(chart: string, dark: boolean): Promise<string> {
  const mermaid = await loadMermaid();
  const task = queue.then(async () => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: bodyFont(),
      themeVariables: { ...(dark ? THEMES.dark : THEMES.light), fontSize: "14px" },
    });
    const id = `mermaid-${++counter}`;
    try {
      const { svg } = await mermaid.render(id, chart);
      return svg;
    } finally {
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  });
  queue = task.catch(() => undefined);
  return task;
}

function diagramKind(chart: string): string {
  const first = chart.trim().split(/\s/)[0] ?? "";
  const names: Record<string, string> = {
    flowchart: "Fluxograma",
    graph: "Fluxograma",
    sequenceDiagram: "Sequência",
    erDiagram: "Entidade-relacionamento",
    "stateDiagram-v2": "Estados",
    stateDiagram: "Estados",
    classDiagram: "Classes",
    gantt: "Cronograma",
    pie: "Pizza",
    journey: "Jornada",
    mindmap: "Mapa mental",
    timeline: "Linha do tempo",
  };
  return names[first] ?? "Diagrama";
}

export function Mermaid({ chart }: { chart: string }) {
  const { resolved } = useTheme();
  const [state, setState] = useState<{ svg?: string; error?: string }>({});
  const [showCode, setShowCode] = useState(false);
  const [zoom, setZoom] = useState(false);
  // a fonte dos diagramas acompanha a pré-visualização de tipografia
  const [typeVersion, setTypeVersion] = useState(0);

  useEffect(() => {
    const onChange = () => setTypeVersion((v) => v + 1);
    window.addEventListener("ah:typography", onChange);
    return () => window.removeEventListener("ah:typography", onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    renderDiagram(chart.trim(), resolved === "dark")
      .then((svg) => !cancelled && setState({ svg }))
      .catch((err: unknown) => !cancelled && setState({ error: err instanceof Error ? err.message : String(err) }));
    return () => {
      cancelled = true;
    };
  }, [chart, resolved, typeVersion]);

  if (state.error) {
    return (
      <div className="not-prose my-6 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <div className="mb-2 flex items-center gap-2 font-semibold text-destructive">
          <AlertTriangle className="h-4 w-4" /> Erro ao renderizar diagrama Mermaid
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">{state.error}</pre>
      </div>
    );
  }

  return (
    <figure className="not-prose group relative my-8 overflow-hidden rounded-2xl border border-border/60 bg-card">
      <figcaption className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-4 py-2">
        <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <Workflow className="h-3.5 w-3.5 text-brand" /> {diagramKind(chart)}
        </span>
        <span className="flex gap-0.5">
          <Hint label={showCode ? "Ver diagrama" : "Ver código"}>
            <Button variant="ghost" size="icon-sm" onClick={() => setShowCode((v) => !v)} aria-label="Alternar código">
              <Code2 />
            </Button>
          </Hint>
          <CopyButton text={chart} />
          <Hint label="Explorar (zoom e arraste)">
            <Button variant="ghost" size="icon-sm" onClick={() => setZoom(true)} disabled={!state.svg} aria-label="Ampliar">
              <Maximize2 />
            </Button>
          </Hint>
        </span>
      </figcaption>
      <div className="bg-dots">
        {showCode ? (
          <pre className="overflow-x-auto bg-[hsl(var(--code-bg))] p-5 font-mono text-xs leading-relaxed text-[hsl(var(--hl-text))]">
            {chart}
          </pre>
        ) : state.svg ? (
          <button
            type="button"
            onClick={() => setZoom(true)}
            className="flex w-full cursor-zoom-in justify-center overflow-x-auto p-6 [&_svg]:h-auto [&_svg]:max-w-full"
            dangerouslySetInnerHTML={{ __html: state.svg }}
            aria-label="Ampliar diagrama"
          />
        ) : (
          <div className="flex h-44 items-center justify-center">
            <span className="h-2 w-40 animate-shimmer rounded-full bg-[linear-gradient(90deg,transparent,hsl(var(--brand)/0.5),transparent)] bg-[length:200%_100%]" />
          </div>
        )}
      </div>
      {state.svg && <DiagramExplorer svg={state.svg} open={zoom} onOpenChange={setZoom} title={diagramKind(chart)} />}
    </figure>
  );
}

function DiagramExplorer({ svg, open, onOpenChange, title }: { svg: string; open: boolean; onOpenChange: (o: boolean) => void; title: string }) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const zoomBy = (factor: number) => setView((v) => ({ ...v, scale: Math.min(6, Math.max(0.3, v.scale * factor)) }));

  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };
  const onWheel = (e: WheelEvent) => zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
  const onPointerDown = (e: PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX - view.x, y: e.clientY - view.y };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent) => {
    const start = drag.current;
    if (start) setView((v) => ({ ...v, x: e.clientX - start.x, y: e.clientY - start.y }));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (onOpenChange(o), !o && setView({ scale: 1, x: 0, y: 0 }))}>
      <DialogContent className="h-[88vh] max-w-[min(1400px,96vw)] grid-rows-[auto_1fr] gap-0 overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b px-5 py-3 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Workflow className="h-4 w-4 text-brand" /> {title}
          </DialogTitle>
          <DialogDescription className="sr-only">Use a roda do mouse para zoom e arraste para mover.</DialogDescription>
          <span className="ml-auto text-xs font-semibold tabular-nums text-muted-foreground">{Math.round(view.scale * 100)}%</span>
          <Button variant="outline" size="icon-sm" onClick={() => zoomBy(1 / 1.25)} aria-label="Diminuir">
            <Minus />
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => zoomBy(1.25)} aria-label="Aumentar">
            <Plus />
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => setView({ scale: 1, x: 0, y: 0 })} aria-label="Resetar">
            <RotateCcw />
          </Button>
        </div>
        <div
          className={cn("bg-dots relative touch-none overflow-hidden", dragging ? "cursor-grabbing" : "cursor-grab")}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
        >
          <div
            className="absolute inset-0 flex items-center justify-center [&_svg]:h-auto [&_svg]:!max-w-none [&_svg]:w-[min(1100px,85vw)]"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: "center" }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border bg-background/80 px-3 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur">
            Roda do mouse para zoom · arraste para mover
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
