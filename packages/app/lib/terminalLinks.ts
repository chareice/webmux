export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Which sink actually accepted the URL. `null` means nothing did. */
export type ExternalUrlOpenChannel = "opener" | "shell" | "window";

export interface ExternalUrlOpenOutcome {
  url: string;
  channel: ExternalUrlOpenChannel | null;
  /** One entry per failed attempt, in the order they were tried. */
  errors: string[];
}

// A Tauri `invoke` that never settles would swallow the tap silently, so each
// attempt gets a deadline and is treated as failed past it.
const ATTEMPT_TIMEOUT_MS = 2500;

function describeError(err: unknown): string {
  if (err == null) return "unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || err.name;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Runs one attempt; resolves to null on success or a message on failure. */
async function attempt(
  label: string,
  run: (url: string) => Promise<unknown>,
  url: string,
  timeoutMs: number,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      // Called inside the try so a synchronous throw (plugin missing in an old
      // installed shell) is caught here too.
      Promise.resolve(run(url)),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no response in ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    return null;
  } catch (err) {
    return `${label}: ${describeError(err)}`;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createExternalUrlOpener(deps: {
  isTauri: () => boolean;
  tauriOpenUrl: (url: string) => Promise<unknown>;
  tauriShellOpen: (url: string) => Promise<unknown>;
  windowOpen: (url: string) => void;
  // False where `window.open` is known to be inert — an Android WebView
  // without multi-window support swallows it without opening anything.
  canTrustWindowOpen?: () => boolean;
  onOutcome?: (outcome: ExternalUrlOpenOutcome) => void;
  timeoutMs?: number;
}): (url: string) => void {
  const timeoutMs = deps.timeoutMs ?? ATTEMPT_TIMEOUT_MS;

  const report = (outcome: ExternalUrlOpenOutcome): void => {
    try {
      deps.onOutcome?.(outcome);
    } catch {
      // A broken reporter must never break link opening.
    }
  };

  // `window.open` gives no usable success signal: with `noopener` the spec
  // mandates a null return even when the popup opened, and an Android WebView
  // without multi-window support returns null while doing nothing at all.
  // So trust it in a plain browser (where it is the normal path) and treat it
  // as a failed last resort inside a Tauri shell (where reaching it already
  // means both native openers are broken).
  const openViaWindow = (
    url: string,
    errors: string[],
    trusted: boolean,
  ): void => {
    try {
      deps.windowOpen(url);
    } catch (err) {
      report({
        url,
        channel: null,
        errors: [...errors, `window.open: ${describeError(err)}`],
      });
      return;
    }
    if (trusted) {
      report({ url, channel: "window", errors });
      return;
    }
    report({
      url,
      channel: null,
      errors: [...errors, "window.open: no native opener available"],
    });
  };

  return (url) => {
    if (!isSafeExternalUrl(url)) return;
    if (!deps.isTauri()) {
      openViaWindow(url, [], deps.canTrustWindowOpen?.() ?? true);
      return;
    }
    // The UI is served remotely by the hub, so new JS can run inside old
    // installed Tauri shells that do not have the opener plugin registered
    // (the dynamic import / invoke can throw, reject, or hang).
    void (async () => {
      const errors: string[] = [];

      const openerError = await attempt(
        "opener",
        deps.tauriOpenUrl,
        url,
        timeoutMs,
      );
      if (!openerError) {
        report({ url, channel: "opener", errors });
        return;
      }
      errors.push(openerError);

      const shellError = await attempt(
        "shell",
        deps.tauriShellOpen,
        url,
        timeoutMs,
      );
      if (!shellError) {
        report({ url, channel: "shell", errors });
        return;
      }
      errors.push(shellError);

      openViaWindow(url, errors, false);
    })();
  };
}
