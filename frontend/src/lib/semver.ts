/**
 * Versões das páginas no formato x.y.z. O servidor é quem calcula de verdade ao aplicar uma proposta;
 * estas funções espelham a regra (backend/app/semver.py) só para mostrar a prévia antes de enviar.
 */
export type Bump = "patch" | "minor" | "major";

export const BUMP_OPTIONS: { value: Bump; label: string; hint: string }[] = [
  { value: "patch", label: "Correção", hint: "Ajuste de texto, link ou formatação" },
  { value: "minor", label: "Novidade", hint: "Conteúdo novo, sem quebrar o que já existia" },
  { value: "major", label: "Mudança grande", hint: "Reescrita ou mudança que quebra quem seguia a versão anterior" },
];

export const BUMP_LABEL: Record<Bump, string> = { patch: "correção", minor: "novidade", major: "mudança grande" };

const PARTS = /^(\d+)\.(\d+)\.(\d+)$/;

function parse(version: string): [number, number, number] | null {
  const match = PARTS.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Páginas ainda 0.x (rascunhos nunca publicados): a primeira publicação vira 1.0.0 qualquer que seja o tipo. */
export const isFirstRelease = (current: string, publishing: boolean) => publishing && parse(current)?.[0] === 0;

export function bumpSemver(current: string, kind: Bump, publishing = false): string {
  const parts = parse(current);
  if (!parts) return current;
  const [major, minor, patch] = parts;
  if (isFirstRelease(current, publishing)) return "1.0.0";
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Versão de quem foi gravado antes do x.y.z: a revisão n vira 1.0.(n-1). */
export const legacySemver = (revision: number) => `1.0.${Math.max(revision, 1) - 1}`;
