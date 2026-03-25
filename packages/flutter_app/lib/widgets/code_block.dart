import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../app/theme.dart';

/// A collapsible code/command block that shows the first few lines collapsed.
class CodeBlock extends StatefulWidget {
  const CodeBlock({
    super.key,
    required this.command,
    this.output,
    this.exitCode,
    this.status,
    this.previewLines = 3,
  });

  final String command;
  final String? output;
  final int? exitCode;
  final String? status;
  final int previewLines;

  @override
  State<CodeBlock> createState() => _CodeBlockState();
}

class _CodeBlockState extends State<CodeBlock> {
  bool _expanded = false;

  String get _preview {
    final lines = (widget.output ?? '').split('\n');
    if (lines.length <= widget.previewLines) return widget.output ?? '';
    return '${lines.take(widget.previewLines).join('\n')}\n...';
  }

  bool get _hasMoreLines {
    final lines = (widget.output ?? '').split('\n');
    return lines.length > widget.previewLines;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isError =
        widget.exitCode != null && widget.exitCode != 0;
    final isRunning = widget.status == 'running';

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      decoration: BoxDecoration(
        color: Colors.black26,
        borderRadius: BorderRadius.zero,
        border: Border.all(
          color: isError
              ? WebmuxTheme.statusFailed.withOpacity(0.4)
              : WebmuxTheme.border,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Command header
          InkWell(
            onTap: widget.output != null && widget.output!.isNotEmpty
                ? () => setState(() => _expanded = !_expanded)
                : null,
            borderRadius: BorderRadius.zero,
            child: Padding(
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  Icon(
                    Icons.terminal_rounded,
                    size: 14,
                    color: isRunning
                        ? WebmuxTheme.statusRunning
                        : WebmuxTheme.subtext,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '\$ ${widget.command}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontFamily: 'monospace',
                        color: theme.colorScheme.onSurface,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (widget.exitCode != null) ...[
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: isError
                            ? WebmuxTheme.statusFailed
                                .withOpacity(0.15)
                            : WebmuxTheme.statusSuccess
                                .withOpacity(0.15),
                        borderRadius: BorderRadius.zero,
                      ),
                      child: Text(
                        '${widget.exitCode}',
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: isError
                              ? WebmuxTheme.statusFailed
                              : WebmuxTheme.statusSuccess,
                          fontFamily: 'monospace',
                          fontSize: 10,
                        ),
                      ),
                    ),
                  ],
                  if (isRunning)
                    const Padding(
                      padding: EdgeInsets.only(left: 8),
                      child: SizedBox(
                        width: 16,
                        height: 16,
                        child: Text('...', style: TextStyle(fontSize: 14)),
                      ),
                    ),
                  if (_hasMoreLines) ...[
                    const SizedBox(width: 4),
                    Icon(
                      _expanded
                          ? Icons.expand_less_rounded
                          : Icons.expand_more_rounded,
                      size: 16,
                      color: WebmuxTheme.subtext,
                    ),
                  ],
                ],
              ),
            ),
          ),
          // Output
          if (widget.output != null && widget.output!.isNotEmpty) ...[
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Stack(
                children: [
                  Text(
                    _expanded ? widget.output! : _preview,
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontFamily: 'monospace',
                      fontSize: 11,
                      height: 1.5,
                    ),
                  ),
                  Positioned(
                    top: 0,
                    right: 0,
                    child: IconButton(
                      onPressed: () {
                        Clipboard.setData(
                            ClipboardData(text: widget.output ?? ''));
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Output copied'),
                            duration: Duration(seconds: 1),
                          ),
                        );
                      },
                      icon: const Icon(Icons.copy_rounded, size: 14),
                      iconSize: 14,
                      padding: EdgeInsets.zero,
                      constraints:
                          const BoxConstraints(minWidth: 24, minHeight: 24),
                      color: WebmuxTheme.subtext,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
