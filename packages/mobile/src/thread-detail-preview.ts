export type ThreadPreviewOptions = {
  charLimit: number;
  lineLimit: number;
};

export function normalizePreviewText(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

export function shouldForcePreviewText(
  content: string,
  options: ThreadPreviewOptions,
): boolean {
  const normalized = normalizePreviewText(content);

  if (!normalized) {
    return false;
  }

  return (
    normalized.length > options.charLimit ||
    normalized.split('\n').length > options.lineLimit + 1
  );
}
