import 'package:flutter/material.dart';

import '../app/pixel_theme.dart';

// ---------------------------------------------------------------------------
// Data class
// ---------------------------------------------------------------------------

/// Data for one building on the park view.
class BuildingData {
  const BuildingData({
    required this.projectName,
    required this.repoPath,
    required this.runningCount,
    required this.errorCount,
    required this.idleCount,
    required this.totalCount,
  });

  final String projectName;
  final String repoPath;
  final int runningCount;
  final int errorCount;
  final int idleCount;
  final int totalCount;

  bool get hasActiveWork => runningCount > 0;
  bool get hasErrors => errorCount > 0;
}

// ---------------------------------------------------------------------------
// Main widget
// ---------------------------------------------------------------------------

class ParkView extends StatelessWidget {
  const ParkView({
    super.key,
    required this.buildings,
    this.onBuildingTap,
    this.onBuildingLongPress,
  });

  final List<BuildingData> buildings;
  final void Function(String repoPath)? onBuildingTap;
  final void Function(String repoPath)? onBuildingLongPress;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFF6B8E5A),
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
          child: Wrap(
            spacing: 16,
            runSpacing: 20,
            alignment: WrapAlignment.center,
            children: [
              for (final b in buildings)
                _PixelBuilding(
                  building: b,
                  onTap: onBuildingTap != null
                      ? () => onBuildingTap!(b.repoPath)
                      : null,
                  onLongPress: onBuildingLongPress != null
                      ? () => onBuildingLongPress!(b.repoPath)
                      : null,
                ),
              // Trees at the end
              const SizedBox(width: double.infinity, height: 8),
              const _TreeRow(),
              const SizedBox(width: double.infinity, height: 20),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Pixel building — a cute house drawn with CustomPainter
// ---------------------------------------------------------------------------

class _PixelBuilding extends StatelessWidget {
  const _PixelBuilding({
    required this.building,
    this.onTap,
    this.onLongPress,
  });

  final BuildingData building;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  /// Building width scales with session count.
  double get _width {
    if (building.totalCount <= 4) return 140;
    if (building.totalCount <= 12) return 180;
    return 220;
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: SizedBox(
        width: _width,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Building name above the house
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: PixelTheme.furnitureDark,
                border: Border.all(color: PixelTheme.furniture, width: 1),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    building.projectName,
                    style: const TextStyle(
                      color: Color(0xFFE8D5B5),
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 2),
            // The actual pixel house
            SizedBox(
              width: _width,
              height: 100,
              child: CustomPaint(
                painter: _HousePainter(
                  hasSmoke: building.hasActiveWork,
                  hasError: building.hasErrors,
                ),
              ),
            ),
            // Status badges below the house
            const SizedBox(height: 4),
            _StatusBadges(building: building),
            // Ground shadow
            Container(
              margin: const EdgeInsets.only(top: 2),
              width: _width - 8,
              height: 4,
              color: const Color(0xFF4A6B3A),
            ),
          ],
        ),
      ),
    );
  }
}

/// Paints a cute pixel-art house with roof, walls, windows, door, and chimney.
class _HousePainter extends CustomPainter {
  const _HousePainter({required this.hasSmoke, required this.hasError});

  final bool hasSmoke;
  final bool hasError;

  // Colors
  static const _roofDark = Color(0xFF8B4513);
  static const _roofMain = Color(0xFFA0522D);
  static const _roofLight = Color(0xFFCD853F);
  static const _roofEdge = Color(0xFF6B3410);
  static const _wallMain = Color(0xFFE8D5B5);
  static const _wallDark = Color(0xFFD4B896);
  static const _wallShadow = Color(0xFFC0A07A);
  static const _windowFrame = Color(0xFF6B4226);
  static const _windowGlass = Color(0xFF87CEEB);
  static const _windowGlassLit = Color(0xFFFFE88A);
  static const _doorColor = Color(0xFF6B4226);
  static const _doorKnob = Color(0xFFD4A06A);
  static const _chimney = Color(0xFF8B4513);
  static const _chimneyTop = Color(0xFF6B3410);

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;

