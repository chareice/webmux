import { useEffect, useState } from "react";

import type { NativeZellijBootstrapResponse } from "@webmux/shared";
import { LoaderCircle } from "lucide-react";

import { getNativeZellijBootstrap } from "@/lib/api";
import { colors } from "@/lib/colors";
import {
  getNativeZellijUnavailableCopy,
  isNativeZellijReady,
} from "@/lib/nativeZellij";

interface NativeZellijPageProps {
  machineId: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; payload: NativeZellijBootstrapResponse };

export function NativeZellijPage({ machineId }: NativeZellijPageProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });

    getNativeZellijBootstrap(machineId)
      .then((payload) => {
        if (!cancelled) {
          setState({ kind: "loaded", payload });
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: error.message || "Failed to load Native Zellij.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [machineId]);

  return (
    <div
      style={{
        height: "100dvh",
        background: "#000",
        color: colors.fg0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ flex: 1, minHeight: 0 }}>
        {state.kind === "loading" && <CenteredState title="Opening Native Zellij…" />}
        {state.kind === "error" && (
          <MessageCard
            title="Native Zellij unavailable"
            detail={state.message}
            instructions={null}
          />
        )}
        {state.kind === "loaded" && renderLoadedState(state.payload)}
      </div>
    </div>
  );
}

function renderLoadedState(payload: NativeZellijBootstrapResponse) {
  if (isNativeZellijReady(payload.status) && payload.proxy_url) {
    return (
      <iframe
        data-testid="native-zellij-frame"
        src={payload.proxy_url}
        title="Native Zellij"
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          background: "#000",
        }}
      />
    );
  }

  if (payload.status.status === "unavailable") {
    const copy = getNativeZellijUnavailableCopy(payload.status);
    return (
      <MessageCard
        title={copy.title}
        detail={copy.detail}
        instructions={payload.status.instructions}
      />
    );
  }

  return (
    <MessageCard
      title="Native Zellij unavailable"
      detail="The machine reported a ready session but did not return a browser URL."
      instructions={null}
    />
  );
}

function CenteredState({ title }: { title: string }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          color: colors.fg2,
          fontSize: 14,
        }}
      >
        <LoaderCircle size={16} />
        {title}
      </div>
    </div>
  );
}

function MessageCard({
  title,
  detail,
  instructions,
}: {
  title: string;
  detail: string;
  instructions: string | null;
}) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "min(640px, 100%)",
          borderRadius: 18,
          border: `1px solid ${colors.line}`,
          background: "rgba(14, 16, 15, 0.88)",
          boxShadow: "0 24px 80px rgba(0, 0, 0, 0.32)",
          padding: 24,
        }}
      >
        <div
          style={{
            fontSize: 12,
            color: colors.accent,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 10,
          }}
        >
          Native Zellij
        </div>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.15 }}>{title}</h1>
        <p
          style={{
            margin: "12px 0 0",
            color: colors.fg2,
            fontSize: 15,
            lineHeight: 1.55,
          }}
        >
          {detail}
        </p>
        {instructions && (
          <pre
            style={{
              margin: "18px 0 0",
              padding: 14,
              borderRadius: 12,
              border: `1px solid ${colors.lineSoft}`,
              background: colors.bg0,
              color: colors.fg2,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              whiteSpace: "pre-wrap",
            }}
          >
            {instructions}
          </pre>
        )}
      </div>
    </div>
  );
}
