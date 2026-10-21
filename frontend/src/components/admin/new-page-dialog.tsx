import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";

import { IconPicker } from "@/components/admin/icon-picker";
import { ParentSelect } from "@/components/admin/parent-select";
import { PageIcon } from "@/components/page-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/hooks/use-session";
import { docsApi, keys, type Template, type TreeNode } from "@/lib/api";
import { BUILTIN_TEMPLATES, fillTemplate, fromCustom, type PageTemplate } from "@/lib/templates";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId?: string | null;
}

const KIND_TAG: Record<PageTemplate["kind"], string | null> = { doc: null, openapi: "OpenAPI", asyncapi: "AsyncAPI" };

export function NewPageDialog({ open, onOpenChange, parentId = null }: Props) {
  const [template, setTemplate] = useState<PageTemplate | null>(null);
  const change = (next: boolean) => {
    if (!next) setTemplate(null);
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className={cn(!template && "max-w-3xl")}>
        {/* remonta o formulário a cada abertura */}
        {open &&
          (template ? (
            <NewPageForm parentId={parentId} template={template} onBack={() => setTemplate(null)} onDone={() => change(false)} />
          ) : (
            <TemplateGallery onPick={setTemplate} />
          ))}
      </DialogContent>
    </Dialog>
  );
}

function TemplateCard({ template, onPick, onDelete }: { template: PageTemplate; onPick: () => void; onDelete?: () => void }) {
  const tag = KIND_TAG[template.kind];
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onPick}
        className="flex h-full w-full flex-col items-start gap-2 rounded-2xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-glow focus-visible:border-brand"
      >
        <span className="flex w-full items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border bg-background transition-colors group-hover:brand-tile group-hover:border-transparent">
            <PageIcon name={template.icon} className="h-4 w-4" />
          </span>
          {tag && <span className="ml-auto rounded-full bg-navy-800/10 px-2 py-0.5 text-[10px] font-bold text-foreground dark:bg-white/10">{tag}</span>}
        </span>
        <span className="font-display text-[15px] font-bold leading-tight">{template.name}</span>
        <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{template.description || "Modelo do time"}</span>
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Excluir o modelo ${template.name}`}
          className="absolute right-2 top-2 rounded-lg p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function TemplateGallery({ onPick }: { onPick: (t: PageTemplate) => void }) {
  const { user } = useSession();
  const { data: custom } = useSWR<Template[]>(keys.templates);
  const { mutate } = useSWRConfig();

  const remove = async (t: Template) => {
    try {
      await docsApi.deleteTemplate(t.id);
      await mutate(keys.templates);
      toast.success("Modelo excluído", { description: t.name });
    } catch (err) {
      toast.error("Não foi possível excluir o modelo", { description: (err as Error).message });
    }
  };

  return (
    <div className="grid gap-5">
      <DialogHeader>
        <DialogTitle>Nova página</DialogTitle>
        <DialogDescription>Escolha um ponto de partida. Você ajusta título, local e conteúdo em seguida.</DialogDescription>
      </DialogHeader>
      <div className="-mx-1 max-h-[62vh] space-y-5 overflow-y-auto px-1 pb-1">
        <div className="grid gap-3 sm:grid-cols-3">
          {BUILTIN_TEMPLATES.map((t) => (
            <TemplateCard key={t.id} template={t} onPick={() => onPick(t)} />
          ))}
        </div>
        {!!custom?.length && (
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Modelos do time</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {custom.map((c) => (
                <TemplateCard
                  key={c.id}
                  template={fromCustom(c)}
                  onPick={() => onPick(fromCustom(c))}
                  onDelete={user?.role === "admin" || user?.username === c.created_by ? () => remove(c) : undefined}
                />
              ))}
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Para criar um modelo do time, abra uma página no Studio e use <span className="font-semibold">⋯ → Salvar como modelo</span>.
        </p>
      </div>
    </div>
  );
}

function NewPageForm({
  parentId,
  template,
  onBack,
  onDone,
}: {
  parentId: string | null;
  template: PageTemplate;
  onBack: () => void;
  onDone: () => void;
}) {
  const { data: tree = [] } = useSWR<TreeNode[]>(keys.adminTree);
  const { user } = useSession();
  const { mutate } = useSWRConfig();
  const navigate = useNavigate();
  const [parent, setParent] = useState<string | null>(parentId);
  const [icon, setIcon] = useState<string | null>(template.id === "blank" ? null : template.icon);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const title = String(form.get("title")).trim();
    setSaving(true);
    try {
      const page = await docsApi.createPage({
        title,
        description: String(form.get("description") ?? ""),
        parent_id: parent,
        icon,
        published: false,
        kind: template.kind,
        content: fillTemplate(template.content, { title, author: user?.username ?? "" }),
      });
      await Promise.all([mutate(keys.adminTree), mutate(keys.tree), mutate(keys.stats)]);
      toast.success("Página criada", { description: page.title });
      onDone();
      navigate(`/admin/pages/${page.id}`);
    } catch (err) {
      toast.error("Não foi possível criar a página", { description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <DialogHeader>
        <button
          type="button"
          onClick={onBack}
          className="mb-1 inline-flex w-fit items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Trocar modelo
        </button>
        <DialogTitle className="flex items-center gap-2">
          <PageIcon name={template.icon} className="h-5 w-5 text-brand" /> {template.name}
        </DialogTitle>
        <DialogDescription>{template.description}</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="np-title">Título</Label>
        <Input
          id="np-title"
          name="title"
          required
          maxLength={200}
          autoFocus
          placeholder={template.kind === "doc" ? "Ex.: Webhooks" : "Ex.: API de Contas"}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="np-parent">Dentro de</Label>
          <ParentSelect id="np-parent" tree={tree} value={parent} onChange={setParent} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="np-icon">Ícone</Label>
          <IconPicker id="np-icon" value={icon} onChange={setIcon} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="np-desc">Descrição</Label>
        <Textarea id="np-desc" name="description" maxLength={500} rows={2} placeholder="Resumo exibido nos cards e na busca" />
      </div>
      <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
        A página nasce como rascunho. Quando estiver pronta, envie para revisão pedindo a publicação.
      </p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Plus />} Criar página
        </Button>
      </DialogFooter>
    </form>
  );
}
