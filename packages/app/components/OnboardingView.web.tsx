import { useState, useEffect, useRef, useCallback } from "react";
import { createRegistrationToken } from "@/lib/api";
import {
  buildOnboardingScript,
  getInstallCommand,
  getRegisterCommand,
  getServiceInstallCommand,
} from "@/lib/nodeInstaller";
import {
  getTokenActionLabel,
  shouldGenerateRegistrationToken,
} from "@/lib/onboardingFlow";
import { isRegistrationTokenFresh } from "@/lib/tokenExpiry";
import { colors } from "@/lib/colors";

function getHubUrl(): string {
  const { protocol, host } = window.location;
  const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${host}/ws/machine`;
}

function buildFullScript(token: string): string {
  const hubUrl = getHubUrl();
  return buildOnboardingScript(hubUrl, token);
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

function CodeBlock({
  label,
  code,
}: {
  label: string;
  code: string;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: colors.foregroundSecondary,
          textTransform: "uppercase" as const,
          letterSpacing: 1,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          backgroundColor: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 6,
          padding: "12px 14px",
          overflowX: "auto" as const,
        }}
      >
        <pre
          style={{
            margin: 0,
            fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', 'Menlo', monospace",
            fontSize: 13,
            lineHeight: 1.6,
            color: colors.foreground,
            whiteSpace: "pre-wrap" as const,
            wordBreak: "break-all" as const,
          }}
        >
          {code}
        </pre>
      </div>
    </div>
  );
}

export function OnboardingView() {
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [requested, setRequested] = useState(false);
  const cachedRef = useRef<CachedToken | null>(null);

  const generateToken = useCallback(async () => {
    // Reuse cached token if still valid (with 60s buffer)
    const cached = cachedRef.current;
    if (cached && isRegistrationTokenFresh(cached.expiresAt)) {
      setToken(cached.token);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await createRegistrationToken("node");
      cachedRef.current = { token: data.token, expiresAt: data.expires_at };
      setToken(data.token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loading || error) {
      return;
    }
    const cached = cachedRef.current;
    if (
      !shouldGenerateRegistrationToken({
        requested,
        token,
        expiresAt: cached?.expiresAt ?? null,
      })
    ) {
      return;
    }
    void generateToken();
  }, [error, generateToken, loading, requested, token]);

  const handleCopy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(buildFullScript(token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  const handleRegenerate = () => {
    setRequested(true);
    cachedRef.current = null;
    setToken(null);
    setCopied(false);
  };

  const handleGenerateClick = () => {
    setRequested(true);
    setError(null);
    setCopied(false);
  };

  const hubUrl = getHubUrl();
  const installCmd = getInstallCommand();
  const registerCmd = token ? getRegisterCommand(hubUrl, token) : "";
  const serviceCmd = getServiceInstallCommand();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        padding: 32,
        background: colors.background,
      }}
    >
      <div style={{ maxWidth: 600, width: "100%" }}>
        {/* Header */}
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: colors.foreground,
            margin: "0 0 8px 0",
          }}
        >
          Connect a machine
        </h1>
        <p
          style={{
            fontSize: 14,
            color: colors.foregroundSecondary,
            margin: "0 0 28px 0",
            lineHeight: 1.5,
          }}
        >
          Install webmux-node on the machine you want to manage,
          then register it with the commands below.
        </p>

        {!requested && !loading && !error && !token ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              padding: 24,
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              background: colors.surface,
            }}
          >
            <p
              style={{
                margin: 0,
                color: colors.foregroundSecondary,
                lineHeight: 1.6,
                fontSize: 14,
              }}
            >
              Generate a fresh registration token only when you are ready to copy the install script to a machine.
            </p>
            <button
              onClick={handleGenerateClick}
              style={{
                width: "fit-content",
                backgroundColor: colors.accent,
                border: "none",
                borderRadius: 999,
                color: colors.background,
                padding: "10px 18px",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {getTokenActionLabel({ loading, token })}
            </button>
          </div>
        ) : loading ? (
          <div
            style={{
              textAlign: "center" as const,
              padding: "32px 0",
              color: colors.foregroundSecondary,
              fontSize: 14,
            }}
          >
            Generating registration token…
          </div>
        ) : error ? (
          <div>
            <div
              style={{
                color: colors.danger,
                fontSize: 14,
                marginBottom: 16,
              }}
            >
              {error}
            </div>
            <button
              onClick={handleGenerateClick}
              style={{
                backgroundColor: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                color: colors.foreground,
                padding: "8px 16px",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        ) : token ? (
          <div>
            {/* Step 1: Install */}
            <CodeBlock
              label="1. Install webmux-node"
              code={installCmd}
            />

            {/* Step 2: Register */}
            <CodeBlock
              label="2. Register with this hub"
              code={registerCmd}
            />

            {/* Step 3: Start service */}
            <CodeBlock
              label="3. Start the service"
              code={serviceCmd}
            />

            {/* Action buttons */}
            <div
              style={{
                display: "flex",
                gap: 10,
                marginBottom: 24,
              }}
            >
              <button
                onClick={() => void handleCopy()}
                style={{
                  backgroundColor: colors.accent,
                  border: "none",
                  borderRadius: 6,
                  color: colors.background,
                  padding: "8px 20px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {copied ? "Copied!" : "Copy all commands"}
              </button>
              <button
                onClick={handleRegenerate}
                style={{
                  backgroundColor: "transparent",
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  color: colors.foregroundSecondary,
                  padding: "8px 16px",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {getTokenActionLabel({ loading, token })}
              </button>
            </div>

            {/* Footer note */}
            <p
              style={{
                fontSize: 12,
                color: colors.foregroundMuted,
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              Once the machine connects, this page will update automatically.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
