# Top-Down Office Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current side-view office grid with a top-down management-sim style scene: a park view with building rooftops, and an indoor view showing office floors with corridor layout and robots seen from above.

**Architecture:** Two-layer CustomPainter system — `ParkPainter` draws the grass field with all building rooftops, `IndoorPainter` draws a single office floor with desks and top-down robots. A `SceneController` manages view state (park vs indoor), desk position assignment, and idle pose assignment. Hit testing uses coordinate math on the Canvas.

**Tech Stack:** Flutter CustomPainter, Riverpod for state, GoRouter for navigation. No new dependencies.

**Design doc:** `docs/plans/2026-03-25-topdown-office-redesign.md`

---

### Task 1: Scene Data Model — Desk Assignment & Idle Poses

Create the data layer that assigns each session a fixed desk position and a random idle pose when completed. This is pure logic with no UI — easy to test.

**Files:**
- Create: `lib/models/office_layout.dart`
- Create: `test/models/office_layout_test.dart`

**Step 1: Write the failing tests**

```dart
// test/models/office_layout_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_app/models/office_layout.dart';

void main() {
  group('OfficeLayout', () {
    test('assigns desk positions to sessions', () {
      final layout = OfficeLayout();
      final pos1 = layout.deskFor('session-1');
      final pos2 = layout.deskFor('session-2');
      expect(pos1, isNotNull);
      expect(pos2, isNotNull);
      expect(pos1, isNot(equals(pos2)));
    });

    test('returns same position for same session', () {
      final layout = OfficeLayout();
      final pos1 = layout.deskFor('session-1');
      final pos2 = layout.deskFor('session-1');
      expect(pos1, equals(pos2));
    });

    test('removes session and frees desk', () {
      final layout = OfficeLayout();
      layout.deskFor('session-1');
      layout.remove('session-1');
      expect(layout.hasSession('session-1'), isFalse);
    });

    test('assigns random idle pose for completed status', () {
      final layout = OfficeLayout();
      final pose = layout.idlePoseFor('session-1');
      expect(IdlePose.values, contains(pose));
    });

    test('returns same idle pose for same session', () {
      final layout = OfficeLayout();
      final pose1 = layout.idlePoseFor('session-1');
      final pose2 = layout.idlePoseFor('session-1');
      expect(pose1, equals(pose2));
    });
  });

  group('FloorPagination', () {
    test('calculates floor count', () {
      // 10 sessions, 8 per floor = 2 floors
      expect(FloorPagination.floorCount(10, 8), equals(2));
      expect(FloorPagination.floorCount(8, 8), equals(1));
      expect(FloorPagination.floorCount(0, 8), equals(1)); // min 1 floor
    });

    test('returns sessions for a given floor', () {
      final sessions = List.generate(10, (i) => 'session-$i');
      final floor0 = FloorPagination.sessionsForFloor(sessions, 0, 8);
      final floor1 = FloorPagination.sessionsForFloor(sessions, 1, 8);
      expect(floor0.length, equals(8));
      expect(floor1.length, equals(2));
    });

    test('sorts by priority: running > error > queued > completed', () {
      final statuses = {
        's1': 'completed',
        's2': 'running',
        's3': 'failed',
        's4': 'queued',
        's5': 'completed',
      };
      final sorted = FloorPagination.sortByPriority(
        statuses.keys.toList(),
        (id) => statuses[id]!,
      );
      expect(sorted[0], equals('s2')); // running first
      expect(sorted[1], equals('s3')); // failed second
      expect(sorted[2], equals('s4')); // queued third
    });
  });
}
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/chareice/projects/webmux/pixel-office/packages/flutter_app && flutter test test/models/office_layout_test.dart`
Expected: FAIL — file not found

**Step 3: Implement the model**

```dart
// lib/models/office_layout.dart
import 'dart:math';

/// Idle pose assigned to completed sessions.
enum IdlePose { sleeping, phone, coffee }

/// Manages fixed desk positions and idle poses for sessions.
///
/// Positions are assigned on first access and remain stable until removed.
/// Idle poses are randomly assigned on first access.
class OfficeLayout {
  final _deskPositions = <String, int>{};
  final _idlePoses = <String, IdlePose>{};
  final _random = Random();
  int _nextDesk = 0;

  /// Get or assign a desk index for [sessionId].
  int deskFor(String sessionId) {
    return _deskPositions.putIfAbsent(sessionId, () => _nextDesk++);
  }

  /// Get or assign a random idle pose for [sessionId].
  IdlePose idlePoseFor(String sessionId) {
    return _idlePoses.putIfAbsent(
      sessionId,
      () => IdlePose.values[_random.nextInt(IdlePose.values.length)],
    );
  }

  bool hasSession(String sessionId) => _deskPositions.containsKey(sessionId);

  void remove(String sessionId) {
    _deskPositions.remove(sessionId);
    _idlePoses.remove(sessionId);
  }

  /// Sync layout with current session list — remove stale entries.
  void sync(Set<String> activeSessionIds) {
    _deskPositions.removeWhere((id, _) => !activeSessionIds.contains(id));
    _idlePoses.removeWhere((id, _) => !activeSessionIds.contains(id));
  }
}

/// Floor pagination logic.
class FloorPagination {
  static const defaultDesksPerFloor = 8;

  static int floorCount(int sessionCount, [int desksPerFloor = defaultDesksPerFloor]) {
    if (sessionCount <= 0) return 1;
    return (sessionCount / desksPerFloor).ceil();
  }

  static List<T> sessionsForFloor<T>(
    List<T> sessions,
    int floor, [
    int desksPerFloor = defaultDesksPerFloor,
  ]) {
    final start = floor * desksPerFloor;
    if (start >= sessions.length) return [];
    final end = (start + desksPerFloor).clamp(0, sessions.length);
    return sessions.sublist(start, end);
  }

  /// Sort session IDs by display priority.
  static List<String> sortByPriority(
    List<String> sessionIds,
    String Function(String) statusOf,
  ) {
    int priority(String status) {
      switch (status) {
        case 'running':
        case 'starting':
          return 0;
        case 'failed':
        case 'error':
          return 1;
        case 'queued':
        case 'waiting':
        case 'waiting_for_input':
          return 2;
        case 'interrupted':
        case 'cancelled':
          return 3;
        default: // completed, success
          return 4;
      }
    }

    return [...sessionIds]..sort((a, b) {
      return priority(statusOf(a)).compareTo(priority(statusOf(b)));
    });
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /home/chareice/projects/webmux/pixel-office/packages/flutter_app && flutter test test/models/office_layout_test.dart`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add lib/models/office_layout.dart test/models/office_layout_test.dart
git commit -m "feat: add OfficeLayout model for desk assignment and floor pagination"
```

---

### Task 2: Top-Down Sprite Painter

Replace the side-view `_SpritePainter` approach with a top-down bird's-eye painter. The robot is seen from above: circular head with antenna on top, rectangular body below. The desk is a rectangle with monitor bar and keyboard dots.

**Files:**
- Create: `lib/widgets/topdown_sprite.dart`

**Step 1: Create the top-down sprite widget**

This is a `CustomPainter`-based widget similar to the existing `PixelSprite`, but draws from a bird's-eye perspective. Grid is 16x16 for compact rendering at ~32px.

```dart
// lib/widgets/topdown_sprite.dart
import 'dart:math';
import 'package:flutter/material.dart';
import '../app/pixel_theme.dart';
import '../models/office_layout.dart';

