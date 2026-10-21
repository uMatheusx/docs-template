/**
 * Pré-visualização de tipografia: troca as famílias (variáveis CSS --font-*) e liga refinamentos
 * tipográficos sem mexer no restante do visual. A escolha vale só para este navegador.
 */

export interface TypePreset {
  id: string;
  name: string;
  description: string;
  display: string;
  body: string;
  mono: string;
  /** famílias no formato da Google Fonts API (css2) */
  google?: string;
  features?: string;
}

export const TYPE_PRESETS: TypePreset[] = [
  {
    id: "atual",
    name: "Atual",
    description: "Fonte do sistema da Apple (SF), com Inter como substituta.",
    display: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Segoe UI", system-ui, sans-serif',
    body: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", system-ui, sans-serif',
    mono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace',
  },
  {
    id: "tecnica",
    name: "Técnica",
    description: "IBM Plex Sans + Plex Mono. Sóbria, de documentação de engenharia e banco.",
    display: '"IBM Plex Sans"',
    body: '"IBM Plex Sans"',
    mono: '"IBM Plex Mono"',
    google: "family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600",
  },
  {
    id: "editorial",
    name: "Editorial",
    description: "Bricolage Grotesque nos títulos + Hanken Grotesk no texto. Mais personalidade.",
    display: '"Bricolage Grotesque"',
    body: '"Hanken Grotesk"',
    mono: '"JetBrains Mono"',
    google: "family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Hanken+Grotesk:wght@400;500;600;700",
  },
  {
    id: "precisa",
    name: "Precisa",
    description: "Geist + Geist Mono. Nítida e compacta, de ferramenta de desenvolvedor.",
    display: '"Geist"',
    body: '"Geist"',
    mono: '"Geist Mono"',
    google: "family=Geist:wght@400..800&family=Geist+Mono:wght@400..600",
  },
];

const KEY = "ah-typography";
export const PREVIEW_KEY = "ah-type-preview";

export interface TypeChoice {
  preset: string;
  refined: boolean;
}

export function readTypography(): TypeChoice {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { preset: "atual", refined: false, ...(JSON.parse(raw) as Partial<TypeChoice>) };
  } catch {
    /* armazenamento indisponível */
  }
  return { preset: "atual", refined: false };
}

function loadFonts(preset: TypePreset) {
  if (!preset.google || document.getElementById(`font-${preset.id}`)) return;
  const link = Object.assign(document.createElement("link"), {
    id: `font-${preset.id}`,
    rel: "stylesheet",
    href: `https://fonts.googleapis.com/css2?${preset.google}&display=swap`,
  });
  document.head.appendChild(link);
}

/** Carrega as fontes de todas as opções (amostras "Aa" do painel). */
export function preloadPresets() {
  TYPE_PRESETS.forEach(loadFonts);
}

export function applyTypography(choice: TypeChoice, persist = true) {
  const preset = TYPE_PRESETS.find((p) => p.id === choice.preset) ?? TYPE_PRESETS[0];
  loadFonts(preset);
  const root = document.documentElement;
  root.style.setProperty("--font-display", preset.display);
  root.style.setProperty("--font-body", preset.body);
  root.style.setProperty("--font-mono", preset.mono);
  root.style.setProperty("--font-features", preset.features ?? "normal");
  root.dataset.type = preset.id;
  root.dataset.refine = choice.refined ? "on" : "off";
  if (persist) {
    try {
      localStorage.setItem(KEY, JSON.stringify(choice));
    } catch {
      /* armazenamento indisponível */
    }
  }
  window.dispatchEvent(new Event("ah:typography"));
}

/** Família do corpo resolvida (para componentes que desenham fora do CSS, como o Mermaid). */
export const bodyFont = () => getComputedStyle(document.body).fontFamily;
