import { isRegistrationTokenFresh } from "./tokenExpiry.ts";
export function shouldGenerateRegistrationToken({ requested, token, expiresAt, now = Date.now(), }) {
    if (!requested) {
        return false;
    }
    if (!token || !expiresAt) {
        return true;
    }
    return !isRegistrationTokenFresh(expiresAt, now);
}
export function getTokenActionLabel({ loading, token, }) {
    if (loading) {
        return "Generating…";
    }
    return token ? "Regenerate Token" : "Generate Token";
}
