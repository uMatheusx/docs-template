import { EditorView } from "@codemirror/view";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import CodeMirror from "@uiw/react-codemirror";
import {
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
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  PencilLine,
  FileDiff,
  RotateCcw,
  Trash2,
  Undo2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { Link, useBlocker, useNavigate } from "react-router";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";

import { insertText, replaceAll } from "@/components/admin/editor-commands";
import {
  FILES_EVENT,
  type FilesEventDetail,
  isJsonText,
  jsonExtensions,
  markdownExtensions,
  parseFrontmatter,
  yamlExtensions,
} from "@/components/admin/editor-extensions";
import { SaveButton, SaveState } from "@/components/admin/editor-status";
import { EditorToolbar } from "@/components/admin/editor-toolbar";
import { Inspector, type Draft } from "@/components/admin/inspector";
import { SLASH_IMAGE_EVENT, setSlashAssets, setSlashPages } from "@/components/admin/slash-commands";
import { MovePageDialog } from "@/components/admin/move-page-dialog";
import { ReviewBanner } from "@/components/admin/review-banner";
import { SaveTemplateDialog } from "@/components/admin/save-template-dialog";
import { FIELDS, rebaseLocal, toDraft } from "@/lib/draft";
import { ChangesDialog } from "@/components/admin/changes-dialog";
import { VersionHistory } from "@/components/admin/version-history";
import { clearLocal, readLocal, writeLocal, type LocalDraft } from "@/lib/local-drafts";
import { flattenTree } from "@/lib/tree";
import { ApiReference } from "@/components/api/api-reference";
import { Markdown } from "@/components/markdown/markdown";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Hint } from "@/components/ui/tooltip";
import { modKey, useModHotkey } from "@/hooks/use-hotkey";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSession } from "@/hooks/use-session";
import { useLocalDraftSync } from "@/hooks/use-local-draft-sync";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useTheme } from "@/hooks/use-theme";
import { ApiError, api, docsApi, keys, type Asset, type Page, type PageInput, type Review, type ReviewDetail } from "@/lib/api";
import { cn, countWords, downloadText, readingTime } from "@/lib/utils";
import { useAdmin } from "@/pages/admin/admin-layout";

type Mode = "write" | "split" | "read";
const MODES: { id: Mode; label: string; icon: typeof Eye }[] = [
  { id: "write", label: "Escrever", icon: PencilLine },
  { id: "split", label: "Dividir", icon: Columns2 },
  { id: "read", label: "Ler", icon: Eye },
];
const MD_FILE = /\.(md|markdown|mdx|txt)$/i;
const SPEC_FILE = /\.(ya?ml|json)$/i;

/** O que já está guardado fora do editor: uma proposta carregada ou um "Salvar" local. */
interface Persisted {
  kind: "proposal" | "local";
  number?: number;
  snapshot: Draft;
}

/** Rascunho local que ainda difere da página (senão não há nada a restaurar). */
function readLocalDraft(page: Page): LocalDraft | null {
  const local = readLocal(page.id);
  if (!local) return null;
  const base = toDraft(page);
  return FIELDS.some((f) => local.draft[f] !== base[f]) ? local : null;
}

interface PageEditorProps {
  page: Page;
  onDelete: () => void;
}

