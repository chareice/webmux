import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';

import '../app/pixel_theme.dart';
import 'pixel_sprite.dart';

/// A chat message bubble with user/assistant styling.
///
/// Wrapped in RepaintBoundary to avoid repainting unchanged messages
/// when the list updates.
class MessageBubble extends StatelessWidget {
  const MessageBubble({
    super.key,
    required this.text,
    required this.isUser,
  });

  final String text;
  final bool isUser;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final bubble = Container(
      constraints: BoxConstraints(
        maxWidth: MediaQuery.of(context).size.width * 0.85,
      ),
      margin: EdgeInsets.only(
        left: isUser ? 48 : 0,
        right: isUser ? 0 : 48,
        top: 4,
        bottom: 4,
      ),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: PixelTheme.messageBubbleDecoration(isUser: isUser),
      // Use plain Text for short messages, MarkdownBody for longer ones.
      child: text.length < 200 && !text.contains('```') && !text.contains('**')
          ? Text(
              text,
              style: theme.textTheme.bodyMedium,
            )
          : MarkdownBody(
              data: text,
              selectable: false,
              styleSheet: MarkdownStyleSheet.fromTheme(theme).copyWith(
                p: theme.textTheme.bodyMedium,
                code: theme.textTheme.bodySmall?.copyWith(
                  fontFamily: 'monospace',
                  backgroundColor: Colors.black26,
                ),
                codeblockDecoration: const BoxDecoration(
                  color: Colors.black26,
                  borderRadius: BorderRadius.zero,
                ),
              ),
            ),
    );

    return RepaintBoundary(
      child: Align(
        alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
        child: isUser
            ? bubble
            : Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 8, right: 6),
                    child: PixelSprite(status: 'completed', size: 24),
                  ),
                  Flexible(child: bubble),
                ],
              ),
      ),
    );
  }
}
