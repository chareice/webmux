# File attachments

The existing attachment action offers **Choose photos** (photo picker) and **Choose files** (system document picker). The terminal key layout and input-mode selector are unchanged.

- Direct input sends one file, up to 25 MiB, over the existing authenticated terminal connection and pastes its saved path without pressing Enter. The submitted status means the client handed the message to the connection; verify the resulting path in the terminal. This legacy path does not have a durable delivery receipt.
- Local editor accepts up to four files totaling 20 MiB. File names, types and bytes are retained in the local draft across mode changes and reload. Sending uses the existing durable composer receipt/retry rules. Generic documents appear as named file cards; supported raster images retain previews.
- The machine stores uploads in a new private temporary directory. Client paths are reduced to a basename, control characters are removed, same-name uploads do not overwrite one another, and paths containing shell metacharacters are quoted. The composer prefixes names with their attachment index to distinguish duplicate names within one message.
- File contents are not parsed or executed by the upload handler. The terminal/agent receives paths on the machine and decides how to use them. Files live in the machine's temporary storage, not the phone's file provider.

The Hub and machine must be updated together for generic documents in the local editor. The optional `filename` field remains compatible with earlier image messages; older image-only composer implementations reject document MIME types and the draft remains available for retry after upgrading.

Validation includes document-provider chooser events, binary content hashes at the actual machine, file names containing spaces and quotes, reload persistence, malformed-data rejection, and existing large-image/retry regressions. Browser tests do not replace physical iOS/Android provider testing.
