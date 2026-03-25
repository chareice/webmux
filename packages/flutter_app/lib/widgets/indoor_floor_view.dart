import 'package:flutter/material.dart';

import '../app/pixel_theme.dart';
import '../models/office_layout.dart';
import 'topdown_sprite.dart';

// ---------------------------------------------------------------------------
// Data class
// ---------------------------------------------------------------------------

/// Represents a single desk slot on a floor.
class DeskSlot {
  const DeskSlot({
    required this.sessionId,
    required this.status,
    required this.label,
    this.idlePose,
  });

  final String sessionId;
  final String status;
  final String label;
  final IdlePose? idlePose;
}

// ---------------------------------------------------------------------------
// Main widget
// ---------------------------------------------------------------------------

/// Displays one floor of an office in top-down view.
///
/// Layout (top to bottom): header bar, top wall, top desk row, corridor,
/// bottom desk row, bottom wall, optional floor pagination.
class IndoorFloorView extends StatelessWidget {
  const IndoorFloorView({
    super.key,
    required this.desks,
    required this.projectName,
    required this.floorIndex,
    required this.floorCount,
    this.onDeskTap,
    this.onDeskLongPress,
    this.onEmptyDeskTap,
    this.onFloorChange,
    this.onBack,
  });

  final List<DeskSlot> desks;
  final String projectName;
  final int floorIndex;
  final int floorCount;
  final void Function(String sessionId)? onDeskTap;
  final void Function(String sessionId)? onDeskLongPress;
  final VoidCallback? onEmptyDeskTap;
  final void Function(int floor)? onFloorChange;
  final VoidCallback? onBack;

  static const _headerTextColor = Color(0xFFE8D5B5);
  static const _deskCellWidth = 64.0;
  static const _deskSpacing = 8.0;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final maxDesksPerRow =
            ((constraints.maxWidth + _deskSpacing) / (_deskCellWidth + _deskSpacing))
                .floor()
                .clamp(1, 6);

        // Split desks: first half top row, second half bottom row.
        final topDesks = desks.length <= maxDesksPerRow
            ? desks
            : desks.sublist(0, (desks.length / 2).ceil());
        final bottomDesks = desks.length <= maxDesksPerRow
            ? <DeskSlot>[]
            : desks.sublist((desks.length / 2).ceil());

        // Determine empty slots to fill each row.
        final topEmpty = (maxDesksPerRow - topDesks.length).clamp(0, maxDesksPerRow);
        final bottomEmpty =
            (maxDesksPerRow - bottomDesks.length).clamp(0, maxDesksPerRow);

