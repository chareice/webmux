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

/// Outdoor grass field showing building rooftops — one per project.
///
/// Scrolls vertically. Each building has a name plate, tiled rooftop body,
/// and a shadow strip. Decorative trees appear at the bottom.
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

  // -- Colors --
  static const Color _grass = Color(0xFF6B8E5A);
  static const Color _shadowGreen = Color(0xFF4A6B3A);
  static const Color _namePlateText = Color(0xFFE8D5B5);

  @override
  Widget build(BuildContext context) {
    return Container(
      color: _grass,
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
          child: Column(
            children: [
              for (int i = 0; i < buildings.length; i++) ...[
                if (i > 0) const SizedBox(height: 20),
                _BuildingCard(
                  building: buildings[i],
                  onTap: onBuildingTap,
                  onLongPress: onBuildingLongPress,
                ),
              ],
              // Decorative tree row at the bottom
              const SizedBox(height: 28),
              const _TreeRow(),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Building card
// ---------------------------------------------------------------------------

class _BuildingCard extends StatelessWidget {
  const _BuildingCard({
    required this.building,
    this.onTap,
    this.onLongPress,
  });

  final BuildingData building;
  final void Function(String repoPath)? onTap;
  final void Function(String repoPath)? onLongPress;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap != null ? () => onTap!(building.repoPath) : null,
      onLongPress:
          onLongPress != null ? () => onLongPress!(building.repoPath) : null,
      child: Column(
        children: [
          // Building body (name plate + rooftop) with border
          Container(
            decoration: BoxDecoration(
              border: Border.all(
                color: PixelTheme.furniture,
                width: 2,
              ),
              borderRadius: BorderRadius.zero,
            ),
            child: Column(
              children: [
                // Name plate
                _NamePlate(building: building),
                // Rooftop tiles
                const _RooftopBody(),
              ],
            ),
          ),
          // Shadow strip (slightly narrower)
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 4),
            height: 4,
            decoration: const BoxDecoration(
              color: ParkView._shadowGreen,
              borderRadius: BorderRadius.zero,
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Name plate
// ---------------------------------------------------------------------------

class _NamePlate extends StatelessWidget {
  const _NamePlate({required this.building});

  final BuildingData building;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: PixelTheme.furnitureDark,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      child: Row(
        children: [
          // Chimney with optional smoke
          _Chimney(active: building.hasActiveWork),
          const SizedBox(width: 6),
          // Project name
          Expanded(
            child: Text(
              building.projectName,
              style: const TextStyle(
                color: ParkView._namePlateText,
                fontSize: 13,
                fontWeight: FontWeight.bold,
              ),
              overflow: TextOverflow.ellipsis,
              maxLines: 1,
            ),
          ),
          const SizedBox(width: 8),
          // Status badges
          _StatusBadges(building: building),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Chimney (with smoke puffs when active)
// ---------------------------------------------------------------------------

class _Chimney extends StatelessWidget {
  const _Chimney({required this.active});

  final bool active;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 12,
      height: 20,
      child: CustomPaint(
        painter: _ChimneyPainter(active: active),
      ),
    );
  }
}

class _ChimneyPainter extends CustomPainter {
  const _ChimneyPainter({required this.active});

  final bool active;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint();

    // Chimney body: small brown rectangle at the bottom
    paint.color = PixelTheme.furniture;
    canvas.drawRect(
      Rect.fromLTWH(2, size.height - 10, 8, 10),
      paint,
    );

    // Chimney top rim (slightly wider)
    paint.color = PixelTheme.furnitureLight;
    canvas.drawRect(
      Rect.fromLTWH(1, size.height - 10, 10, 2),
      paint,
    );

    // Smoke puffs when active
    if (active) {
      paint.color = const Color(0x60888888);
      canvas.drawCircle(
        Offset(6, size.height - 14),
        3,
        paint,
      );
      paint.color = const Color(0x40888888);
      canvas.drawCircle(
        Offset(4, size.height - 18),
        2.5,
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _ChimneyPainter oldDelegate) =>
      oldDelegate.active != active;
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
        // Running count (only show if > 0)
        if (building.runningCount > 0) ...[
          _Badge(
            icon: '\u26A1',
            count: building.runningCount,
            color: PixelTheme.statusSuccess,
          ),
          const SizedBox(width: 4),
        ],
        // Error count (only show if > 0)
        if (building.errorCount > 0) ...[
          _Badge(
            icon: '\u274C',
            count: building.errorCount,
            color: PixelTheme.statusFailed,
          ),
          const SizedBox(width: 4),
        ],
        // Idle count (always show)
        _Badge(
          icon: '\uD83D\uDCA4',
          count: building.idleCount,
          color: const Color(0xFF565f89),
        ),
      ],
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({
    required this.icon,
    required this.count,
    required this.color,
  });

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
        borderRadius: BorderRadius.zero,
      ),
      child: Text(
        '$icon$count',
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Rooftop body (brick-pattern tiles)
// ---------------------------------------------------------------------------

class _RooftopBody extends StatelessWidget {
  const _RooftopBody();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      height: 44,
      width: double.infinity,
      child: CustomPaint(
        painter: _RooftopPainter(),
      ),
    );
  }
}

class _RooftopPainter extends CustomPainter {
  const _RooftopPainter();

  // Alternating row colors for brick-like pattern
  static const List<Color> _rowColors = [
    Color(0xFF8B4513),
    Color(0xFFA0522D),
    Color(0xFF8B4513),
    Color(0xFFCD853F),
  ];

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint();
    const rowCount = 4;
    final rowHeight = size.height / rowCount;

    // Draw horizontal brick rows
    for (int r = 0; r < rowCount; r++) {
      paint.color = _rowColors[r % _rowColors.length];
      canvas.drawRect(
        Rect.fromLTWH(0, r * rowHeight, size.width, rowHeight),
        paint,
      );
    }

    // Draw vertical brick-pattern lines (staggered)
    paint.color = PixelTheme.furnitureDark.withOpacity(0.35);
    paint.strokeWidth = 1;

    const brickWidth = 24.0;
    for (int r = 0; r < rowCount; r++) {
      final yTop = r * rowHeight;
      final offset = (r.isOdd) ? brickWidth / 2 : 0.0;
      for (double x = offset; x < size.width; x += brickWidth) {
        canvas.drawLine(
          Offset(x, yTop),
          Offset(x, yTop + rowHeight),
          paint,
        );
      }
    }

    // Draw horizontal mortar lines between rows
    paint.color = PixelTheme.furnitureDark.withOpacity(0.25);
    for (int r = 1; r < rowCount; r++) {
      final y = r * rowHeight;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  @override
  bool shouldRepaint(covariant _RooftopPainter oldDelegate) => false;
}

// ---------------------------------------------------------------------------
// Decorative tree row
// ---------------------------------------------------------------------------

class _TreeRow extends StatelessWidget {
  const _TreeRow();

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: List.generate(5, (index) {
        // Vary tree sizes slightly for a natural look
        final sizes = [28.0, 32.0, 26.0, 34.0, 30.0];
        return _PixelTree(size: sizes[index]);
      }),
    );
  }
}

class _PixelTree extends StatelessWidget {
  const _PixelTree({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: Size(size, size * 1.25),
      painter: const _TreePainter(),
    );
  }
}

class _TreePainter extends CustomPainter {
  const _TreePainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint();

    // Work on an 8x10 logical grid
    final px = size.width / 8;
    final py = size.height / 10;

    void fill(Color c, double x, double y, double w, double h) {
      canvas.drawRect(
        Rect.fromLTWH(x * px, y * py, w * px, h * py),
        paint..color = c,
      );
    }

    // Trunk (centered, bottom portion)
    fill(PixelTheme.furniture, 3, 7, 2, 3);
    // Trunk highlight
    fill(PixelTheme.furnitureLight, 3, 7, 1, 3);

    // Canopy layer 1 (bottom, widest) -- dark green
    fill(PixelTheme.plantGreenDark, 1, 4, 6, 3);
    // Canopy layer 2 (middle) -- medium green
    fill(PixelTheme.plantGreen, 2, 2, 4, 3);
    // Canopy layer 3 (top, smallest) -- light green
    fill(PixelTheme.plantGreenLight, 3, 0, 2, 3);

    // Canopy highlight dots for texture
    paint.color = PixelTheme.plantGreenLight.withOpacity(0.5);
    canvas.drawRect(
      Rect.fromLTWH(2 * px, 3 * py, px, py),
      paint,
    );
    canvas.drawRect(
      Rect.fromLTWH(5 * px, 5 * py, px, py),
      paint,
    );

    // Shadow under canopy edges
    paint.color = PixelTheme.plantGreenDark.withOpacity(0.4);
    canvas.drawRect(
      Rect.fromLTWH(1 * px, 6.5 * py, 6 * px, 0.5 * py),
      paint,
    );
  }

  @override
  bool shouldRepaint(covariant _TreePainter oldDelegate) => false;
}