/// A top-down pixel-art robot at a desk, seen from above.
///
/// Used inside the IndoorPainter for each workstation.
/// Can also be used standalone for previews.
class TopDownSprite extends StatefulWidget {
  const TopDownSprite({
    super.key,
    required this.status,
    this.idlePose,
    this.size = 32,
  });

  final String status;
  final IdlePose? idlePose;
  final double size;

  @override
  State<TopDownSprite> createState() => _TopDownSpriteState();
}

class _TopDownSpriteState extends State<TopDownSprite>
    with SingleTickerProviderStateMixin {
  AnimationController? _controller;
  int _frame = 0;

  static bool _needsAnimation(String status) =>
      status == 'running' || status == 'starting';

  @override
  void initState() {
    super.initState();
    if (_needsAnimation(widget.status)) _startAnimation();
  }

  @override
  void didUpdateWidget(covariant TopDownSprite oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.status != widget.status) {
      _frame = 0;
      if (_needsAnimation(widget.status)) {
        _startAnimation();
      } else {
        _stopAnimation();
      }
    }
  }

  void _startAnimation() {
    _controller?.dispose();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    )..addStatusListener((s) {
        if (s == AnimationStatus.completed) {
          setState(() => _frame = (_frame + 1) % 4);
          _controller?.forward(from: 0);
        }
      });
    _controller!.forward();
  }

  void _stopAnimation() {
    _controller?.dispose();
    _controller = null;
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: Size(widget.size, widget.size),
      painter: TopDownSpritePainter(
        status: widget.status,
        idlePose: widget.idlePose,
        frame: _frame,
      ),
    );
  }
}

/// Draws a top-down workstation: desk + chair + robot from above.
///
/// 16x16 logical grid scaled to the widget size.
class TopDownSpritePainter extends CustomPainter {
  TopDownSpritePainter({
    required this.status,
    this.idlePose,
    required this.frame,
  });

  final String status;
  final IdlePose? idlePose;
  final int frame;

  static const int _grid = 16;

  // Palette
  static const _deskColor = PixelTheme.furnitureLight;
  static const _deskEdge = PixelTheme.furniture;
  static const _chairColor = PixelTheme.furnitureDark;
  static const _monitorBezel = Color(0xFF3A3028);
  static const _keyboardColor = Color(0xFF4A3A2E);
  static const _robotHead = Color(0xFFB0B8C8);
  static const _robotHeadDark = Color(0xFF8090A0);
  static const _robotAccent = PixelTheme.spriteBody;

  Color get _antennaColor {
    switch (status) {
      case 'running':
      case 'starting':
        return PixelTheme.statusSuccess;
      case 'queued':
      case 'waiting':
      case 'waiting_for_input':
        return PixelTheme.statusWarning;
      case 'failed':
      case 'error':
        return PixelTheme.statusFailed;
      case 'interrupted':
      case 'cancelled':
        return PixelTheme.statusFailed;
      default:
        return PixelTheme.statusSuccess;
    }
  }

  @override
  void paint(Canvas canvas, Size size) {
    final px = size.width / _grid;

    void fill(Color c, double x, double y, double w, double h) {
      canvas.drawRect(
        Rect.fromLTWH(x * px, y * px, w * px, h * px),
        Paint()..color = c,
      );
    }

    void dot(Color c, double x, double y) => fill(c, x, y, 1, 1);

    // Draw desk (top of frame, robot faces up toward desk)
    _drawDesk(fill, dot);

    // Draw robot based on status
    switch (status) {
      case 'running':
      case 'starting':
        _drawRunning(fill, dot, frame);
      case 'queued':
      case 'waiting':
      case 'waiting_for_input':
        _drawQueued(fill, dot);
      case 'failed':
      case 'error':
        _drawFailed(fill, dot);
      case 'completed':
      case 'success':
        _drawIdle(fill, dot);
      case 'interrupted':
      case 'cancelled':
        _drawInterrupted(fill, dot);
      default:
        _drawRunning(fill, dot, 0);
    }
  }

