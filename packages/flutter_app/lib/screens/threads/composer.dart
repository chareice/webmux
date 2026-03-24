import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../app/theme.dart';
import '../../models/run.dart';
import '../../services/api_client.dart';
import '../../widgets/todo_bar.dart';
import '../../widgets/queue_bar.dart';

/// The core input area for sending messages in a thread.
class Composer extends StatefulWidget {
  const Composer({
    super.key,
    required this.agentId,
    required this.threadId,
    required this.runStatus,
    required this.apiClient,
    required this.hasTurns,
    this.tool = 'claude',
    this.repoPath = '',
    this.todoItems = const [],
    this.queuedTurns = const [],
    this.onMessageSent,
  });

  final String agentId;
  final String threadId;
  final String runStatus;
  final ApiClient apiClient;
  final bool hasTurns;
  final String tool;
  final String repoPath;
  final List<TodoEntry> todoItems;
  final List<RunTurn> queuedTurns;
  /// Called after a message is sent successfully, with the prompt text.
  final void Function(String prompt)? onMessageSent;

  @override
  State<Composer> createState() => _ComposerState();
}

class _ComposerState extends State<Composer> {
  final _textController = TextEditingController();
  final _focusNode = FocusNode();
  final _imagePicker = ImagePicker();
  final List<_Attachment> _attachments = [];
  bool _sending = false;

  bool get _isRunning =>
      widget.runStatus == 'running' || widget.runStatus == 'starting';

  bool get _isWaiting => widget.runStatus == 'waiting';

  bool get _canSend =>
      !_sending &&
      (_textController.text.trim().isNotEmpty || _attachments.isNotEmpty);

  String get _placeholder {
    if (_isWaiting) return 'Reply to agent...';
    if (_isRunning) return 'Queue next instruction...';
    return 'Message...';
  }

  @override
  void dispose() {
    _textController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  Future<void> _pickImages() async {
    if (_attachments.length >= 4) return;
    final remaining = 4 - _attachments.length;

    try {
      final files = await _imagePicker.pickMultiImage(
        limit: remaining,
        imageQuality: 85,
      );

      for (final file in files) {
        if (_attachments.length >= 4) break;
        final bytes = await file.readAsBytes();
        final mimeType = _guessMimeType(file.name);
        setState(() {
          _attachments.add(_Attachment(
            name: file.name,
            mimeType: mimeType,
            bytes: bytes,
            base64: base64Encode(bytes),
          ));
        });
      }
    } catch (_) {
      // User cancelled or platform error — ignore.
    }
  }

  String _guessMimeType(String name) {
    final lower = name.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.webp')) return 'image/webp';
    return 'image/png';
  }

  Future<void> _send() async {
    if (!_canSend) return;

    final prompt = _textController.text.trim();
    if (prompt.isEmpty && _attachments.isEmpty) return;

    setState(() => _sending = true);

    try {
      final attachments = _attachments
          .map((a) => RunImageAttachmentUpload(
                id: '',
                name: a.name,
                mimeType: a.mimeType,
                sizeBytes: a.bytes.length,
                base64: a.base64,
              ))
          .toList();

      if (widget.hasTurns) {
        // Continue existing thread.
        await widget.apiClient.continueThread(
          widget.agentId,
          widget.threadId,
          ContinueRunRequest(
            prompt: prompt,
            attachments: attachments.isNotEmpty ? attachments : null,
          ),
        );
      } else {
        // Start a new thread.
        await widget.apiClient.startThread(
          widget.agentId,
          StartRunRequest(
            tool: widget.tool,
            repoPath: widget.repoPath,
            prompt: prompt,
            attachments: attachments.isNotEmpty ? attachments : null,
          ),
        );
      }

      final sentPrompt = prompt;
      _textController.clear();
      setState(() => _attachments.clear());
      widget.onMessageSent?.call(sentPrompt);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to send: $e')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _sending = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final borderColor =
        _isWaiting ? theme.colorScheme.primary : WebmuxTheme.border;

    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(
          top: BorderSide(color: borderColor, width: _isWaiting ? 2 : 1),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Todo bar
            TodoBar(items: widget.todoItems),
            // Queue bar
            QueueBar(
              queuedTurns: widget.queuedTurns,
              agentId: widget.agentId,
              threadId: widget.threadId,
              apiClient: widget.apiClient,
              onChanged: widget.onMessageSent != null ? () => widget.onMessageSent!('') : null,
            ),
            // Attachment preview
            if (_attachments.isNotEmpty) _buildAttachmentBar(),
            // Text input
            _buildInput(theme),
            // Toolbar
            _buildToolbar(theme),
          ],
        ),
      ),
    );
  }

  Widget _buildAttachmentBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: WebmuxTheme.border),
        ),
      ),
      height: 64,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: _attachments.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final att = _attachments[index];
          return Stack(
            clipBehavior: Clip.none,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: Image.memory(
                  att.bytes,
                  width: 48,
                  height: 48,
                  fit: BoxFit.cover,
                ),
              ),
              Positioned(
                top: -4,
                right: -4,
                child: GestureDetector(
                  onTap: () {
                    setState(() => _attachments.removeAt(index));
                  },
                  child: Container(
                    width: 18,
                    height: 18,
                    decoration: BoxDecoration(
                      color: WebmuxTheme.statusFailed,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.close_rounded,
                      size: 12,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildInput(ThemeData theme) {
    return ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height / 3,
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
        child: TextField(
          controller: _textController,
          focusNode: _focusNode,
          minLines: 1,
          maxLines: 8,
          textInputAction: TextInputAction.newline,
          decoration: InputDecoration(
            hintText: _placeholder,
            border: InputBorder.none,
            enabledBorder: InputBorder.none,
            focusedBorder: InputBorder.none,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 4,
              vertical: 8,
            ),
            isDense: true,
            filled: false,
          ),
          style: theme.textTheme.bodyMedium,
          onChanged: (_) => setState(() {}),
        ),
      ),
    );
  }

  Widget _buildToolbar(ThemeData theme) {
    final sendColor = _isRunning
        ? WebmuxTheme.statusWarning
        : theme.colorScheme.primary;

    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 0, 8, 4),
      child: Row(
        children: [
          // Image picker
          IconButton(
            onPressed: _attachments.length >= 4 ? null : _pickImages,
            icon: const Icon(Icons.image_outlined),
            iconSize: 20,
            color: WebmuxTheme.subtext,
            tooltip: 'Attach images',
          ),
          const Spacer(),
          // Send button
          SizedBox(
            height: 34,
            child: FilledButton.icon(
              onPressed: _canSend ? _send : null,
              icon: _sending
                  ? SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: theme.colorScheme.onPrimary,
                      ),
                    )
                  : const Icon(Icons.send_rounded, size: 16),
              label: Text(_isRunning ? 'Queue' : 'Send'),
              style: FilledButton.styleFrom(
                backgroundColor: _canSend ? sendColor : sendColor.withOpacity(0.3),
                foregroundColor: theme.colorScheme.onPrimary,
                padding:
                    const EdgeInsets.symmetric(horizontal: 14),
                textStyle: const TextStyle(fontSize: 13),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Internal attachment data before upload.
class _Attachment {
  final String name;
  final String mimeType;
  final Uint8List bytes;
  final String base64;

  const _Attachment({
    required this.name,
    required this.mimeType,
    required this.bytes,
    required this.base64,
  });
}
