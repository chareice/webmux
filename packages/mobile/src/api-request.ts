export function buildApiHeaders(
  options?: RequestInit,
  token?: string,
): Record<string, string> {
  const headers = {
    ...(options?.headers as Record<string, string> | undefined),
  };

  if (options?.body !== undefined && options.body !== null) {
    headers['Content-Type'] ??= 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}