  /// Desk: rectangle at top of cell, with monitor and keyboard.
  void _drawDesk(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) dot,
  ) {
    // Desk surface (top portion)
    fill(_deskColor, 1, 1, 14, 5);
    fill(_deskEdge, 1, 1, 14, 1); // top edge
    fill(_deskEdge, 1, 5, 14, 1); // front edge

    // Monitor (thin bar on desk)
    fill(_monitorBezel, 3, 2, 10, 2);

    // Keyboard (dot pattern below monitor)
    fill(_keyboardColor, 4, 4.5, 8, 1);
    // Key dots
    for (var i = 0; i < 4; i++) {
      dot(const Color(0xFF5A4A3E), 5 + i * 2.0, 4.5);
    }
  }

  /// Monitor screen color based on status.
  Color get _screenColor {
    switch (status) {
      case 'running':
      case 'starting':
        return const Color(0xFF6BA4C8); // active blue
      case 'queued':
      case 'waiting':
      case 'waiting_for_input':
        return const Color(0xFFE8D090); // waiting yellow
      case 'failed':
      case 'error':
        return const Color(0xFFD46070); // error red
      default:
        return const Color(0xFF3A3028); // off/dark
    }
  }

  /// Draw monitor screen content (on top of bezel).
  void _drawScreen(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) dot,
  ) {
    fill(_screenColor, 4, 2.5, 8, 1);
  }

  /// Robot: circular head from above with antenna.
  void _drawRobotHead(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) dot, {
    double offsetX = 0,
    double offsetY = 0,
    bool dimAntenna = false,
  }) {
    final cx = 8.0 + offsetX;
    final cy = 10.0 + offsetY;

    // Body (below head, rectangular torso seen from above)
    fill(_robotHead, cx - 2, cy + 1.5, 4, 3);
    fill(_robotAccent, cx - 1.5, cy + 2, 3, 2); // blue panel

    // Head (circle approximation — 4x4 with corners cut)
    fill(_robotHead, cx - 2, cy - 1.5, 4, 3);
    fill(_robotHeadDark, cx - 2, cy - 1.5, 4, 0.5); // top shadow

    // Antenna stalk
    fill(_robotHeadDark, cx - 0.5, cy - 3, 1, 1.5);
    // Antenna ball
    final antennaC = dimAntenna
        ? _antennaColor.withOpacity(0.4)
        : _antennaColor;
    fill(antennaC, cx - 1, cy - 4, 2, 1.5);
  }

  /// Chair (behind robot, at bottom of cell).
  void _drawChair(
    void Function(Color, double, double, double, double) fill, {
    double offsetX = 0,
  }) {
    fill(_chairColor, 5.5 + offsetX, 13, 5, 2.5);
    fill(PixelTheme.furniture, 6 + offsetX, 13.5, 4, 1.5);
  }

  // ── State-specific drawings ──

  void _drawRunning(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) dot,
    int frame,
  ) {
    _drawScreen(fill, dot);

    // Robot facing desk (toward top)
    _drawRobotHead(fill, dot, dimAntenna: frame.isOdd);
    _drawChair(fill);

    // Arms reaching toward keyboard (animated)
    final leftX = frame.isEven ? 4.0 : 4.5;
    final rightX = frame.isEven ? 11.0 : 10.5;
    fill(_robotHead, leftX, 7, 2, 1); // left arm
    fill(_robotHead, rightX, 7, 2, 1); // right arm

    // Antenna glow on even frames
    if (frame.isEven) {
      fill(_antennaColor.withOpacity(0.3), 6.5, 5.5, 3, 1.5);
    }
  }

  void _drawQueued(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) dot,
  ) {
    _drawScreen(fill, dot);
    _drawRobotHead(fill, dot);
    _drawChair(fill);

    // Left arm resting
    fill(_robotHead, 4, 9, 2, 1);
    // Right arm raised (question)
    fill(_robotHead, 11, 8, 2, 1);
    fill(_robotHeadDark, 12, 7, 1.5, 1.5); // raised hand

    // "?" bubble
    fill(const Color(0xFFFFF8F0), 12, 4, 3, 3);
    fill(const Color(0xFFD4A574), 12, 4, 3, 0.5);
    dot(PixelTheme.statusWarning, 13, 5);
    dot(PixelTheme.statusWarning, 13, 6);
  }

  void _drawFailed(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) dot,
  ) {
    _drawScreen(fill, dot);

    // Robot head slumped forward (closer to desk)
    _drawRobotHead(fill, dot, offsetY: -2);
    _drawChair(fill);

    // Arms limp on desk
    fill(_robotHead, 4, 7, 2, 1);
    fill(_robotHead, 11, 7, 2, 1);

    // "!" bubble
    fill(const Color(0xFFFFF8F0), 12, 3, 3, 3);
    fill(const Color(0xFFD4A574), 12, 3, 3, 0.5);
    fill(PixelTheme.statusFailed, 13, 4, 1, 1.5);

    // Smoke puffs
    dot(const Color(0x60888888), 3, 6);
    dot(const Color(0x40888888), 2, 5);
  }

  void _drawIdle(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) dot,
  ) {
    final pose = idlePose ?? IdlePose.sleeping;

    switch (pose) {
      case IdlePose.sleeping:
        _drawSleeping(fill, dot);
      case IdlePose.phone:
        _drawPhone(fill, dot);
      case IdlePose.coffee:
        _drawCoffee(fill, dot);
    }
  }

  void _drawSleeping(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) dot,
  ) {
    // Head slumped on desk
    _drawRobotHead(fill, dot, offsetY: -3.5, dimAntenna: true);
    _drawChair(fill);

    // Arms on desk
    fill(_robotHead, 4, 6.5, 2, 1);
    fill(_robotHead, 11, 6.5, 2, 1);

    // ZZZ bubble
    fill(const Color(0xFFc0caf5), 12, 3, 1, 1); // small z
    fill(const Color(0xFFc0caf5), 13, 2, 1.5, 1.5); // medium Z
    fill(const Color(0xFFc0caf5), 14, 0.5, 2, 2); // big Z
  }

  void _drawPhone(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) dot,
  ) {
    // Chair rotated (robot facing away from desk, toward bottom)
    _drawChair(fill);

    // Robot body rotated (facing down)
    fill(_robotHead, 6, 9, 4, 3);
    fill(_robotAccent, 6.5, 9.5, 3, 2);

    // Head (facing down)
    fill(_robotHead, 6, 11.5, 4, 3);
    fill(_robotHeadDark, 6, 14, 4, 0.5);

    // Antenna (pointing down)
    fill(_robotHeadDark, 7.5, 14.5, 1, 1);
    fill(_antennaColor.withOpacity(0.4), 7, 15.5, 2, 1);

    // Phone in hands
    fill(const Color(0xFF2A2A3A), 7, 12, 2, 1.5);
    fill(const Color(0xFF5A8AC0), 7.2, 12.2, 1.6, 1); // screen glow
  }

  void _drawCoffee(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) dot,
  ) {
    // Robot sitting at desk but leaned back
    _drawRobotHead(fill, dot, offsetY: -0.5, dimAntenna: true);
    _drawChair(fill);

    // Left arm resting on desk
    fill(_robotHead, 4, 8, 2, 1);
    // Right arm holding cup (to the side)
    fill(_robotHead, 11, 9, 2, 1);

    // Coffee cup on desk
    fill(const Color(0xFFFFFFFF), 12, 3, 2, 2);
    fill(PixelTheme.rugWarm, 12.2, 3.2, 1.6, 1.6);
    // Steam
    dot(const Color(0x40FFFFFF), 12.5, 2);
    dot(const Color(0x30FFFFFF), 13.5, 1.5);
  }

  void _drawInterrupted(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) dot,
  ) {
    // Robot standing alert (pushed chair back)
    _drawRobotHead(fill, dot, offsetY: 1);
    fill(_chairColor, 5.5, 14, 5, 2); // chair pushed back

    // Arms out to sides
    fill(_robotHead, 3, 10, 2, 1);
    fill(_robotHead, 12, 10, 2, 1);

    // Alert marks above
    dot(PixelTheme.statusFailed, 6, 5.5);
    dot(PixelTheme.statusFailed, 10, 5.5);
  }

  @override
  bool shouldRepaint(covariant TopDownSpritePainter old) =>
      old.status != status || old.frame != frame || old.idlePose != idlePose;
}
```

**Step 2: Verify it builds**

Run: `cd /home/chareice/projects/webmux/pixel-office/packages/flutter_app && flutter analyze lib/widgets/topdown_sprite.dart`
Expected: No errors

**Step 3: Commit**

```bash
git add lib/widgets/topdown_sprite.dart
git commit -m "feat: add TopDownSprite — bird's-eye robot at desk painter"
```

---

### Task 3: Indoor Floor View

Create the `IndoorFloorView` widget that renders an entire office floor as a single scene: two rows of desks along walls, corridor in between, decorative elements (plants, coffee machine, door).

**Files:**
- Create: `lib/widgets/indoor_floor_view.dart`

**Step 1: Create the indoor floor painter**

The indoor floor is drawn as a single `CustomPainter`. Each workstation is placed at a calculated position. The painter receives a list of "desk slots" — each with a session ID, status, and idle pose.

```dart
// lib/widgets/indoor_floor_view.dart
import 'package:flutter/material.dart';
import '../app/pixel_theme.dart';
import '../models/office_layout.dart';
import '../models/run.dart';
import 'topdown_sprite.dart';

