export const IMAGE_PASTE_DEDUPE_MS = 2_000;

export interface ImagePasteDedupeRecord {
  signature: string;
  sentAt: number;
}

interface ImagePastePayload {
  data: string;
  mime: string;
}

export function shouldSendClipboardImagePaste(
  recent: ImagePasteDedupeRecord | null,
  payload: ImagePastePayload,
  now = Date.now(),
  windowMs = IMAGE_PASTE_DEDUPE_MS,
): { send: boolean; recent: ImagePasteDedupeRecord } {
  const signature = `${payload.mime}\0${payload.data}`;
  if (
    recent &&
    recent.signature === signature &&
    now >= recent.sentAt &&
    now - recent.sentAt < windowMs
  ) {
    return { send: false, recent };
  }

  return {
    send: true,
    recent: {
      signature,
      sentAt: now,
    },
  };
}
