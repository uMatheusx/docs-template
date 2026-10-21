import { Braces, Copy, ExternalLink, File, FileText, Images, Link2, Loader2, Search, Trash2, UploadCloud, Webhook } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";

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
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import { SPEC_HINT } from "@/lib/spec-hint";
import { docsApi, keys, type Asset } from "@/lib/api";
import { cn, formatBytes, normalize, timeAgo } from "@/lib/utils";

const isImage = (a: Asset) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(a.name);
const markdownFor = (a: Asset) => `${isImage(a) ? "!" : ""}[${a.name}](${a.url})`;
/** bloco que incorpora o contrato na página (o editor também oferece pelo "/") */
const specBlockFor = (a: Asset) => `\`\`\`${a.spec_kind}\nref: ${a.url}\n${SPEC_HINT[a.spec_kind!]}\n\`\`\`\n`;
const SPEC_LABEL = { openapi: "OpenAPI", asyncapi: "AsyncAPI" } as const;

type Filter = "all" | "images" | "specs" | "files";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "images", label: "Imagens" },
  { id: "specs", label: "Contratos de API" },
  { id: "files", label: "Outros arquivos" },
];
const groupOf = (a: Asset): Exclude<Filter, "all"> => (isImage(a) ? "images" : a.spec_kind ? "specs" : "files");

