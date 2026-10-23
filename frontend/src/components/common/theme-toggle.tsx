import { Monitor, Moon, Sun } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { useTheme, type Theme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

/** Alterna claro ↔ escuro com animação. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, setTheme } = useTheme();
  const dark = resolved === "dark";
  return (
    <Hint label={dark ? "Tema claro" : "Tema escuro"}>
      <Button
        variant="ghost"
        size="icon"
        className={cn("overflow-hidden", className)}
        onClick={() => setTheme(dark ? "light" : "dark")}
        aria-label="Alternar tema"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={resolved}
            initial={{ y: 14, rotate: -90, opacity: 0 }}
            animate={{ y: 0, rotate: 0, opacity: 1 }}
            exit={{ y: -14, rotate: 90, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="flex"
          >
            {dark ? <Moon /> : <Sun />}
          </motion.span>
        </AnimatePresence>
      </Button>
    </Hint>
  );
}

const OPTIONS: { value: Theme; icon: typeof Sun; label: string }[] = [
  { value: "light", icon: Sun, label: "Claro" },
  { value: "dark", icon: Moon, label: "Escuro" },
  { value: "system", icon: Monitor, label: "Sistema" },
];

/** Seletor segmentado claro / escuro / sistema. */
export function ThemeSegmented({ layoutId = "theme-seg" }: { layoutId?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div className="relative grid grid-cols-3 gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Tema">
      {OPTIONS.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          onClick={() => setTheme(value)}
          className={cn(
            "relative z-10 flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors",
            theme === value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {theme === value && (
            <motion.span layoutId={layoutId} className="absolute inset-0 -z-10 rounded-lg bg-background shadow-sm" />
          )}
          <Icon className="h-3.5 w-3.5 shrink-0" /> {label}
        </button>
      ))}
    </div>
  );
}
