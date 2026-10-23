import { createElement } from "react";

import { getPageIcon } from "@/lib/content/icons";

export function PageIcon({ name, className }: { name?: string | null; className?: string }) {
  return createElement(getPageIcon(name), { className });
}
