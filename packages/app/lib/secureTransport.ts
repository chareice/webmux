import { isBundledOrigin, isTauri } from "./platform";

export interface SecureStatus {
  endpoint: { hub_url: string; public_key: string };
  device_id: string | null;
}
type WireResponse = { type: string; id: string; data?: string; status?: number; body?: string; message?: string };
let enabled = false;
let status: SecureStatus | null = null;
let initialization: Promise<SecureStatus | null> | null = null;
let lastError: string | null = null;
const detail = (error: unknown) => error instanceof Error ? error.message : String(error);
export const isSecureConnection = () => enabled;
export const secureConnectionStatus = () => status;
export const secureConnectionError = () => lastError;
export const isPairingUri = (uri: string) => /^offdesk:\/\/pair(?:\?|\/)/i.test(uri.trim());

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  try { return await invoke<T>(command, args); }
  catch (error) { lastError = detail(error); throw new Error(lastError); }
}
export function restoreSecureConnection(): Promise<SecureStatus | null> {
  if (!isTauri() || !isBundledOrigin()) return Promise.resolve(null);
  return initialization ??= invoke<SecureStatus | null>("secure_status").then((saved) => {
    status = saved;
    enabled = saved !== null;
    return saved;
  }).catch((error) => {
    // A damaged marker or locked credential store must never select ordinary
    // fetch/WebSocket as a fallback. Recovery stays on the bundled screen.
    enabled = true;
    throw error;
  });
}
export async function pairSecureConnection(uri: string): Promise<SecureStatus> {
  if (!isTauri() || !isBundledOrigin()) throw new Error("Pair from the App's own setup screen");
  const paired = await invoke<SecureStatus>("secure_pair", { uri, deviceName: /iPhone|iPad/i.test(navigator.userAgent) ? "iPhone / iPad" : /Android/i.test(navigator.userAgent) ? "Android" : "Desktop" }).catch(async (error: unknown) => {
    initialization = null;
    try { await restoreSecureConnection(); } catch { /* keep recovery closed */ }
    throw error;
  });
  enabled = true;
  status = paired;
  lastError = null;
  initialization = Promise.resolve(paired);
  return paired;
}
export async function forgetSecureConnection(): Promise<void> {
  await invoke("secure_forget");
  localStorage.removeItem("offdesk:token");
  localStorage.removeItem("offdesk:server_url");
  enabled = false;
  status = null;
  lastError = null;
  initialization = Promise.resolve(null);
}
export async function secureFetch(method: string, path: string, body?: string, signal?: AbortSignal): Promise<Response> {
  if (!enabled) throw new Error("No encrypted connection is configured");
  signal?.throwIfAborted();
  // Aborting the UI wait never implies the Hub did not execute a mutation.
  // Request/receipt IDs remain responsible for safe composer retries.
  const pending = invoke<WireResponse>("secure_request", { method, path, body: body ?? null });
  let removeAbort = () => {};
  const abort = new Promise<never>((_, reject) => {
    const handler = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", handler, { once: true });
    removeAbort = () => signal?.removeEventListener("abort", handler);
  });
  try {
    const result = await Promise.race([pending, abort]);
    signal?.throwIfAborted();
    if (result.type !== "http" || !result.status) throw new Error(result.message ?? "Invalid encrypted response");
    return new Response(result.status === 204 || result.status === 304 ? null : result.body ?? "", { status: result.status });
  } finally { removeAbort(); }
}

/** The existing terminal code keeps its WebSocket interface. Encryption and
 * credentials stay in native Rust; IPC channels are private to this caller. */
class SecureSocket extends EventTarget {
  readonly url: string;
  readonly protocol = "";
  readonly extensions = "";
  readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSING = 2; readonly CLOSED = 3;
  readyState = 0;
  binaryType: BinaryType = "blob";
  bufferedAmount = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  private readonly id = crypto.randomUUID();
  private opened: Promise<void>;
  private sends = Promise.resolve();
  constructor(url: string) {
    super(); this.url = url;
    this.opened = this.open(url).catch((error: unknown) => { this.fail(error); });
  }
  private async open(raw: string) {
    const target = new URL(raw);
    const origin = new URL(status?.endpoint.hub_url ?? "invalid:");
    if (target.host !== origin.host || target.protocol !== (origin.protocol === "https:" ? "wss:" : "ws:")) throw new Error("Socket does not belong to the paired Hub");
    target.searchParams.delete("token");
    const { Channel } = await import("@tauri-apps/api/core");
    const events = new Channel<WireResponse>();
    events.onmessage = (message) => this.receive(message);
    await invoke("secure_socket_open", { id: this.id, path: target.pathname + target.search, events });
    if (this.readyState >= 2) await invoke("secure_socket_close", { id: this.id });
  }
  private receive(message: WireResponse) {
    if (message.id !== this.id || this.readyState >= 2) return;
    if (message.type === "opened") {
      this.readyState = 1;
      const event = new Event("open"); this.dispatchEvent(event); this.onopen?.(event);
    } else if (message.type === "text" || message.type === "binary") {
      let data: string | ArrayBuffer | Blob = message.data ?? "";
      if (message.type === "binary") {
        const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
        data = this.binaryType === "arraybuffer" ? bytes.buffer : new Blob([bytes]);
      }
      const event = new MessageEvent("message", { data }); this.dispatchEvent(event); this.onmessage?.(event);
    } else if (message.type === "error") { this.fail(message.message ?? "Encrypted socket failed"); }
    else if (message.type === "closed") { this.finish(1006); }
  }
  private fail(error: unknown) {
    if (this.readyState >= 2) return;
    lastError = detail(error);
    const event = new Event("error"); this.dispatchEvent(event); this.onerror?.(event);
    this.finish(1006);
    void invoke("secure_socket_close", { id: this.id }).catch(() => {});
  }
  private finish(code: number) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    const event = new CloseEvent("close", { code, wasClean: code === 1000 }); this.dispatchEvent(event); this.onclose?.(event);
  }
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (this.readyState !== 1) throw new DOMException("Encrypted socket is not open", "InvalidStateError");
    const size = typeof data === "string" ? new TextEncoder().encode(data).byteLength : data instanceof Blob ? data.size : data.byteLength;
    if (this.bufferedAmount + size > 32 * 1024 * 1024) { this.fail("Encrypted input queue is full"); return; }
    this.bufferedAmount += size;
    // Preserve order across asynchronous Blob conversion / IPC. In particular
    // bracketed paste must reach the Hub before its following Enter frame.
    this.sends = this.sends.then(async () => {
      try {
        if (this.readyState !== 1) return;
        let payload: string;
        if (typeof data === "string") payload = data;
        else {
          const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
          let chars = "";
          for (let i = 0; i < bytes.length; i += 8192) chars += String.fromCharCode(...bytes.subarray(i, i + 8192));
          payload = btoa(chars);
        }
        await invoke("secure_socket_send", { id: this.id, data: payload, binary: typeof data !== "string" });
      } finally { this.bufferedAmount -= size; }
    }).catch((error: unknown) => this.fail(error));
  }
  close() {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    void this.opened.then(() => invoke("secure_socket_close", { id: this.id })).catch(() => {}).finally(() => this.finish(1000));
  }
}
export function openSocket(url: string): WebSocket {
  return enabled ? new SecureSocket(url) as unknown as WebSocket : new WebSocket(url);
}
