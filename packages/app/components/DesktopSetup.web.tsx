// The desktop app's first run, and the machine that stays on.
//
// One question — is this the machine that stays on? — and two answers. "Yes"
// runs the bundled hub install and lands on the code the phone scans; "no"
// is the client the app has always been. The Tauri side is role.rs; the
// typed calls are lib/desktopHub.ts. Design: docs/design/desktop-hub/.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import * as QRCode from "qrcode";

import { useAuth } from "@/lib/auth";
import { colors } from "@/lib/colors";
import {
  baseUrlFor,
  desktopRole,
  hubInstall,
  hubIsReady,
  hubLink,
  hubStatus,
  hubUninstall,
  portOf,
  setDesktopRole,
  tokenFromLink,
  type DesktopRole,
  type HubLink,
  type HubStatus,
} from "@/lib/desktopHub";
import { setServerUrl } from "@/lib/serverUrl";
import LoginScreen from "../app/login";
import { Body, Button, Card, Check, Display, Donut, Eyebrow, Spinner, fontDisplay } from "./Warm.web";

const IPHONE_URL = "https://offdesk.dev/#phone";
const ANDROID_URL = "https://offdesk.dev/apk";

async function openOutside(url: string) {
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

async function copyText(text: string) {
  try {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

// ── The gate ──────────────────────────────────────────────────────

/**
 * Wraps the desktop app's whole tree. Decides, from the stored role and the
 * hub's state on this machine, whether to show the first-run question, the
 * install, the code for the phone, the sign-in, or the app itself.
 */
export function DesktopGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, login, loginWithToken } = useAuth();
  // undefined: not read yet. null: never answered.
  const [role, setRole] = useState<DesktopRole | null | undefined>(undefined);
  const [status, setStatus] = useState<HubStatus | null>(null);
  const [link, setLink] = useState<HubLink | null>(null);

  useEffect(() => {
    // A bridge that does not know the command (an older shell, or a test's
    // stub) answers with nothing: that is "never answered", not "loading".
    desktopRole()
      .then((stored) => setRole(stored ?? null))
      .catch(() => setRole(null));
  }, []);

  useEffect(() => {
    if (role !== "hub") return;
    let cancelled = false;
    hubStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({ supported: false, bundled: false, hub_installed: false, node_installed: false, listening: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [role]);

  const pick = useCallback(async (picked: DesktopRole) => {
    await setDesktopRole(picked);
    setStatus(null);
    setRole(picked);
  }, []);

  // Into the terminal: this app is now a client of the hub it just made,
  // signed in with the owner's own link. An OAuth hub has no link; the
  // browser sign-in the client path uses works for it.
  const openTerminal = useCallback(
    async (current: HubLink) => {
      const token = tokenFromLink(current.link);
      if (token) {
        await loginWithToken(current.url, token);
        return;
      }
      setServerUrl(current.url);
      await login();
    },
    [login, loginWithToken],
  );

  if (role === undefined) return <Spinner />;
  if (role === null) return <FirstRun onPick={pick} />;

  if (role === "hub") {
    if (!status) return <Spinner />;
    if (!hubIsReady(status)) {
      return (
        <HubSetup
          status={status}
          onReady={(ready) => {
            setLink(ready);
            setStatus({ ...status, hub_installed: true, node_installed: true, listening: true });
          }}
          onGiveUp={() => void pick("client")}
        />
      );
    }
    if (isLoading) return <Spinner />;
    if (!isAuthenticated) {
      return <HubReadyScreen initial={link} onOpen={openTerminal} />;
    }
    return <>{children}</>;
  }

  if (isLoading) return <Spinner />;
  if (!isAuthenticated) return <LoginScreen onBecomeHub={() => void pick("hub")} />;
  return <>{children}</>;
}

// ── First run ─────────────────────────────────────────────────────

function FirstRun({ onPick }: { onPick: (role: DesktopRole) => Promise<void> }) {
  const [busy, setBusy] = useState<DesktopRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const choose = (role: DesktopRole) => {
    setBusy(role);
    setError(null);
    onPick(role).catch((e: unknown) => {
      setError(String(e));
      setBusy(null);
    });
  };
  return (
    <Screen>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
        <Eyebrow>First run</Eyebrow>
        <Display size={42}>Which machine is this?</Display>
        <Body size={17} style={{ color: colors.fg1, maxWidth: 560 }}>
          Same app either way. The only question is whether this is the machine that stays on.
        </Body>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 28, width: "100%", maxWidth: 880 }}>
        <RoleCard
          accent={colors.accent}
          icon={<ServerIcon />}
          title="The one that stays on"
          body="A Mac on the desk, a Mini in the closet. It becomes your hub: the one address your phone and every other machine talk to. Starts at login, restarts if it stops."
          note="Installs the hub, the node and tmux here. No account, no cloud."
          action={
            <Button onClick={() => choose("hub")} disabled={busy !== null} testId="first-run-hub">
              <Check color={colors.onAccent} /> {busy === "hub" ? "One moment…" : "Set this machine up"}
            </Button>
          }
        />
        <RoleCard
          accent={colors.info}
          icon={<LaptopIcon />}
          title="Just connecting"
          body="You already have a hub somewhere else. Open its terminals from this machine, the way the phone does."
          note="Paste the link the hub printed, or sign in."
          action={
            <Button kind="sky" onClick={() => choose("client")} disabled={busy !== null} testId="first-run-client">
              <LinkIcon /> Connect to a hub
            </Button>
          }
        />
      </div>
      {error ? <Body style={{ color: colors.err }}>{error}</Body> : null}
      <div style={{ fontFamily: fontDisplay, fontSize: 14, fontWeight: 600, color: colors.fg2 }}>
        You can change this later in Settings.
      </div>
    </Screen>
  );
}

function RoleCard({
  accent,
  icon,
  title,
  body,
  note,
  action,
}: {
  accent: string;
  icon: ReactNode;
  title: string;
  body: string;
  note: string;
  action: ReactNode;
}) {
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 18, padding: 32 }}>
      <Donut color={accent} size={56}>
        {icon}
      </Donut>
      <Display size={26}>{title}</Display>
      <Body size={16} style={{ flexGrow: 1 }}>
        {body}
      </Body>
      {action}
      <div style={{ fontFamily: fontDisplay, fontSize: 13, fontWeight: 600, color: colors.fg3 }}>{note}</div>
    </Card>
  );
}

