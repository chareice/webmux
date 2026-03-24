import 'package:flutter/material.dart';

import '../app/pixel_theme.dart';
import '../app/theme.dart';
import '../models/run.dart';
import 'workstation.dart';

/// The main visual area showing a pixel-art office room with workstations
/// arranged in a flowing grid.
///
/// Draws the office background (wall, floor) and lays out [Workstation] widgets
/// for each thread. Supports tap, long-press, and an "add new" action.
class OfficeScene extends StatelessWidget {
  const OfficeScene({
    super.key,
    required this.threads,
    this.onThreadTap,
    this.onThreadLongPress,
    this.onAddNew,
  });

  /// List of Run objects to display as workstations.
  final List<Run> threads;

  /// Called when a workstation sprite is tapped.
  final void Function(Run thread)? onThreadTap;

  /// Called when a workstation sprite is long-pressed.
  final void Function(Run thread)? onThreadLongPress;

  /// Called when the "+" add button is tapped.
  final VoidCallback? onAddNew;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: PixelTheme.wall,
      child: CustomPaint(
        painter: const _OfficeBgPainter(),
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Wall spacer — reserve visual space for the painted wall strip.
              const SizedBox(height: 40),
              // Workstation grid + add button
              Wrap(
                spacing: 10,
                runSpacing: 10,
                alignment: WrapAlignment.center,
                children: [
                  for (final run in threads)
                    Workstation(
                      label: _labelFor(run),
                      status: run.status,
                      onTap: onThreadTap == null
                          ? null
                          : () => onThreadTap!(run),
                      onLongPress: onThreadLongPress == null
                          ? null
                          : () => onThreadLongPress!(run),
                    ),
                  _AddButton(onTap: onAddNew),
                ],
              ),
              // Bottom padding so the floor is always visible.
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }

  /// Derive a short label from [run.summary] or [run.prompt].
  static String _labelFor(Run run) {
    final raw = run.summary ?? run.prompt;
    // Truncate to 40 characters to keep the label compact.
    if (raw.length <= 40) return raw;
    return '${raw.substring(0, 37)}...';
  }
}

// ---------------------------------------------------------------------------
// Background painter — wall band at top, checkerboard floor at bottom.
// ---------------------------------------------------------------------------

class _OfficeBgPainter extends CustomPainter {
  const _OfficeBgPainter();

  static const double _wallHeight = 40;
  static const double _wallStripHeight = 4;
  static const double _tileSize = 16;

  @override
  void paint(Canvas canvas, Size size) {
    // Wall
    canvas.drawRect(
      Rect.fromLTWH(0, 0, size.width, _wallHeight),
      Paint()..color = PixelTheme.wall,
    );

    // Thin accent strip at bottom of wall
    canvas.drawRect(
      Rect.fromLTWH(0, _wallHeight, size.width, _wallStripHeight),
      Paint()..color = PixelTheme.floorLight,
    );

    // Checkerboard floor — fills from the strip down to the bottom.
    const floorTop = _wallHeight + _wallStripHeight;
    final floorPaintDark = Paint()..color = PixelTheme.floorDark;
    final floorPaintLight = Paint()..color = PixelTheme.floorLight;

    final cols = (size.width / _tileSize).ceil();
    final rows = ((size.height - floorTop) / _tileSize).ceil();

    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        final paint = (r + c).isEven ? floorPaintDark : floorPaintLight;
        canvas.drawRect(
          Rect.fromLTWH(
            c * _tileSize,
            floorTop + r * _tileSize,
            _tileSize,
            _tileSize,
          ),
          paint,
        );
      }
    }
  }

  @override
  bool shouldRepaint(covariant _OfficeBgPainter oldDelegate) => false;
}

// ---------------------------------------------------------------------------
// Add-new button styled as an empty workstation slot.
// ---------------------------------------------------------------------------

class _AddButton extends StatelessWidget {
  const _AddButton({this.onTap});

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 120,
      child: InkWell(
        onTap: onTap,
        child: Container(
          decoration: PixelTheme.pixelBox(
            borderColor: WebmuxTheme.subtext.withAlpha(100),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Match the sprite height (80px) with the "+" icon centered.
              SizedBox(
                height: 80,
                child: Center(
                  child: Icon(
                    Icons.add,
                    size: 32,
                    color: WebmuxTheme.subtext.withAlpha(180),
                  ),
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                'New',
                style: TextStyle(
                  color: WebmuxTheme.subtext,
                  fontSize: 11,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
