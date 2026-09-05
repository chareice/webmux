# Local terminal editor

On a phone, select **Local editor** below the terminal to type without waiting
for remote echo. **Direct input** restores the usual terminal keyboard. Each
user/hub/machine/terminal has its own saved draft and input mode. Look for
**Saved on this device** before reloading or leaving the page.

Text editing, Chinese IME composition, and image previews happen locally.
**Send** uploads the images to the machine, pastes the text and image paths as
one bracketed paste, then presses Enter. The destination program decides how
to interpret that input; this is useful for an agent prompt and is still a
command submission if the terminal is running a shell.

- **/ Commands** switches to direct input and types `/`, opening the remote
  program's menu where supported. It preserves the local draft. It cannot
  merge a remote menu selection into the local draft automatically.
- **Terminal controls** returns to direct input for arrows, Tab, Esc, Ctrl+C,
  and other terminal interactions.
- Attach or paste up to four PNG, JPEG, WebP, or GIF images, totaling 20 MiB.
  The agent must support reading local image paths. Files are saved to a
  private temporary directory on the machine and retained for the agent to
  read; they follow the machine's temporary-file cleanup policy.
- A connection above 250 ms for five seconds suggests the local editor.
  Switching is manual in this first version: typing, IME composition, and
  terminal menus are never interrupted by an automatic mode change. The
  indicator measures client-to-Hub RTT, not agent execution time.

## Delivery and recovery

**Delivered to terminal** means the Node wrote the paste and Enter to its
terminal attachment. It does not mean the shell command succeeded or the agent
finished. The draft clears only after this acknowledgement.

The client saves the exact message and a random send ID before dispatch. The
Hub persists a receipt reservation before forwarding it. The same ID and
content return the original receipt instead of sending a second command,
including after a Hub restart. A failed attachment is rejected before any
text is written. New sends require control of the machine and a Node advertising
`composer-v1`; older Nodes display an update instruction.

If the acknowledgement is lost, the draft stays locked. **Check delivery** uses
the same ID; nothing is automatically resent. If the Hub crashed between
reserving the ID and recording the Node's response, the result may remain
unconfirmed permanently. Inspect the terminal before discarding that draft and
creating another send. This favors avoiding duplicate commands over guaranteed
delivery. Multiple simultaneous sends from one terminal connection are refused.

Drafts and pending images are stored in this device's IndexedDB, scoped to the
signed-in user and destination. Clearing site data removes them. The Hub stores
IDs, a content digest, and receipts, not a separate copy of message text/images;
terminal history may still contain the submitted text. Receipt tombstones are
retained to prevent old sends being replayed.

This feature does not add end-to-end encryption. Application encryption,
trusted client distribution, pairing, and the hosted relay remain a separate
phase, independent of whether input is direct or locally composed.

## Verification

`e2e/tests/local-composer.spec.ts` covers draft/image restoration, mode changes,
multiline sends, duplicate IDs, lost acknowledgements, invalid images, and an
image whose encoded frame exceeds 16 MiB. Run `pnpm e2e:test` locally or
`pnpm e2e:ci` in automation; both use the container browser. The existing
`pnpm e2e:test:debug-host` is the explicit host-browser debug alternative.

Native debug daemons can set `OFFDESK_CONFIG_DIR` to a separate directory and
`TMUX_TMPDIR` to a separate tmux socket directory. Use an isolated database and
port too, so debugging cannot load the installed Node's credentials or session
metadata. An explicit config directory skips legacy-directory migration.

## 中文说明

手机终端下方可切换直接输入和本地编辑器。草稿、中文输入和图片预览在本机
完成；点击发送后等待主机确认，断线保留草稿并使用原 ID 查询，避免重复执行。
斜杠菜单及控制键仍使用直接输入。第一版仅提示高延迟，不自动切换模式；端到端
加密与官方中转服务留在独立阶段。
