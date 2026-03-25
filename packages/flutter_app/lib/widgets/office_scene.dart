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

  /// Group threads by repoPath.
  Map<String, List<Run>> _groupByProject() {
    final map = <String, List<Run>>{};
    for (final run in threads) {
      final key = run.repoPath.isNotEmpty ? run.repoPath : 'Other';
      (map[key] ??= []).add(run);
    }
    return map;
  }

  /// Extract short project name from repoPath.
  static String _projectName(String repoPath) {
    if (repoPath == 'Other') return 'Other';
    final parts = repoPath.split('/').where((p) => p.isNotEmpty).toList();
    return parts.isNotEmpty ? parts.last : repoPath;
  }

  @override
  Widget build(BuildContext context) {
    final groups = _groupByProject();

    return Column(
      children: [
        // Main scrollable office area
        Expanded(
          child: Container(
            color: PixelTheme.wall,
            child: CustomPaint(
              painter: const _OfficeBgPainter(),
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Wall spacer
                    const SizedBox(height: 68),
                    // Grouped by project
                    for (final entry in groups.entries) ...[
                      _ProjectHeader(name: _projectName(entry.key)),
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final run in entry.value)
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
                        ],
                      ),
                      const SizedBox(height: 12),
                    ],
                    const SizedBox(height: 60),
                  ],
                ),
              ),
            ),
          ),
        ),
        // Bottom action bar — game-style toolbar
        _ActionBar(onAddNew: onAddNew, threadCount: threads.length),
      ],
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
// Background painter — Stardew Valley-style cozy indoor office room.
// ---------------------------------------------------------------------------

class _OfficeBgPainter extends CustomPainter {
  const _OfficeBgPainter();

  static const double _wallHeight = 68;
  static const double _baseboardHeight = 6;
  static const double _plankHeight = 8;

  @override
  void paint(Canvas canvas, Size size) {
    _drawWall(canvas, size);
    _drawBaseboard(canvas, size);
    _drawWindows(canvas, size);
    _drawBookshelf(canvas, size);
    _drawPottedPlant(canvas, size);
    _drawFramedPicture(canvas, size);
    _drawFloor(canvas, size);
    _drawRug(canvas, size);
    _drawWallFloorShadow(canvas, size);
  }

  /// Warm cream wall background.
  void _drawWall(Canvas canvas, Size size) {
    canvas.drawRect(
      Rect.fromLTWH(0, 0, size.width, _wallHeight),
      Paint()..color = PixelTheme.wall,
    );
  }

  /// Wainscoting / baseboard along the bottom of the wall.
  void _drawBaseboard(Canvas canvas, Size size) {
    const top = _wallHeight - _baseboardHeight;
    // Main baseboard strip
    canvas.drawRect(
      Rect.fromLTWH(0, top, size.width, _baseboardHeight),
      Paint()..color = PixelTheme.wallAccent,
    );
    // Darker top line of baseboard
    canvas.drawRect(
      Rect.fromLTWH(0, top, size.width, 2),
      Paint()..color = PixelTheme.furniture,
    );
    // Darker bottom line of baseboard
    canvas.drawRect(
      Rect.fromLTWH(0, _wallHeight - 1, size.width, 1),
      Paint()..color = PixelTheme.furnitureDark,
    );
  }

