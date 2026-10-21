import { motion } from "motion/react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { cn } from "@/lib/utils";

interface Heading {
  id: string;
  text: string;
  level: number;
}

interface Box {
  x: number;
  top: number;
  bottom: number;
}

/** Posição horizontal da linha por nível de título (h2 → 1px, h3 → 13px). */
const LINE_X: Record<number, number> = { 2: 1, 3: 13 };
/** Altura reservada para cada metade da curva quando a indentação muda. */
const CURVE = 7;

/** Desfoque das pontas do trecho ativo (px): o laranja some aos poucos em vez de ser cortado. */
const FEATHER = 3;

/** Trecho reto de cada item — exclui as metades de curva quando a indentação muda. */
function straightSpan(boxes: Box[], i: number): { start: number; end: number } {
  const box = boxes[i];
  const prev = boxes[i - 1];
  const next = boxes[i + 1];
  return {
    start: prev && prev.x !== box.x ? box.top + CURVE : box.top,
    end: next && next.x !== box.x ? box.bottom - CURVE : box.bottom,
  };
}

/**
 * Traçado da linha do sumário: desce reto em cada item e, quando a indentação
 * muda entre um item e o próximo, faz uma curva em "S" até a nova coluna.
 */
function tracePath(boxes: Box[]): string {
  let d = "";
  boxes.forEach((box, i) => {
    const prev = boxes[i - 1];
    const { start, end } = straightSpan(boxes, i);
    if (!prev) d += `M${box.x} ${start}`;
    else if (prev.x !== box.x) d += ` C${prev.x} ${prev.bottom} ${box.x} ${box.top} ${box.x} ${start}`;
    d += ` L${box.x} ${end}`;
  });
  return d;
}

/** Sumário cuja linha acompanha a indentação dos títulos; o trecho ativo acende e desliza pelas curvas. */
export function Toc({ containerRef, contentKey }: { containerRef: RefObject<HTMLElement | null>; contentKey: string }) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<string>();
  const [boxes, setBoxes] = useState<Box[]>([]);
  const listRef = useRef<HTMLUListElement>(null);
  const maskId = `toc-mask-${useId().replace(/:/g, "")}`;

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -65% 0px" },
    );
    let signature = "";
    let frame = 0;
    const collect = () => {
      const elements = Array.from(root.querySelectorAll<HTMLElement>("h2[id], h3[id]"));
      const next = elements.map((el) => el.id).join("|");
      if (next === signature) return;
      signature = next;
      observer.disconnect();
      elements.forEach((el) => observer.observe(el));
      setHeadings(
        elements.map((el) => ({
          id: el.id,
          // data-toc: rótulo curto para títulos compostos (ex.: operações da referência de API)
          text: el.dataset.toc ?? (el.textContent ?? "").replace(/#$/, "").trim(),
          level: Number(el.tagName[1]),
        })),
      );
    };
    frame = requestAnimationFrame(collect);
    // referências de API incorporadas chegam depois (lazy + fetch): recoleta quando o artigo muda
    const mutations = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(collect);
    });
    mutations.observe(root, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      observer.disconnect();
    };
  }, [containerRef, contentKey]);

  // mede cada item (o ResizeObserver dispara ao observar e quando a largura quebra linhas)
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () =>
      setBoxes(
        Array.from(list.children as HTMLCollectionOf<HTMLElement>).map((li) => ({
          x: LINE_X[Number(li.dataset.level)] ?? LINE_X[2],
          top: li.offsetTop,
          bottom: li.offsetTop + li.offsetHeight,
        })),
      );
    const resize = new ResizeObserver(measure);
    resize.observe(list);
    return () => resize.disconnect();
  }, [headings]);

  if (headings.length < 2) return null;
  const activeIndex = Math.max(0, headings.findIndex((h) => h.id === active));
  const activeSpan = boxes[activeIndex] ? straightSpan(boxes, activeIndex) : undefined;
  const height = boxes.at(-1)?.bottom ?? 0;
  const path = tracePath(boxes);
  // regiões explícitas: o desfoque da máscara não pode ser recortado pela caixa padrão do SVG
  const region = { x: -12, y: -24, width: 40, height: height + 48 };

  return (
    <div>
      <p className="mb-3 text-[13px] font-semibold text-foreground">Nesta página</p>
      <div className="relative">
        {boxes.length === headings.length && (
          <svg
            aria-hidden
            width={16}
            height={height}
            viewBox={`0 0 16 ${height}`}
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
          >
            <defs>
              <filter id={`${maskId}-feather`} filterUnits="userSpaceOnUse" {...region}>
                <feGaussianBlur stdDeviation={FEATHER} />
              </filter>
              <mask id={maskId} maskUnits="userSpaceOnUse" {...region}>
                {activeSpan && (
                  <motion.rect
                    x={-6}
                    width={28}
                    initial={false}
                    // levemente recolhido: o desfoque faz o laranja sumir suavemente nas pontas
                    animate={{ y: activeSpan.start + 2, height: Math.max(4, activeSpan.end - activeSpan.start - 4) }}
                    transition={{ type: "spring", stiffness: 380, damping: 36 }}
                    fill="white"
                    filter={`url(#${maskId}-feather)`}
                  />
                )}
              </mask>
            </defs>
            <path d={path} fill="none" stroke="hsl(var(--border))" strokeWidth={1} strokeLinecap="round" />
            {/* brilho aplicado depois da máscara, para acompanhar só o trecho visível */}
            <g>
              <path
                d={path}
                fill="none"
                stroke="hsl(var(--brand))"
                strokeWidth={2}
                strokeLinecap="round"
                mask={`url(#${maskId})`}
              />
            </g>
          </svg>
        )}
        <ul ref={listRef}>
          {headings.map((h, i) => (
            <li key={h.id} data-level={h.level}>
              <a
                href={`#${h.id}`}
                onClick={() => setActive(h.id)}
                className={cn(
                  "block py-1.5 pr-2 text-[13px] leading-snug transition-colors",
                  h.level === 3 ? "pl-[30px]" : "pl-[18px]",
                  i === activeIndex ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
