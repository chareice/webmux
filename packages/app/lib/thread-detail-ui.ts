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
  return "bg-surface-light rounded-2xl border border-border px-3 pt-3 pb-2";
}

export function getComposerInputClassName(): string {
  return "min-h-[40px] max-h-[160px] px-1 text-[15px] leading-5 text-foreground";
}

export function getComposerToolbarClassName(): string {
  return "flex-row items-center mt-1.5 pt-1.5 border-t border-border/50";
}

export function getComposerIconButtonClassName({
  disabled,
}: ComposerStateOptions): string {
  return [
    "h-8 w-8 shrink-0 rounded-lg items-center justify-center",
    disabled ? "opacity-35" : "active:bg-surface",
  ]
    .filter(Boolean)
    .join(" ");
}

export function getComposerSubmitButtonClassName({
  disabled,
}: ComposerStateOptions): string {
  return [
    "h-8 shrink-0 items-center justify-center rounded-lg px-4 ml-auto",
    disabled
      ? "bg-accent/25"
      : "bg-accent active:opacity-90",
  ].join(" ");
}

export function getComposerSubmitTextClassName({
  disabled,
}: ComposerStateOptions): string {
  return disabled
    ? "text-white/50 text-[13px] font-semibold"
    : "text-background text-[13px] font-semibold";
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