  /// Draw 2–3 evenly-spaced windows on the wall.
  void _drawWindows(Canvas canvas, Size size) {
    const windowW = 28.0;
    const windowH = 32.0;
    const windowTop = 10.0;
    const paneGap = 2.0; // frame / cross-bar thickness

    // Determine how many windows fit and space them evenly.
    final count = size.width > 300 ? 3 : 2;
    final spacing = size.width / (count + 1);

    for (var i = 0; i < count; i++) {
      final cx = spacing * (i + 1);
      final left = cx - windowW / 2;

      // Window frame (outer border)
      canvas.drawRect(
        Rect.fromLTWH(left, windowTop, windowW, windowH),
        Paint()..color = PixelTheme.furniture,
      );

      // Inner window area
      const inset = paneGap;
      final innerRect = Rect.fromLTWH(
        left + inset,
        windowTop + inset,
        windowW - inset * 2,
        windowH - inset * 2,
      );
      canvas.drawRect(innerRect, Paint()..color = PixelTheme.windowBlue);

      // Cross-bar horizontal
      final crossY = innerRect.top + innerRect.height / 2 - 1;
      canvas.drawRect(
        Rect.fromLTWH(innerRect.left, crossY, innerRect.width, paneGap),
        Paint()..color = PixelTheme.furniture,
      );
      // Cross-bar vertical
      final crossX = innerRect.left + innerRect.width / 2 - 1;
      canvas.drawRect(
        Rect.fromLTWH(crossX, innerRect.top, paneGap, innerRect.height),
        Paint()..color = PixelTheme.furniture,
      );

      // Window sill
      canvas.drawRect(
        Rect.fromLTWH(left - 2, windowTop + windowH, windowW + 4, 3),
        Paint()..color = PixelTheme.furnitureLight,
      );
      canvas.drawRect(
        Rect.fromLTWH(left - 2, windowTop + windowH + 3, windowW + 4, 1),
        Paint()..color = PixelTheme.furnitureDark,
      );

      // Warm light glow beneath window
      canvas.drawRect(
        Rect.fromLTWH(left, windowTop + windowH + 4, windowW, 6),
        Paint()
          ..color = PixelTheme.windowLight.withAlpha(60)
          ..blendMode = BlendMode.srcOver,
      );
    }
  }

  /// A small bookshelf drawn between the first and second windows.
  void _drawBookshelf(Canvas canvas, Size size) {
    // Position the bookshelf at ~25% of the width.
    final count = size.width > 300 ? 3 : 2;
    if (count < 3) return; // only draw when there is room

    final spacing = size.width / (count + 1);
    // Place between window 0 and window 1
    final cx = (spacing * 1 + spacing * 2) / 2;
    const shelfW = 20.0;
    const shelfH = 24.0;
    const shelfTop = 16.0;
    final left = cx - shelfW / 2;

    // Outer frame
    canvas.drawRect(
      Rect.fromLTWH(left, shelfTop, shelfW, shelfH),
      Paint()..color = PixelTheme.furniture,
    );
    // Inner back
    canvas.drawRect(
      Rect.fromLTWH(left + 2, shelfTop + 2, shelfW - 4, shelfH - 4),
      Paint()..color = PixelTheme.furnitureLight,
    );
    // Middle shelf plank
    canvas.drawRect(
      Rect.fromLTWH(left + 2, shelfTop + shelfH / 2 - 1, shelfW - 4, 2),
      Paint()..color = PixelTheme.furniture,
    );

    // Books — top shelf
    final bookColors = [
      PixelTheme.bookRed,
      PixelTheme.bookBlue,
      PixelTheme.bookGreen,
      PixelTheme.bookRed,
    ];
    var bx = left + 3;
    for (var i = 0; i < 4; i++) {
      final bw = (i == 2) ? 3.0 : 3.5;
      canvas.drawRect(
        Rect.fromLTWH(bx, shelfTop + 3, bw, shelfH / 2 - 5),
        Paint()..color = bookColors[i],
      );
      bx += bw + 0.5;
    }
    // Books — bottom shelf
    bx = left + 3;
    final bookColors2 = [
      PixelTheme.bookGreen,
      PixelTheme.bookBlue,
      PixelTheme.bookRed,
    ];
    for (var i = 0; i < 3; i++) {
      final bw = (i == 1) ? 4.0 : 3.5;
      canvas.drawRect(
        Rect.fromLTWH(bx, shelfTop + shelfH / 2 + 2, bw, shelfH / 2 - 5),
        Paint()..color = bookColors2[i],
      );
      bx += bw + 0.5;
    }
  }

