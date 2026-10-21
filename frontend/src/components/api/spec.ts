import { parse } from "yaml";

export type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
export const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function parseSpec(text: string): { spec: Obj | null; error?: string } {
  try {
    const spec = parse(text);
    return isObj(spec) ? { spec } : { spec: null, error: "O conteúdo não é um objeto YAML/JSON." };
  } catch (err) {
    return { spec: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Resolve um `$ref` local ("#/components/schemas/Conta"). */
export function resolveRef(spec: Obj, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  return ref
    .slice(2)
    .split("/")
    .map((p) => decodeURIComponent(p.replace(/~1/g, "/").replace(/~0/g, "~")))
    .reduce<unknown>((node, key) => (isObj(node) ? node[key] : undefined), spec);
}

/** Segue `$ref` até chegar no objeto real (com proteção contra ciclos). */
export function deref(spec: Obj, value: unknown, depth = 0): unknown {
  if (depth > 20 || !isObj(value) || typeof value.$ref !== "string") return value;
  return deref(spec, resolveRef(spec, value.$ref), depth + 1);
}

export const refName = (value: unknown) => (isObj(value) && typeof value.$ref === "string" ? value.$ref.split("/").pop() : undefined);

export const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// ---------------------------------------------------------------- OpenAPI
export const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;
export type Method = (typeof METHODS)[number];

export interface Parameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  description?: string;
  schema?: Obj;
  example?: unknown;
  deprecated?: boolean;
}

export interface Operation {
  anchor: string;
  method: Method;
  path: string;
  summary?: string;
  description?: string;
  operationId?: string;
  deprecated: boolean;
  tags: string[];
  parameters: Parameter[];
  requestBody?: Obj;
  responses: [string, Obj][];
  security: Obj[];
}

export function listOperations(spec: Obj): Operation[] {
  const ops: Operation[] = [];
  const paths = isObj(spec.paths) ? spec.paths : {};
  for (const [path, rawItem] of Object.entries(paths)) {
    const item = deref(spec, rawItem);
    if (!isObj(item)) continue;
    const shared = arr(item.parameters).map((p) => deref(spec, p)).filter(isObj);
    for (const method of METHODS) {
      const op = deref(spec, item[method]);
      if (!isObj(op)) continue;
      const own = arr(op.parameters).map((p) => deref(spec, p)).filter(isObj);
      // parâmetros da operação substituem os do caminho com o mesmo nome+local
      const merged = [...shared.filter((s) => !own.some((o) => o.name === s.name && o.in === s.in)), ...own];
      ops.push({
        anchor: `op-${method}-${slugify(path) || "raiz"}`,
        method,
        path,
        summary: str(op.summary),
        description: str(op.description),
        operationId: str(op.operationId),
        deprecated: op.deprecated === true,
        tags: arr(op.tags).map(String),
        parameters: merged.map((p) => ({
          name: String(p.name),
          in: (str(p.in) ?? "query") as Parameter["in"],
          required: p.required === true || p.in === "path",
          description: str(p.description),
          schema: isObj(p.schema) ? p.schema : undefined,
          example: p.example,
          deprecated: p.deprecated === true,
        })),
        requestBody: isObj(deref(spec, op.requestBody)) ? (deref(spec, op.requestBody) as Obj) : undefined,
        responses: Object.entries(isObj(op.responses) ? op.responses : {}).map(
          ([code, r]) => [code, (deref(spec, r) as Obj) ?? {}] as [string, Obj],
        ),
        security: arr(op.security ?? spec.security).filter(isObj),
      });
    }
  }
  return ops;
}

/** Recorte da referência usado ao incorporar numa página markdown. */
export interface ReferenceFilter {
  /** "POST /accounts" ou o operationId */
  operations?: string[];
  tags?: string[];
}

const matches = (op: Operation, key: string) => {
  const k = key.trim().replace(/\s+/g, " ").toLowerCase();
  return k === `${op.method} ${op.path}`.toLowerCase() || (!!op.operationId && k === op.operationId.toLowerCase());
};

export function filterOperations(ops: Operation[], filter?: ReferenceFilter) {
  if (!filter?.operations?.length && !filter?.tags?.length) return ops;
  // operações citadas aparecem na ordem do bloco; as que vêm só pelas tags, depois (na ordem da especificação)
  const listed = (filter.operations ?? []).flatMap((key) => ops.filter((op) => matches(op, key)));
  const byTag = ops.filter(
    (op) => !listed.includes(op) && filter.tags?.some((tag) => op.tags.some((t) => t.toLowerCase() === tag.toLowerCase())),
  );
  return [...new Set([...listed, ...byTag])];
}

export function groupByTag(spec: Obj, ops: Operation[]) {
  const declared = arr(spec.tags).filter(isObj);
  const names = [...declared.map((t) => String(t.name)), ...ops.flatMap((o) => o.tags)];
  const order = [...new Set(names)];
  const groups = order
    .map((tag) => ({
      tag,
      description: str(declared.find((t) => t.name === tag)?.description),
      ops: ops.filter((o) => o.tags.includes(tag)),
    }))
    .filter((g) => g.ops.length);
  const untagged = ops.filter((o) => !o.tags.length);
  if (untagged.length) groups.push({ tag: "Outras operações", description: undefined, ops: untagged });
  return groups;
}

/** Um ambiente onde a API está disponível (servidor da especificação). */
export interface Environment {
  id: string;
  /** nome exibido: `x-environment`/`title`, ou o host quando não há nome */
  name: string;
  url: string;
  description?: string;
  protocol?: string;
  /** `x-default: true` — usado nos exemplos de código até o leitor escolher outro */
  isDefault: boolean;
}

const hostOf = (url: string) => url.replace(/^\w+:\/\//, "").split("/")[0] || url;

/** Ambientes da OpenAPI (`servers`), com variáveis preenchidas pelo valor padrão. */
export function openApiEnvironments(spec: Obj): Environment[] {
  return arr(spec.servers)
    .filter(isObj)
    .map((s, i) => {
      const vars = isObj(s.variables) ? s.variables : {};
      const url = String(s.url ?? "")
        .replace(/{(\w+)}/g, (_, name) => {
          const v = vars[name];
          return isObj(v) && v.default !== undefined ? String(v.default) : `{${name}}`;
        })
        .replace(/\/$/, "");
      const name = str(s["x-environment"]) ?? str(s.description) ?? hostOf(url);
      return {
        id: `${i}-${url}`,
        name,
        url,
        // sem x-environment, a descrição já virou o nome
        description: str(s["x-environment"]) ? str(s.description) : undefined,
        isDefault: s["x-default"] === true,
      };
    })
    .filter((s) => s.url);
}

/** Ambientes da AsyncAPI (`servers` é um mapa nome → servidor). */
export function asyncApiEnvironments(spec: Obj): Environment[] {
  const servers = isObj(spec.servers) ? spec.servers : {};
  return Object.entries(servers)
    .filter((entry): entry is [string, Obj] => isObj(entry[1]))
    .map(([key, server]) => {
      const host = str(server.host) ?? str(server.url) ?? "";
      const path = str(server.pathname) ?? "";
      return {
        id: key,
        name: str(server["x-environment"]) ?? str(server.title) ?? key,
        url: host + path,
        description: str(server.description),
        protocol: str(server.protocol),
        isDefault: server["x-default"] === true,
      };
    });
}

export function usesBearer(spec: Obj, op: Operation): boolean {
  const schemes = isObj(spec.components) && isObj(spec.components.securitySchemes) ? spec.components.securitySchemes : {};
  return op.security.some((req) =>
    Object.keys(req).some((name) => {
      const scheme = deref(spec, schemes[name]);
      return isObj(scheme) && ((scheme.type === "http" && scheme.scheme === "bearer") || scheme.type === "oauth2" || scheme.type === "openIdConnect");
    }),
  );
}

/** Exemplo gerado a partir do esquema (usa example/default/enum quando houver). */
export function exampleFor(spec: Obj, raw: unknown, depth = 0, seen = new Set<string>()): unknown {
  if (depth > 8) return null;
  if (isObj(raw) && typeof raw.$ref === "string") {
    if (seen.has(raw.$ref)) return null;
    return exampleFor(spec, resolveRef(spec, raw.$ref), depth + 1, new Set([...seen, raw.$ref]));
  }
  if (!isObj(raw)) return null;
  const schema = raw;
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.reduce<Obj>((acc, part) => {
      const ex = exampleFor(spec, part, depth + 1, seen);
      return isObj(ex) ? { ...acc, ...ex } : acc;
    }, {});
  }
  for (const key of ["oneOf", "anyOf"] as const) {
    if (Array.isArray(schema[key]) && schema[key].length) return exampleFor(spec, schema[key][0], depth + 1, seen);
  }
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  if (type === "object" || isObj(schema.properties)) {
    const props = isObj(schema.properties) ? schema.properties : {};
    return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, exampleFor(spec, v, depth + 1, seen)]));
  }
  if (type === "array") return [exampleFor(spec, schema.items, depth + 1, seen)];
  if (type === "integer" || type === "number") return schema.minimum ?? 0;
  if (type === "boolean") return true;
  switch (schema.format) {
    case "email":
      return "usuario@example.com";
    case "date-time":
      return "2026-01-15T10:00:00Z";
    case "date":
      return "2026-01-15";
    case "uuid":
      return "3f1c0e2a-9b7d-4c51-8a1e-2d9f6b3c4a10";
    case "uri":
      return "https://example.com";
  }
  return "texto";
}