/// Data for one desk slot in the floor view.
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

/// Displays one floor of an office in top-down view.
///
/// Two rows of desks face opposite walls with a corridor between them.
/// Tap a desk to select it, long-press for context menu.
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

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Header bar
        _FloorHeader(
          projectName: projectName,
          floorIndex: floorIndex,
          floorCount: floorCount,
          onBack: onBack,
        ),
        // Office floor
        Expanded(
          child: Container(
            color: PixelTheme.floorLight,
            child: LayoutBuilder(
              builder: (context, constraints) {
                return _FloorLayout(
                  desks: desks,
                  constraints: constraints,
                  onDeskTap: onDeskTap,
                  onDeskLongPress: onDeskLongPress,
                  onEmptyDeskTap: onEmptyDeskTap,
                );
              },
            ),
          ),
        ),
        // Floor pagination
        if (floorCount > 1)
          _FloorPagination(
            floorIndex: floorIndex,
            floorCount: floorCount,
            onFloorChange: onFloorChange,
          ),
      ],
    );
  }
}

/// The actual floor layout with walls, corridor, and desks.
class _FloorLayout extends StatelessWidget {
  const _FloorLayout({
    required this.desks,
    required this.constraints,
    this.onDeskTap,
    this.onDeskLongPress,
    this.onEmptyDeskTap,
  });

  final List<DeskSlot> desks;
  final BoxConstraints constraints;
  final void Function(String)? onDeskTap;
  final void Function(String)? onDeskLongPress;
  final VoidCallback? onEmptyDeskTap;

  @override
  Widget build(BuildContext context) {
    // Calculate how many desks fit per row
    const deskSize = 64.0; // each desk cell
    const deskSpacing = 8.0;
    const wallPadding = 12.0;

    final availableWidth = constraints.maxWidth - wallPadding * 2;
    final desksPerRow = ((availableWidth + deskSpacing) / (deskSize + deskSpacing))
        .floor()
        .clamp(2, 6);

    // Split desks into top row and bottom row
    final topRow = desks.take(desksPerRow).toList();
    final bottomRow = desks.skip(desksPerRow).take(desksPerRow).toList();

    return Column(
      children: [
        // Top wall
        Container(
          height: 8,
          decoration: const BoxDecoration(
            color: PixelTheme.wallAccent,
            border: Border(
              bottom: BorderSide(color: PixelTheme.furniture, width: 2),
            ),
          ),
        ),
        // Top row of desks (facing wall)
        Container(
          color: PixelTheme.floorDark,
          padding: EdgeInsets.symmetric(horizontal: wallPadding, vertical: 4),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.start,
            children: [
              for (var i = 0; i < desksPerRow; i++) ...[
                if (i > 0) const SizedBox(width: deskSpacing),
                SizedBox(
                  width: deskSize,
                  height: deskSize,
                  child: i < topRow.length
                      ? _DeskCell(
                          desk: topRow[i],
                          onTap: onDeskTap,
                          onLongPress: onDeskLongPress,
                        )
                      : _EmptyDesk(onTap: onEmptyDeskTap),
                ),
              ],
            ],
          ),
        ),
        // Corridor
        Expanded(
          child: Container(
            decoration: const BoxDecoration(
              color: PixelTheme.floorLight,
              border: Border.symmetric(
                horizontal: BorderSide(
                  color: PixelTheme.floorDark,
                  width: 1,
                ),
              ),
            ),
            child: const _CorridorDecorations(),
          ),
        ),
        // Bottom row of desks (facing wall)
        Container(
          color: PixelTheme.floorDark,
          padding: EdgeInsets.symmetric(horizontal: wallPadding, vertical: 4),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.start,
            children: [
              for (var i = 0; i < desksPerRow; i++) ...[
                if (i > 0) const SizedBox(width: deskSpacing),
                SizedBox(
                  width: deskSize,
                  height: deskSize,
                  child: i < bottomRow.length
                      ? _DeskCell(
                          desk: bottomRow[i],
                          onTap: onDeskTap,
                          onLongPress: onDeskLongPress,
                        )
                      : _EmptyDesk(onTap: onEmptyDeskTap),
                ),
              ],
            ],
          ),
        ),
        // Bottom wall
        Container(
          height: 8,
          decoration: const BoxDecoration(
            color: PixelTheme.wallAccent,
            border: Border(
              top: BorderSide(color: PixelTheme.furniture, width: 2),
            ),
          ),
        ),
        // Door indicator on right side
      ],
    );
  }
}

/// Single desk cell containing a TopDownSprite + label.
class _DeskCell extends StatelessWidget {
  const _DeskCell({
    required this.desk,
    this.onTap,
    this.onLongPress,
  });

  final DeskSlot desk;
  final void Function(String)? onTap;
  final void Function(String)? onLongPress;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap != null ? () => onTap!(desk.sessionId) : null,
      onLongPress: onLongPress != null ? () => onLongPress!(desk.sessionId) : null,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Expanded(
            child: TopDownSprite(
              status: desk.status,
              idlePose: desk.idlePose,
              size: 48,
            ),
          ),
          Text(
            desk.label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: PixelTheme.furnitureDark,
              fontSize: 8,
            ),
          ),
        ],
      ),
    );
  }
}

