import { FileUp, Link2, Loader2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";

import { ParentSelect } from "@/components/admin/parent-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { docsApi, keys, type TreeNode } from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";

const MD = /\.(md|markdown|mdx|txt|ya?ml|json)$/i;

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">{open && <ImportForm onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function ImportForm({ onDone }: { onDone: () => void }) {
  const { data: tree = [] } = useSWR<TreeNode[]>(keys.adminTree);
  const { mutate } = useSWRConfig();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState("files");
  const [files, setFiles] = useState<File[]>([]);
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const addFiles = (list: FileList | File[]) => {
    const accepted = Array.from(list).filter((f) => MD.test(f.name));
    if (accepted.length < Array.from(list).length) toast.warning("Apenas arquivos .md/.txt ou especificações .yaml/.json são aceitos");
    setFiles((prev) => [...prev, ...accepted]);
  };

  async function submit() {
    setBusy(true);
    try {
      const pages = tab === "files" ? await docsApi.importFiles(files, parent) : [await docsApi.importUrl(url, parent)];
      await Promise.all([mutate(keys.adminTree), mutate(keys.tree), mutate(keys.stats)]);
      toast.success(`${pages.length} página(s) importada(s)`);
      onDone();
      if (pages[0]) navigate(`/admin/pages/${pages[0].id}`);
    } catch (err) {
      toast.error("Falha na importação", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Importar páginas</DialogTitle>
        <DialogDescription>
          Título, slug, ícone e descrição podem vir do front matter (<code>title:</code>, <code>icon:</code>…) ou do
          primeiro <code># título</code>. Arquivos OpenAPI e AsyncAPI (.yaml/.json) viram referências de API interativas.
        </DialogDescription>
      </DialogHeader>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="files">
            <FileUp /> Arquivos
          </TabsTrigger>
          <TabsTrigger value="url">
            <Link2 /> URL
          </TabsTrigger>
        </TabsList>
        <TabsContent value="files" className="mt-4 space-y-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => (e.preventDefault(), setDragging(true))}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
            className={cn(
              "flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-sm text-muted-foreground transition-colors",
              dragging ? "border-primary bg-primary/5 text-primary" : "hover:border-primary/50 hover:bg-accent/50",
            )}
          >
            <Upload className="h-6 w-6" />
            Arraste arquivos .md, .yaml ou .json aqui ou clique para selecionar
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".md,.markdown,.mdx,.txt,text/markdown,.yaml,.yml,.json"
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
          {files.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-1.5 text-sm">
                  <FileUp className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{f.name}</span>
                  <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                  <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remover">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="url" className="mt-4 space-y-2">
          <Label htmlFor="imp-url">URL do arquivo (.md, .yaml ou .json)</Label>
          <Input
            id="imp-url"
            type="url"
            placeholder="https://github.com/org/repo/blob/main/README.md"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Links de “blob” do GitHub são convertidos para o arquivo raw.</p>
        </TabsContent>
      </Tabs>
      <div className="space-y-2">
        <Label htmlFor="imp-parent">Importar dentro de</Label>
        <ParentSelect id="imp-parent" tree={tree} value={parent} onChange={setParent} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button onClick={submit} disabled={busy || (tab === "files" ? !files.length : !url)}>
          {busy ? <Loader2 className="animate-spin" /> : <Upload />} Importar
        </Button>
      </DialogFooter>
    </div>
  );
}
