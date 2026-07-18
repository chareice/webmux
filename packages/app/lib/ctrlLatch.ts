// Mobile Ctrl-latch transform (SPEC-PHASE3 §2, design doc §4). While the key
// bar's Ctrl key is armed, the next character key — from the soft keyboard or
// a key-bar key — is sent as its control byte instead. Only letters and the
// classic Ctrl punctuation set (@ [ \ ] ^ _) transform; everything else
// (digits, symbols, escape sequences, multi-char IME commits) sends as-is.

export function ctrlLatchTransform(data: string): string | null {
  if (data.length !== 1) return null;
  const code = data.toUpperCase().charCodeAt(0);
  // 0x40–0x5F: @ A–Z [ \ ] ^ _ — the range Ctrl maps into 0x00–0x1F.
  if (code < 0x40 || code > 0x5f) return null;
  return String.fromCharCode(code & 0x1f);
}