/// An empty desk (no robot). Tappable to create new session.
class _EmptyDesk extends StatelessWidget {
  const _EmptyDesk({this.onTap});

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: CustomPaint(
        size: const Size(48, 48),
        painter: _EmptyDeskPainter(),
      ),
    );
  }
}

class _EmptyDeskPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final px = size.width / 16;

    void fill(Color c, double x, double y, double w, double h) {
      canvas.drawRect(
        Rect.fromLTWH(x * px, y * px, w * px, h * px),
        Paint()..color = c,
      );
    }

    // Empty desk surface
    fill(PixelTheme.furnitureLight.withOpacity(0.5), 1, 1, 14, 5);
    fill(PixelTheme.furniture.withOpacity(0.3), 1, 1, 14, 1);
    fill(PixelTheme.furniture.withOpacity(0.3), 1, 5, 14, 1);

    // Empty chair
    fill(PixelTheme.furnitureDark.withOpacity(0.3), 5.5, 10, 5, 2.5);

    // "+" hint
    fill(PixelTheme.furniture.withOpacity(0.3), 7.5, 7, 1, 3);
    fill(PixelTheme.furniture.withOpacity(0.3), 6.5, 8, 3, 1);
  }

  @override
  bool shouldRepaint(covariant _EmptyDeskPainter old) => false;
}

/// Corridor decorations: coffee machine, plants, etc.
class _CorridorDecorations extends StatelessWidget {
  const _CorridorDecorations();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          // Coffee machine
          _CorridorItem(
            icon: '☕',
            color: PixelTheme.rugWarm,
          ),
          // Plant
          _CorridorItem(
            icon: '🌿',
            color: PixelTheme.plantGreen,
          ),
          // Door
          Container(
            width: 20,
            height: 28,
            decoration: BoxDecoration(
              color: PixelTheme.furniture,
              border: Border.all(color: PixelTheme.furnitureDark, width: 2),
            ),
            child: Align(
              alignment: const Alignment(0.5, 0),
              child: Container(
                width: 3,
                height: 3,
                decoration: const BoxDecoration(
                  color: PixelTheme.rugWarm,
                  shape: BoxShape.circle,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CorridorItem extends StatelessWidget {
  const _CorridorItem({required this.icon, required this.color});

  final String icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Text(icon, style: const TextStyle(fontSize: 16));
  }
}

/// Floor header with project name and back button.
class _FloorHeader extends StatelessWidget {
  const _FloorHeader({
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
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: const BoxDecoration(
        color: PixelTheme.furnitureDark,
        border: Border(
          bottom: BorderSide(color: PixelTheme.furniture, width: 2),
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Row(
          children: [
            GestureDetector(
              onTap: onBack,
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.arrow_back, size: 16, color: Color(0xFFE8D5B5)),
                  SizedBox(width: 4),
                  Text(
                    'Park',
                    style: TextStyle(color: Color(0xFFE8D5B5), fontSize: 12),
                  ),
                ],
              ),
            ),
            const Spacer(),
            Text(
              projectName,
              style: const TextStyle(
                color: Color(0xFFE8D5B5),
                fontSize: 14,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(width: 8),
            Text(
              '${floorIndex + 1}F / ${floorCount}F',
              style: const TextStyle(
                color: Color(0xFFA0896A),
                fontSize: 11,
              ),
            ),
            const Spacer(),
            const SizedBox(width: 60), // balance back button
          ],
        ),
      ),
    );
  }
}

/// Floor pagination dots + arrows.
class _FloorPagination extends StatelessWidget {
  const _FloorPagination({
    required this.floorIndex,
    required this.floorCount,
    this.onFloorChange,
  });

  final int floorIndex;
  final int floorCount;
  final void Function(int)? onFloorChange;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: const BoxDecoration(
        color: PixelTheme.furnitureDark,
        border: Border(
          top: BorderSide(color: PixelTheme.furniture, width: 2),
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          GestureDetector(
            onTap: floorIndex > 0
                ? () => onFloorChange?.call(floorIndex - 1)
                : null,
            child: Icon(
              Icons.chevron_left,
              size: 20,
              color: floorIndex > 0
                  ? const Color(0xFFE8D5B5)
                  : const Color(0xFF5A4030),
            ),
          ),
          const SizedBox(width: 8),
          for (var i = 0; i < floorCount; i++) ...[
            Container(
              width: 8,
              height: 8,
              margin: const EdgeInsets.symmetric(horizontal: 2),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: i == floorIndex
                    ? const Color(0xFFE8D5B5)
                    : const Color(0xFF5A4030),
              ),
            ),
          ],
          const SizedBox(width: 8),
          GestureDetector(
            onTap: floorIndex < floorCount - 1
                ? () => onFloorChange?.call(floorIndex + 1)
                : null,
            child: Icon(
              Icons.chevron_right,
              size: 20,
              color: floorIndex < floorCount - 1
                  ? const Color(0xFFE8D5B5)
                  : const Color(0xFF5A4030),
            ),
          ),
        ],
      ),
    );
  }
}
```

**Step 2: Verify it builds**

Run: `cd /home/chareice/projects/webmux/pixel-office/packages/flutter_app && flutter analyze lib/widgets/indoor_floor_view.dart`
Expected: No errors

**Step 3: Commit**

```bash
git add lib/widgets/indoor_floor_view.dart
git commit -m "feat: add IndoorFloorView — top-down office floor with corridor layout"
```

---

### Task 4: Park View — Building Rooftops on Grass

Create the `ParkView` widget that shows the outdoor grass scene with building rooftops. Each building represents a project. Tapping a rooftop enters the indoor view.

**Files:**
- Create: `lib/widgets/park_view.dart`

**Step 1: Create the park view**

```dart
// lib/widgets/park_view.dart
import 'dart:math';
import 'package:flutter/material.dart';
import '../app/pixel_theme.dart';

/// One building in the park — represents a project.
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

/// Park view — grass field with building rooftops.
///
/// Each building is a project. Tap to enter indoor view.
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
      color: const Color(0xFF6B8E5A), // grass
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final building in buildings) ...[
              _BuildingRooftop(
                building: building,
                onTap: onBuildingTap != null
                    ? () => onBuildingTap!(building.repoPath)
                    : null,
                onLongPress: onBuildingLongPress != null
                    ? () => onBuildingLongPress!(building.repoPath)
                    : null,
              ),
              const SizedBox(height: 20),
            ],
            // Grass decorations at bottom
            const _GrassDecorations(),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }
}

/// A single building rooftop seen from above.
class _BuildingRooftop extends StatelessWidget {
  const _BuildingRooftop({
    required this.building,
    this.onTap,
    this.onLongPress,
  });

