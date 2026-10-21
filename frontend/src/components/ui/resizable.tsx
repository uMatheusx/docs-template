import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/lib/utils";

const ResizablePanelGroup = ({ className, ...props }: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
  <ResizablePrimitive.PanelGroup
    className={cn("flex h-full w-full data-[panel-group-direction=vertical]:flex-col", className)}
    {...props}
  />
);

const ResizablePanel = ResizablePrimitive.Panel;

const ResizableHandle = ({ className, ...props }: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle>) => (
  <ResizablePrimitive.PanelResizeHandle
    className={cn(
      "group relative flex w-px items-center justify-center bg-border transition-colors after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 hover:bg-brand/60 data-[resize-handle-state=drag]:bg-brand",
      className,
    )}
    {...props}
  >
    <span className="z-10 h-8 w-1 rounded-full bg-border opacity-0 transition-opacity group-hover:bg-brand group-hover:opacity-100" />
  </ResizablePrimitive.PanelResizeHandle>
);

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
