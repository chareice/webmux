export interface ComposerStateOptions {
  disabled: boolean;
}

export async function copyMessageContent(
  content: string,
  writeText: (value: string) => Promise<void>,
): Promise<boolean> {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }

  await writeText(trimmed);
  return true;
}

export function getComposerCardClassName(): string {
  return "bg-background rounded-[18px] border border-border px-2.5 py-2.5";
}

export function getComposerIconButtonClassName({
  disabled,
}: ComposerStateOptions): string {
  return [
    "w-11 h-11 shrink-0 rounded-[14px] border border-border bg-surface-light items-center justify-center",
    disabled ? "opacity-45" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function getComposerInputClassName(): string {
  return "flex-1 min-h-[42px] max-h-[120px] rounded-2xl border border-border bg-surface-light px-3.5 py-2.5 text-[15px] leading-5 text-foreground";
}

export function getComposerSubmitButtonClassName({
  disabled,
}: ComposerStateOptions): string {
  return [
    "h-11 min-w-[72px] shrink-0 items-center justify-center rounded-[14px] border px-4",
    disabled ? "border-border bg-surface-light" : "border-accent bg-accent",
  ].join(" ");
}

export function getComposerSubmitTextClassName({
  disabled,
}: ComposerStateOptions): string {
  return disabled
    ? "text-foreground-secondary text-sm font-semibold"
    : "text-white text-sm font-semibold";
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
