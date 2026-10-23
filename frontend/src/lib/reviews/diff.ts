export type DiffOp = {
  type: "same" | "add" | "del";
  text: string;
  /** número da linha no texto antigo (same/del) */
  oldNo?: number;
  /** número da linha no texto novo (same/add) */
  newNo?: number;
};

/** Diff de linhas por LCS (suficiente para páginas de documentação). */
export function diffLines(before: string, after: string): DiffOp[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "same", text: a[i], oldNo: i + 1, newNo: j + 1 });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: "del", text: a[i], oldNo: i + 1 });
      i++;
    } else {
      ops.push({ type: "add", text: b[j], newNo: j + 1 });
      j++;
    }
  }
  while (i < n) ops.push({ type: "del", text: a[i], oldNo: ++i });
  while (j < m) ops.push({ type: "add", text: b[j], newNo: ++j });
  return ops;
}

export type DiffHunk = DiffOp | { type: "skip"; count: number };

/** Mantém `context` linhas iguais ao redor das mudanças e colapsa o resto. */
export function collapseDiff(ops: DiffOp[], context = 3): DiffHunk[] {
  const keep = new Array(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op.type === "same") return;
    for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) keep[k] = true;
  });
  const out: DiffHunk[] = [];
  let skipped = 0;
  ops.forEach((op, idx) => {
    if (keep[idx]) {
      if (skipped) out.push({ type: "skip", count: skipped });
      skipped = 0;
      out.push(op);
    } else {
      skipped++;
    }
  });
  if (skipped) out.push({ type: "skip", count: skipped });
  return out;
}

export function diffStats(ops: DiffOp[]) {
  return {
    added: ops.filter((o) => o.type === "add").length,
    removed: ops.filter((o) => o.type === "del").length,
  };
}
