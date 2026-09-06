# Local terminal editor

On a phone or touch tablet, open the gear (**Input settings**) in the
scrolling tool strip and choose **Write first, then send**. **Type directly**
restores terminal input. Each user/hub/machine/terminal has its own saved draft
and mode; changing modes preserves text and attachments.

The two compact rows use equal-width, borderless 44 px-high keys. Visual styling
uses the existing product palette, display/body font tokens, rounded press
states and Lucide icons; the wireframe defines layout and interaction only. Ctrl+C, Esc,
Tab, `/`, Enter and the inverted-T arrow cluster stay fixed. The keyboard
visibility toggle is the first key on row two. Paste, attachments, selection,
input settings, Ctrl and symbols scroll between it and the arrow cluster.
Edge fades indicate remaining horizontal content. Shift+Tab is not included.

The draft starts one line high. Long or multiline text can expand with the
icon inside the field. In draft mode, symbols, Tab, Space, paste and arrows
edit locally at the caret. **Enter** submits a nonempty draft and attachments;
with an empty draft it sends terminal Enter. Shift+Enter adds a newline.
There is no separate Send button. Esc, Ctrl+C and explicitly armed Ctrl
shortcuts control the terminal even while editing a draft.

- To use the agent's remote slash menu, choose **Type directly**, then tap `/`.
  A remote menu selection cannot be merged into the local draft automatically.
- Paste opens a reviewable local draft and inserts at the caret. If clipboard
  permission is denied, use the platform Paste menu in that field.
- The paperclip offers Photos and Files in both modes. Drafts accept up to
  four files totaling 20 MiB. Files are saved to a private temporary directory
  on the machine when submitted, and follow its temporary-file cleanup policy.
- Only the keyboard toggle intentionally changes keyboard visibility; toolbar
  Enter, navigation and symbols preserve focus. Native IME behavior still
  needs real-device validation alongside the browser checks.
- A connection above 250 ms for five seconds suggests local editing. Switching
  remains manual, so typing and terminal menus are not interrupted.

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

If the acknowledgement is lost, the draft stays locked. **Enter** checks delivery using
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

手机和触屏平板共用两行紧凑按键。高频键固定显示，方向键为倒 T 形；第二行
首键控制键盘显隐，低频工具横滑。齿轮菜单切换“直接输入 / 先写后发”，草稿
默认一行；Enter 统一提交，确认接收后清稿。草稿内的方向键和符号在本地编辑，
Esc、Ctrl+C 和主动启用的 Ctrl 组合键仍发送给终端。断线保留原发送 ID，避免
重复执行。图片和文件共用附件入口。