export function bodyMedia(body?: Obj): { type: string; media: Obj }[] {
  const content = body && isObj(body.content) ? body.content : {};
  return Object.entries(content)
    .filter(([, m]) => isObj(m))
    .map(([type, media]) => ({ type, media: media as Obj }));
}

export function mediaExample(spec: Obj, media: Obj): unknown {
  if (media.example !== undefined) return media.example;
  if (isObj(media.examples)) {
    const first = deref(spec, Object.values(media.examples)[0]);
    if (isObj(first) && first.value !== undefined) return first.value;
  }
  return exampleFor(spec, media.schema);
}

// ---------------------------------------------------------------- AsyncAPI (2.x e 3.x)
export interface AsyncMessage {
  name: string;
  title?: string;
  summary?: string;
  description?: string;
  contentType?: string;
  payload?: unknown;
  headers?: unknown;
  examples: unknown[];
}

export interface AsyncOperation {
  anchor: string;
  id: string;
  action: "send" | "receive";
  summary?: string;
  description?: string;
  messages: AsyncMessage[];
}

export interface AsyncChannel {
  id: string;
  address: string;
  description?: string;
  operations: AsyncOperation[];
}

function toMessage(spec: Obj, raw: unknown, fallback: string): AsyncMessage | null {
  const msg = deref(spec, raw);
  if (!isObj(msg)) return null;
  return {
    name: str(msg.name) ?? refName(raw) ?? fallback,
    title: str(msg.title),
    summary: str(msg.summary),
    description: str(msg.description),
    contentType: str(msg.contentType) ?? str(spec.defaultContentType),
    payload: msg.payload,
    headers: msg.headers,
    examples: arr(msg.examples)
      .map((e) => (isObj(e) ? e.payload : undefined))
      .filter((e) => e !== undefined),
  };
}