// ── Becoming the hub ──────────────────────────────────────────────

function HubSetup({
  status,
  onReady,
  onGiveUp,
}: {
  status: HubStatus;
  onReady: (link: HubLink) => void;
  onGiveUp: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!status.supported) {
      setError("The hub runs on macOS and Linux. On this machine the app is a client.");
      return;
    }
    let cancelled = false;
    setError(null);
    hubInstall()
      .then((link) => {
        if (!cancelled) onReady(link);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, status.supported]);

  return (
    <Screen>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
        <Eyebrow>This machine is your hub</Eyebrow>
        <Display size={38}>{error ? "That did not go through." : "Setting it up…"}</Display>
      </div>
      <Card style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: 16 }}>
        <SetupStep done={false} pending={!error} title="Hub is running" sub="Starts at login and restarts if it stops." />
        <SetupStep done={false} pending={!error} title="This machine is registered" sub="Its node runs as a service too, so the first terminal you open is a shell right here." />
        <SetupStep done={false} pending={!error} title="tmux is ready" sub={status.bundled ? "Bundled with the app." : "From this machine's PATH."} />
      </Card>
      {error ? (
        <>
          <Body style={{ color: colors.err, maxWidth: 560, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 13 }}>{error}</Body>
          <div style={{ display: "flex", gap: 12 }}>
            {status.supported ? (
              <Button onClick={() => setAttempt((n) => n + 1)} testId="hub-setup-retry">
                Try again
              </Button>
            ) : null}
            <Button kind="sky" onClick={onGiveUp}>
              Just connect to a hub instead
            </Button>
          </div>
        </>
      ) : (
        <Body size={14} style={{ textAlign: "center" }}>
          macOS may ask whether offdesk can accept incoming connections. It can; that is your phone.
        </Body>
      )}
    </Screen>
  );
}

