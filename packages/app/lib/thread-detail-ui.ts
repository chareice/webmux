export interface ComposerStateOptions {
  disabled: boolean;
}

export async function copyMessageContent(
  content: string,
  writeText: (value: string) => Promise<void | boolean>,
): Promise<boolean> {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }

  await writeText(trimmed);
  return true;
}

export function getComposerCardClassName(): string {
  return "border-t border-border";
}

export function getComposerInputClassName(): string {
  return "min-h-[48px] max-h-[160px] px-4 py-3 text-[15px] leading-6 text-foreground outline-none";
}

export function getComposerToolbarClassName(): string {
  return "flex-row items-center gap-2 px-4 pb-3";
}

export function getComposerIconButtonClassName({
  disabled,
}: ComposerStateOptions): string {
  return [
    "h-9 shrink-0 items-center justify-center px-4 border",
    disabled ? "border-border/50 opacity-40" : "border-border active:bg-surface",
  ]
    .filter(Boolean)
    .join(" ");
}

export function getComposerSubmitButtonClassName({
  disabled,
}: ComposerStateOptions): string {
  return [
    "h-9 shrink-0 items-center justify-center px-5 ml-auto border",
    disabled
      ? "border-border"
      : "border-foreground bg-foreground active:opacity-90",
  ].join(" ");
}

export function getComposerSubmitTextClassName({
  disabled,
}: ComposerStateOptions): string {
  return disabled
    ? "text-foreground-secondary text-sm"
    : "text-background text-sm font-semibold";
}

export function getMessageCopyButtonClassName({
  copied,
}: {
  copied: boolean;
}): string {
  return [
    "rounded-full border px-2.5 py-1",
    copied
      ? "border-accent/30 bg-accent/20"
      : "border-border bg-surface-light",
  ].join(" ");
}

export function getMessageCopyTextClassName({
  copied,
}: {
  copied: boolean;
}): string {
  return copied
    ? "text-accent text-xs font-semibold"
    : "text-foreground-secondary text-xs font-semibold";
}
