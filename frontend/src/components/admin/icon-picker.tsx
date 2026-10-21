import { useState } from "react";

import { PageIcon } from "@/components/page-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PAGE_ICONS } from "@/lib/icons";
import { cn } from "@/lib/utils";

export function IconPicker({ value, onChange, id }: { value: string | null; onChange: (v: string | null) => void; id?: string }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const names = Object.keys(PAGE_ICONS).filter((n) => n.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} variant="outline" className="w-full justify-start font-normal">
          <PageIcon name={value} />
          <span className={cn(!value && "text-muted-foreground")}>{value ?? "Padrão"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start">
        <Input placeholder="Filtrar ícones…" value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-2 h-8" />
        <div className="grid max-h-56 grid-cols-7 gap-1 overflow-y-auto">
          {names.map((name) => (
            <button
              key={name}
              type="button"
              title={name}
              onClick={() => {
                onChange(name);
                setOpen(false);
              }}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent",
                value === name && "bg-primary/15 text-primary",
              )}
            >
              <PageIcon name={name} className="h-4 w-4" />
            </button>
          ))}
        </div>
        {value && (
          <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => (onChange(null), setOpen(false))}>
            Remover ícone
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