function SetupStep({ done, pending, title, sub }: { done: boolean; pending: boolean; title: string; sub: string }) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 30,
          height: 30,
          borderRadius: "50%",
          background: done ? colors.ok : colors.bg3,
          flexShrink: 0,
          opacity: pending && !done ? 0.6 : 1,
        }}
      >
        {done ? <Check color={colors.onAccent} /> : null}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontFamily: fontDisplay, fontSize: 17, fontWeight: 600, color: colors.fg0 }}>{title}</div>
        <Body size={14}>{sub}</Body>
      </div>
    </div>
  );
}

// ── Hub ready: the code for the phone ─────────────────────────────

function HubReadyScreen({ initial, onOpen }: { initial: HubLink | null; onOpen: (link: HubLink) => Promise<void> }) {
  const [link, setLink] = useState<HubLink | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (link) return;
    hubLink()
      .then(setLink)
      .catch((e: unknown) => setError(String(e)));
  }, [link]);

  return (
    <Screen wide>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 40, width: "100%", maxWidth: 1000, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Eyebrow>This machine is your hub</Eyebrow>
            <Display size={38}>Running. Now get your phone in.</Display>
          </div>
          <Card style={{ display: "flex", flexDirection: "column", gap: 16, padding: 24 }}>
            <SetupStep done pending={false} title="Hub is running" sub="Starts at login and restarts if it stops." />
            <SetupStep done pending={false} title="This machine is registered" sub="Its node runs as a service too, so the first terminal you open is a shell right here." />
            <SetupStep done pending={false} title="tmux is ready" sub="Your sessions outlive the app, the network, and you walking away." />
          </Card>
          {error ? <Body style={{ color: colors.err }}>{error}</Body> : null}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Button
              disabled={!link || opening}
              testId="hub-ready-open"
              onClick={() => {
                if (!link) return;
                setOpening(true);
                onOpen(link).catch((e: unknown) => {
                  setError(String(e));
                  setOpening(false);
                });
              }}
            >
              <TerminalIcon /> {opening ? "Opening…" : "Open my terminal"}
            </Button>
          </div>
        </div>
        <PhoneCodePanel link={link} onLink={setLink} onError={setError} />
      </div>
    </Screen>
  );
}

/**
 * The code, the address picker, the link, and where to get the app. Also
 * the body of Settings → This machine, so it takes the link it is given
 * and asks for another when an address is picked.
 */