  /// A potted plant sitting on the baseboard.
  void _drawPottedPlant(Canvas canvas, Size size) {
    final count = size.width > 300 ? 3 : 2;
    final spacing = size.width / (count + 1);
    // Place between the last two windows (or at 75% width for 2 windows).
    final cx =
        count == 3
            ? (spacing * 2 + spacing * 3) / 2
            : (spacing * 1 + spacing * 2) / 2;

    const potW = 10.0;
    const potH = 8.0;
    const potTop = _wallHeight - _baseboardHeight - potH + 1;
    final potLeft = cx - potW / 2;

    // Pot
    canvas.drawRect(
      Rect.fromLTWH(potLeft, potTop, potW, potH),
      Paint()..color = PixelTheme.furniture,
    );
    canvas.drawRect(
      Rect.fromLTWH(potLeft + 1, potTop, potW - 2, 2),
      Paint()..color = PixelTheme.furnitureLight,
    );

    // Leaves (layered circles of green rectangles)
    final lcx = cx;
    const lcy = potTop - 4;
    // Dark leaves behind
    canvas.drawRect(
      Rect.fromLTWH(lcx - 6, lcy - 3, 12, 8),
      Paint()..color = PixelTheme.plantGreenDark,
    );
    // Main green body
    canvas.drawRect(
      Rect.fromLTWH(lcx - 5, lcy - 5, 10, 8),
      Paint()..color = PixelTheme.plantGreen,
    );
    // Light highlight top
    canvas.drawRect(
      Rect.fromLTWH(lcx - 3, lcy - 6, 6, 4),
      Paint()..color = PixelTheme.plantGreenLight,
    );
  }

  /// A small framed picture on the wall (decorative).
  void _drawFramedPicture(Canvas canvas, Size size) {
    // Place it to the far left, near the left edge.
    if (size.width < 200) return;
    const frameW = 14.0;
    const frameH = 12.0;
    const frameLeft = 18.0;
    const frameTop = 14.0;

    // Frame border
    canvas.drawRect(
      const Rect.fromLTWH(frameLeft, frameTop, frameW, frameH),
      Paint()..color = PixelTheme.furniture,
    );
    // Inner canvas area
    canvas.drawRect(
      const Rect.fromLTWH(frameLeft + 2, frameTop + 2, frameW - 4, frameH - 4),
      Paint()..color = PixelTheme.windowLight,
    );
    // Simple landscape: sky, grass, sun
    canvas.drawRect(
      const Rect.fromLTWH(frameLeft + 2, frameTop + 2, frameW - 4, 4),
      Paint()..color = PixelTheme.windowBlue.withAlpha(180),
    );
    canvas.drawRect(
      const Rect.fromLTWH(frameLeft + 2, frameTop + 6, frameW - 4, 4),
      Paint()..color = PixelTheme.plantGreen.withAlpha(180),
    );
    // Tiny sun
    canvas.drawRect(
      const Rect.fromLTWH(frameLeft + frameW - 5, frameTop + 3, 2, 2),
      Paint()..color = PixelTheme.rugWarm,
    );
  }

  /// Wooden plank floor with horizontal grain lines.
  void _drawFloor(Canvas canvas, Size size) {
    const floorTop = _wallHeight;
    final floorHeight = size.height - floorTop;
    if (floorHeight <= 0) return;

    final rows = (floorHeight / _plankHeight).ceil();
    final paintDark = Paint()..color = PixelTheme.floorDark;
    final paintLight = Paint()..color = PixelTheme.floorLight;
    final grainPaint = Paint()..color = PixelTheme.furnitureDark.withAlpha(25);
    final seamPaint = Paint()..color = PixelTheme.furnitureDark.withAlpha(40);

    for (var r = 0; r < rows; r++) {
      final y = floorTop + r * _plankHeight;
      final paint = r.isEven ? paintDark : paintLight;
      canvas.drawRect(
        Rect.fromLTWH(0, y, size.width, _plankHeight),
        paint,
      );

      // Subtle grain lines within each plank (2-3 thin horizontal lines).
      for (var g = 2; g < _plankHeight - 1; g += 3) {
        canvas.drawRect(
          Rect.fromLTWH(0, y + g, size.width, 1),
          grainPaint,
        );
      }

      // Darker seam line between planks.
      canvas.drawRect(
        Rect.fromLTWH(0, y + _plankHeight - 1, size.width, 1),
        seamPaint,
      );

      // Vertical plank joints (staggered per row).
      final jointOffset = r.isEven ? 0.0 : 40.0;
      for (var x = jointOffset; x < size.width; x += 80) {
        canvas.drawRect(
          Rect.fromLTWH(x, y, 1, _plankHeight),
          seamPaint,
        );
      }
    }
  }

