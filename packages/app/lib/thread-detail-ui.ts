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
  return "mx-4 mb-4 border border-border bg-surface";
}

export function getComposerInputClassName(): string {
  return "min-h-[48px] max-h-[160px] px-3 py-3 text-[15px] leading-6 text-foreground bg-surface outline-none";
}

export function getComposerToolbarClassName(): string {
  return "flex-row items-center gap-2 px-3 pb-2 pt-1";
}

export function getComposerIconButtonClassName({
  disabled,
}: ComposerStateOptions): string {
  return [
    "shrink-0 items-center justify-center",
    disabled ? "opacity-30" : "active:opacity-60",
  ]
    .filter(Boolean)
    .join(" ");
}

export function getComposerSubmitButtonClassName({
  disabled,
}: ComposerStateOptions): string {
  return [
    "h-8 shrink-0 items-center justify-center px-5 ml-auto",
    disabled
      ? "bg-surface-light"
      : "bg-foreground active:opacity-90",
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
