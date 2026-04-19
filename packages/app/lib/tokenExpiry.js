const TOKEN_REFRESH_BUFFER_MS = 60_000;
export function isRegistrationTokenFresh(expiresAtMs, nowMs = Date.now()) {
    return expiresAtMs > nowMs + TOKEN_REFRESH_BUFFER_MS;
}