  final BuildingData building;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Building name plate
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            decoration: const BoxDecoration(
              color: PixelTheme.furnitureDark,
              border: Border(
                top: BorderSide(color: PixelTheme.furniture, width: 2),
                left: BorderSide(color: PixelTheme.furniture, width: 2),
                right: BorderSide(color: PixelTheme.furniture, width: 2),
              ),
            ),
            child: Row(
              children: [
                // Chimney with optional smoke
                _Chimney(active: building.hasActiveWork),
                const SizedBox(width: 8),
                Text(
                  building.projectName,
                  style: const TextStyle(
                    color: Color(0xFFE8D5B5),
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 0.5,
                  ),
                ),
                const Spacer(),
                // Status summary badges
                _StatusBadges(building: building),
              ],
            ),
          ),
          // Rooftop body (tile pattern)
          Container(
            height: 44,
            decoration: const BoxDecoration(
              border: Border(
                left: BorderSide(color: PixelTheme.furniture, width: 2),
                right: BorderSide(color: PixelTheme.furniture, width: 2),
                bottom: BorderSide(color: PixelTheme.furniture, width: 2),
              ),
            ),
            child: CustomPaint(
              painter: _RooftopTilePainter(),
              size: Size.infinite,
            ),
          ),
          // Shadow under building
          Container(
            height: 4,
            margin: const EdgeInsets.symmetric(horizontal: 4),
            color: const Color(0xFF4A6B3A),
          ),
        ],
      ),
    );
  }
}

/// Chimney with smoke animation when active.
class _Chimney extends StatelessWidget {
  const _Chimney({required this.active});

  final bool active;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 12,
      height: 18,
      child: Stack(
        children: [
          // Chimney base
          Positioned(
            bottom: 0,
            left: 2,
            child: Container(
              width: 8,
              height: 10,
              color: const Color(0xFF8B4513),
            ),
          ),
          // Smoke puffs (only when active)
          if (active) ...[
            Positioned(
              top: 0,
              left: 3,
              child: Container(
                width: 5,
                height: 5,
                decoration: BoxDecoration(
                  color: const Color(0x60CCCCCC),
                  shape: BoxShape.circle,
                ),
              ),
            ),
            Positioned(
              top: 3,
              left: 5,
              child: Container(
                width: 4,
                height: 4,
                decoration: BoxDecoration(
                  color: const Color(0x40CCCCCC),
                  shape: BoxShape.circle,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Status badges showing running/error/idle counts.
class _StatusBadges extends StatelessWidget {
  const _StatusBadges({required this.building});

  final BuildingData building;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (building.runningCount > 0)
          _Badge(
            label: '⚡${building.runningCount}',
            color: PixelTheme.statusSuccess,
          ),
        if (building.errorCount > 0) ...[
          const SizedBox(width: 4),
          _Badge(
            label: '❌${building.errorCount}',
            color: PixelTheme.statusFailed,
          ),
        ],
        const SizedBox(width: 4),
        _Badge(
          label: '💤${building.idleCount}',
          color: const Color(0xFF8090A0),
        ),
      ],
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
      decoration: BoxDecoration(
        color: color.withOpacity(0.2),
        border: Border.all(color: color.withOpacity(0.5), width: 1),
      ),
      child: Text(
        label,
        style: TextStyle(color: color, fontSize: 10),
      ),
    );
  }
}

/// Rooftop tile pattern — alternating rows of brown/red.
class _RooftopTilePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    const tileH = 6.0;
    const colors = [
      Color(0xFF8B4513), // dark brown
      Color(0xFFA0522D), // sienna
      Color(0xFF8B4513),
      Color(0xFFCD853F), // lighter wood
    ];

    for (var y = 0.0; y < size.height; y += tileH) {
      final colorIndex = (y / tileH).floor() % colors.length;
      canvas.drawRect(
        Rect.fromLTWH(0, y, size.width, tileH),
        Paint()..color = colors[colorIndex],
      );

      // Tile pattern — offset brick pattern
      final offset = colorIndex.isOdd ? 12.0 : 0.0;
      final linePaint = Paint()
        ..color = const Color(0x30000000)
        ..strokeWidth = 0.5;
      for (var x = offset; x < size.width; x += 24) {
        canvas.drawLine(Offset(x, y), Offset(x, y + tileH), linePaint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _RooftopTilePainter old) => false;
}

/// Decorative grass elements (trees, flowers).
class _GrassDecorations extends StatelessWidget {
  const _GrassDecorations();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          _Tree(),
          _Tree(),
          _Tree(),
        ],
      ),
    );
  }
}

class _Tree extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 20,
      height: 24,
      child: CustomPaint(painter: _TreePainter()),
    );
  }
}

class _TreePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final px = size.width / 8;

    void fill(Color c, double x, double y, double w, double h) {
      canvas.drawRect(
        Rect.fromLTWH(x * px, y * px, w * px, h * px),
        Paint()..color = c,
      );
    }

    // Trunk
    fill(PixelTheme.furniture, 3, 7, 2, 3);
    // Canopy layers
    fill(PixelTheme.plantGreenDark, 1, 3, 6, 4);
    fill(PixelTheme.plantGreen, 2, 1, 4, 4);
    fill(PixelTheme.plantGreenLight, 3, 0, 2, 3);
    // Shadow
    fill(const Color(0x30000000), 2, 10, 4, 1);
  }

  @override
  bool shouldRepaint(covariant _TreePainter old) => false;
}
```

**Step 2: Verify it builds**

Run: `cd /home/chareice/projects/webmux/pixel-office/packages/flutter_app && flutter analyze lib/widgets/park_view.dart`
Expected: No errors

**Step 3: Commit**

```bash
git add lib/widgets/park_view.dart
git commit -m "feat: add ParkView — grass field with building rooftops"
```

---

### Task 5: Scene Controller — Park/Indoor State Management

Create `OfficeSceneV2` that manages the two-layer view (park ↔ indoor) and wires up the data pipeline: grouping threads by project, sorting by priority, assigning desk positions and idle poses.

**Files:**
- Create: `lib/widgets/office_scene_v2.dart`

**Step 1: Create the scene controller widget**

```dart
// lib/widgets/office_scene_v2.dart
import 'package:flutter/material.dart';
import '../models/office_layout.dart';
import '../models/run.dart';
import 'indoor_floor_view.dart';
import 'park_view.dart';