export function PageEditor({ page, onDelete }: PageEditorProps) {
  const { resolved } = useTheme();
  const { mutate } = useSWRConfig();
  const [baseline, setBaseline] = useState(page);
  // o que a pessoa estava fazendo volta sozinho ao abrir a página: tudo é guardado neste navegador enquanto edita
  const [stored] = useState<LocalDraft | null>(() => readLocalDraft(page));
  const [draft, setDraft] = useState<Draft>(() => (stored ? rebaseLocal(stored, page) : toDraft(page)));
  // versão (e campos) em que o rascunho se baseia: é com ela que a mesclagem compara ao aplicar a proposta
  const [origin, setOrigin] = useState<{ version: number; semver: string; fields: Draft }>(() =>
    stored
      ? {
          version: stored.baseVersion,
          semver: stored.baseSemver ?? "",
          fields: stored.baseDraft ?? toDraft(page),
        }
      : { version: page.version, semver: page.semver, fields: toDraft(page) },
  );
  // "Salvar" explícito = salvo localmente (pronto para enviar); o restante é "modificado, não salvo"
  const [persisted, setPersisted] = useState<Persisted | null>(() =>
    stored?.explicit ? { kind: "local", snapshot: rebaseLocal(stored, page) } : null,
  );
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
  // proposta que o usuário quer carregar, esperando a confirmação de que o texto atual pode ser substituído
  const [confirmLoad, setConfirmLoad] = useState<Review | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
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
  const { data: pageReviews } = useSWR<Review[]>(keys.reviews("active", baseline.id));
  const myReview = pageReviews?.find((r) => r.author === user?.username);
  const otherReviews = pageReviews?.filter((r) => r !== myReview) ?? [];

  // páginas que o "/" oferece como link (todas, menos esta)
  useEffect(() => {
    setSlashPages(
      flattenTree(tree)
        .filter((n) => n.id !== baseline.id)
        .map((n) => ({ id: n.id, title: n.title, path: n.path, published: n.published, kind: n.kind })),
    );
  }, [tree, baseline.id]);

  // arquivos de "Arquivos" que o "/" oferece (contratos OpenAPI/AsyncAPI, PDFs…)
  const { data: assetList } = useSWR<Asset[]>(keys.assets);
  useEffect(() => {
    setSlashAssets(assetList ?? []);
  }, [assetList]);

  const base = toDraft(baseline);
  const changed = FIELDS.filter((f) => draft[f] !== base[f]);
  const dirty = changed.length > 0;
  // o que já está guardado em outro lugar (proposta carregada ou "Salvar" local) não conta como não salvo
  const beyondPersisted = persisted ? FIELDS.filter((f) => draft[f] !== persisted.snapshot[f]) : [];
  const unsaved = persisted ? beyondPersisted.length > 0 : dirty;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  // ------------------------------------------------------------ rascunho local (automático e "Salvar")
  // o navegador recusou guardar (cheio/bloqueado): sem rede de segurança, sair da página volta a pedir confirmação
  const { failed: localFailed, setFailed: setLocalFailed } = useLocalDraftSync(baseline.id, {
    draft,
    dirty,
    unsaved,
    persistedKind: persisted?.kind ?? null,
    origin,
  });

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
    setPersisted(null);
    setOrigin({ version: next.version, semver: next.semver, fields: toDraft(next) });
  }

  /** Páginas publicadas: "Salvar" guarda neste navegador (para trocar de página sem perder nada) e não publica. */
  function saveLocal() {
    if (!unsaved) return false;
    const result = writeLocal(baseline.id, {
      draft,
      savedAt: new Date().toISOString(),
      baseVersion: origin.version,
      baseSemver: origin.semver,
      baseDraft: origin.fields,
      explicit: true,
    });
    if (result !== "ok") {
      setLocalFailed(true);
      toast.error("Não foi possível salvar neste navegador", {
        description:
          result === "full"
            ? "O armazenamento do navegador está cheio. Envie para revisão para não perder as alterações."
            : "O armazenamento local está indisponível. Envie para revisão para não perder as alterações.",
      });
      return false;
    }
    setPersisted({ kind: "local", snapshot: draft });
    toast.success("Salvo neste navegador", {
      description: "Pode trocar de página e voltar: as alterações ficam aqui. Quando estiver pronto, envie para revisão.",
    });
    return true;
  }

  async function save(note?: string) {
    if (reviewOnly) return saveLocal();
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
      setPersisted(null);
      setOrigin({ version: saved.version, semver: saved.semver, fields: toDraft(saved) });
      setBaseline(saved);
      setDraft((d) => ({ ...d, slug: saved.slug }));
      await refreshCaches(saved);
      toast.success("Rascunho salvo", { description: "Fica só a última versão; o histórico começa quando a página for publicada." });
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

  /** Só se envia para revisão o que já foi salvo: abre a tela Alterações ou avisa para salvar antes. */
  function openReview() {
    if (unsaved) {
      toast.error("Salve antes de enviar para revisão", {
        description: "Use Salvar para guardar as alterações e depois envie.",
      });
      return;
    }
    // o envio (de uma ou várias páginas, publicadas ou rascunhos) é sempre pela tela Alterações
    navigate(`/admin/changes?select=${baseline.id}`);
  }

  /** Carregar substitui o editor inteiro: só pergunta quando há algo a perder (nem se já é igual à proposta). */
  function requestLoadProposal(review: Review) {
    const nothingToLose = !dirty || (persisted?.kind === "proposal" && !unsaved);
    if (nothingToLose) void loadProposal(review);
    else setConfirmLoad(review);
  }

  async function loadProposal(review: Review) {
    try {
      const detail = await api<ReviewDetail>(keys.review(review.id));
      const item = detail.items.find((i) => i.page_id === baseline.id);
      if (!item) throw new Error("A proposta não altera mais esta página.");
      // só o que a proposta altera (a API devolve null no resto). Em rascunho, "publicar" não é um campo do
      // editor (vai pelo botão Pedir publicação); em página publicada, voltar a rascunho é.
      const fields = Object.fromEntries(
        Object.entries(item.fields).filter(([key, value]) => value != null && (key !== "published" || baseline.published)),
      ) as Partial<Draft>;
      const next: Draft = {
        ...toDraft(baseline),
        ...fields,
        content: item.has_content ? item.proposed_content : baseline.content,
      };
      setDraft(next);
      setPersisted({ kind: "proposal", number: review.number, snapshot: next });
      setOrigin({ version: item.base_version, semver: item.base_semver, fields: toDraft(baseline) });
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
  // normalmente nada se perde ao sair (tudo é guardado neste navegador); só pergunta se a gravação local falhou
  const atRisk = localFailed && unsaved;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      atRisk && currentLocation.pathname !== nextLocation.pathname && !nextLocation.state?.skipGuard,
  );
  useEffect(() => {
    if (!atRisk) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [atRisk]);

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
          <SaveState
            saving={saving}
            dirty={unsaved}
            changed={persisted ? beyondPersisted.length : changed.length}
            version={baseline.semver}
            persisted={persisted ? { kind: persisted.kind, number: persisted.number } : undefined}
          />

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
            {baseline.published ? (
              <Hint label={draft.published ? "Visível para todos os leitores" : unpublishNote}>
                <label className="hidden items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-bold md:flex">
                  <Switch checked={draft.published} onCheckedChange={(v) => set("published", v)} className="scale-90" />
                  {draft.published ? "Publicada" : "Tirar do ar"}
                </label>
              </Hint>
            ) : (
              <Hint label={publishLock}>
                <span className="hidden items-center rounded-xl bg-muted px-2.5 py-1.5 text-xs font-bold text-muted-foreground md:flex">Rascunho</span>
              </Hint>
            )}
            <Hint label="Ver alterações em relação à versão publicada">
              <Button variant="ghost" size="sm" onClick={() => setChangesOpen(true)} aria-label="Ver alterações" disabled={!dirty}>
                <FileDiff /> <span className="hidden 2xl:inline">Alterações</span>
                {dirty && <span className="rounded-md bg-muted px-1.5 font-mono text-[10px]">{changed.length}</span>}
              </Button>
            </Hint>
            <Hint label="Histórico de versões">
              <Button variant="ghost" size="sm" onClick={() => openHistory()} aria-label="Histórico de versões">
                <History /> <span className="hidden 2xl:inline">Histórico</span>
                <span className="rounded-md bg-muted px-1.5 font-mono text-[10px]">{baseline.semver}</span>
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
                <DropdownMenuItem disabled={!dirty} onSelect={() => setChangesOpen(true)}>
                  <FileDiff /> Ver alterações
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!persisted || !unsaved} onSelect={() => setConfirmRestore(true)}>
                  <RotateCcw /> {persisted?.kind === "proposal" ? `Voltar à proposta #${persisted.number}…` : "Restaurar o último salvo…"}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!dirty} onSelect={() => setConfirmDiscard(true)}>
                  <Undo2 /> Descartar alterações…
                </DropdownMenuItem>
                <DropdownMenuItem disabled={(reviewOnly && !dirty) || unsaved} onSelect={openReview}>
                  <GitPullRequest /> {reviewOnly ? "Enviar para revisão…" : "Pedir publicação…"}
                  {unsaved && <span className="ml-auto text-xs">salve antes</span>}
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
          </div>
        </div>
        {/* o título ocupa a linha de baixo junto das ações principais: a de cima fica só com o contexto e as ferramentas */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <input
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            className="min-w-0 flex-1 basis-72 bg-transparent font-display text-[1.7rem] font-semibold tracking-[-0.02em] outline-none placeholder:text-muted-foreground/60"
            placeholder="Título da página"
            aria-label="Título"
          />
          <SaveButton
            dirty={dirty}
            unsaved={unsaved}
            saving={saving}
            onSave={save}
            reviewOnly={reviewOnly}
            onReview={openReview}
          />
        </div>
      </header>

      <ReviewBanner
        mine={myReview}
        others={otherReviews}
        reviewOnly={reviewOnly}
        origin={origin}
        current={{ version: baseline.version, semver: baseline.semver }}
        onLoad={requestLoadProposal}
      />

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
                  extensions={isSpec ? (specJson ? jsonExtensions : yamlExtensions) : markdownExtensions}
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
              <div ref={previewRef} className="relative h-full overflow-y-auto">
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
        pending={
          unsaved
            ? { kind: "unsaved" }
            : persisted?.kind === "local" && dirty
              ? { kind: "unsent" }
              : persisted?.kind === "proposal" && dirty
                ? { kind: "proposal", number: persisted.number }
                : null
        }
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
      <SaveTemplateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        source={{ title: draft.title, icon: draft.icon, kind, content: draft.content }}
      />

      <ConfirmDialog
        open={confirmLoad !== null}
        onOpenChange={(open) => !open && setConfirmLoad(null)}
        title={`Carregar a proposta #${confirmLoad?.number} no editor?`}
        description={
          <>
            Tudo que está no editor agora será substituído pelo conteúdo da proposta.
            {persisted?.kind === "local" ? " Isso inclui o que você salvou neste navegador." : ""}
            {unsaved ? " As alterações ainda não salvas serão perdidas." : ""} Isso não pode ser desfeito.
          </>
        }
        cancel="Manter o que está no editor"
        confirm="Substituir e carregar"
        onConfirm={() => {
          const review = confirmLoad;
          setConfirmLoad(null);
          if (review) void loadProposal(review);
        }}
      />

      <ChangesDialog
        open={changesOpen}
        onOpenChange={setChangesOpen}
        current={draft}
        published={{
          label: `Desde a versão publicada (${baseline.semver})`,
          legend: `Comparando com a versão publicada (${baseline.semver})`,
          draft: base,
        }}
        saved={
          persisted
            ? {
                label: persisted.kind === "proposal" ? `Desde a proposta #${persisted.number}` : "Desde o último Salvar",
                legend: persisted.kind === "proposal" ? `Comparando com a proposta #${persisted.number} carregada` : "Comparando com o que você salvou neste navegador",
                draft: persisted.snapshot,
              }
            : null
        }
        onRestoreSaved={() => {
          setChangesOpen(false);
          setConfirmRestore(true);
        }}
        onDiscard={() => {
          setChangesOpen(false);
          setConfirmDiscard(true);
        }}
      />

      <ConfirmDialog
        open={confirmRestore}
        onOpenChange={setConfirmRestore}
        title={persisted?.kind === "proposal" ? `Voltar à proposta #${persisted.number}?` : "Restaurar o último salvo?"}
        description={
          <>
            {persisted?.kind === "proposal" ? "O editor volta ao texto da proposta carregada." : "O editor volta ao que você salvou neste navegador."}{" "}
            As alterações feitas depois ({beyondPersisted.length}) serão perdidas. Isso não pode ser desfeito.
          </>
        }
        cancel="Manter o que está no editor"
        confirm="Restaurar"
        onConfirm={() => {
          if (persisted) setDraft(persisted.snapshot);
          toast.success(persisted?.kind === "proposal" ? "Voltou à proposta" : "Restaurado ao último salvo");
        }}
      />

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Descartar as alterações?"
        description={`O editor volta ao que está na página (versão ${baseline.semver}). O que você escreveu aqui e o que foi guardado neste navegador serão apagados. Isso não pode ser desfeito.`}
        cancel="Manter as alterações"
        confirm="Descartar"
        onConfirm={() => {
          reset(baseline);
          clearLocal(baseline.id);
          toast.success("Alterações descartadas");
        }}
      />

      <ConfirmDialog
        open={blocker.state === "blocked"}
        title="Sair sem salvar?"
        description="O navegador não conseguiu guardar as alterações que ainda não foram salvas. Se sair agora, elas serão perdidas."
        cancel="Continuar editando"
        confirm="Sair mesmo assim"
        onCancel={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
      />
    </div>
  );
}
