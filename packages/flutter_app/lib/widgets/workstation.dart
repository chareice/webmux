import 'package:flutter/material.dart';

import '../app/pixel_theme.dart';
import 'pixel_sprite.dart';
import 'status_indicator.dart';

/// A single "desk slot" in the office view.
///
/// No border box — the cubicle look comes from wooden divider walls
/// drawn between workstations by the parent layout.
class Workstation extends StatelessWidget {
  const Workstation({
    super.key,
    required this.status,
    required this.label,
    this.onTap,
    this.onLongPress,
  });

  final String status;
  final String label;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            PixelSprite(status: status, size: 48),
            const SizedBox(height: 4),
            // Status dot + label
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 5,
                  height: 5,
                  decoration: BoxDecoration(
                    color: StatusIndicator.colorForStatus(status),
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 3),
                Flexible(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: PixelTheme.furnitureDark,
                      fontSize: 9,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