export function asyncChannels(spec: Obj): AsyncChannel[] {
  const channels = isObj(spec.channels) ? spec.channels : {};
  const version = String(spec.asyncapi ?? "");

  if (version.startsWith("2")) {
    return Object.entries(channels).map(([address, raw]) => {
      const ch = isObj(raw) ? raw : {};
      const operations: AsyncOperation[] = [];
      for (const [verb, action] of [
        ["subscribe", "receive"],
        ["publish", "send"],
      ] as const) {
        const op = ch[verb];
        if (!isObj(op)) continue;
        const rawMsg = deref(spec, op.message);
        const list = isObj(rawMsg) && Array.isArray(rawMsg.oneOf) ? rawMsg.oneOf : [op.message];
        operations.push({
          anchor: `op-${verb}-${slugify(address)}`,
          id: str(op.operationId) ?? `${verb} ${address}`,
          action,
          summary: str(op.summary),
          description: str(op.description),
          messages: list.map((m, i) => toMessage(spec, m, `mensagem ${i + 1}`)).filter((m): m is AsyncMessage => !!m),
        });
      }
      return { id: address, address, description: str(ch.description), operations };
    });
  }

  // AsyncAPI 3: operações ficam fora dos canais e apontam para eles
  const operations = isObj(spec.operations) ? spec.operations : {};
  return Object.entries(channels).map(([id, raw]) => {
    const ch = deref(spec, raw);
    const channel = isObj(ch) ? ch : {};
    const ops = Object.entries(operations)
      .filter(([, op]) => isObj(op) && isObj(op.channel) && op.channel.$ref === `#/channels/${id}`)
      .map(([opId, rawOp]) => {
        const op = rawOp as Obj;
        const refs = arr(op.messages).length ? arr(op.messages) : Object.values(isObj(channel.messages) ? channel.messages : {});
        return {
          anchor: `op-${slugify(opId)}`,
          id: opId,
          action: (op.action === "send" ? "send" : "receive") as AsyncOperation["action"],
          summary: str(op.summary),
          description: str(op.description),
          messages: refs.map((m, i) => toMessage(spec, m, `mensagem ${i + 1}`)).filter((m): m is AsyncMessage => !!m),
        };
      });
    return { id, address: str(channel.address) ?? id, description: str(channel.description), operations: ops };
  });
}

export const pretty = (value: unknown) => JSON.stringify(value, null, 2);