        return Column(
          children: [
            // -- Header bar --
            _HeaderBar(
              projectName: projectName,
              floorIndex: floorIndex,
              floorCount: floorCount,
              onBack: onBack,
            ),

            // -- Floor content (expandable) --
            Expanded(
              child: Column(
                children: [
                  // Top wall strip
                  const _WallStrip(),

                  // Top desk row
                  _DeskRow(
                    desks: topDesks,
                    emptySlots: topEmpty,
                    maxDesksPerRow: maxDesksPerRow,
                    onDeskTap: onDeskTap,
                    onDeskLongPress: onDeskLongPress,
                    onEmptyDeskTap: onEmptyDeskTap,
                  ),

                  // Corridor
                  const _Corridor(),

                  // Bottom desk row
                  _DeskRow(
                    desks: bottomDesks,
                    emptySlots: bottomEmpty,
                    maxDesksPerRow: maxDesksPerRow,
                    onDeskTap: onDeskTap,
                    onDeskLongPress: onDeskLongPress,
                    onEmptyDeskTap: onEmptyDeskTap,
                  ),

                  // Bottom wall strip
                  const _WallStrip(),

                  const Spacer(),
                ],
              ),
            ),

            // -- Floor pagination (only when multiple floors) --
            if (floorCount > 1)
              _FloorPagination(
                floorIndex: floorIndex,
                floorCount: floorCount,
                onFloorChange: onFloorChange,
              ),
          ],
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Header bar
// ---------------------------------------------------------------------------

class _HeaderBar extends StatelessWidget {
  const _HeaderBar({
    required this.projectName,
    required this.floorIndex,
    required this.floorCount,
    this.onBack,
  });

  final String projectName;
  final int floorIndex;
  final int floorCount;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: PixelTheme.furnitureDark,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      child: Row(
        children: [
          // Back button
          GestureDetector(
            onTap: onBack,
            behavior: HitTestBehavior.opaque,
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '\u2190 ',
                  style: TextStyle(
                    color: IndoorFloorView._headerTextColor,
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(
                  'Park',
                  style: TextStyle(
                    color: IndoorFloorView._headerTextColor,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          // Project name
          Expanded(
            child: Text(
              projectName,
              style: const TextStyle(
                color: IndoorFloorView._headerTextColor,
                fontSize: 13,
                fontWeight: FontWeight.bold,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          // Floor indicator
          Text(
            '${floorIndex + 1}F / ${floorCount}F',
            style: const TextStyle(
              color: IndoorFloorView._headerTextColor,
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Wall strip
// ---------------------------------------------------------------------------

class _WallStrip extends StatelessWidget {
  const _WallStrip();

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 6,
      decoration: const BoxDecoration(
        color: PixelTheme.wallAccent,
        border: Border(
          bottom: BorderSide(color: PixelTheme.furniture, width: 1),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Desk row
// ---------------------------------------------------------------------------

class _DeskRow extends StatelessWidget {
  const _DeskRow({
    required this.desks,
    required this.emptySlots,
    required this.maxDesksPerRow,
    this.onDeskTap,
    this.onDeskLongPress,
    this.onEmptyDeskTap,
  });

  final List<DeskSlot> desks;
  final int emptySlots;
  final int maxDesksPerRow;
  final void Function(String sessionId)? onDeskTap;
  final void Function(String sessionId)? onDeskLongPress;
  final VoidCallback? onEmptyDeskTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: PixelTheme.floorDark,
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          // Occupied desks
          for (int i = 0; i < desks.length; i++) ...[
            if (i > 0) const SizedBox(width: IndoorFloorView._deskSpacing),
            _DeskCell(
              desk: desks[i],
              onTap: onDeskTap,
              onLongPress: onDeskLongPress,
            ),
          ],
          // Empty desk slots
          for (int i = 0; i < emptySlots; i++) ...[
            if (desks.isNotEmpty || i > 0)
              const SizedBox(width: IndoorFloorView._deskSpacing),
            _EmptyDeskCell(onTap: onEmptyDeskTap),
          ],
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Desk cell (occupied)
// ---------------------------------------------------------------------------

class _DeskCell extends StatelessWidget {
  const _DeskCell({
    required this.desk,
    this.onTap,
    this.onLongPress,
  });

  final DeskSlot desk;
  final void Function(String sessionId)? onTap;
  final void Function(String sessionId)? onLongPress;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap != null ? () => onTap!(desk.sessionId) : null,
      onLongPress:
          onLongPress != null ? () => onLongPress!(desk.sessionId) : null,
      child: SizedBox(
        width: IndoorFloorView._deskCellWidth,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Robot sprite
            TopDownSprite(
              status: desk.status,
              idlePose: desk.idlePose,
              size: 48,
            ),
            const SizedBox(height: 2),
            // Label
            Text(
              desk.label,
              style: const TextStyle(
                color: IndoorFloorView._headerTextColor,
                fontSize: 8,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Empty desk cell
// ---------------------------------------------------------------------------

class _EmptyDeskCell extends StatelessWidget {
  const _EmptyDeskCell({this.onTap});

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: const SizedBox(
        width: IndoorFloorView._deskCellWidth,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Faded desk with "+" hint
            CustomPaint(
              size: Size(48, 48),
              painter: _EmptyDeskPainter(),
            ),
            SizedBox(height: 2),
            Text(
              '',
              style: TextStyle(fontSize: 8),
            ),
          ],
        ),
      ),
    );
  }
}

/// Paints a faded desk outline with a "+" hint.
class _EmptyDeskPainter extends CustomPainter {
  const _EmptyDeskPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = PixelTheme.furniture.withOpacity(0.3)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;

    // Desk outline (rectangle)
    final deskRect = Rect.fromLTWH(
      size.width * 0.15,
      size.height * 0.1,
      size.width * 0.7,
      size.height * 0.35,
    );
    canvas.drawRect(deskRect, paint);

    // Chair outline (smaller rectangle below)
    final chairRect = Rect.fromLTWH(
      size.width * 0.25,
      size.height * 0.55,
      size.width * 0.5,
      size.height * 0.3,
    );
    canvas.drawRect(chairRect, paint);

    // "+" hint in the center
    final plusPaint = Paint()
      ..color = PixelTheme.wallAccent.withOpacity(0.5)
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;

    final cx = size.width / 2;
    final cy = size.height / 2;
    const armLen = 6.0;
    canvas.drawLine(
      Offset(cx - armLen, cy),
      Offset(cx + armLen, cy),
      plusPaint,
    );
    canvas.drawLine(
      Offset(cx, cy - armLen),
      Offset(cx, cy + armLen),
      plusPaint,
    );
  }

  @override
  bool shouldRepaint(covariant _EmptyDeskPainter oldDelegate) => false;
}

// ---------------------------------------------------------------------------
// Corridor
// ---------------------------------------------------------------------------

class _Corridor extends StatelessWidget {
  const _Corridor();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: PixelTheme.floorLight,
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 16),
      child: const Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          // Coffee machine
          Text('\u2615', style: TextStyle(fontSize: 18)),
          // Plant
          Text('\uD83C\uDF3F', style: TextStyle(fontSize: 18)),
          // Pixel door
          _PixelDoor(),
          // Another plant
          Text('\uD83C\uDF3F', style: TextStyle(fontSize: 18)),
          // Coffee cup
          Text('\u2615', style: TextStyle(fontSize: 18)),
        ],
      ),
    );
  }
}

/// A tiny pixel-style door decoration.
class _PixelDoor extends StatelessWidget {
  const _PixelDoor();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 16,
      height: 22,
      decoration: BoxDecoration(
        color: PixelTheme.furniture,
        border: Border.all(color: PixelTheme.furnitureDark, width: 1),
      ),
      child: Align(
        alignment: Alignment.centerRight,
        child: Container(
          width: 3,
          height: 3,
          margin: const EdgeInsets.only(right: 2),
          decoration: const BoxDecoration(
            color: PixelTheme.wallAccent,
            shape: BoxShape.circle,
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Floor pagination
// ---------------------------------------------------------------------------

class _FloorPagination extends StatelessWidget {
  const _FloorPagination({
    required this.floorIndex,
    required this.floorCount,
    this.onFloorChange,
  });

  final int floorIndex;
  final int floorCount;
  final void Function(int floor)? onFloorChange;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: PixelTheme.furnitureDark,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          // Left arrow
          GestureDetector(
            onTap: floorIndex > 0
                ? () => onFloorChange?.call(floorIndex - 1)
                : null,
            child: Text(
              '\u25C0',
              style: TextStyle(
                color: floorIndex > 0
                    ? IndoorFloorView._headerTextColor
                    : IndoorFloorView._headerTextColor.withOpacity(0.3),
                fontSize: 12,
              ),
            ),
          ),
          const SizedBox(width: 12),
          // Dots
          for (int i = 0; i < floorCount; i++) ...[
            if (i > 0) const SizedBox(width: 6),
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: i == floorIndex
                    ? IndoorFloorView._headerTextColor
                    : Colors.transparent,
                border: Border.all(
                  color: IndoorFloorView._headerTextColor,
                  width: 1,
                ),
              ),
            ),
          ],
          const SizedBox(width: 12),
          // Right arrow
          GestureDetector(
            onTap: floorIndex < floorCount - 1
                ? () => onFloorChange?.call(floorIndex + 1)
                : null,
            child: Text(
              '\u25B6',
              style: TextStyle(
                color: floorIndex < floorCount - 1
                    ? IndoorFloorView._headerTextColor
                    : IndoorFloorView._headerTextColor.withOpacity(0.3),
                fontSize: 12,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