function FileRow({
  asset,
  onCopy,
  onDelete,
}: {
  asset: Asset;
  onCopy: (text: string, label: string) => void;
  onDelete: (a: Asset) => void;
}) {
  const Icon =
    asset.spec_kind === "asyncapi" ? Webhook : asset.spec_kind ? Braces : /\.(pdf|docx?|txt|md|csv|xlsx?)$/i.test(asset.name) ? FileText : File;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-testid="file-row">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", asset.spec_kind ? "brand-tile" : "bg-muted text-muted-foreground")}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <p className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold" title={asset.name}>
            {asset.name}
          </span>
          {asset.spec_kind && (
            <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-bold text-brand-ink">{SPEC_LABEL[asset.spec_kind]}</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(asset.size)} · enviado {timeAgo(asset.last_modified)}
        </p>
      </div>
      <div className="flex items-center gap-1">
        {asset.spec_kind && (
          <Button variant="outline" size="sm" onClick={() => onCopy(specBlockFor(asset), "Bloco de referência copiado")}>
            <Copy /> Copiar referência
          </Button>
        )}
        <Hint label="Copiar link em markdown">
          <Button size="icon-sm" variant="ghost" aria-label={`Copiar link de ${asset.name}`} onClick={() => onCopy(markdownFor(asset), "Link copiado")}>
            <Link2 />
          </Button>
        </Hint>
        <Hint label="Abrir ou baixar">
          <Button size="icon-sm" variant="ghost" asChild>
            <a href={asset.url} target="_blank" rel="noreferrer" aria-label={`Abrir ${asset.name}`}>
              <ExternalLink />
            </a>
          </Button>
        </Hint>
        <Hint label="Excluir">
          <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label={`Excluir ${asset.name}`} onClick={() => onDelete(asset)}>
            <Trash2 />
          </Button>
        </Hint>
      </div>
    </li>
  );
}

export default function AdminMedia() {
  const { data: assets, isLoading, mutate } = useSWR<Asset[]>(keys.assets);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [preview, setPreview] = useState<Asset>();
  const [toDelete, setToDelete] = useState<Asset>();

  const matching = (assets ?? []).filter((a) => normalize(a.name).includes(normalize(query)));
  const count = (f: Filter) => (assets ?? []).filter((a) => f === "all" || groupOf(a) === f).length;
  const visible = matching.filter((a) => filter === "all" || groupOf(a) === filter);
  const images = visible.filter((a) => groupOf(a) === "images");
  const specs = visible.filter((a) => groupOf(a) === "specs");
  const others = visible.filter((a) => groupOf(a) === "files");
  const totalSize = (assets ?? []).reduce((sum, a) => sum + a.size, 0);

  async function upload(files: File[]) {
    if (!files.length) return;
    setUploading((n) => n + files.length);
    await Promise.all(
      files.map(async (file) => {
        try {
          const asset = await docsApi.uploadAsset(file);
          if (asset.spec_kind) {
            toast.success(`Contrato ${SPEC_LABEL[asset.spec_kind]} reconhecido`, { description: `${asset.name} já pode ser referenciado nas páginas.` });
          }
        } catch (err) {
          toast.error(`Falha ao enviar ${file.name}`, { description: (err as Error).message });
        } finally {
          setUploading((n) => n - 1);
        }
      }),
    );
    toast.success(`${files.length} arquivo(s) enviado(s)`);
    mutate();
  }

  async function remove(asset: Asset) {
    setToDelete(undefined);
    setPreview(undefined);
    await mutate(
      async (current) => {
        await docsApi.deleteAsset(asset);
        return current?.filter((a) => a.key !== asset.key);
      },
      { optimisticData: (current) => current?.filter((a) => a.key !== asset.key) ?? [], rollbackOnError: true },
    );
    toast.success("Arquivo excluído");
  }

  const copy = (text: string, label: string) => navigator.clipboard.writeText(text).then(() => toast.success(label, { description: text }));

  return (
    <div
      className="relative min-h-full"
      onDragEnter={(e) => e.dataTransfer.types.includes("Files") && setDragging(true)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        upload(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="mx-auto max-w-[1280px] space-y-6 p-5 lg:p-8">
        <header className="flex flex-wrap items-end gap-4">
          <div className="flex-1">
            <h1 className="font-display text-3xl font-semibold tracking-tight">Arquivos</h1>
            <p className="text-muted-foreground">
              {assets ? `${assets.length} arquivo(s) · ${formatBytes(totalSize)}` : "Imagens, contratos de API e anexos da documentação"}
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar arquivos"
              aria-label="Buscar arquivos"
              className="h-10 w-full rounded-xl border bg-background/60 pl-9 pr-3 text-sm outline-none focus:border-brand/50 focus:ring-4 focus:ring-brand/10"
            />
          </div>
          <Button onClick={() => input.current?.click()} disabled={uploading > 0}>
            {uploading > 0 ? <Loader2 className="animate-spin" /> : <UploadCloud />}
            {uploading > 0 ? `Enviando ${uploading}…` : "Enviar arquivos"}
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) upload(Array.from(e.target.files));
              e.target.value = "";
            }}
          />
        </header>

        <div role="tablist" aria-label="Tipo de arquivo" className="flex w-fit flex-wrap rounded-xl bg-muted p-1">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              onClick={() => setFilter(id)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors",
                filter === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              <span className="rounded-md bg-background/70 px-1.5 font-mono text-[10px]">{count(id)}</span>
            </button>
          ))}
        </div>

        {isLoading && (
          <div className="columns-2 gap-4 md:columns-3 xl:columns-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="mb-4 rounded-2xl" style={{ height: 140 + ((i * 53) % 120) }} />
            ))}
          </div>
        )}

        {assets?.length === 0 && (
          <button
            onClick={() => input.current?.click()}
            className="flex w-full flex-col items-center gap-3 rounded-3xl border-2 border-dashed py-20 text-center transition-colors hover:border-brand/50 hover:bg-brand/5"
          >
            <span className="brand-tile flex h-14 w-14 items-center justify-center rounded-2xl">
              <Images className="h-6 w-6" />
            </span>
            <span className="font-display text-lg font-bold">Nenhum arquivo ainda</span>
            <span className="text-sm text-muted-foreground">
              Arraste imagens, contratos OpenAPI/AsyncAPI (.yaml, .json), PDFs e outros arquivos para esta tela, ou clique para enviar.
            </span>
          </button>
        )}

        {assets && assets.length > 0 && visible.length === 0 && (
          <p className="rounded-2xl border border-dashed py-10 text-center text-sm text-muted-foreground">Nenhum arquivo corresponde à busca.</p>
        )}

        {specs.length > 0 && (
          <section className="space-y-3">
            <div>
              <h2 className="font-display text-lg font-bold">Contratos de API</h2>
              <p className="text-sm text-muted-foreground">
                Use em qualquer página: digite <code className="rounded bg-muted px-1 font-mono text-xs">/</code> no editor e escolha Referência OpenAPI ou AsyncAPI.
              </p>
            </div>
            <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
              {specs.map((a) => (
                <FileRow key={a.key} asset={a} onCopy={copy} onDelete={setToDelete} />
              ))}
            </ul>
          </section>
        )}

        {others.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-display text-lg font-bold">Outros arquivos</h2>
            <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
              {others.map((a) => (
                <FileRow key={a.key} asset={a} onCopy={copy} onDelete={setToDelete} />
              ))}
            </ul>
          </section>
        )}

        {images.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-display text-lg font-bold">Imagens</h2>
        <div className="columns-2 gap-4 md:columns-3 xl:columns-4">
          <AnimatePresence>
            {images.map((asset) => (
              <motion.figure
                key={asset.key}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="group relative mb-4 break-inside-avoid overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-float"
              >
                <button type="button" onClick={() => setPreview(asset)} className="block w-full" aria-label={`Visualizar ${asset.name}`}>
                  {isImage(asset) ? (
                    <img src={asset.url} alt={asset.name} loading="lazy" className="w-full bg-[repeating-conic-gradient(hsl(var(--muted))_0_25%,transparent_0_50%)] bg-[length:16px_16px] object-cover" />
                  ) : (
                    <span className="flex h-36 items-center justify-center bg-muted/50">
                      <File className="h-10 w-10 text-muted-foreground" />
                    </span>
                  )}
                </button>
                <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end gap-1 p-2 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                  <Hint label="Copiar markdown">
                    <Button size="icon-sm" variant="secondary" className="shadow" onClick={() => copy(markdownFor(asset), "Markdown copiado")}>
                      <Copy />
                    </Button>
                  </Hint>
                  <Hint label="Excluir">
                    <Button size="icon-sm" variant="secondary" className="text-destructive shadow" onClick={() => setToDelete(asset)}>
                      <Trash2 />
                    </Button>
                  </Hint>
                </div>
                <figcaption className="px-3 py-2.5">
                  <p className="truncate text-[13px] font-bold" title={asset.name}>
                    {asset.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatBytes(asset.size)} · {timeAgo(asset.last_modified)}
                  </p>
                </figcaption>
              </motion.figure>
            ))}
          </AnimatePresence>
        </div>
          </section>
        )}
      </div>

      {/* overlay de upload */}
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-8"
          >
            <div className="pointer-events-none flex h-full w-full flex-col items-center justify-center gap-4 rounded-[2rem] border-4 border-dashed border-brand text-white">
              <motion.span
                animate={{ y: [0, -10, 0] }}
                transition={{ repeat: Infinity, duration: 1.4 }}
                className="brand-tile flex h-20 w-20 items-center justify-center rounded-3xl"
              >
                <UploadCloud className="h-9 w-9" />
              </motion.span>
              <p className="font-display text-2xl font-semibold">Solte para enviar ao S3</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* lightbox */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(undefined)}>
        <DialogContent className="max-w-4xl gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">{preview?.name}</DialogTitle>
          <DialogDescription className="sr-only">Detalhes do arquivo</DialogDescription>
          {preview && (
            <>
              <div className="flex max-h-[65vh] items-center justify-center bg-[repeating-conic-gradient(hsl(var(--muted))_0_25%,transparent_0_50%)] bg-[length:20px_20px]">
                {isImage(preview) ? (
                  <img src={preview.url} alt={preview.name} className="max-h-[65vh] object-contain" />
                ) : (
                  <File className="my-20 h-16 w-16 text-muted-foreground" />
                )}
              </div>
              <div className="space-y-3 border-t p-5">
                <div>
                  <p className="font-display text-lg font-bold">{preview.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(preview.size)} · enviado {timeAgo(preview.last_modified)} · s3://…/{preview.key}
                  </p>
                </div>
                <code className="block truncate rounded-xl bg-muted px-3 py-2 font-mono text-xs">{markdownFor(preview)}</code>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => copy(markdownFor(preview), "Markdown copiado")}>
                    <Copy /> Copiar markdown
                  </Button>
                  <Button variant="outline" onClick={() => copy(new URL(preview.url, window.location.origin).href, "URL copiada")}>
                    <Link2 /> Copiar URL
                  </Button>
                  <Button variant="outline" asChild>
                    <a href={preview.url} target="_blank" rel="noreferrer">
                      <ExternalLink /> Abrir
                    </a>
                  </Button>
                  <Button variant="ghost" className="ml-auto text-destructive" onClick={() => setToDelete(preview)}>
                    <Trash2 /> Excluir
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              O arquivo será removido do S3. Páginas que o referenciam vão exibir uma imagem quebrada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground shadow-none hover:bg-destructive/90"
              onClick={() => toDelete && remove(toDelete)}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
