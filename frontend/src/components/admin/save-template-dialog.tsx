import { LayoutTemplate, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { docsApi, keys, type PageKind } from "@/lib/api";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: { title: string; icon: string | null; kind: PageKind; content: string };
}

/** Guarda o conteúdo atual como modelo reutilizável na criação de páginas. */
export function SaveTemplateDialog({ open, onOpenChange, source }: Props) {
  const { mutate } = useSWRConfig();
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSaving(true);
    try {
      const template = await docsApi.createTemplate({
        name: String(form.get("name")).trim(),
        description: String(form.get("description") ?? "").trim(),
        icon: source.icon,
        kind: source.kind,
        content: source.content,
      });
      await mutate(keys.templates);
      toast.success("Modelo salvo", { description: `“${template.name}” aparece ao criar uma nova página.` });
      onOpenChange(false);
    } catch (err) {
      toast.error("Não foi possível salvar o modelo", { description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <form onSubmit={onSubmit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Salvar como modelo</DialogTitle>
              <DialogDescription>
                O conteúdo atual vira um ponto de partida para novas páginas. Use <code>{"{{title}}"}</code>, <code>{"{{date}}"}</code> e{" "}
                <code>{"{{author}}"}</code> para preencher automaticamente.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="tpl-name">Nome do modelo</Label>
              <Input id="tpl-name" name="name" required maxLength={80} autoFocus defaultValue={source.title} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-desc">Quando usar</Label>
              <Textarea id="tpl-desc" name="description" maxLength={300} rows={2} placeholder="Ex.: Página de integração com um parceiro" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="animate-spin" /> : <LayoutTemplate />} Salvar modelo
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
