import 'package:flutter/material.dart';

import '../app/pixel_theme.dart';
import '../models/office_layout.dart';

/// A top-down (bird's eye) pixel-art sprite that draws a robot at a desk.
///
/// Uses a 16x16 logical grid rendered at [size] (default 32px) with a square
/// aspect ratio. Supports 7 visual states based on session status and idle
/// pose. Only `running`/`starting` states animate; all others are static.
class TopDownSprite extends StatefulWidget {
  const TopDownSprite({
    super.key,
    required this.status,
    this.idlePose,
    this.size = 32,
  });

  /// Session status: 'running', 'starting', 'queued', 'waiting',
  /// 'waiting_for_input', 'failed', 'error', 'completed', 'success',
  /// 'interrupted', 'cancelled'.
  final String status;

  /// Idle pose for completed sessions. Ignored for non-completed statuses.
  final IdlePose? idlePose;

  /// Widget size in logical pixels (square).
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
    if (_needsAnimation(widget.status)) {
      _startAnimation();
    }
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
      duration: const Duration(milliseconds: 250),
    )..addStatusListener(_onAnimationStatus);
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

  void _onAnimationStatus(AnimationStatus status) {
    if (status == AnimationStatus.completed) {
      setState(() {
        _frame = (_frame + 1) % 4;
      });
      _controller?.forward(from: 0);
    }
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

// ---------------------------------------------------------------------------
// Painter
// ---------------------------------------------------------------------------

/// Paints a top-down robot-at-desk scene on a 16x16 logical grid.
///
/// Public so other painters can compose or extend the drawing.
class TopDownSpritePainter extends CustomPainter {
  TopDownSpritePainter({
    required this.status,
    this.idlePose,
    required this.frame,
  });

  final String status;
  final IdlePose? idlePose;
  final int frame;

  // Grid dimensions.
  static const int _cols = 16;
  static const int _rows = 16;

  // -- Robot palette (top-down) --
  static const Color _robotHead = Color(0xFFB0B8C8); // metallic gray
  static const Color _robotHeadHighlight = Color(0xFFD0D8E8);
  static const Color _robotHeadShadow = Color(0xFF8090A0);
  static const Color _robotBody = Color(0xFF8898B0); // darker torso
  static const Color _robotAccent = PixelTheme.spriteBody; // blue panel

  // -- Desk palette --
  static const Color _deskWood = Color(0xFFD4A06A); // light wood top-down
  static const Color _deskWoodDark = Color(0xFFB08050); // wood shadow edge
  static const Color _monitorBar = Color(0xFF3A3028); // dark bezel bar
  static const Color _keyboard = Color(0xFF4A3A2E); // warm brown keyboard

  // -- Chair palette --
  static const Color _chair = Color(0xFF3D2B1F); // dark leather
  static const Color _chairHighlight = Color(0xFF5A4438);

  // -- Misc --
  static const Color _bubbleWhite = Color(0xFFFFF8F0);
  static const Color _bubbleBorder = Color(0xFFD4A574);

  // -- Monitor screen colors by status --
  static const Color _screenRunning = Color(0xFF6BA4C8);
  static const Color _screenQueued = Color(0xFFE8D090);
  static const Color _screenFailed = Color(0xFFD46070);
  static const Color _screenOff = Color(0xFF3A3028);

  /// Antenna ball color based on status.
  Color get _antennaColor {
    switch (status) {
      case 'running':
      case 'starting':
        return PixelTheme.statusSuccess; // green
      case 'queued':
      case 'waiting':
      case 'waiting_for_input':
        return PixelTheme.statusWarning; // yellow
      case 'failed':
      case 'error':
        return PixelTheme.statusFailed; // red
      case 'completed':
      case 'success':
        // Dim green for idle completed states.
        return const Color(0xFF5A8A4A);
      case 'interrupted':
      case 'cancelled':
        return PixelTheme.statusFailed; // red
      default:
        return PixelTheme.statusSuccess;
    }
  }

  @override
  void paint(Canvas canvas, Size size) {
    final px = size.width / _cols;
    final py = size.height / _rows;

    void fill(Color c, double x, double y, double w, double h) {
      canvas.drawRect(
        Rect.fromLTWH(x * px, y * py, w * px, h * py),
        Paint()..color = c,
      );
    }

    void fillPixel(Color c, double x, double y) => fill(c, x, y, 1, 1);

    void fillCircle(Color c, double cx, double cy, double r) {
      canvas.drawCircle(
        Offset(cx * px, cy * py),
        r * px,
        Paint()..color = c,
      );
    }

    switch (status) {
      case 'running':
      case 'starting':
        _drawRunning(fill, fillPixel, fillCircle, frame);
      case 'queued':
      case 'waiting':
      case 'waiting_for_input':
        _drawQueued(fill, fillPixel, fillCircle);
      case 'failed':
      case 'error':
        _drawFailed(fill, fillPixel, fillCircle);
      case 'completed':
      case 'success':
        _drawCompleted(fill, fillPixel, fillCircle);
      case 'interrupted':
      case 'cancelled':
        _drawInterrupted(fill, fillPixel, fillCircle);
      default:
        _drawRunning(fill, fillPixel, fillCircle, 0);
    }
  }

  @override
  bool shouldRepaint(covariant TopDownSpritePainter oldDelegate) =>
      oldDelegate.status != status ||
      oldDelegate.frame != frame ||
      oldDelegate.idlePose != idlePose;

  // =========================================================================
  // Shared drawing helpers
  // =========================================================================

  /// Draw the desk at the top of the cell (rows 1-3).
  /// Desk spans most of the width with a wood rectangle.
  void _drawDesk(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
  ) {
    // Desk surface (top of cell)
    fill(_deskWood, 2, 1, 12, 3);
    // Front edge shadow
    fill(_deskWoodDark, 2, 3.5, 12, 0.5);
    // Back edge highlight
    fill(const Color(0xFFE0B87A), 2, 1, 12, 0.5);
  }

  /// Draw the monitor bar on the desk (a thin dark rectangle with a screen).
  void _drawMonitor(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px, {
    required Color screenColor,
  }) {
    // Monitor back (thin bar seen from above)
    fill(_monitorBar, 5, 1.5, 6, 1.5);
    // Screen (colored strip on the near side of the monitor)
    fill(screenColor, 5.5, 2, 5, 0.5);
  }

  /// Draw the keyboard (small dots/rectangle on desk surface).
  void _drawKeyboard(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
  ) {
    fill(_keyboard, 5.5, 3, 5, 0.5);
    // Key dots
    px(const Color(0xFF5A4A3E), 6, 3);
    px(const Color(0xFF5A4A3E), 7.5, 3);
    px(const Color(0xFF5A4A3E), 9, 3);
  }

  /// Draw the chair at the bottom of the cell.
  void _drawChair(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px, {
    double cx = 6,
    double cy = 12,
    bool rotated = false,
  }) {
    if (rotated) {
      // Chair rotated sideways (for phone pose -- facing down)
      fill(_chair, cx, cy, 4, 3);
      fill(_chairHighlight, cx, cy, 4, 0.5);
    } else {
      // Normal chair facing desk (horizontal rectangle)
      fill(_chair, cx, cy, 4, 2.5);
      fill(_chairHighlight, cx, cy, 4, 0.5);
      // Armrests
      fill(_chair, cx - 0.5, cy + 0.5, 0.5, 1.5);
      fill(_chair, cx + 4, cy + 0.5, 0.5, 1.5);
    }
  }

  /// Draw the robot head from above: a circle with antenna stalk + ball.
  void _drawRobotHead(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    void Function(Color, double, double, double) circle, {
    required double hx,
    required double hy,
    bool slumped = false,
  }) {
    // Antenna stalk (thin line going toward the top / toward desk)
    if (!slumped) {
      fill(_robotHeadShadow, hx + 1.25, hy - 1.5, 0.5, 1.5);
      // Antenna ball
      circle(_antennaColor, hx + 1.5, hy - 1.5, 0.6);
    } else {
      // Slumped: antenna droops to the side
      fill(_robotHeadShadow, hx + 2.2, hy - 0.3, 1, 0.4);
      circle(_antennaColor, hx + 3.2, hy - 0.3, 0.5);
    }

    // Head: circular shape from above (metallic dome)
    circle(_robotHead, hx + 1.5, hy + 1.5, 1.8);
    // Highlight crescent on top-left
    circle(_robotHeadHighlight, hx + 1.0, hy + 1.0, 0.8);
  }

  /// Draw the robot body from above: rectangular torso below head.
  void _drawRobotBody(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px, {
    required double bx,
    required double by,
  }) {
    // Torso rectangle
    fill(_robotBody, bx, by, 3, 3);
    // Blue accent panel on back
    fill(_robotAccent, bx + 0.5, by + 0.5, 2, 1.5);
    // Panel detail line
    fill(const Color(0xFF3A70B0), bx + 0.8, by + 1.2, 1.4, 0.3);
  }

  /// Draw small robot arms (lines extending from body sides).
  void _drawArms(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px, {
    required double bx,
    required double by,
    bool typing = false,
    int typingFrame = 0,
    bool raised = false,
    bool limp = false,
    bool outToSides = false,
  }) {
    if (typing) {
      // Arms reaching toward keyboard (toward top of cell)
      final leftDy = (typingFrame == 0 || typingFrame == 2) ? -0.5 : 0.0;
      final rightDy = (typingFrame == 1 || typingFrame == 3) ? -0.5 : 0.0;
      // Left arm
      fill(_robotHeadShadow, bx - 0.5, by - 1 + leftDy, 0.7, 2);
      // Right arm
      fill(_robotHeadShadow, bx + 2.8, by - 1 + rightDy, 0.7, 2);
    } else if (raised) {
      // One arm raised (right arm up)
      fill(_robotHeadShadow, bx - 0.5, by + 0.5, 0.7, 2);
      fill(_robotHeadShadow, bx + 2.8, by - 1.5, 0.7, 2);
    } else if (limp) {
      // Arms hanging down (toward bottom)
      fill(_robotHeadShadow, bx - 0.5, by + 1, 0.7, 2);
      fill(_robotHeadShadow, bx + 2.8, by + 1, 0.7, 2);
    } else if (outToSides) {
      // Arms spread out sideways
      fill(_robotHeadShadow, bx - 1.5, by + 0.5, 2, 0.7);
      fill(_robotHeadShadow, bx + 2.5, by + 0.5, 2, 0.7);
    } else {
      // Default resting arms at sides
      fill(_robotHeadShadow, bx - 0.5, by + 0.3, 0.7, 1.5);
      fill(_robotHeadShadow, bx + 2.8, by + 0.3, 0.7, 1.5);
    }
  }

  // =========================================================================
  // State: running / starting
  // =========================================================================

  void _drawRunning(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    void Function(Color, double, double, double) circle,
    int frame,
  ) {
    _drawDesk(fill, px);
    _drawMonitor(fill, px,
        screenColor: frame.isEven ? _screenRunning : const Color(0xFF5E94B8));
    _drawKeyboard(fill, px);
    _drawChair(fill, px);

    // Robot body centered, sitting in chair area
    const bx = 6.5;
    const by = 8.0;
    _drawRobotBody(fill, px, bx: bx, by: by);

    // Arms typing on keyboard
    _drawArms(fill, px, bx: bx, by: by, typing: true, typingFrame: frame);

    // Head (above body, facing desk)
    _drawRobotHead(fill, px, circle, hx: bx, hy: by - 3);

    // Antenna blink: glow on even frames
    if (frame.isEven) {
      circle(
        _antennaColor.withOpacity(0.3),
        bx + 1.5,
        by - 3 - 1.5,
        1.2,
      );
    }

    // Typing activity dots on keyboard (alternating)
    if (frame == 0 || frame == 2) {
      px(const Color(0xFFFFFFFF), 6.5, 3.2);
    }
    if (frame == 1 || frame == 3) {
      px(const Color(0xFFFFFFFF), 9, 3.2);
    }
  }

  // =========================================================================
  // State: queued / waiting / waiting_for_input
  // =========================================================================

  void _drawQueued(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    void Function(Color, double, double, double) circle,
  ) {
    _drawDesk(fill, px);
    _drawMonitor(fill, px, screenColor: _screenQueued);
    _drawKeyboard(fill, px);
    _drawChair(fill, px);

    const bx = 6.5;
    const by = 8.0;
    _drawRobotBody(fill, px, bx: bx, by: by);

    // One arm raised
    _drawArms(fill, px, bx: bx, by: by, raised: true);

    _drawRobotHead(fill, px, circle, hx: bx, hy: by - 3);

    // "?" speech bubble (top-right)
    fill(_bubbleBorder, 11, 3, 4, 3);
    fill(_bubbleWhite, 11.5, 3.5, 3, 2);
    // Bubble tail
    px(_bubbleBorder, 11, 5.5);

    // "?" character
    px(PixelTheme.statusWarning, 12.5, 4);
    px(PixelTheme.statusWarning, 13, 3.8);
    px(PixelTheme.statusWarning, 13, 4.3);
    px(PixelTheme.statusWarning, 12.5, 4.5);
    px(PixelTheme.statusWarning, 12.5, 5);
  }

  // =========================================================================
  // State: failed / error
  // =========================================================================

  void _drawFailed(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    void Function(Color, double, double, double) circle,
  ) {
    _drawDesk(fill, px);
    _drawMonitor(fill, px, screenColor: _screenFailed);
    _drawKeyboard(fill, px);
    _drawChair(fill, px);

    const bx = 6.5;
    const by = 8.0;
    _drawRobotBody(fill, px, bx: bx, by: by);

    // Arms limp
    _drawArms(fill, px, bx: bx, by: by, limp: true);

    // Head slumped forward toward desk (higher y = more forward in top-down)
    _drawRobotHead(fill, px, circle, hx: bx, hy: by - 4.5, slumped: true);

    // "!" alert bubble (top-right)
    fill(_bubbleBorder, 11, 2, 3, 3);
    fill(_bubbleWhite, 11.5, 2.5, 2, 2);
    px(_bubbleBorder, 11, 4.5);

    // "!" character
    fill(PixelTheme.statusFailed, 12.2, 3, 0.6, 1);
    fill(PixelTheme.statusFailed, 12.2, 4.2, 0.6, 0.3);

    // Smoke puffs above robot (small gray circles)
    circle(const Color(0x60888888), 5, 4, 0.5);
    circle(const Color(0x40888888), 4, 3, 0.4);
    circle(const Color(0x30888888), 3.5, 2, 0.3);
  }

  // =========================================================================
  // State: completed — dispatches to idle pose
  // =========================================================================

  void _drawCompleted(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    void Function(Color, double, double, double) circle,
  ) {
    switch (idlePose) {
      case IdlePose.sleeping:
        _drawSleeping(fill, px, circle);
      case IdlePose.phone:
        _drawPhone(fill, px, circle);
      case IdlePose.coffee:
        _drawCoffee(fill, px, circle);
      case null:
        _drawSleeping(fill, px, circle); // default
    }
  }

  // =========================================================================
  // Idle: sleeping — head down on desk, "ZZZ"
  // =========================================================================

  void _drawSleeping(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    void Function(Color, double, double, double) circle,
  ) {
    _drawDesk(fill, px);
    _drawMonitor(fill, px, screenColor: _screenOff);
    _drawChair(fill, px);

    const bx = 6.5;
    const by = 8.0;
    _drawRobotBody(fill, px, bx: bx, by: by);

    // Arms resting on desk (forward)
    fill(_robotHeadShadow, bx - 0.3, by - 2, 0.7, 2.5);
    fill(_robotHeadShadow, bx + 2.6, by - 2, 0.7, 2.5);

    // Head resting on desk (drawn ON the desk, further up)
    circle(_robotHead, bx + 1.5, 3.8, 1.6);
    circle(_robotHeadHighlight, bx + 1.0, 3.3, 0.6);
    // Dim antenna flopped to side
    fill(_robotHeadShadow, bx + 2.8, 3.2, 1, 0.4);
    circle(const Color(0xFF5A8A4A), bx + 3.8, 3.2, 0.4);

    // "ZZZ" floating text (ascending sizes)
    _drawZ(px, const Color(0xFFB0C0D0), 11, 2);
    _drawZ(px, const Color(0xFF90A0B0), 12.5, 1);
    _drawZ(px, const Color(0xFF7888A0), 14, 0);
  }

  /// Draw a tiny "Z" character at position.
  void _drawZ(
    void Function(Color, double, double) px,
    Color c,
    double x,
    double y,
  ) {
    px(c, x, y);
    px(c, x + 0.5, y);
    px(c, x + 0.5, y + 0.5);
    px(c, x, y + 1);
    px(c, x + 0.5, y + 1);
  }

  // =========================================================================
  // Idle: phone — chair rotated, robot facing down holding phone
  // =========================================================================

  void _drawPhone(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    void Function(Color, double, double, double) circle,
  ) {
    _drawDesk(fill, px);
    _drawMonitor(fill, px, screenColor: _screenOff);

    // Chair rotated (facing downward/away from desk)
    _drawChair(fill, px, cx: 6, cy: 11, rotated: true);

    // Robot body (slightly lower, sitting in rotated chair)
    const bx = 6.5;
    const by = 8.5;
    _drawRobotBody(fill, px, bx: bx, by: by);

    // Arms holding phone (converging in front / below)
    fill(_robotHeadShadow, bx + 0.5, by + 2.8, 0.7, 1.5);
    fill(_robotHeadShadow, bx + 1.8, by + 2.8, 0.7, 1.5);

    // Phone (small rectangle held in hands)
    fill(const Color(0xFF2A2A3A), bx + 0.5, by + 4, 2, 1);
    // Phone screen glow
    fill(const Color(0xFF5577AA), bx + 0.7, by + 4.2, 1.6, 0.5);

    // Head facing down (toward phone, away from desk)
    _drawRobotHead(fill, px, circle, hx: bx, hy: by - 2.5);
  }

  // =========================================================================
  // Idle: coffee — at desk, leaned back, coffee cup on desk, steam
  // =========================================================================

  void _drawCoffee(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    void Function(Color, double, double, double) circle,
  ) {
    _drawDesk(fill, px);
    _drawMonitor(fill, px, screenColor: _screenOff);
    _drawKeyboard(fill, px);
    _drawChair(fill, px);

    // Coffee cup on desk (right side)
    fill(const Color(0xFFE8E0D0), 11, 2, 1.5, 1.5); // cup body
    fill(const Color(0xFF8B6D47), 11, 2, 1.5, 0.3); // coffee surface
    // Cup handle
    fill(const Color(0xFFE8E0D0), 12.5, 2.3, 0.5, 0.8);

    // Steam dots above cup
    circle(const Color(0x50FFFFFF), 11.5, 1.3, 0.3);
    circle(const Color(0x35FFFFFF), 12, 0.7, 0.25);
    circle(const Color(0x20FFFFFF), 11.2, 0.3, 0.2);

    // Robot body (slightly leaned back / lower)
    const bx = 6.5;
    const by = 8.5;
    _drawRobotBody(fill, px, bx: bx, by: by);

    // Arms resting at sides (relaxed)
    _drawArms(fill, px, bx: bx, by: by);

    // Head leaned back slightly (further from desk)
    _drawRobotHead(fill, px, circle, hx: bx, hy: by - 2.5);
  }

  // =========================================================================
  // State: interrupted / cancelled
  // =========================================================================

  void _drawInterrupted(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    void Function(Color, double, double, double) circle,
  ) {
    _drawDesk(fill, px);
    _drawMonitor(fill, px, screenColor: _screenOff);
    // Chair pushed back
    _drawChair(fill, px, cy: 13);

    // Robot body (standing, above chair)
    const bx = 6.5;
    const by = 8.0;
    _drawRobotBody(fill, px, bx: bx, by: by);

    // Arms spread out to sides (alert)
    _drawArms(fill, px, bx: bx, by: by, outToSides: true);

    // Head
    _drawRobotHead(fill, px, circle, hx: bx, hy: by - 3);

    // Alert marks above head (! !)
    fill(PixelTheme.statusFailed, 5.5, 3.5, 0.5, 1);
    fill(PixelTheme.statusFailed, 5.5, 4.8, 0.5, 0.3);
    fill(PixelTheme.statusFailed, 10, 3.5, 0.5, 1);
    fill(PixelTheme.statusFailed, 10, 4.8, 0.5, 0.3);
  }
}