    final p = Paint();

    // ── Chimney (behind roof, top-right) ──
    final chimneyX = w * 0.72;
    p.color = _chimney;
    canvas.drawRect(Rect.fromLTWH(chimneyX, 2, 12, 30), p);
    p.color = _chimneyTop;
    canvas.drawRect(Rect.fromLTWH(chimneyX - 1, 2, 14, 4), p);

    // Smoke puffs
    if (hasSmoke) {
      p.color = const Color(0x55AAAAAA);
      canvas.drawRect(Rect.fromLTWH(chimneyX + 2, -6, 6, 6), p);
      p.color = const Color(0x35AAAAAA);
      canvas.drawRect(Rect.fromLTWH(chimneyX + 5, -14, 5, 5), p);
      p.color = const Color(0x20AAAAAA);
      canvas.drawRect(Rect.fromLTWH(chimneyX, -20, 4, 4), p);
    }

    // ── Roof (triangular / peaked shape) ──
    final roofPeakY = 8.0;
    final roofBaseY = h * 0.45;
    final roofOverhang = 6.0;

    // Draw roof as layered horizontal bars getting wider (top to bottom)
    final roofRows = ((roofBaseY - roofPeakY) / 3).floor();
    for (var i = 0; i < roofRows; i++) {
      final t = i / roofRows;
      final y = roofPeakY + i * 3;
      final inset = (1 - t) * (w * 0.3);
      final left = inset - roofOverhang;
      final right = w - inset + roofOverhang;

      // Alternate colors for tile rows
      if (i % 3 == 0) {
        p.color = _roofDark;
      } else if (i % 3 == 1) {
        p.color = _roofMain;
      } else {
        p.color = _roofLight;
      }
      canvas.drawRect(Rect.fromLTWH(left, y, right - left, 3), p);
    }

    // Roof ridge line at top
    p.color = _roofEdge;
    canvas.drawRect(
      Rect.fromLTWH(w * 0.3 - roofOverhang, roofPeakY, w * 0.4 + roofOverhang * 2, 3),
      p,
    );

    // Roof bottom edge
    p.color = _roofEdge;
    canvas.drawRect(Rect.fromLTWH(-roofOverhang, roofBaseY - 2, w + roofOverhang * 2, 3), p);

    // ── Front wall ──
    final wallTop = roofBaseY;
    final wallBottom = h - 4;
    final wallHeight = wallBottom - wallTop;

    p.color = _wallMain;
    canvas.drawRect(Rect.fromLTWH(0, wallTop, w, wallHeight), p);

    // Wall shadow at top (under roof)
    p.color = _wallShadow;
    canvas.drawRect(Rect.fromLTWH(0, wallTop, w, 4), p);

    // Wall texture — subtle horizontal line
    p.color = _wallDark;
    canvas.drawRect(Rect.fromLTWH(0, wallTop + wallHeight * 0.5, w, 1), p);

    // Wall side edges
    p.color = PixelTheme.furniture;
    canvas.drawRect(Rect.fromLTWH(0, wallTop, 2, wallHeight), p);
    canvas.drawRect(Rect.fromLTWH(w - 2, wallTop, 2, wallHeight), p);

    // ── Door (center) ──
    final doorW = 16.0;
    final doorH = wallHeight * 0.7;
    final doorX = (w - doorW) / 2;
    final doorY = wallBottom - doorH;

    p.color = _doorColor;
    canvas.drawRect(Rect.fromLTWH(doorX, doorY, doorW, doorH), p);
    // Door frame highlight
    p.color = PixelTheme.furnitureLight;
    canvas.drawRect(Rect.fromLTWH(doorX, doorY, doorW, 2), p);
    canvas.drawRect(Rect.fromLTWH(doorX, doorY, 2, doorH), p);
    // Door knob
    p.color = _doorKnob;
    canvas.drawRect(Rect.fromLTWH(doorX + doorW - 5, doorY + doorH * 0.5, 2, 2), p);

