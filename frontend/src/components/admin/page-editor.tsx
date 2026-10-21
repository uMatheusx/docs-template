import { json } from "@codemirror/lang-json";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { languages } from "@codemirror/language-data";
import { EditorView, keymap } from "@codemirror/view";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import CodeMirror from "@uiw/react-codemirror";
import {
  Check,
  ChevronDown,
  Columns2,
  CopyPlus,
  Download,
  ExternalLink,
  Eye,
  FileUp,
  FolderInput,
  GitPullRequest,
  History,
  LayoutTemplate,
  LifeBuoy,
  Loader2,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  PencilLine,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { Link, useBlocker, useNavigate } from "react-router";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";

import { insertText, replaceAll, wrapSelection } from "@/components/admin/editor-commands";
import { EditorToolbar } from "@/components/admin/editor-toolbar";
import { Inspector, type Draft } from "@/components/admin/inspector";
import { SLASH_IMAGE_EVENT, slashCommands } from "@/components/admin/slash-commands";
import { MovePageDialog } from "@/components/admin/move-page-dialog";
import { ReviewDialog, type ReviewDraft } from "@/components/admin/review-dialog";
import { SaveTemplateDialog } from "@/components/admin/save-template-dialog";
import { VersionHistory } from "@/components/admin/version-history";
import { ApiReference } from "@/components/api/api-reference";
import { Markdown } from "@/components/markdown/markdown";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Hint } from "@/components/ui/tooltip";
import { modKey, useModHotkey } from "@/hooks/use-hotkey";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSession } from "@/hooks/use-session";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useTheme } from "@/hooks/use-theme";
import { ApiError, api, docsApi, keys, type Page, type PageInput, type Review, type ReviewDetail, type ReviewFields } from "@/lib/api";
import { REVIEW_STATUS } from "@/lib/reviews";
import { cn, countWords, downloadText, readingTime, timeAgo } from "@/lib/utils";
import { useAdmin } from "@/pages/admin/admin-layout";

type Mode = "write" | "split" | "read";
const MODES: { id: Mode; label: string; icon: typeof Eye }[] = [
  { id: "write", label: "Escrever", icon: PencilLine },
  { id: "split", label: "Dividir", icon: Columns2 },
  { id: "read", label: "Ler", icon: Eye },
];
const FIELDS = ["title", "slug", "icon", "description", "published", "content"] as const;
const MD_FILE = /\.(md|markdown|mdx|txt)$/i;
const SPEC_FILE = /\.(ya?ml|json)$/i;
const FILES_EVENT = "ah:files";
type FilesEventDetail = { files: File[]; pos?: number };

const toDraft = (p: Page): Draft => ({
  title: p.title,
  slug: p.slug,
  icon: p.icon,
  description: p.description,
  published: p.published,
  content: p.content,
});

interface LocalDraft {
  draft: Draft;
  savedAt: string;
  baseVersion: number;
}

const localKey = (id: string) => `ah-draft:${id}`;

function readLocalDraft(page: Page): LocalDraft | null {
  try {
    const raw = localStorage.getItem(localKey(page.id));
    if (!raw) return null;
    const local = JSON.parse(raw) as LocalDraft;
    const base = toDraft(page);
    return FIELDS.some((f) => local.draft[f] !== base[f]) ? local : null;
  } catch {
    return null;
  }
}

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const match = text.match(/^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: text.slice(match[0].length).replace(/^\n+/, "") };
}

function emitFiles(view: EditorView, files: File[], pos?: number) {
  view.dom.dispatchEvent(new CustomEvent<FilesEventDetail>(FILES_EVENT, { detail: { files, pos } }));
}

const fileHandlers = EditorView.domEventHandlers({
    drop(event, view) {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.length) return false;
      event.preventDefault();
      emitFiles(view, files, view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? undefined);
      return true;
    },
    paste(event, view) {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!files.length) return false;
      event.preventDefault();
      emitFiles(view, files);
      return true;
    },
});

const editorExtensions = [
  markdown({ base: markdownLanguage, codeLanguages: languages }),
  EditorView.lineWrapping,
  slashCommands,
  keymap.of([
    { key: "Mod-b", run: (v) => (wrapSelection(v, "**"), true) },
    { key: "Mod-i", run: (v) => (wrapSelection(v, "*"), true) },
  ]),
  fileHandlers,
];
// especificações OpenAPI/AsyncAPI: sem toolbar nem comandos "/" de markdown
const yamlExtensions = [yaml(), EditorView.lineWrapping, fileHandlers];
const jsonExtensions = [json(), EditorView.lineWrapping, fileHandlers];
const isJsonText = (text: string) => text.trimStart().startsWith("{");

