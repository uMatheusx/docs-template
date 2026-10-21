import { Check, Copy } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";

export function CopyButton({ text, className, label = "Copiar" }: { text: string; className?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Hint label={copied ? "Copiado!" : label}>
      <Button
        variant="ghost"
        size="icon-sm"
        className={className}
        aria-label={label}
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={String(copied)}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex"
          >
            {copied ? <Check className="text-emerald-400" /> : <Copy />}
          </motion.span>
        </AnimatePresence>
      </Button>
    </Hint>
  );
}