export function PhoneCodePanel({
  link,
  onLink,
  onError,
  compact = false,
}: {
  link: HubLink | null;
  onLink: (link: HubLink) => void;
  onError?: (message: string) => void;
  compact?: boolean;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);

  const encoded = link?.short ?? link?.link ?? link?.url ?? "";
  useEffect(() => {
    let cancelled = false;
    if (!encoded) {
      setQr(null);
      return;
    }
    QRCode.toString(encoded, {
      type: "svg",
      margin: 0,
      errorCorrectionLevel: "M",
      // Hex only — the encoder rejects CSS variables. Ink on cream reads
      // fine through a camera and matches the page.
      color: { dark: "#2b2340", light: "#fffbf4" },
    })
      .then((svg) => {
        if (!cancelled) setQr(svg);
      })
      .catch(() => {
        if (!cancelled) setQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [encoded]);

  const port = useMemo(() => (link ? portOf(link.url) : "4317"), [link]);
  const currentAddress = useMemo(() => {
    try {
      return link ? new URL(link.url).hostname : "";
    } catch {
      return "";
    }
  }, [link]);

  const pickAddress = (address: string) => {
    if (!address || address === currentAddress) return;
    setPicking(true);
    hubLink(baseUrlFor(address, port))
      .then((next) => {
        onLink(next);
      })
      .catch((e: unknown) => onError?.(String(e)))
      .finally(() => setPicking(false));
  };

  const copy = () => {
    const text = link?.link ?? link?.url;
    if (!text) return;
    void copyText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const candidates = link?.candidates ?? [];
  const listed = candidates.some((c) => c.address === currentAddress)
    ? candidates
    : currentAddress
      ? [{ interface: "chosen", address: currentAddress }, ...candidates]
      : candidates;

  // On Hub ready this is the sticker card beside the steps; inside a dialog
  // or a Settings section it sits flat, the surface around it is the card.
  const body = (
    <>
      {!compact ? <Display size={22} style={{ textAlign: "center" }}>Scan this with your phone</Display> : null}
      <div
        style={{
          width: compact ? 168 : 212,
          height: compact ? 168 : 212,
          padding: 12,
          borderRadius: 18,
          background: "#fffbf4",
          border: `1px solid ${colors.lineSoft}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: picking ? 0.5 : 1,
        }}
        dangerouslySetInnerHTML={qr ? { __html: qr } : undefined}
      >
        {qr ? undefined : <span style={{ fontSize: 12, color: colors.fg3 }}>{link ? "…" : "waiting for the hub"}</span>}
      </div>
      <Body size={14} style={{ textAlign: "center", maxWidth: 340 }}>
        The phone's camera is enough. It opens the offdesk app if you have it, and signs you in. No app yet? The browser is the whole client.
      </Body>

      <label style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontFamily: fontDisplay, fontSize: 13, fontWeight: 600, color: colors.fg2 }}>Your phone can reach it at</span>
        <select
          value={currentAddress}
          onChange={(event) => pickAddress(event.target.value)}
          disabled={!link || picking}
          data-testid="hub-address-picker"
          style={{
            height: 44,
            padding: "0 12px",
            borderRadius: 12,
            border: `1.5px solid ${colors.line}`,
            background: colors.bg0,
            color: colors.fg0,
            fontFamily: "var(--font-mono)",
            fontSize: 13,
          }}
        >
          {listed.map((c) => (
            <option key={c.address} value={c.address}>
              http://{c.address}:{port} · {c.interface}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 12.5, color: colors.fg2 }}>A VPN or a proxy in TUN mode can put the wrong one first.</span>
      </label>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <Button kind="sky" onClick={() => void openOutside(IPHONE_URL)}>
          <PhoneIcon /> iPhone app
        </Button>
        <Button kind="sky" onClick={() => void openOutside(ANDROID_URL)}>
          <PhoneIcon /> Android app
        </Button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "8px 8px 8px 12px",
          borderRadius: 12,
          background: colors.bg0,
          border: `1px solid ${colors.lineSoft}`,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: colors.fg2,
            flexGrow: 1,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {link?.link ? link.link.replace(/token=.{6}.*$/, "token=…") : link?.url ?? "…"}
        </span>
        <Button onClick={copy} disabled={!link} style={{ height: 32, padding: "0 14px", fontSize: 12, boxShadow: "none" }} testId="hub-copy-link">
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      {link ? (
        <div style={{ fontFamily: fontDisplay, fontSize: 12.5, fontWeight: 600, color: colors.fg3, textAlign: "center" }}>
          {link.link
            ? "The link signs in whoever has it. Keep it off shared screens."
            : "This hub signs in through GitHub or Google, so the code is just the address."}
        </div>
      ) : null}
    </>
  );
  const column = { display: "flex", flexDirection: "column", alignItems: "center", gap: 16 } as const;
  if (compact) return <div style={column}>{body}</div>;
  return (
    <Card sticker style={{ ...column, padding: 28 }}>
      {body}
    </Card>
  );
}

/** The hub's own code, fetched here: for Settings and the Phone dialog. */
export function HubPhoneCode() {
  const [link, setLink] = useState<HubLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (link) return;
    hubLink()
      .then(setLink)
      .catch((e: unknown) => setError(String(e)));
  }, [link]);
  return (
    <div style={{ maxWidth: 440 }}>
      {error ? <Body size={12} style={{ color: colors.err, marginBottom: 8 }}>{error}</Body> : null}
      <PhoneCodePanel link={link} onLink={setLink} onError={setError} compact />
    </div>
  );
}

// ── Settings → This machine ───────────────────────────────────────

/** The desktop app's role, and the hub's state when it is the hub. */
export function ThisMachineSection() {
  const [role, setRole] = useState<DesktopRole | null | undefined>(undefined);
  const [status, setStatus] = useState<HubStatus | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    desktopRole().then(setRole).catch(() => setRole(null));
  }, []);
  useEffect(() => {
    if (role !== "hub") return;
    hubStatus().then(setStatus).catch(() => setStatus(null));
  }, [role]);

  const becomeHub = async () => {
    setBusy(true);
    setError(null);
    try {
      await setDesktopRole("hub");
      window.location.reload();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const stopBeingHub = async () => {
    setBusy(true);
    setError(null);
    try {
      await hubUninstall();
      await setDesktopRole("client");
      window.location.reload();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const row = (label: string, ok: boolean | null) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: colors.fg1 }}>
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: ok ? colors.ok : "transparent",
          border: ok ? "none" : `2px dashed ${colors.fg3}`,
          flexShrink: 0,
        }}
      />
      {label}
    </div>
  );

  if (role === undefined) return null;

  if (role !== "hub") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Body size={13}>This app is a client: it opens terminals on a hub somewhere else.</Body>
        <div>
          <Button kind="sky" onClick={() => void becomeHub()} disabled={busy} style={{ height: 36, fontSize: 13 }}>
            Make this machine the hub instead
          </Button>
        </div>
        {error ? <Body size={12} style={{ color: colors.err }}>{error}</Body> : null}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {row("Hub service installed", status?.hub_installed ?? null)}
        {row("Node service installed", status?.node_installed ?? null)}
        {row("Answering on this machine", status?.listening ?? null)}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button kind="sky" onClick={() => setShowCode((v) => !v)} style={{ height: 36, fontSize: 13 }} testId="settings-show-phone-code">
          {showCode ? "Hide the phone code" : "Show the phone code"}
        </Button>
        {confirmStop ? (
          <>
            <Button onClick={() => void stopBeingHub()} disabled={busy} style={{ height: 36, fontSize: 13 }}>
              {busy ? "Stopping…" : "Yes, remove both services"}
            </Button>
            <Button kind="ghost" onClick={() => setConfirmStop(false)} style={{ height: 36, fontSize: 13 }}>
              Keep it
            </Button>
          </>
        ) : (
          <Button kind="ghost" onClick={() => setConfirmStop(true)} style={{ height: 36, fontSize: 13 }}>
            Stop being the hub
          </Button>
        )}
      </div>
      {confirmStop ? (
        <Body size={12}>The database and your tmux sessions stay. Only the two services go.</Body>
      ) : null}
      {error ? <Body size={12} style={{ color: colors.err }}>{error}</Body> : null}
      {showCode ? <HubPhoneCode /> : null}
    </div>
  );
}

// ── Bits ──────────────────────────────────────────────────────────

function Screen({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  // The outer box scrolls; the inner one is centred with auto margins, which
  // — unlike justify-content: center — keeps the top reachable when the
  // window is shorter than the content.
  return (
    <div
      style={{
        flex: 1,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: colors.bg0,
        color: colors.fg0,
        boxSizing: "border-box",
        overflow: "auto",
      }}
    >
      <div
        style={{
          margin: "auto",
          width: "100%",
          maxWidth: wide ? 1100 : 980,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 28,
          padding: wide ? "36px 48px" : "36px 56px",
          boxSizing: "border-box",
        }}
      >
        {children}
      </div>
    </div>
  );
}

const icon = (paths: string, size = 22) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: paths }} />
);
const ServerIcon = () => icon('<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>');
const LaptopIcon = () => icon('<rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M2 20h20"/>');
const LinkIcon = () => icon('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', 18);
const PhoneIcon = () => icon('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>', 18);
const TerminalIcon = () => icon('<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>', 18);
