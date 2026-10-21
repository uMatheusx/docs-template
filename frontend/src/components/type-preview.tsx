import { Check, Type, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Switch } from "@/components/ui/switch";
import { applyTypography, preloadPresets, PREVIEW_KEY, readTypography, TYPE_PRESETS, type TypeChoice } from "@/lib/typography";
import { cn } from "@/lib/utils";

/** Painel flutuante para comparar tipografias nas páginas reais (ativado com ?tipografia). */
export function TypePreview() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(PREVIEW_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [collapsed, setCollapsed] = useState(false);
  const [choice, setChoice] = useState<TypeChoice>(readTypography);

  useEffect(() => {
    if (open) preloadPresets();
  }, [open]);

  if (!open) return null;

  const update = (next: Partial<TypeChoice>) => {
    const merged = { ...choice, ...next };
    setChoice(merged);
    applyTypography(merged);
  };
  const close = () => {
    try {
      localStorage.removeItem(PREVIEW_KEY);
    } catch {
      /* armazenamento indisponível */
    }
    setOpen(false);
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 left-4 z-[60] flex items-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-float"
      >
        <Type className="h-4 w-4 text-brand" /> {TYPE_PRESETS.find((p) => p.id === choice.preset)?.name}
        {choice.refined && " + refinamentos"}
      </button>
    );
  }

  return (
    <aside
      aria-label="Pré-visualização de tipografia"
      className="fixed bottom-4 left-4 z-[60] w-[min(360px,calc(100vw-2rem))] rounded-3xl border bg-background/95 p-4 shadow-float backdrop-blur"
    >
      <div className="flex items-start gap-2">
        <span className="brand-tile flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
          <Type className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[15px] font-bold leading-tight">Pré-visualização de tipografia</p>
          <p className="text-xs text-muted-foreground">Só neste navegador. Navegue pelas páginas para comparar.</p>
        </div>
        <button type="button" onClick={() => setCollapsed(true)} className="rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-accent">
          Minimizar
        </button>
        <button type="button" onClick={close} aria-label="Fechar pré-visualização" className="rounded-lg p-1 text-muted-foreground hover:bg-accent">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid gap-1.5">
        {TYPE_PRESETS.map((preset) => {
          const active = preset.id === choice.preset;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => update({ preset: preset.id })}
              aria-pressed={active}
              className={cn(
                "flex items-center gap-3 rounded-2xl border px-3 py-2 text-left transition-colors",
                active ? "border-brand/60 bg-brand/[0.07]" : "hover:bg-accent",
              )}
            >
              <span className="w-12 shrink-0 text-center text-[26px] font-bold leading-none tracking-tight" style={{ fontFamily: preset.display }}>
                Rg
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[15px] font-bold" style={{ fontFamily: preset.display }}>
                  {preset.name} {active && <Check className="h-3.5 w-3.5 text-brand" />}
                </span>
                <span className="block text-[11.5px] leading-snug text-muted-foreground" style={{ fontFamily: preset.body }}>
                  {preset.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <label className="mt-3 flex items-center justify-between gap-3 rounded-2xl border p-3">
        <span>
          <span className="block text-sm font-bold">Refinamentos</span>
          <span className="block text-[11.5px] leading-snug text-muted-foreground">
            Linhas de texto mais curtas, títulos balanceados, números alinhados, rótulos menos espaçados e links mais discretos.
          </span>
        </span>
        <Switch checked={choice.refined} onCheckedChange={(refined) => update({ refined })} />
      </label>
    </aside>
  );
}