    // ── Windows (one on each side of door) ──
    final windowW = 14.0;
    final windowH = 12.0;
    final windowY = wallTop + 8;

    // Left window
    _drawWindow(canvas, doorX - windowW - 10, windowY, windowW, windowH);
    // Right window
    _drawWindow(canvas, doorX + doorW + 10, windowY, windowW, windowH);

    // ── Base / foundation ──
    p.color = PixelTheme.furnitureDark;
    canvas.drawRect(Rect.fromLTWH(0, wallBottom, w, 4), p);
  }

  void _drawWindow(Canvas canvas, double x, double y, double w, double h) {
    final p = Paint();
    // Frame
    p.color = _windowFrame;
    canvas.drawRect(Rect.fromLTWH(x, y, w, h), p);
    // Glass
    p.color = hasError ? const Color(0xFFFFAAAA) : _windowGlass;
    canvas.drawRect(Rect.fromLTWH(x + 2, y + 2, w - 4, h - 4), p);
    // Cross bar
    p.color = _windowFrame;
    canvas.drawRect(Rect.fromLTWH(x + w / 2 - 0.5, y, 1, h), p);
    canvas.drawRect(Rect.fromLTWH(x, y + h / 2 - 0.5, w, 1), p);
    // Light glint
    p.color = Colors.white.withOpacity(0.3);
    canvas.drawRect(Rect.fromLTWH(x + 2, y + 2, 3, 3), p);
  }

  @override
  bool shouldRepaint(covariant _HousePainter old) =>
      old.hasSmoke != hasSmoke || old.hasError != hasError;
}

// ---------------------------------------------------------------------------
// Status badges
// ---------------------------------------------------------------------------

class _StatusBadges extends StatelessWidget {
  const _StatusBadges({required this.building});

  final BuildingData building;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (building.runningCount > 0) ...[
          _Badge(icon: '\u26A1', count: building.runningCount, color: PixelTheme.statusSuccess),
          const SizedBox(width: 3),
        ],
        if (building.errorCount > 0) ...[
          _Badge(icon: '\u274C', count: building.errorCount, color: PixelTheme.statusFailed),
          const SizedBox(width: 3),
        ],
        _Badge(icon: '\uD83D\uDCA4', count: building.idleCount, color: const Color(0xFF565f89)),
      ],
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.icon, required this.count, required this.color});

  final String icon;
  final int count;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        border: Border.all(color: color.withOpacity(0.4), width: 1),
      ),
      child: Text(
        '$icon$count',
        style: TextStyle(color: color, fontSize: 9, fontWeight: FontWeight.bold),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Decorative trees
// ---------------------------------------------------------------------------

class _TreeRow extends StatelessWidget {
  const _TreeRow();

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: List.generate(5, (i) {
        final sizes = [28.0, 32.0, 26.0, 34.0, 30.0];
        return CustomPaint(
          size: Size(sizes[i], sizes[i] * 1.25),
          painter: const _TreePainter(),
        );
      }),
    );
  }
}

class _TreePainter extends CustomPainter {
  const _TreePainter();

  @override
  void paint(Canvas canvas, Size size) {
    final px = size.width / 8;
    final py = size.height / 10;
    final p = Paint();

    void f(Color c, double x, double y, double w, double h) {
      p.color = c;
      canvas.drawRect(Rect.fromLTWH(x * px, y * py, w * px, h * py), p);
    }

    f(PixelTheme.furniture, 3, 7, 2, 3);
    f(PixelTheme.furnitureLight, 3, 7, 1, 3);
    f(PixelTheme.plantGreenDark, 1, 4, 6, 3);
    f(PixelTheme.plantGreen, 2, 2, 4, 3);
    f(PixelTheme.plantGreenLight, 3, 0, 2, 3);
  }

  @override
  bool shouldRepaint(covariant _TreePainter old) => false;
}
