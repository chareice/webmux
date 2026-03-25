import 'package:flutter/material.dart';

import '../app/pixel_theme.dart';
import '../app/theme.dart';
import 'pixel_sprite.dart';
import 'status_indicator.dart';

/// A single "desk slot" in the office view.
///
/// Combines a [PixelSprite] with a short text label and a colored status dot.
/// Supports tap and long-press interactions for navigation and context menus.
class Workstation extends StatelessWidget {
  const Workstation({
    super.key,
    required this.status,
    required this.label,
    this.onTap,
    this.onLongPress,
  });

  /// Thread status: 'running', 'starting', 'queued', 'failed', 'success',
  /// 'interrupted', etc.
  final String status;

  /// Short text shown below the sprite (thread summary or truncated prompt).
  final String label;

  /// Called when the workstation is tapped (e.g. navigate to thread detail).
  final VoidCallback? onTap;

  /// Called on long press (e.g. show context menu: interrupt, delete, etc.).
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 90,
      child: InkWell(
        onTap: onTap,
        onLongPress: onLongPress,
        child: Container(
          decoration: PixelTheme.pixelBox(),
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Pixel sprite (desk + monitor + person)
              PixelSprite(status: status, size: 48),
              const SizedBox(height: 6),
              // Status dot + label row
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // 6px status dot
                  Container(
                    width: 6,
                    height: 6,
                    decoration: BoxDecoration(
                      color: StatusIndicator.colorForStatus(status),
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 4),
                  // Label text, truncated with ellipsis
                  Flexible(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: WebmuxTheme.subtext,
                        fontSize: 11,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