/// Top-level scene widget that manages park ↔ indoor view switching.
///
/// Replaces the old [OfficeScene] with a two-layer management sim interface.
class OfficeSceneV2 extends StatefulWidget {
  const OfficeSceneV2({
    super.key,
    required this.threads,
    this.onThreadTap,
    this.onThreadLongPress,
    this.onAddNew,
    this.onAddNewForProject,
  });

  final List<Run> threads;
  final void Function(Run thread)? onThreadTap;
  final void Function(Run thread)? onThreadLongPress;
  final VoidCallback? onAddNew;
  /// Called when tapping an empty desk inside a building — passes the repoPath.
  final void Function(String repoPath)? onAddNewForProject;

  @override
  State<OfficeSceneV2> createState() => _OfficeSceneV2State();
}

class _OfficeSceneV2State extends State<OfficeSceneV2> {
  /// Current view mode.
  String? _selectedProject; // null = park view, non-null = indoor view
  int _currentFloor = 0;

  /// Persistent desk/pose assignments.
  final _layout = OfficeLayout();

  // ── Data helpers ──

  Map<String, List<Run>> _groupByProject() {
    final map = <String, List<Run>>{};
    for (final run in widget.threads) {
      final key = run.repoPath.isNotEmpty ? run.repoPath : 'Other';
      (map[key] ??= []).add(run);
    }
    return map;
  }

  static String _projectName(String repoPath) {
    if (repoPath == 'Other') return 'Other';
    final parts = repoPath.split('/').where((p) => p.isNotEmpty).toList();
    return parts.isNotEmpty ? parts.last : repoPath;
  }

  static String _labelFor(Run run) {
    final raw = run.summary ?? run.prompt;
    if (raw.length <= 30) return raw;
    return '${raw.substring(0, 27)}...';
  }

  static bool _isActive(String status) {
    return status == 'running' ||
        status == 'starting' ||
        status == 'queued' ||
        status == 'waiting' ||
        status == 'waiting_for_input' ||
        status == 'failed' ||
        status == 'error' ||
        status == 'interrupted' ||
        status == 'cancelled';
  }

  static bool _isIdle(String status) {
    return status == 'completed' || status == 'success';
  }

  Run? _findRun(String sessionId) {
    try {
      return widget.threads.firstWhere((t) => t.id == sessionId);
    } catch (_) {
      return null;
    }
  }

  // ── Park view data ──

  List<BuildingData> _buildBuildingList() {
    final groups = _groupByProject();
    return groups.entries.map((entry) {
      final runs = entry.value;
      return BuildingData(
        projectName: _projectName(entry.key),
        repoPath: entry.key,
        runningCount: runs.where((r) =>
            r.status == 'running' || r.status == 'starting').length,
        errorCount: runs.where((r) =>
            r.status == 'failed' || r.status == 'error').length,
        idleCount: runs.where((r) => _isIdle(r.status)).length,
        totalCount: runs.length,
      );
    }).toList()
      // Sort: buildings with active work first
      ..sort((a, b) {
        if (a.hasActiveWork && !b.hasActiveWork) return -1;
        if (!a.hasActiveWork && b.hasActiveWork) return 1;
        if (a.hasErrors && !b.hasErrors) return -1;
        if (!a.hasErrors && b.hasErrors) return 1;
        return b.totalCount.compareTo(a.totalCount);
      });
  }

  // ── Indoor view data ──

  List<DeskSlot> _buildDeskSlots(List<Run> runs) {
    // Sort by priority
    final sorted = FloorPagination.sortByPriority(
      runs.map((r) => r.id).toList(),
      (id) => runs.firstWhere((r) => r.id == id).status,
    );

    // Get sessions for current floor
    final floorSessions = FloorPagination.sessionsForFloor(
      sorted,
      _currentFloor,
    );

    // Sync layout to remove stale sessions
    _layout.sync(runs.map((r) => r.id).toSet());

    return floorSessions.map((sessionId) {
      final run = runs.firstWhere((r) => r.id == sessionId);
      _layout.deskFor(sessionId); // ensure assigned

      return DeskSlot(
        sessionId: sessionId,
        status: run.status,
        label: _labelFor(run),
        idlePose: _isIdle(run.status) ? _layout.idlePoseFor(sessionId) : null,
      );
    }).toList();
  }

  // ── Navigation ──

  void _enterBuilding(String repoPath) {
    setState(() {
      _selectedProject = repoPath;
      _currentFloor = 0;
    });
  }

  void _exitTopark() {
    setState(() {
      _selectedProject = null;
      _currentFloor = 0;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_selectedProject != null) {
      return _buildIndoorView();
    }
    return _buildParkView();
  }

  Widget _buildParkView() {
    return Column(
      children: [
        Expanded(
          child: ParkView(
            buildings: _buildBuildingList(),
            onBuildingTap: _enterBuilding,
          ),
        ),
        _ActionBar(
          onAddNew: widget.onAddNew,
          threadCount: widget.threads.length,
        ),
      ],
    );
  }

  Widget _buildIndoorView() {
    final groups = _groupByProject();
    final runs = groups[_selectedProject] ?? [];
    final desks = _buildDeskSlots(runs);
    final totalFloors = FloorPagination.floorCount(runs.length);

    // Clamp floor index
    if (_currentFloor >= totalFloors) {
      _currentFloor = totalFloors - 1;
    }

    return IndoorFloorView(
      desks: desks,
      projectName: _projectName(_selectedProject!),
      floorIndex: _currentFloor,
      floorCount: totalFloors,
      onDeskTap: (sessionId) {
        final run = _findRun(sessionId);
        if (run != null) widget.onThreadTap?.call(run);
      },
      onDeskLongPress: (sessionId) {
        final run = _findRun(sessionId);
        if (run != null) widget.onThreadLongPress?.call(run);
      },
      onEmptyDeskTap: widget.onAddNewForProject != null
          ? () => widget.onAddNewForProject!(_selectedProject!)
          : null,
      onFloorChange: (floor) => setState(() => _currentFloor = floor),
      onBack: _exitTopark,
    );
  }
}

// Action bar — copied from office_scene.dart, kept for park view bottom.
class _ActionBar extends StatelessWidget {
  const _ActionBar({this.onAddNew, required this.threadCount});

