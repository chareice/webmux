import 'package:flutter/material.dart';

import '../app/pixel_theme.dart';

/// A pixel-art robot sprite that draws a small cute robot sitting at a desk
/// with a monitor. Supports 5 visual states, each with a looping frame
/// animation.
///
/// Used full-size (~48 px) in the office scene and small (~24 px) as an
/// avatar in the chat thread AppBar.
class PixelSprite extends StatefulWidget {
  const PixelSprite({
    super.key,
    required this.status,
    this.size = 48,
  });

  /// One of: 'running', 'starting', 'queued', 'failed', 'success',
  /// 'interrupted'.
  final String status;

  /// Widget height in logical pixels. Width scales proportionally (4:3 ratio).
  final double size;

  @override
  State<PixelSprite> createState() => _PixelSpriteState();
}

class _PixelSpriteState extends State<PixelSprite>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  int _frame = 0;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: _frameDuration,
    )..addStatusListener(_onAnimationStatus);
    _controller.forward();
  }

  @override
  void didUpdateWidget(covariant PixelSprite oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.status != widget.status) {
      _frame = 0;
      _controller.duration = _frameDuration;
      _controller.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Duration get _frameDuration {
    // Typing states get a faster tick.
    final s = widget.status;
    if (s == 'running' || s == 'starting') {
      return const Duration(milliseconds: 200);
    }
    return const Duration(milliseconds: 300);
  }

  int get _totalFrames {
    switch (widget.status) {
      case 'running':
      case 'starting':
        return 4;
      case 'queued':
      case 'waiting':
      case 'waiting_for_input':
        return 3;
      case 'failed':
      case 'error':
        return 2;
      case 'success':
      case 'completed':
        return 3;
      case 'interrupted':
      case 'cancelled':
        return 2;
      default:
        return 2;
    }
  }

  void _onAnimationStatus(AnimationStatus status) {
    if (status == AnimationStatus.completed) {
      setState(() {
        _frame = (_frame + 1) % _totalFrames;
      });
      _controller.forward(from: 0);
    }
  }

  @override
  Widget build(BuildContext context) {
    final width = widget.size * (32 / 24); // 32:24 grid -> 4:3 ratio
    return CustomPaint(
      size: Size(width, widget.size),
      painter: _SpritePainter(
        status: widget.status,
        frame: _frame,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Painter
// ---------------------------------------------------------------------------

class _SpritePainter extends CustomPainter {
  _SpritePainter({required this.status, required this.frame});

  final String status;
  final int frame;

  // Grid is 32 wide x 24 tall.
  static const int _cols = 32;
  static const int _rows = 24;

  // -- Robot palette --
  static const Color _robotBody = Color(0xFFB0B8C8); // light metallic gray
  static const Color _robotDark = Color(0xFF8090A0); // darker metallic
  static const Color _robotHighlight = Color(0xFFD0D8E8); // bright highlight
  static const Color _robotFaceScreen = Color(0xFF1A2A3A); // dark screen face
  static const Color _robotAccent = PixelTheme.spriteBody; // blue accent

  // -- Shared palette constants --
  static const Color _bezel = Color(0xFF3A3028); // warm dark brown bezel
  static const Color _bezelHighlight = Color(0xFF5A4A3A); // bezel edge
  static const Color _keyboard = Color(0xFF4A3A2E); // warm brown keyboard
  static const Color _bubbleWhite = Color(0xFFFFF8F0); // warm white bubble
  static const Color _bubbleBorder = Color(0xFFD4A574); // warm tan border

  /// Return eye / antenna color based on current status.
  Color get _eyeColor {
    switch (status) {
      case 'running':
      case 'starting':
        return PixelTheme.statusSuccess; // bright green
      case 'queued':
      case 'waiting':
      case 'waiting_for_input':
        return PixelTheme.statusWarning; // yellow
      case 'failed':
      case 'error':
        return PixelTheme.statusFailed; // red
      case 'success':
      case 'completed':
        return PixelTheme.statusSuccess; // bright green
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

    switch (status) {
      case 'running':
      case 'starting':
        _drawTyping(fill, fillPixel, frame);
      case 'queued':
      case 'waiting':
      case 'waiting_for_input':
        _drawQueued(fill, fillPixel, frame);
      case 'failed':
      case 'error':
        _drawFailed(fill, fillPixel, frame);
      case 'success':
      case 'completed':
        _drawSuccess(fill, fillPixel, frame);
      case 'interrupted':
      case 'cancelled':
        _drawInterrupted(fill, fillPixel, frame);
      default:
        _drawTyping(fill, fillPixel, 0);
    }
  }

  @override
  bool shouldRepaint(covariant _SpritePainter oldDelegate) =>
      oldDelegate.status != status || oldDelegate.frame != frame;

  // =========================================================================
  // Shared drawing helpers
  // =========================================================================

  /// Draw the desk with warm wood tones. Takes full width x=3..28, y=16..18.
  static void _drawDesk(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
  ) {
    // Desk top surface
    fill(PixelTheme.furniture, 3, 16, 26, 2);
    // Top edge highlight
    fill(PixelTheme.furnitureLight, 3, 16, 26, 1);
    // Front edge shadow
    fill(PixelTheme.furnitureDark, 3, 18, 26, 0.5);
    // Desk legs (chunky warm wood)
    fill(PixelTheme.furniture, 4, 18, 2, 4);
    fill(PixelTheme.furniture, 26, 18, 2, 4);
    // Leg highlights
    fill(PixelTheme.furnitureLight, 4, 18, 1, 4);
    fill(PixelTheme.furnitureLight, 26, 18, 1, 4);
  }

  /// Draw the computer monitor on the desk.
  static void _drawMonitor(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px, {
    required Color screenColor,
    bool showCursor = false,
    bool showCheck = false,
    bool showX = false,
    bool showDots = false,
  }) {
    // Monitor bezel
    fill(_bezel, 7, 9, 9, 7); // main body
    fill(_bezelHighlight, 7, 9, 9, 1); // top highlight
    fill(_bezelHighlight, 7, 9, 1, 7); // left highlight

    // Screen area
    fill(screenColor, 8, 10, 7, 5);

    // Screen content
    if (showCursor) {
      fill(Colors.white70, 9, 11, 3, 1); // text line 1
      fill(Colors.white54, 9, 12, 4, 1); // text line 2
      fill(Colors.white, 9, 13, 1, 1); // cursor
    }
    if (showCheck) {
      px(Colors.white, 9, 13);
      px(Colors.white, 10, 14);
      px(Colors.white, 11, 13);
      px(Colors.white, 12, 12);
      px(Colors.white, 13, 11);
    }
    if (showX) {
      px(Colors.white, 9, 11);
      px(Colors.white, 13, 11);
      px(Colors.white, 10, 12);
      px(Colors.white, 12, 12);
      px(Colors.white, 11, 13);
      px(Colors.white, 10, 14);
      px(Colors.white, 12, 14);
      px(Colors.white, 9, 15);
      px(Colors.white, 13, 15);
    }
    if (showDots) {
      px(Colors.white70, 9, 12);
      px(Colors.white70, 11, 12);
      px(Colors.white70, 13, 12);
    }

    // Monitor stand
    fill(_bezel, 10, 16, 3, 1);
    fill(_bezel, 9, 16, 5, 0.5);
  }

  /// Draw the robot head (rounded-rectangle screen face) at [headX], [headY].
  void _drawRobotHead(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px, {
    required double headX,
    required double headY,
    bool happy = false,
    bool sad = false,
    bool surprised = false,
  }) {
    // Antenna stalk (1px wide, 2px tall)
    fill(_robotDark, headX + 2, headY - 2.5, 1, 2.5);
    // Antenna ball (color matches state)
    fill(_eyeColor, headX + 1.5, headY - 3.5, 2, 1.5);

    // Head body (rounded rectangle -- 5x4 with corner pixels removed)
    fill(_robotBody, headX, headY, 5, 4);
    // Top corners rounded
    fill(Colors.transparent, headX, headY, 1, 1);
    fill(Colors.transparent, headX + 4, headY, 1, 1);
    // Use background-matching removal by just drawing highlight on edges
    fill(_robotHighlight, headX + 1, headY, 3, 1); // top edge highlight
    fill(_robotHighlight, headX, headY + 1, 1, 2); // left edge highlight

    // Face screen (dark inset)
    fill(_robotFaceScreen, headX + 0.5, headY + 1, 4, 2.5);

    // Eyes on the face screen
    if (happy) {
      // Happy ^_^ eyes: inverted V shapes
      px(_eyeColor, headX + 1, headY + 2.5);
      fill(_eyeColor, headX + 1, headY + 1.5, 1, 1);
      px(_eyeColor, headX + 3, headY + 2.5);
      fill(_eyeColor, headX + 3, headY + 1.5, 1, 1);
      // Small smile line
      px(_eyeColor, headX + 1.5, headY + 3);
      px(_eyeColor, headX + 2, headY + 3.2);
      px(_eyeColor, headX + 2.5, headY + 3);
    } else if (sad) {
      // Sad X eyes
      px(_eyeColor, headX + 1, headY + 1.5);
      px(_eyeColor, headX + 1, headY + 2.5);
      px(_eyeColor, headX + 1.5, headY + 2);
      px(_eyeColor, headX + 3, headY + 1.5);
      px(_eyeColor, headX + 3, headY + 2.5);
      px(_eyeColor, headX + 3.5, headY + 2);
    } else if (surprised) {
      // Surprised ! eyes (big dots)
      fill(_eyeColor, headX + 1, headY + 1.5, 1, 1.5);
      fill(_eyeColor, headX + 3, headY + 1.5, 1, 1.5);
      // Open mouth
      px(_eyeColor, headX + 2, headY + 3.2);
    } else {
      // Normal dot eyes
      px(_eyeColor, headX + 1.5, headY + 2);
      px(_eyeColor, headX + 3, headY + 2);
    }
  }

  /// Draw the robot torso (boxy metallic body with blue accent panel).
  static void _drawRobotBody(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px, {
    required double bodyX,
    required double bodyY,
  }) {
    // Main torso (5x5 boxy)
    fill(_robotBody, bodyX, bodyY, 5, 5);
    // Top highlight
    fill(_robotHighlight, bodyX, bodyY, 5, 1);
    // Left edge highlight
    fill(_robotHighlight, bodyX, bodyY, 1, 5);
    // Bottom shadow
    fill(_robotDark, bodyX, bodyY + 4, 5, 1);

    // Blue chest panel / accent
    fill(_robotAccent, bodyX + 1, bodyY + 1, 3, 2.5);
    // Panel detail lines
    fill(const Color(0xFF3A70B0), bodyX + 1.5, bodyY + 2, 2, 0.5);
  }

  // =========================================================================
  // State: running / starting -- robot typing, antenna blinking
  // =========================================================================

  void _drawTyping(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    int frame,
  ) {
    _drawDesk(fill, px);

    // Keyboard on desk
    fill(_keyboard, 12, 15, 7, 1);
    fill(const Color(0xFF5A4A3E), 12, 15, 7, 0.5);

    // Monitor with active screen
    final screenColor = frame.isEven
        ? const Color(0xFF6BA4C8)
        : const Color(0xFF5E94B8);
    _drawMonitor(fill, px, screenColor: screenColor, showCursor: frame.isEven);

    // Robot head at (17, 3)
    _drawRobotHead(fill, px, headX: 17, headY: 3);

    // Robot body at (17, 7)
    _drawRobotBody(fill, px, bodyX: 17, bodyY: 7);

    // Arms -- animate typing: alternate which arm is lower (pressing key)
    final leftArmY = (frame == 0 || frame == 2) ? 15.0 : 14.5;
    final rightArmY = (frame == 1 || frame == 3) ? 15.0 : 14.5;
    // Left arm (two segments toward keyboard)
    fill(_robotBody, 15, 9, 2, 1); // upper arm
    fill(_robotDark, 14, leftArmY, 2, 1); // hand on keyboard
    fill(_robotBody, 15, 10, 1, (leftArmY - 10)); // forearm connector
    // Right arm
    fill(_robotBody, 22, 9, 2, 1); // upper arm
    fill(_robotDark, 22, rightArmY, 2, 1); // hand on keyboard
    fill(_robotBody, 22, 10, 1, (rightArmY - 10)); // forearm connector

    // Antenna blink effect (every other frame the antenna ball dims)
    if (frame == 1 || frame == 3) {
      fill(const Color(0x4000FF00), 18.5, -0.5, 2, 1.5); // glow around ball
    }
  }

  // =========================================================================
  // State: queued / waiting -- hand raised, eyes yellow "?", antenna pulsing
  // =========================================================================

  void _drawQueued(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    int frame,
  ) {
    _drawDesk(fill, px);

    // Monitor with waiting screen
    _drawMonitor(
      fill,
      px,
      screenColor: const Color(0xFFE8D090),
      showDots: true,
    );

    // Robot head (slight tilt animation)
    final tiltX = (frame == 1) ? 0.5 : 0.0;
    _drawRobotHead(fill, px, headX: 17 + tiltX, headY: 3);

    // Robot body
    _drawRobotBody(fill, px, bodyX: 17, bodyY: 7);

    // Left arm resting on desk
    fill(_robotBody, 15, 9, 2, 1);
    fill(_robotDark, 14, 14, 2, 1);
    fill(_robotBody, 15, 10, 1, 4);

    // Right arm raised (waving)
    final waveY = frame == 1 ? -1.0 : 0.0;
    fill(_robotBody, 22, 9, 2, 1);
    fill(_robotDark, 23, 6 + waveY, 2, 1); // raised hand
    fill(_robotBody, 22, 7 + waveY, 1, 2); // forearm

    // "?" speech bubble
    fill(_bubbleBorder, 25, 1, 6, 5);
    fill(_bubbleWhite, 26, 2, 4, 3);
    px(_bubbleBorder, 25, 6); // tail

    // "?" character
    px(PixelTheme.statusWarning, 27, 2);
    px(PixelTheme.statusWarning, 28, 2);
    px(PixelTheme.statusWarning, 29, 2);
    px(PixelTheme.statusWarning, 29, 3);
    px(PixelTheme.statusWarning, 28, 3);
    px(PixelTheme.statusWarning, 28, 4);

    // Antenna slow pulse (brightness oscillation)
    if (frame == 0) {
      fill(const Color(0x30FFCC00), 18.5, -0.5, 2, 1.5);
    }
  }

  // =========================================================================
  // State: failed / error -- robot slumped, eyes red "X", smoke above
  // =========================================================================

  void _drawFailed(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    int frame,
  ) {
    _drawDesk(fill, px);

    // Monitor with red error screen
    _drawMonitor(
      fill,
      px,
      screenColor: const Color(0xFFD46070),
      showX: true,
    );

    // Robot head (drooped forward and down)
    _drawRobotHead(fill, px, headX: 16, headY: 5, sad: true);

    // Robot body (slightly hunched/lower)
    _drawRobotBody(fill, px, bodyX: 17, bodyY: 9);

    // Arms hanging limp
    fill(_robotBody, 15, 11, 2, 1);
    fill(_robotDark, 14, 14, 2, 1);
    fill(_robotBody, 15, 12, 1, 2);
    fill(_robotBody, 22, 11, 2, 1);
    fill(_robotDark, 23, 14, 2, 1);
    fill(_robotBody, 22, 12, 1, 2);

    // Antenna drooping (tilted to the side)
    // Override the antenna drawn by _drawRobotHead by drawing a droopy one
    fill(_robotDark, 17, 3.5, 1, 1.5); // short droopy stalk going left
    fill(_robotDark, 16, 3, 1, 1); // droopy tip

    // Smoke/spark puffs above robot (animated)
    if (frame == 0) {
      px(const Color(0x80888888), 19, 1);
      px(const Color(0x60888888), 20, 0);
      px(const Color(0x40888888), 18, 0);
      // Spark
      px(const Color(0xFFFFAA00), 21, 2);
    } else {
      px(const Color(0x80888888), 18, 0);
      px(const Color(0x60888888), 20, 1);
      px(const Color(0x40888888), 21, 0);
      // Spark
      px(const Color(0xFFFFAA00), 17, 1);
    }
  }

  // =========================================================================
  // State: success / completed -- robot happy, eyes "^_^", antenna bouncing
  // =========================================================================

  void _drawSuccess(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    int frame,
  ) {
    _drawDesk(fill, px);

    // Monitor with green success screen
    _drawMonitor(
      fill,
      px,
      screenColor: const Color(0xFF7AB85A),
      showCheck: true,
    );

    // Robot head (happy, slightly bouncing)
    final bounceY = (frame == 1) ? -0.5 : 0.0;
    _drawRobotHead(fill, px, headX: 17, headY: 3 + bounceY, happy: true);

    // Robot body
    _drawRobotBody(fill, px, bodyX: 17, bodyY: 7);

    // Arms in a celebratory pose -- both raised
    final armLift = (frame == 1) ? -1.0 : 0.0;
    // Left arm raised
    fill(_robotBody, 15, 9, 2, 1);
    fill(_robotDark, 13, 5 + armLift, 2, 1); // raised hand
    fill(_robotBody, 15, 6 + armLift, 1, 3); // forearm
    // Right arm raised
    fill(_robotBody, 22, 9, 2, 1);
    fill(_robotDark, 24, 5 + armLift, 2, 1); // raised hand
    fill(_robotBody, 23, 6 + armLift, 1, 3); // forearm

    // Happy sparkles
    if (frame == 1) {
      px(const Color(0xFFFFF8DC), 13, 2);
      px(const Color(0xFFFFF8DC), 26, 3);
    }
    if (frame == 2) {
      px(const Color(0xFFFFF8DC), 14, 1);
      px(const Color(0xFFFFF8DC), 25, 2);
      px(const Color(0xFFFFF8DC), 27, 5);
    }
  }

  // =========================================================================
  // State: interrupted / cancelled -- robot alert, eyes "!", antenna up
  // =========================================================================

  void _drawInterrupted(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    int frame,
  ) {
    _drawDesk(fill, px);

    // Monitor dim/off
    _drawMonitor(fill, px, screenColor: const Color(0xFF5A5040));

    // Robot head (higher -- standing alert)
    _drawRobotHead(fill, px, headX: 17, headY: 1, surprised: true);

    // Robot body (standing taller above desk)
    fill(_robotBody, 17, 5.5, 5, 5);
    fill(_robotHighlight, 17, 5.5, 5, 1);
    fill(_robotHighlight, 17, 5.5, 1, 5);
    fill(_robotDark, 17, 9.5, 5, 1);
    // Blue chest panel
    fill(_robotAccent, 18, 6.5, 3, 2.5);
    fill(const Color(0xFF3A70B0), 18.5, 7.5, 2, 0.5);

    // Arms out to sides (startled)
    final armLift = frame == 1 ? -1.0 : 0.0;
    // Left arm
    fill(_robotBody, 15, 7 + armLift, 2, 1);
    fill(_robotDark, 13, 6 + armLift, 2, 1);
    // Right arm
    fill(_robotBody, 22, 7 + armLift, 2, 1);
    fill(_robotDark, 24, 6 + armLift, 2, 1);

    // Lower body / legs hidden behind desk (no legs visible)
    // Just the torso extends down to desk level

    // Alert lines above head
    if (frame == 0) {
      px(PixelTheme.statusFailed, 18, -1);
      px(PixelTheme.statusFailed, 20, -1);
    } else {
      px(PixelTheme.statusFailed, 17, -1);
      px(PixelTheme.statusFailed, 19, -1);
      px(PixelTheme.statusFailed, 21, -1);
    }
  }
}
