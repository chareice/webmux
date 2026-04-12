const TOKEN_REFRESH_BUFFER_MS = 60_000;

export function isRegistrationTokenFresh(
  expiresAtMs: number,
  nowMs = Date.now(),
): boolean {
  return expiresAtMs > nowMs + TOKEN_REFRESH_BUFFER_MS;
}
