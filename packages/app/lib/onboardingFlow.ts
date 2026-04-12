import { isRegistrationTokenFresh } from "./tokenExpiry.ts";

interface TokenGenerationState {
  requested: boolean;
  token: string | null;
  expiresAt: number | null;
  now?: number;
}

interface TokenActionState {
  loading: boolean;
  token: string | null;
}

export function shouldGenerateRegistrationToken({
  requested,
  token,
  expiresAt,
  now = Date.now(),
}: TokenGenerationState): boolean {
  if (!requested) {
    return false;
  }

  if (!token || !expiresAt) {
    return true;
  }

  return !isRegistrationTokenFresh(expiresAt, now);
}

export function getTokenActionLabel({
  loading,
  token,
}: TokenActionState): string {
  if (loading) {
    return "Generating…";
  }

  return token ? "Regenerate Token" : "Generate Token";
}
