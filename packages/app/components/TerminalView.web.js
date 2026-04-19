import { forwardRef, lazy, Suspense } from "react";
const renderer = typeof window !== "undefined"
    ? localStorage.getItem("webmux:renderer") || "xterm"
    : "xterm";
const LazyImpl = lazy(() => (renderer === "wterm"
    ? import("./TerminalView.wterm")
    : import("./TerminalView.xterm")).then((m) => ({ default: m.TerminalView })));
export const TerminalView = forwardRef(function TerminalView(props, ref) {
    return (<Suspense fallback={null}>
        <LazyImpl ref={ref} {...props}/>
      </Suspense>);
});
