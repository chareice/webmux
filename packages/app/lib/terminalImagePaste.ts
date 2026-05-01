// Helpers for forwarding image/file uploads to a terminal session via the
// `image_paste` WS protocol. Pure utilities so they can be unit-tested
// without spinning up xterm or a WebSocket.

// Keep filenames in basename-shape (no path traversal) and stripped of
// control bytes. Falls back to a synthetic `tc-paste-<ts><ext>` name.
export function safeFilename(name: string, fallbackExt = ""): string {
  const base = (name || "").split(/[/\\]/).pop() || "";
  const stripped = base.replace(/^\.+/, "").replace(/[\x00-\x1f]/g, "");
  if (stripped) return stripped;
  return `tc-paste-${Date.now()}${fallbackExt}`;
}

// Read a Blob as base64 plus the resolved MIME type. Uses Blob.arrayBuffer
// rather than FileReader so the helper is testable under plain Node.
export async function readFileAsBase64(
  file: Blob,
): Promise<{ base64: string; mime: string }> {
  const buffer = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  return { base64, mime: file.type || "application/octet-stream" };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Chunk to stay clear of String.fromCharCode argument limits on large
  // payloads (Safari trips around ~100 KB if we feed bytes in one shot).
  // btoa is available in browsers and Node 16+, no fallback needed.
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

// 25 MB cap mirrors the dragdrop guard in TerminalView.xterm.tsx — WS
// frames larger than this regularly choke the browser and the hub
// forwarder.
export const MAX_IMAGE_PASTE_BYTES = 25 * 1024 * 1024;

export interface ImagePasteMessage {
  type: "image_paste";
  data: string;
  mime: string;
  filename: string;
}

export function buildImagePasteMessage(
  base64: string,
  mime: string,
  filename: string,
): ImagePasteMessage {
  return { type: "image_paste", data: base64, mime, filename };
}
