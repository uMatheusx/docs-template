export interface Crumb {
  id: string;
  title: string;
  path: string;
}

/** Tipo da página: markdown ou especificação de API (renderizada como referência interativa). */
export type PageKind = "doc" | "openapi" | "asyncapi";

export interface PageMeta {
  id: string;
  title: string;
  slug: string;
  parent_id: string | null;
  order: number;
  icon: string | null;
  description: string;
  published: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string;
  version: number;
  /** descrição da alteração que gerou esta versão */
  note: string;
  kind: PageKind;
  path: string;
}

export interface TreeNode extends PageMeta {
  children: TreeNode[];
}

export interface Page extends PageMeta {
  content: string;
  breadcrumbs: Crumb[];
}

export type Role = "admin" | "editor";

export interface User {
  username: string;
  role: Role;
}

export interface SiteInfo {
  name: string;
  public_read: boolean;
  review_self_approval: boolean;
  user: User | null;
}

export interface SearchResult {
  id: string;
  title: string;
  path: string;
  description: string;
  snippet: string;
  score: number;
}

export interface HistoryEntry {
  id: string;
  author: string;
  size: number;
  version: number | null;
  note: string;
  /** quando esta versão foi escrita */
  created_at: string;
  /** quando foi substituída por outra (arquivada) */
  archived_at: string;
}

export interface Asset {
  id: string;
  name: string;
  key: string;
  url: string;
  size: number;
  content_type: string | null;
  last_modified: string;
}

export interface Stats {
  total: number;
  published: number;
  drafts: number;
  assets: number;
  open_reviews: number;
  recent: PageMeta[];
}

export interface PageInput {
  title?: string;
  slug?: string;
  parent_id?: string | null;
  icon?: string | null;
  description?: string;
  published?: boolean;
  content?: string;
  note?: string;
  version?: number;
  kind?: PageKind;
}

// ---------------------------------------------------------------- links quebrados
export type LinkIssueKind = "broken_link" | "draft_link" | "broken_image" | "broken_asset";

export interface LinkIssue {
  page_id: string;
  page_title: string;
  page_path: string;
  kind: LinkIssueKind;
  target: string;
  text: string;
  line: number;
}

export interface LinkReport {
  checked_at: string;
  pages_checked: number;
  issues: LinkIssue[];
}

// ---------------------------------------------------------------- revisões
export type ReviewStatus = "open" | "approved" | "changes_requested" | "merged" | "closed";

export interface ReviewFields {
  title?: string;
  slug?: string;
  icon?: string | null;
  description?: string;
  published?: boolean;
}

export interface ReviewEvent {
  id: string;
  type: "created" | "updated" | "comment" | "approved" | "changes_requested" | "merged" | "closed";
  author: string;
  body: string;
  at: string;
}

export interface Review {
  id: string;
  number: number;
  page_id: string;
  page_title: string;
  page_path: string;
  page_published: boolean;
  title: string;
  description: string;
  base_version: number;
  fields: ReviewFields;
  has_content: boolean;
  status: ReviewStatus;
  author: string;
  created_at: string;
  updated_at: string;
  merged_version: number | null;
  events: ReviewEvent[];
}

export interface ReviewDetail extends Review {
  proposed_content: string;
  current_content: string;
  current_version: number;
  page_kind: PageKind;
}

export interface ReviewInput {
  title: string;
  description?: string;
  content?: string;
  fields?: ReviewFields;
  base_version: number;
}

// ---------------------------------------------------------------- modelos
export interface Template {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  kind: PageKind;
  content: string;
  created_by: string;
  created_at: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type RequestOptions = Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit };

