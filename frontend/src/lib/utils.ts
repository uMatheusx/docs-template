import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

export function timeAgo(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "agora mesmo";
}

export function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short" });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function countWords(markdown: string): number {
  const text = markdown.replace(/```[\s\S]*?```/g, " ").trim();
  return text ? text.split(/\s+/).length : 0;
}

/** Minutos de leitura (≈ 200 palavras/min, mínimo 1). */
export function readingTime(markdown: string): number {
  return Math.max(1, Math.round(countWords(markdown) / 200));
}

/** Remove acentos e caixa para comparações tolerantes. */
export function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export function downloadText(filename: string, text: string, type = "text/markdown;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

/** Separa o primeiro `# título` do markdown (usado como título do hero). */
export function splitLeadingH1(markdown: string): { heading: string | null; body: string } {
  const match = markdown.match(/^\s*#\s+(.+?)\s*#*\s*(?:\r?\n|$)/);
  if (!match) return { heading: null, body: markdown };
  return { heading: match[1], body: markdown.slice(match[0].length).replace(/^\s*\n/, "") };
}