interface PageEditorProps {
  page: Page;
  onDelete: () => void;
}

export function PageEditor({ page, onDelete }: PageEditorProps) {
  const { resolved } = useTheme();
  const { mutate } = useSWRConfig();
  const [baseline, setBaseline] = useState(page);
  const [draft, setDraft] = useState<Draft>(() => toDraft(page));
  const [recovered, setRecovered] = useState<LocalDraft | null>(() => readLocalDraft(page));
  // mover a página na árvore chega pela prop: sincroniza caminho/pai sem perder o rascunho
  const [syncedPage, setSyncedPage] = useState(page);
  if (page !== syncedPage) {
    setSyncedPage(page);
    if (page.path !== baseline.path || page.parent_id !== baseline.parent_id) {
      setBaseline((b) => ({ ...b, path: page.path, parent_id: page.parent_id, slug: page.slug, breadcrumbs: page.breadcrumbs }));
      setDraft((d) => (d.slug === baseline.slug ? { ...d, slug: page.slug } : d));
    }
  }
  const [view, setView] = useState<EditorView>();
  const [mode, setMode] = usePersistedState<Mode>("ah-editor-mode", "split");
  const [inspectorOpen, setInspectorOpen] = usePersistedState("ah-inspector", true);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<{ open: boolean; id?: string }>({ open: false });
  const [inspectorSheet, setInspectorSheet] = useState(false);
  const [moving, setMoving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const wide = useMediaQuery("(min-width: 1280px)");
  const navigate = useNavigate();
  const { tree } = useAdmin();
  const fileInput = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const preview = useDeferredValue(draft.content);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const { user } = useSession();
  const isAdmin = user?.role === "admin";
  const kind = baseline.kind ?? "doc";
  const isSpec = kind !== "doc";
  const specJson = isSpec && isJsonText(draft.content);
  // ninguém altera páginas publicadas diretamente: as mudanças viram propostas de revisão (com descrição)
  const reviewOnly = baseline.published;
  // rascunho: só se publica pedindo publicação. Publicada: desligar é uma mudança como as outras (vai para revisão)
  const publishLock = baseline.published ? undefined : "Para publicar, envie para revisão pedindo a publicação";
  const unpublishNote = "Volta a rascunho quando a proposta for aprovada e aplicada";
  const { data: pageReviews, mutate: refreshReviews } = useSWR<Review[]>(keys.reviews("active", baseline.id));
  const myReview = pageReviews?.find((r) => r.author === user?.username);
  const otherReviews = pageReviews?.filter((r) => r !== myReview) ?? [];

  const base = toDraft(baseline);
  const changed = FIELDS.filter((f) => draft[f] !== base[f]);
  const dirty = changed.length > 0;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  // ------------------------------------------------------------ rascunho local (recuperação)
  useEffect(() => {
    if (recovered) return;
    const timer = setTimeout(() => {
      try {
        if (dirty) {
          const local: LocalDraft = { draft, savedAt: new Date().toISOString(), baseVersion: baseline.version };
          localStorage.setItem(localKey(baseline.id), JSON.stringify(local));
        } else {
          localStorage.removeItem(localKey(baseline.id));
        }
      } catch {
        /* armazenamento indisponível */
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [draft, dirty, baseline.id, baseline.version, recovered]);

  // ------------------------------------------------------------ salvar
  async function refreshCaches(saved: Page) {
    await mutate(keys.adminPage(saved.id), saved, { revalidate: false });
    mutate(keys.adminTree);
    mutate(keys.tree);
    mutate(keys.stats);
    mutate(keys.history(saved.id));
    mutate((key) => typeof key === "string" && key.startsWith("/api/pages/"), undefined, { revalidate: true });
  }

  function reset(next: Page) {
    setBaseline(next);
    setDraft(toDraft(next));
  }

  async function save(note?: string) {
    if (reviewOnly) {
      if (dirty) setReviewOpen(true);
      return false;
    }
    if (!dirty || saving) return false;
    if (!draft.title.trim()) {
      toast.error("O título não pode ficar vazio");
      return false;
    }
    setSaving(true);
    const input: PageInput = { version: baseline.version, note: note?.trim() || undefined };
    for (const field of changed) Object.assign(input, { [field]: draft[field] });
    try {
      const saved = await docsApi.updatePage(baseline.id, input);
      setBaseline(saved);
      setDraft((d) => ({ ...d, slug: saved.slug }));
      await refreshCaches(saved);
      toast.success(`Versão ${saved.version} salva`, { description: saved.note || "Guardada no S3 · veja em Histórico" });
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error("Conflito de edição", {
          description: err.message,
          duration: 10000,
          action: { label: "Recarregar", onClick: async () => reset(await api<Page>(keys.adminPage(baseline.id))) },
        });
      } else {
        toast.error("Erro ao salvar", { description: (err as Error).message });
      }
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function submitReview({ title, description, requestPublish }: ReviewDraft) {
    const fields: ReviewFields = {};
    for (const field of changed) if (field !== "content") Object.assign(fields, { [field]: draft[field] });
    if (requestPublish) fields.published = true;
    const content = changed.includes("content") ? draft.content : undefined;
    if (content === undefined && Object.keys(fields).length === 0) {
      toast.error("Não há alterações para propor");
      return false;
    }
    setSaving(true);
    try {
      const review = await docsApi.submitReview(baseline.id, { title, description, content, fields, base_version: baseline.version });
      // a proposta guarda as alterações: o editor volta para a versão publicada
      try {
        localStorage.removeItem(localKey(baseline.id));
      } catch {
        /* armazenamento indisponível */
      }
      reset(baseline);
      refreshReviews();
      mutate(keys.stats);
      mutate((key) => typeof key === "string" && key.startsWith("/api/admin/reviews"));
      toast.success(`Proposta #${review.number} enviada para revisão`, {
        description: "Um administrador vai revisar antes de publicar.",
        action: { label: "Abrir", onClick: () => navigate(`/admin/reviews/${review.id}`) },
      });
      return true;
    } catch (err) {
      toast.error("Não foi possível enviar a proposta", { description: (err as Error).message });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function loadProposal(review: Review) {
    try {
      const detail = await api<ReviewDetail>(keys.review(review.id));
      // só o que a proposta altera (a API devolve null no resto); publicação fica com quem revisa
      const fields = Object.fromEntries(
        Object.entries(detail.fields).filter(([key, value]) => value != null && key !== "published"),
      ) as Partial<Draft>;
      setDraft({
        ...toDraft(baseline),
        ...fields,
        content: detail.has_content ? detail.proposed_content : baseline.content,
      });
      toast.success(`Proposta #${review.number} carregada no editor`, { description: "Envie de novo para atualizar a proposta." });
    } catch (err) {
      toast.error("Não foi possível carregar a proposta", { description: (err as Error).message });
    }
  }

  async function duplicate() {
    try {
      const copy = await docsApi.createPage({
        title: `${draft.title} (cópia)`,
        parent_id: baseline.parent_id,
        icon: draft.icon,
        description: draft.description,
        published: false,
        content: draft.content,
        kind,
      });
      mutate(keys.adminTree);
      toast.success("Página duplicada como rascunho", { description: copy.title });
      navigate(`/admin/pages/${copy.id}`);
    } catch (err) {
      toast.error("Não foi possível duplicar", { description: (err as Error).message });
    }
  }

  async function afterMove() {
    const fresh = await api<Page>(keys.adminPage(baseline.id));
    mutate(keys.adminPage(baseline.id), fresh, { revalidate: false });
    setBaseline((prev) => ({
      ...prev,
      parent_id: fresh.parent_id,
      path: fresh.path,
      slug: fresh.slug,
      breadcrumbs: fresh.breadcrumbs,
    }));
    setDraft((d) => (d.slug === baseline.slug ? { ...d, slug: fresh.slug } : d));
  }

  const openHistory = (id?: string) => setHistory({ open: true, id });
  const toggleInspector = () => (wide ? setInspectorOpen(!inspectorOpen) : setInspectorSheet(true));

  useModHotkey("s", () => void save());

  // ------------------------------------------------------------ proteção contra perda
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname && !nextLocation.state?.skipGuard,
  );
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // ------------------------------------------------------------ arquivos (drop / paste / upload / "/Imagem")
  async function handleFiles(files: File[], pos?: number) {
    if (!view) return;
    for (const file of files) {
      if (isSpec && SPEC_FILE.test(file.name)) {
        replaceAll(view, await file.text());
        toast.success(`Especificação carregada de ${file.name}`, { description: `Use ${modKey}+Z para desfazer.` });
        continue;
      }
      if (!isSpec && MD_FILE.test(file.name)) {
        const { meta, body } = parseFrontmatter(await file.text());
        replaceAll(view, body);
        setDraft((d) => ({
          ...d,
          title: meta.title ?? d.title,
          description: meta.description ?? d.description,
          icon: meta.icon ?? d.icon,
        }));
        toast.success(`Conteúdo carregado de ${file.name}`, { description: `Use ${modKey}+Z para desfazer.` });
        continue;
      }
      const id = toast.loading(`Enviando ${file.name} para o S3…`);
      try {
        const asset = await docsApi.uploadAsset(file);
        const isImage = file.type.startsWith("image/");
        const alt = file.name.replace(/\.[^.]+$/, "");
        insertText(view, `${isImage ? "!" : ""}[${alt}](${asset.url})\n`, pos);
        mutate(keys.assets);
        toast.success(`${file.name} enviado`, { id });
      } catch (err) {
        toast.error(`Falha ao enviar ${file.name}`, { id, description: (err as Error).message });
      }
    }
  }

  useEffect(() => {
    if (!view) return;
    const onFiles = (e: Event) => {
      const { files, pos } = (e as CustomEvent<FilesEventDetail>).detail;
      handleFiles(files, pos);
    };
    const onSlashImage = () => fileInput.current?.click();
    view.dom.addEventListener(FILES_EVENT, onFiles);
    view.dom.addEventListener(SLASH_IMAGE_EVENT, onSlashImage);
    return () => {
      view.dom.removeEventListener(FILES_EVENT, onFiles);
      view.dom.removeEventListener(SLASH_IMAGE_EVENT, onSlashImage);
    };
  });

  // ------------------------------------------------------------ rolagem sincronizada editor → preview
  useEffect(() => {
    if (!view || mode !== "split") return;
    const scroller = view.scrollDOM;
    const onScroll = () => {
      const target = previewRef.current;
      if (!target) return;
      const ratio = scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight);
      target.scrollTop = ratio * (target.scrollHeight - target.clientHeight);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [view, mode]);

  function jumpTo(lineNumber: number) {
    if (mode === "read") setMode("split");
    if (!view) return;
    const line = view.state.doc.line(Math.min(lineNumber, view.state.doc.lines));
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 40 }) });
    view.focus();
  }

  const lines = draft.content.split("\n").length;
  const fileExt = isSpec ? (specJson ? "json" : "yaml") : "md";
  const path = `/docs/${baseline.path.split("/").slice(0, -1).concat(draft.slug).join("/")}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ------------------------------------------------ cabeçalho */}
      <header className="border-b px-5 pb-3 pt-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={path}
            target="_blank"
            className="group flex min-w-0 items-center gap-1.5 rounded-lg bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="truncate">{path}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
          <SaveState saving={saving} dirty={dirty} changed={changed.length} version={baseline.version} />

          <div className="ml-auto flex items-center gap-1.5">
            <div className="relative hidden rounded-xl bg-muted p-1 sm:flex">
              {MODES.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setMode(id)}
                  className={cn(
                    "relative z-10 flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-colors",
                    id === "split" && "hidden lg:flex",
                    mode === id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {mode === id && <motion.span layoutId="editor-mode" className="absolute inset-0 -z-10 rounded-lg bg-background shadow-sm" />}
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>
            <Hint label={publishLock ?? (draft.published ? "Visível para todos os leitores" : unpublishNote)}>
              <label className="hidden items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-bold md:flex">
                <Switch
                  checked={draft.published}
                  disabled={!!publishLock}
                  onCheckedChange={(v) => set("published", v)}
                  className="scale-90"
                />
                {draft.published ? "Publicada" : "Rascunho"}
              </label>
            </Hint>
            <Hint label="Histórico de versões">
              <Button variant="ghost" size="sm" onClick={() => openHistory()} aria-label="Histórico de versões">
                <History /> <span className="hidden 2xl:inline">Histórico</span>
                <span className="rounded-md bg-muted px-1.5 font-mono text-[10px]">v{baseline.version}</span>
              </Button>
            </Hint>
            <Hint label={wide && inspectorOpen ? "Fechar inspetor" : "Abrir inspetor"}>
              <Button variant="ghost" size="icon" onClick={toggleInspector} aria-label="Inspetor">
                {wide && inspectorOpen ? <PanelRightClose /> : <PanelRightOpen />}
              </Button>
            </Hint>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Mais ações">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem asChild>
                  <Link to={path} target="_blank">
                    <ExternalLink /> Ver na documentação
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openHistory()}>
                  <History /> Histórico de versões
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setReviewOpen(true)}>
                  <GitPullRequest /> Enviar para revisão…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {isAdmin && (
                  <DropdownMenuItem onSelect={() => setMoving(true)}>
                    <FolderInput /> Mover para…
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={duplicate}>
                  <CopyPlus /> Duplicar página
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTemplateOpen(true)}>
                  <LayoutTemplate /> Salvar como modelo…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
                  <FileUp /> {isSpec ? "Carregar especificação (.yaml/.json)" : "Carregar arquivo .md"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    downloadText(`${draft.slug}.${fileExt}`, draft.content, isSpec ? "application/yaml;charset=utf-8" : undefined)
                  }
                >
                  <Download /> Baixar .{fileExt}
                </DropdownMenuItem>
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={onDelete}>
                      <Trash2 /> Excluir página
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {!baseline.published && (
              <Button variant="secondary" onClick={() => setReviewOpen(true)} disabled={saving}>
                <GitPullRequest /> Pedir publicação
              </Button>
            )}
            <SaveButton dirty={dirty} saving={saving} onSave={save} reviewOnly={reviewOnly} onReview={() => setReviewOpen(true)} />
          </div>
        </div>
        <input
          value={draft.title}
          onChange={(e) => set("title", e.target.value)}
          className="mt-3 w-full bg-transparent font-display text-[1.7rem] font-semibold tracking-[-0.02em] outline-none placeholder:text-muted-foreground/60"
          placeholder="Título da página"
          aria-label="Título"
        />
      </header>

      <AnimatePresence>
        {recovered && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b bg-brand-soft"
          >
            <div className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
              <LifeBuoy className="h-4 w-4 text-brand-ink" />
              <span className="font-semibold">Encontramos alterações não salvas de {timeAgo(recovered.savedAt)}.</span>
              {recovered.baseVersion !== baseline.version && (
                <span className="text-xs text-muted-foreground">(feitas sobre a v{recovered.baseVersion}; a atual é v{baseline.version})</span>
              )}
              <span className="ml-auto flex gap-2">
                <Button size="sm" onClick={() => (setDraft(recovered.draft), setRecovered(null))}>
                  Recuperar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    localStorage.removeItem(localKey(baseline.id));
                    setRecovered(null);
                  }}
                >
                  <X /> Descartar
                </Button>
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {(reviewOnly || (pageReviews?.length ?? 0) > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-sky-500/[0.07] px-5 py-2 text-sm">
          <GitPullRequest className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
          {myReview ? (
            <>
              <span className="font-semibold">
                Sua proposta #{myReview.number} “{myReview.title}” está {REVIEW_STATUS[myReview.status].label.toLowerCase()}.
              </span>
              <span className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => loadProposal(myReview)}>
                  Carregar no editor
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link to={`/admin/reviews/${myReview.id}`}>Abrir proposta</Link>
                </Button>
              </span>
            </>
          ) : (
            reviewOnly && <span className="font-semibold">Página publicada: suas alterações viram uma proposta que um administrador revisa.</span>
          )}
          {otherReviews.length > 0 && (
            <span className="ml-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {otherReviews.length === 1 ? "1 proposta aberta" : `${otherReviews.length} propostas abertas`} nesta página:
              {otherReviews.slice(0, 3).map((r) => (
                <Link
                  key={r.id}
                  to={`/admin/reviews/${r.id}`}
                  className="rounded-full border bg-background px-2 py-0.5 font-semibold text-foreground hover:border-brand/40"
                >
                  #{r.number} · {r.author}
                </Link>
              ))}
            </span>
          )}
        </div>
      )}

      {/* ------------------------------------------------ corpo */}
      <div className="flex min-h-0 flex-1">
        <ResizablePanelGroup direction="horizontal" autoSaveId="ah-editor-split" className="min-w-0 flex-1">
          {mode !== "read" && (
            <ResizablePanel id="editor" order={1} minSize={28} className="flex flex-col">
              {!isSpec && <EditorToolbar view={view} onImage={() => fileInput.current?.click()} />}
              <div
                className="relative min-h-0 flex-1 overflow-hidden"
                onDragEnter={(e) => e.dataTransfer.types.includes("Files") && setDragging(true)}
                onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
                onDrop={() => setDragging(false)}
              >
                <CodeMirror
                  value={draft.content}
                  onChange={(value) => set("content", value)}
                  onCreateEditor={(v) => setView(v)}
                  extensions={isSpec ? (specJson ? jsonExtensions : yamlExtensions) : editorExtensions}
                  theme={resolved === "dark" ? githubDark : githubLight}
                  height="100%"
                  basicSetup={{ foldGutter: true, highlightActiveLine: true, searchKeymap: true, autocompletion: false }}
                  placeholder={
                    isSpec
                      ? "Cole ou arraste a especificação (.yaml ou .json)."
                      : "Comece a escrever… digite / para inserir blocos, ou arraste um .md / imagem para cá."
                  }
                />
                {dragging && (
                  <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand bg-brand/10 text-sm font-bold text-brand-ink backdrop-blur-[1px]">
                    {isSpec ? "Solte para carregar a especificação" : "Solte para carregar .md ou enviar imagens ao S3"}
                  </div>
                )}
              </div>
            </ResizablePanel>
          )}
          {mode === "split" && <ResizableHandle />}
          {mode !== "write" && (
            <ResizablePanel id="preview" order={2} minSize={28}>
              <div ref={previewRef} className="h-full overflow-y-auto">
                <div className="mx-auto max-w-3xl px-8 py-8">
                  {isSpec ? (
                    <ApiReference kind={kind} content={preview} />
                  ) : (
                    <>
                      <h1 className="mb-6 font-display text-3xl font-semibold tracking-tight">{draft.title || "Sem título"}</h1>
                      <Markdown content={preview.replace(/^\s*#\s+.+\n?/, "")} />
                    </>
                  )}
                </div>
              </div>
            </ResizablePanel>
          )}
        </ResizablePanelGroup>

        <AnimatePresence initial={false}>
          {wide && inspectorOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.2, 0.7, 0.2, 1] }}
              className="shrink-0 overflow-hidden border-l bg-sidebar"
            >
              <div className="h-full w-[320px]">
                <Inspector
                  draft={draft}
                  baseline={baseline}
                  onChange={set}
                  onJump={jumpTo}
                  onOpenHistory={openHistory}
                  kind={kind}
                  publishLock={publishLock}
                />
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
        {!wide && (
          <Sheet open={inspectorSheet} onOpenChange={setInspectorSheet}>
            <SheetContent side="right" className="w-[340px] max-w-[90vw] bg-sidebar p-0">
              <SheetTitle className="sr-only">Inspetor</SheetTitle>
              <SheetDescription className="sr-only">Propriedades, estrutura e versões da página</SheetDescription>
              <div className="h-full pt-8">
                <Inspector
                  draft={draft}
                  baseline={baseline}
                  onChange={set}
                  onJump={(line) => (setInspectorSheet(false), jumpTo(line))}
                  onOpenHistory={(id) => (setInspectorSheet(false), openHistory(id))}
                  kind={kind}
                  publishLock={publishLock}
                />
              </div>
            </SheetContent>
          </Sheet>
        )}
      </div>

      {/* ------------------------------------------------ status */}
      <footer className="flex items-center gap-4 border-t bg-sidebar px-5 py-1.5 text-[11px] font-semibold text-muted-foreground">
        {isSpec ? (
          <>
            <span>{kind === "openapi" ? "Especificação OpenAPI" : "Especificação AsyncAPI"}</span>
            <span>{specJson ? "JSON" : "YAML"}</span>
            <span>{lines} linhas</span>
          </>
        ) : (
          <>
            <span>{countWords(draft.content)} palavras</span>
            <span>{readingTime(draft.content)} min de leitura</span>
            <span className="hidden sm:inline">{lines} linhas</span>
            <span className="ml-auto hidden items-center gap-1 md:flex">
              Digite <kbd>/</kbd> para inserir blocos
            </span>
          </>
        )}
      </footer>

      <input
        ref={fileInput}
        type="file"
        accept={isSpec ? ".yaml,.yml,.json" : ".md,.markdown,.mdx,.txt,text/markdown,image/*,application/pdf"}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />

      <VersionHistory
        open={history.open}
        onOpenChange={(open) => setHistory((h) => ({ ...h, open }))}
        page={baseline}
        dirty={dirty}
        initialId={history.id}
        reviewOnly={reviewOnly}
        onUseVersion={(content, label) => {
          set("content", content);
          toast.success(`Versão ${label} carregada no editor`, {
            description: "Revise e use Enviar para revisão para aplicar na página publicada.",
          });
        }}
        onRestored={async (restored) => {
          reset(restored);
          await refreshCaches(restored);
        }}
      />
      <MovePageDialog tree={tree} pageId={moving ? baseline.id : null} onOpenChange={setMoving} onMoved={afterMove} />
      <ReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        pageTitle={baseline.title}
        changed={changed}
        existing={myReview}
        canRequestPublish={!baseline.published}
        saving={saving}
        onSubmit={submitReview}
      />
      <SaveTemplateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        source={{ title: draft.title, icon: draft.icon, kind, content: draft.content }}
      />

      <AlertDialog open={blocker.state === "blocked"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair sem salvar?</AlertDialogTitle>
            <AlertDialogDescription>
              Há alterações não salvas. Elas continuam guardadas neste navegador e poderão ser recuperadas quando você voltar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Continuar editando</AlertDialogCancel>
            <AlertDialogAction onClick={() => blocker.proceed?.()}>Sair mesmo assim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SaveState({ saving, dirty, changed, version }: { saving: boolean; dirty: boolean; changed: number; version: number }) {
  const state = saving ? "saving" : dirty ? "dirty" : "saved";
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={state}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15 }}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold",
          state === "saved" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          state === "dirty" && "bg-brand/10 text-brand-ink",
          state === "saving" && "bg-muted text-muted-foreground",
        )}
      >
        {state === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
        {state === "dirty" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />}
        {state === "saved" && <Check className="h-3 w-3" />}
        {state === "saving" ? "Salvando…" : state === "dirty" ? `${changed} alteração(ões) não salva(s)` : `Salvo · v${version}`}
      </motion.span>
    </AnimatePresence>
  );
}

/** Salvar rápido (Ctrl+S) ou com uma descrição que aparece no histórico. */
function SaveButton({
  dirty,
  saving,
  onSave,
  reviewOnly,
  onReview,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: (note?: string) => Promise<boolean>;
  reviewOnly: boolean;
  onReview: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const submit = async () => {
    if (await onSave(note)) {
      setNote("");
      setOpen(false);
    }
  };
  if (reviewOnly) {
    return (
      <Button onClick={onReview} disabled={!dirty || saving}>
        {saving ? <Loader2 className="animate-spin" /> : <GitPullRequest />} Enviar para revisão
      </Button>
    );
  }
  return (
    <div className="flex">
      <Button onClick={() => onSave()} disabled={!dirty || saving} className="rounded-r-none pr-3">
        {saving ? <Loader2 className="animate-spin" /> : <Save />} Salvar
        <kbd className="ml-0.5 hidden border-background/25 bg-background/15 text-background/80 lg:inline-flex">{modKey} S</kbd>
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <Hint label="Salvar com descrição">
          <PopoverTrigger asChild>
            <Button
              disabled={!dirty || saving}
              className="rounded-l-none border-l border-background/20 px-2"
              aria-label="Salvar com descrição"
            >
              <ChevronDown />
            </Button>
          </PopoverTrigger>
        </Hint>
        <PopoverContent align="end" className="w-80">
          <p className="text-sm font-bold">Salvar com descrição</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Aparece no histórico de versões, como uma mensagem de commit.
          </p>
          <textarea
            autoFocus
            value={note}
            maxLength={200}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ex.: Atualiza o fluxo de autenticação com PKCE"
            className="mt-3 w-full resize-none rounded-xl border bg-background/60 px-3 py-2 text-sm outline-none focus:border-brand/50 focus:ring-4 focus:ring-brand/10"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              {note.length}/200 · {modKey}+Enter
            </span>
            <Button size="sm" onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />} Salvar versão
            </Button>
          </div>
          <button
            onClick={() => (setOpen(false), onReview())}
            className="mt-3 flex w-full items-center gap-2 border-t pt-3 text-left text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <GitPullRequest className="h-3.5 w-3.5 text-brand" /> Enviar para revisão pedindo a publicação
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