  final VoidCallback? onAddNew;
  final int threadCount;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFF4A2E1A),
        border: Border(top: BorderSide(color: Color(0xFF6B4226), width: 3)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFF6B4226),
                  border: Border.all(color: const Color(0xFF8B5E3C), width: 1),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.smart_toy_rounded,
                        size: 14, color: Color(0xFFB0B8C8)),
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
              GestureDetector(
                onTap: onAddNew,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  decoration: const BoxDecoration(
                    color: Color(0xFF5B8C3E),
                    border: Border(
                      top: BorderSide(color: Color(0xFF7DB356), width: 2),
                      left: BorderSide(color: Color(0xFF7DB356), width: 2),
                      right: BorderSide(color: Color(0xFF3D6B28), width: 2),
                      bottom: BorderSide(color: Color(0xFF3D6B28), width: 3),
                    ),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('+',
                          style: TextStyle(
                              color: Colors.white,
                              fontSize: 16,
                              fontWeight: FontWeight.bold)),
                      SizedBox(width: 6),
                      Text('New Session',
                          style: TextStyle(
                              color: Colors.white,
                              fontSize: 13,
                              fontWeight: FontWeight.bold)),
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
```

**Step 2: Verify it builds**

Run: `cd /home/chareice/projects/webmux/pixel-office/packages/flutter_app && flutter analyze lib/widgets/office_scene_v2.dart`
Expected: No errors

**Step 3: Commit**

```bash
git add lib/widgets/office_scene_v2.dart
git commit -m "feat: add OfficeSceneV2 — park/indoor view switching with state management"
```

---

### Task 6: Integration — Wire Up to OfficeScreen

Replace the old `OfficeScene` with `OfficeSceneV2` in the main screen. Add support for the new `onAddNewForProject` callback.

**Files:**
- Modify: `lib/screens/home/office_screen.dart`

**Step 1: Update OfficeScreen to use OfficeSceneV2**

In `lib/screens/home/office_screen.dart`:

1. Replace import of `office_scene.dart` with `office_scene_v2.dart`
2. Replace `OfficeScene` widget with `OfficeSceneV2`
3. Add `_onAddNewForProject` method that pre-fills the repo path

Key changes:

```dart
// Replace import
import '../../widgets/office_scene_v2.dart';
// Remove old import
// import '../../widgets/office_scene.dart';

// Add new method in _OfficeScreenState:
void _onAddNewForProject(String repoPath) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.zero),
    builder: (ctx) => NewThreadSheet(
      apiClient: ref.read(apiClientProvider),
      initialRepoPath: repoPath,
      onCreated: (agentId, threadId) {
        ref.read(threadsProvider.notifier).refresh();
        _loadData();
        context.push('/threads/$agentId/$threadId');
      },
    ),
  );
}

// In _buildBody(), replace OfficeScene with OfficeSceneV2:
return RefreshIndicator(
  onRefresh: _loadData,
  child: OfficeSceneV2(
    threads: _threads,
    onThreadTap: _onThreadTap,
    onThreadLongPress: _onThreadLongPress,
    onAddNew: _onAddNew,
    onAddNewForProject: _onAddNewForProject,
  ),
);
```

**Step 2: Add `initialRepoPath` parameter to NewThreadSheet**

In `lib/widgets/new_thread_sheet.dart`, add an optional `initialRepoPath` parameter:

```dart
class NewThreadSheet extends StatefulWidget {
  const NewThreadSheet({
    super.key,
    required this.apiClient,
    required this.onCreated,
    this.initialRepoPath,
  });

  final ApiClient apiClient;
  final void Function(String agentId, String threadId) onCreated;
  final String? initialRepoPath;
  // ...
}
```

In `_NewThreadSheetState.initState`, use it:

```dart
// In _loadData(), after setting _recentPaths:
if (widget.initialRepoPath != null) {
  _repoPathController.text = widget.initialRepoPath!;
} else if (_recentPaths.isNotEmpty) {
  _repoPathController.text = _recentPaths.first;
}
```

**Step 3: Verify it builds**

Run: `cd /home/chareice/projects/webmux/pixel-office/packages/flutter_app && flutter build web --no-tree-shake-icons`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add lib/screens/home/office_screen.dart lib/widgets/new_thread_sheet.dart
git commit -m "feat: integrate OfficeSceneV2 into main screen"
```

---

### Task 7: Visual Polish & Testing

Build the web app, run it, and verify all views work correctly. Fix any visual or interaction issues.

**Step 1: Build and run**

```bash
cd /home/chareice/projects/webmux/pixel-office/packages/flutter_app
flutter build web --no-tree-shake-icons
node dev_proxy.mjs
```

**Step 2: Visual verification checklist**

Open `http://localhost:8080` (with auth token) and verify:

- [ ] Park view shows building rooftops on grass background
- [ ] Each building shows project name, chimney, and status badges
- [ ] Tap a building → enters indoor view with corridor layout
- [ ] Indoor view shows two rows of desks with top-down robots
- [ ] Running robots have blinking antenna animation
- [ ] Completed robots show random idle poses (sleeping/phone/coffee)
- [ ] Floor pagination works (arrows + dots)
- [ ] Back button returns to park view
- [ ] Tap desk → navigates to thread detail
- [ ] Long-press desk → shows context menu
- [ ] Tap empty desk → opens new session with pre-filled project
- [ ] "+ New Session" button in park view works
- [ ] Bottom action bar shows correct thread count
- [ ] No performance issues (check CPU usage)

**Step 3: Run existing tests**

```bash
flutter test
```
Expected: All pass (existing smoke test should still work)

**Step 4: Run analyzer**

```bash
flutter analyze
```
Expected: No errors

**Step 5: Fix any issues found, then commit**

```bash
git add -A
git commit -m "feat: visual polish and integration fixes for top-down office"
```

---

### Task 8: Cleanup — Remove Old Widgets

Remove the old side-view office components that are no longer used.

**Files:**
- Delete: `lib/widgets/office_scene.dart` (replaced by `office_scene_v2.dart` + `park_view.dart`)
- Keep: `lib/widgets/pixel_sprite.dart` (still used in thread detail AppBar)
- Keep: `lib/widgets/workstation.dart` (still used? check and remove if not)

**Step 1: Check for remaining usages of old widgets**

Search for imports of `office_scene.dart` and `workstation.dart`. If no other files import them (besides the old office_screen.dart which now uses v2), they can be removed.

**Step 2: Remove unused files**

```bash
# Only if confirmed unused:
git rm lib/widgets/office_scene.dart
# Check workstation.dart too — if only used by office_scene.dart, remove:
git rm lib/widgets/workstation.dart
```

**Step 3: Rename office_scene_v2.dart**

```bash
# Rename to final name
git mv lib/widgets/office_scene_v2.dart lib/widgets/office_scene.dart
```

Update all imports accordingly.

**Step 4: Verify build**

```bash
flutter build web --no-tree-shake-icons
flutter analyze
flutter test
```

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove old side-view office widgets, rename v2 to final"
```