export async function api<T>(url: string, { json, headers, ...init }: RequestOptions = {}): Promise<T> {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: { Accept: "application/json", ...(json !== undefined && { "Content-Type": "application/json" }), ...headers },
    body: json !== undefined ? JSON.stringify(json) : init.body,
  });
  if (!res.ok) {
    let message = res.statusText || `Erro ${res.status}`;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail)) message = data.detail.map((d: { msg: string }) => d.msg).join(", ");
    } catch {
      /* resposta sem JSON */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const fetcher = <T>(url: string) => api<T>(url);

export const keys = {
  site: "/api/site",
  tree: "/api/tree",
  adminTree: "/api/admin/tree",
  stats: "/api/admin/stats",
  assets: "/api/admin/assets",
  health: "/api/health",
  linkReport: "/api/admin/link-report",
  templates: "/api/admin/templates",
  reviews: (state: "active" | "done" | "all" = "active", pageId?: string) =>
    `/api/admin/reviews?state=${state}${pageId ? `&page_id=${pageId}` : ""}`,
  review: (id: string) => `/api/admin/reviews/${id}`,
  pageByPath: (path: string) => `/api/pages/by-path?path=${encodeURIComponent(path)}`,
  adminPage: (id: string) => `/api/admin/pages/${id}`,
  history: (id: string) => `/api/admin/pages/${id}/history`,
  search: (q: string) => `/api/search?q=${encodeURIComponent(q)}`,
};

export const docsApi = {
  login: (username: string, password: string) =>
    api<{ user: User }>("/api/auth/login", { method: "POST", json: { username, password } }),
  logout: () => api<void>("/api/auth/logout", { method: "POST" }),
  createPage: (input: PageInput) => api<Page>("/api/admin/pages", { method: "POST", json: input }),
  updatePage: (id: string, input: PageInput) => api<Page>(`/api/admin/pages/${id}`, { method: "PUT", json: input }),
  deletePage: (id: string) => api<{ deleted: number }>(`/api/admin/pages/${id}`, { method: "DELETE" }),
  movePage: (id: string, parent_id: string | null, index: number) =>
    api<TreeNode[]>(`/api/admin/pages/${id}/move`, { method: "POST", json: { parent_id, index } }),
  historyVersion: (id: string, versionId: string) =>
    api<{ id: string; content: string }>(`/api/admin/pages/${id}/history/${versionId}`),
  restoreVersion: (id: string, versionId: string) =>
    api<Page>(`/api/admin/pages/${id}/history/${versionId}/restore`, { method: "POST" }),
  importFiles: (files: File[], parentId: string | null) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    if (parentId) form.append("parent_id", parentId);
    return api<Page[]>("/api/admin/import/files", { method: "POST", body: form });
  },
  importUrl: (url: string, parent_id: string | null) =>
    api<Page>("/api/admin/import/url", { method: "POST", json: { url, parent_id } }),
  uploadAsset: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api<Asset>("/api/admin/assets", { method: "POST", body: form });
  },
  deleteAsset: (asset: Asset) => api<void>(`/api/admin/assets/${asset.id}/${asset.name}`, { method: "DELETE" }),

  // revisões
  submitReview: (pageId: string, input: ReviewInput) =>
    api<Review>(`/api/admin/pages/${pageId}/reviews`, { method: "POST", json: input }),
  commentReview: (id: string, body: string) =>
    api<Review>(`/api/admin/reviews/${id}/comments`, { method: "POST", json: { body } }),
  approveReview: (id: string, body = "") => api<Review>(`/api/admin/reviews/${id}/approve`, { method: "POST", json: { body } }),
  requestChanges: (id: string, body: string) =>
    api<Review>(`/api/admin/reviews/${id}/request-changes`, { method: "POST", json: { body } }),
  mergeReview: (id: string, force = false) =>
    api<Review>(`/api/admin/reviews/${id}/merge`, { method: "POST", json: { force } }),
  closeReview: (id: string) => api<Review>(`/api/admin/reviews/${id}/close`, { method: "POST" }),

  // modelos
  createTemplate: (input: Omit<Template, "id" | "created_by" | "created_at">) =>
    api<Template>("/api/admin/templates", { method: "POST", json: input }),
  deleteTemplate: (id: string) => api<void>(`/api/admin/templates/${id}`, { method: "DELETE" }),
};
