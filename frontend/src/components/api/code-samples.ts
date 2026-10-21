import { bodyMedia, exampleFor, mediaExample, pretty, usesBearer, type Obj, type Operation } from "@/components/api/spec";

export const WITH_BODY = new Set(["post", "put", "patch", "delete"]);

/** Valores iniciais dos parâmetros (exemplos da especificação). */
export function initialValues(spec: Obj, op: Operation): Record<string, string> {
  const values: Record<string, string> = {};
  for (const p of op.parameters) {
    const example = p.example ?? exampleFor(spec, p.schema);
    values[`${p.in}:${p.name}`] = example === null || example === undefined || example === "texto" ? "" : String(example);
  }
  return values;
}

/** Exemplos de chamada (cURL / JavaScript / Python) para a operação. */
export function codeSamples(spec: Obj, op: Operation, server: string) {
  const json = bodyMedia(op.requestBody).find((m) => m.type.includes("json"));
  const example = json ? mediaExample(spec, json.media) : undefined;
  const values = initialValues(spec, op);
  const path = op.path.replace(/{(\w+)}/g, (_, n) => values[`path:${n}`] || `{${n}}`);
  const query = op.parameters
    .filter((p) => p.in === "query" && values[`query:${p.name}`])
    .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(values[`query:${p.name}`])}`)
    .join("&");
  const url = `${server}${path}${query ? `?${query}` : ""}`;
  const method = op.method.toUpperCase();
  const auth = usesBearer(spec, op);
  const body = example !== undefined && WITH_BODY.has(op.method) ? pretty(example) : undefined;

  const curl = [
    `curl -X ${method} '${url}'`,
    auth && `  -H 'Authorization: Bearer $TOKEN'`,
    body && `  -H 'Content-Type: application/json'`,
    body && `  -d '${body.replace(/'/g, "'\\''")}'`,
  ]
    .filter(Boolean)
    .join(" \\\n");

  const jsHeaders = [auth && `    Authorization: \`Bearer \${token}\`,`, body && `    "Content-Type": "application/json",`].filter(Boolean);
  const js = [
    `const response = await fetch("${url}", {`,
    `  method: "${method}",`,
    jsHeaders.length ? `  headers: {\n${jsHeaders.join("\n")}\n  },` : "",
    body ? `  body: JSON.stringify(${body.replace(/\n/g, "\n  ")}),` : "",
    `});`,
    `const data = await response.json();`,
  ]
    .filter(Boolean)
    .join("\n");

  const pyArgs = [auth && `    headers={"Authorization": f"Bearer {token}"},`, body && `    json=${body.replace(/\n/g, "\n    ").replace(/\btrue\b/g, "True").replace(/\bfalse\b/g, "False").replace(/\bnull\b/g, "None")},`].filter(Boolean);
  const python = [
    "import httpx",
    "",
    `response = httpx.${op.method === "delete" ? "delete" : op.method}(`,
    `    "${url}",`,
    ...pyArgs,
    ")",
    "response.raise_for_status()",
  ].join("\n");

  return [
    { label: "cURL", code: curl },
    { label: "JavaScript", code: js },
    { label: "Python", code: python },
  ];
}

