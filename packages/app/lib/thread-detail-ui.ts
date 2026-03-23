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
  return "bg-surface rounded-[22px] border border-border px-3 py-3";
}

export function getComposerIconButtonClassName({
  disabled,
}: ComposerStateOptions): string {
  return [
    "w-12 h-12 shrink-0 rounded-[16px] border border-border bg-surface-light items-center justify-center",
    disabled ? "opacity-45" : "active:opacity-85",
  ]
    .filter(Boolean)
    .join(" ");
}

export function getComposerInputClassName(): string {
  return "flex-1 min-h-[48px] max-h-[120px] rounded-[16px] border border-border bg-surface-light px-4 py-3 text-[15px] leading-5 text-foreground";
}

export function getComposerSubmitButtonClassName({
  disabled,
}: ComposerStateOptions): string {
  return [
    "h-12 min-w-[78px] shrink-0 items-center justify-center rounded-[16px] border px-5",
    disabled
      ? "border-accent/20 bg-accent/35"
      : "border-accent bg-accent active:opacity-90",
  ].join(" ");
}

export function getComposerSubmitTextClassName({
  disabled,
}: ComposerStateOptions): string {
  return disabled
    ? "text-white/70 text-sm font-semibold"
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