  /// Warm-colored rug in the center of the floor.
  void _drawRug(Canvas canvas, Size size) {
    const floorTop = _wallHeight;
    final floorHeight = size.height - floorTop;
    if (floorHeight < 40) return;

    final rugW = size.width * 0.55;
    final rugH = floorHeight * 0.35;
    final rugLeft = (size.width - rugW) / 2;
    // Place rug a bit below the midpoint of the floor.
    final rugTop = floorTop + (floorHeight - rugH) / 2 + 8;

    // Rug border
    canvas.drawRect(
      Rect.fromLTWH(rugLeft, rugTop, rugW, rugH),
      Paint()..color = PixelTheme.rugAccent,
    );
    // Rug inner fill
    canvas.drawRect(
      Rect.fromLTWH(rugLeft + 3, rugTop + 3, rugW - 6, rugH - 6),
      Paint()..color = PixelTheme.rugWarm,
    );
    // Inner accent border (pattern line)
    canvas.drawRect(
      Rect.fromLTWH(rugLeft + 6, rugTop + 6, rugW - 12, rugH - 12),
      Paint()..color = PixelTheme.rugAccent.withAlpha(120),
    );
    // Innermost fill
    canvas.drawRect(
      Rect.fromLTWH(rugLeft + 8, rugTop + 8, rugW - 16, rugH - 16),
      Paint()..color = PixelTheme.rugWarm,
    );

    // Simple diamond / cross pattern in center of rug.
    final rcx = rugLeft + rugW / 2;
    final rcy = rugTop + rugH / 2;
    final patternPaint = Paint()..color = PixelTheme.rugAccent.withAlpha(100);
    // Horizontal stripe
    canvas.drawRect(
      Rect.fromLTWH(rugLeft + 10, rcy - 1, rugW - 20, 2),
      patternPaint,
    );
    // Vertical stripe
    canvas.drawRect(
      Rect.fromLTWH(rcx - 1, rugTop + 10, 2, rugH - 20),
      patternPaint,
    );
  }

  /// Subtle shadow / gradient where wall meets floor.
  void _drawWallFloorShadow(Canvas canvas, Size size) {
    canvas.drawRect(
      Rect.fromLTWH(0, _wallHeight, size.width, 3),
      Paint()..color = PixelTheme.furnitureDark.withAlpha(30),
    );
    canvas.drawRect(
      Rect.fromLTWH(0, _wallHeight + 3, size.width, 2),
      Paint()..color = PixelTheme.furnitureDark.withAlpha(15),
    );
  }

  @override
  bool shouldRepaint(covariant _OfficeBgPainter oldDelegate) => false;
}

// ---------------------------------------------------------------------------
// Project group header — pixel-styled label
// ---------------------------------------------------------------------------

class _ProjectHeader extends StatelessWidget {
  const _ProjectHeader({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: PixelTheme.furnitureDark.withAlpha(180),
        borderRadius: BorderRadius.zero,
        border: Border(
          bottom: BorderSide(color: PixelTheme.furniture, width: 2),
        ),
      ),
      child: Row(
        children: [
          Icon(Icons.folder_rounded, size: 14, color: PixelTheme.rugWarm),
          const SizedBox(width: 6),
          Text(
            name,
            style: const TextStyle(
              color: Color(0xFFE8D5B5),
              fontSize: 12,
              fontWeight: FontWeight.bold,
              letterSpacing: 0.5,
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Bottom action bar — game-style toolbar with stats and actions
// ---------------------------------------------------------------------------

class _ActionBar extends StatelessWidget {
  const _ActionBar({this.onAddNew, required this.threadCount});

  final VoidCallback? onAddNew;
  final int threadCount;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: PixelTheme.furnitureDark,
        border: const Border(
          top: BorderSide(color: PixelTheme.furniture, width: 3),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(
            children: [
              // Thread count badge
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: PixelTheme.furniture,
                  border: Border.all(color: PixelTheme.furnitureLight, width: 1),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.smart_toy_rounded, size: 14, color: Color(0xFFB0B8C8)),
                    const SizedBox(width: 4),
                    Text(
                      '$threadCount',
                      style: const TextStyle(
                        color: Color(0xFFE8D5B5),
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
              const Spacer(),
              // New session button — game-style
              InkWell(
                onTap: onAddNew,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                  decoration: BoxDecoration(
                    color: const Color(0xFF4A90D9),
                    border: Border.all(color: const Color(0xFF6AB0FF), width: 2),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0xFF2A5090),
                        offset: Offset(0, 2),
                      ),
                    ],
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.add_rounded, size: 16, color: Colors.white),
                      SizedBox(width: 4),
                      Text(
                        'New Session',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 0.5,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
