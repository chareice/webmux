import 'package:flutter/material.dart';

import '../app/theme.dart';

/// A small colored dot or icon that indicates thread/task status.
class StatusIndicator extends StatelessWidget {
  const StatusIndicator({
    super.key,
    required this.status,
    this.size = 8,
    this.showIcon = false,
  });

  final String status;
  final double size;

  /// When true, shows an icon (checkmark, X, etc.) instead of a dot.
  final bool showIcon;

  static Color colorForStatus(String status) {
    switch (status) {
      case 'running':
      case 'starting':
        return WebmuxTheme.statusRunning;
      case 'completed':
        return WebmuxTheme.statusSuccess;
      case 'failed':
      case 'error':
        return WebmuxTheme.statusFailed;
      case 'waiting':
      case 'waiting_for_input':
        return WebmuxTheme.statusWarning;
      case 'queued':
      case 'pending':
        return WebmuxTheme.statusQueued;
      case 'interrupted':
      case 'cancelled':
        return WebmuxTheme.subtext;
      default:
        return WebmuxTheme.subtext;
    }
  }

  static IconData iconForStatus(String status) {
    switch (status) {
      case 'completed':
        return Icons.check_circle_rounded;
      case 'failed':
      case 'error':
        return Icons.cancel_rounded;
      case 'interrupted':
      case 'cancelled':
        return Icons.remove_circle_rounded;
      case 'running':
      case 'starting':
        return Icons.play_circle_rounded;
      case 'waiting':
      case 'waiting_for_input':
        return Icons.pause_circle_rounded;
      case 'queued':
      case 'pending':
        return Icons.schedule_rounded;
      default:
        return Icons.circle;
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = colorForStatus(status);

    if (showIcon) {
      return Icon(
        iconForStatus(status),
        color: color,
        size: size,
      );
    }

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
      ),
    );
  }
}
