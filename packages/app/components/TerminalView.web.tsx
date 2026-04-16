import { forwardRef, lazy, Suspense } from "react";
import type { TerminalViewRef, TerminalViewProps } from "./TerminalView.types";

const renderer =
  typeof window !== "undefined"
    ? localStorage.getItem("webmux:renderer") || "xterm"
    : "xterm";

const LazyImpl = lazy(() =>
  (renderer === "wterm"
    ? import("./TerminalView.wterm")
    : import("./TerminalView.xterm")
  ).then((m) => ({ default: m.TerminalView })),
);

export type { TerminalViewRef, TerminalViewProps };

export const TerminalView = forwardRef<TerminalViewRef, TerminalViewProps>(
  function TerminalView(props, ref) {
    return (
      <Suspense fallback={null}>
        <LazyImpl ref={ref} {...props} />
      </Suspense>
    );
  },
);
