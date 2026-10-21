import { Keyboard } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { modKey } from "@/hooks/use-hotkey";

const SHORTCUTS: [string[], string][] = [
  [[modKey, "K"], "Abrir o Command Center"],
  [["/"], "Buscar"],
  [["["], "Página anterior"],
  [["]"], "Próxima página"],
  [["F"], "Modo foco (esconde navegação)"],
  [["T"], "Alternar tema claro/escuro"],
  [["?"], "Mostrar atalhos"],
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="brand-tile flex h-8 w-8 items-center justify-center rounded-lg">
              <Keyboard className="h-4 w-4" />
            </span>
            Atalhos de teclado
          </DialogTitle>
          <DialogDescription>Navegue pela documentação sem tirar as mãos do teclado.</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-xl border">
          {SHORTCUTS.map(([keys, label]) => (
            <li key={label} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span>{label}</span>
              <span className="flex gap-1">
                {keys.map((k) => (
                  <kbd key={k} className="h-6 min-w-6 text-[11px]">
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
