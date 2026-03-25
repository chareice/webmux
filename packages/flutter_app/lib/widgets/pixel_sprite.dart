import 'package:flutter/material.dart';

import '../app/pixel_theme.dart';

/// A pixel-art character sprite that draws a person sitting at a desk with
/// a monitor. Supports 5 visual states, each with a looping frame animation.
///
/// Used full-size (~80 px) in the office scene and small (~24 px) as an
/// avatar in the chat thread AppBar.
class PixelSprite extends StatefulWidget {
  const PixelSprite({
    super.key,
    required this.status,
    this.size = 80,
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
    if (s == 'running' || s == 'starting') return const Duration(milliseconds: 200);
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
    final width = widget.size * (32 / 24); // 32:24 grid → 4:3 ratio
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

  // Grid is 32 wide × 24 tall.
  static const int _cols = 32;
  static const int _rows = 24;

  @override
  void paint(Canvas canvas, Size size) {
    final px = size.width / _cols; // pixel unit width
    final py = size.height / _rows; // pixel unit height

    // Helpers ----------------------------------------------------------------
    void fill(Color c, double x, double y, double w, double h) {
      canvas.drawRect(
        Rect.fromLTWH(x * px, y * py, w * px, h * py),
        Paint()..color = c,
      );
    }

    void fillPixel(Color c, double x, double y) => fill(c, x, y, 1, 1);

    // -----------------------------------------------------------------------
    // Dispatch to per-state drawing routines.
    // -----------------------------------------------------------------------
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
  // State: running / starting — typing at keyboard
  // =========================================================================

  static void _drawTyping(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    int frame,
  ) {
    // Desk (y=16..18, x=4..28)
    fill(PixelTheme.furniture, 4, 16, 24, 2);
    fill(PixelTheme.furnitureLight, 4, 16, 24, 1); // top highlight

    // Keyboard on desk
    fill(const Color(0xFF3a3a4a), 13, 16, 6, 1);

    // Monitor (on desk, x=8..14, y=10..16)
    fill(const Color(0xFF2a2a3a), 8, 10, 7, 6); // bezel
    // Screen — active blue glow with blinking content
    final screenColor = frame.isEven
        ? PixelTheme.statusRunning
        : PixelTheme.statusRunning.withAlpha(180);
    fill(screenColor, 9, 11, 5, 4);
    // Blinking cursor on screen
    if (frame % 2 == 0) {
      px(Colors.white, 10, 13);
    }
    // Monitor stand
    fill(const Color(0xFF2a2a3a), 10, 16, 3, 1);

    // Chair (behind person, x=17..22, y=14..20)
    fill(const Color(0xFF3a3048), 19, 12, 5, 2); // backrest
    fill(const Color(0xFF3a3048), 20, 14, 3, 4); // backrest lower
    fill(const Color(0xFF2a2038), 19, 20, 5, 1); // seat cushion

    // Person — seated
    // Hair (3 wide, 1 tall)
    fill(PixelTheme.spriteHair, 18, 7, 3, 1);
    // Head (3×3)
    fill(PixelTheme.spriteSkin, 18, 8, 3, 3);
    // Eyes
    px(PixelTheme.spriteHair, 18.5, 9);
    px(PixelTheme.spriteHair, 20, 9);
    // Body (3×4, sitting)
    fill(PixelTheme.spriteBody, 18, 11, 3, 5);

    // Arms — animate typing: alternate which arm is up / down
    final leftArmY = (frame == 0 || frame == 2) ? 15.0 : 14.0;
    final rightArmY = (frame == 1 || frame == 3) ? 15.0 : 14.0;
    // Left arm reaching toward keyboard
    px(PixelTheme.spriteSkin, 17, leftArmY);
    px(PixelTheme.spriteSkin, 16, leftArmY);
    // Right arm
    px(PixelTheme.spriteSkin, 21, rightArmY);
    px(PixelTheme.spriteSkin, 22, rightArmY);

    // Legs (seated, under desk)
    fill(PixelTheme.spriteHair, 18, 18, 1, 3);
    fill(PixelTheme.spriteHair, 20, 18, 1, 3);

    // Desk legs
    fill(PixelTheme.furniture, 5, 18, 1, 4);
    fill(PixelTheme.furniture, 27, 18, 1, 4);
  }

  // =========================================================================
  // State: queued — waiting, hand raised, "?" bubble
  // =========================================================================

  static void _drawQueued(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    int frame,
  ) {
    // Desk
    fill(PixelTheme.furniture, 4, 16, 24, 2);
    fill(PixelTheme.furnitureLight, 4, 16, 24, 1);

    // Monitor (idle / dim)
    fill(const Color(0xFF2a2a3a), 8, 10, 7, 6);
    fill(PixelTheme.statusQueued, 9, 11, 5, 4);
    fill(const Color(0xFF2a2a3a), 10, 16, 3, 1);

    // Chair
    fill(const Color(0xFF3a3048), 19, 12, 5, 2);
    fill(const Color(0xFF3a3048), 20, 14, 3, 4);
    fill(const Color(0xFF2a2038), 19, 20, 5, 1);

    // Person — slight idle sway (shift body by 0-1 px)
    final sway = (frame == 1) ? 0.5 : 0.0;

    // Hair
    fill(PixelTheme.spriteHair, 18 + sway, 7, 3, 1);
    // Head
    fill(PixelTheme.spriteSkin, 18 + sway, 8, 3, 3);
    px(PixelTheme.spriteHair, 18.5 + sway, 9);
    px(PixelTheme.spriteHair, 20 + sway, 9);
    // Body
    fill(PixelTheme.spriteBody, 18 + sway, 11, 3, 5);

    // Left arm resting
    px(PixelTheme.spriteSkin, 17 + sway, 14);
    px(PixelTheme.spriteSkin, 16 + sway, 14);

    // Right arm raised
    px(PixelTheme.spriteSkin, 21 + sway, 11);
    px(PixelTheme.spriteSkin, 22 + sway, 10);
    px(PixelTheme.spriteSkin, 22 + sway, 9);

    // Legs
    fill(PixelTheme.spriteHair, 18 + sway, 18, 1, 3);
    fill(PixelTheme.spriteHair, 20 + sway, 18, 1, 3);

    // "?" speech bubble (above head)
    fill(Colors.white, 23, 4, 5, 4);
    px(Colors.white, 22, 8); // tail
    // "?" character — pixel art question mark
    px(PixelTheme.statusQueued, 24, 5);
    px(PixelTheme.statusQueued, 25, 5);
    px(PixelTheme.statusQueued, 26, 5);
    px(PixelTheme.statusQueued, 26, 6);
    px(PixelTheme.statusQueued, 25, 6);
    px(PixelTheme.statusQueued, 25, 7); // dot below

    // Desk legs
    fill(PixelTheme.furniture, 5, 18, 1, 4);
    fill(PixelTheme.furniture, 27, 18, 1, 4);
  }

  // =========================================================================
  // State: failed — slumped on desk, "!" indicator
  // =========================================================================

  static void _drawFailed(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    int frame,
  ) {
    // Desk
    fill(PixelTheme.furniture, 4, 16, 24, 2);
    fill(PixelTheme.furnitureLight, 4, 16, 24, 1);

    // Monitor — error / red screen
    fill(const Color(0xFF2a2a3a), 8, 10, 7, 6);
    fill(PixelTheme.statusFailed.withAlpha(180), 9, 11, 5, 4);
    // "X" on screen
    px(Colors.white, 10, 12);
    px(Colors.white, 12, 12);
    px(Colors.white, 11, 13);
    px(Colors.white, 10, 14);
    px(Colors.white, 12, 14);
    fill(const Color(0xFF2a2a3a), 10, 16, 3, 1);

    // Chair
    fill(const Color(0xFF3a3048), 19, 12, 5, 2);
    fill(const Color(0xFF3a3048), 20, 14, 3, 4);
    fill(const Color(0xFF2a2038), 19, 20, 5, 1);

    // Person — slumped, head on desk
    // Hair (on desk level)
    fill(PixelTheme.spriteHair, 16, 14, 3, 1);
    // Head slumped forward and down
    fill(PixelTheme.spriteSkin, 16, 15, 3, 2);
    // Body hunched
    fill(PixelTheme.spriteBody, 18, 12, 3, 5);
    // Arms limp on desk
    px(PixelTheme.spriteSkin, 15, 16);
    px(PixelTheme.spriteSkin, 14, 16);
    px(PixelTheme.spriteSkin, 21, 15);
    px(PixelTheme.spriteSkin, 22, 15);

    // Legs
    fill(PixelTheme.spriteHair, 18, 18, 1, 3);
    fill(PixelTheme.spriteHair, 20, 18, 1, 3);

    // "!" indicator above (flashing)
    if (frame == 0) {
      fill(PixelTheme.statusFailed, 18, 5, 1, 3);
      px(PixelTheme.statusFailed, 18, 9);
    }

    // Desk legs
    fill(PixelTheme.furniture, 5, 18, 1, 4);
    fill(PixelTheme.furniture, 27, 18, 1, 4);
  }

  // =========================================================================
  // State: success — relaxing with coffee
  // =========================================================================

  static void _drawSuccess(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    int frame,
  ) {
    // Desk
    fill(PixelTheme.furniture, 4, 16, 24, 2);
    fill(PixelTheme.furnitureLight, 4, 16, 24, 1);

    // Monitor — green success screen
    fill(const Color(0xFF2a2a3a), 8, 10, 7, 6);
    fill(PixelTheme.statusSuccess.withAlpha(160), 9, 11, 5, 4);
    // Checkmark on screen
    px(Colors.white, 10, 14);
    px(Colors.white, 11, 13);
    px(Colors.white, 12, 12);
    px(Colors.white, 13, 13); // not needed for check but adds V shape flair
    fill(const Color(0xFF2a2a3a), 10, 16, 3, 1);

    // Coffee cup on desk (x=23..25, y=14..16)
    fill(Colors.white, 23, 14, 3, 2);
    px(const Color(0xFF6a4a2a), 24, 14); // coffee inside
    // Steam (animating)
    if (frame == 0 || frame == 2) {
      px(Colors.white38, 24, 12);
      px(Colors.white38, 23, 13);
    } else {
      px(Colors.white38, 23, 12);
      px(Colors.white38, 24, 13);
    }

    // Chair
    fill(const Color(0xFF3a3048), 19, 12, 5, 2);
    fill(const Color(0xFF3a3048), 20, 14, 3, 4);
    fill(const Color(0xFF2a2038), 19, 20, 5, 1);

    // Person — leaning back slightly (shifted right by 1)
    const bx = 19.0;
    // Hair
    fill(PixelTheme.spriteHair, bx, 7, 3, 1);
    // Head
    fill(PixelTheme.spriteSkin, bx, 8, 3, 3);
    // Happy eyes (closed/relaxed)
    px(PixelTheme.spriteHair, bx + 0.5, 9);
    px(PixelTheme.spriteHair, bx + 2, 9);
    // Smile
    px(PixelTheme.spriteHair, bx + 0.5, 10);
    px(PixelTheme.spriteHair, bx + 1, 10.5);
    px(PixelTheme.spriteHair, bx + 2, 10);
    // Body leaning back
    fill(PixelTheme.spriteBody, bx, 11, 3, 5);

    // Left arm resting on desk
    px(PixelTheme.spriteSkin, bx - 1, 14);
    px(PixelTheme.spriteSkin, bx - 2, 14);
    // Right arm resting on lap
    px(PixelTheme.spriteSkin, bx + 3, 14);
    px(PixelTheme.spriteSkin, bx + 4, 14);

    // Legs
    fill(PixelTheme.spriteHair, bx, 18, 1, 3);
    fill(PixelTheme.spriteHair, bx + 2, 18, 1, 3);

    // Desk legs
    fill(PixelTheme.furniture, 5, 18, 1, 4);
    fill(PixelTheme.furniture, 27, 18, 1, 4);
  }

  // =========================================================================
  // State: interrupted — standing up startled
  // =========================================================================

  static void _drawInterrupted(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    int frame,
  ) {
    // Desk
    fill(PixelTheme.furniture, 4, 16, 24, 2);
    fill(PixelTheme.furnitureLight, 4, 16, 24, 1);

    // Monitor (off / dim)
    fill(const Color(0xFF2a2a3a), 8, 10, 7, 6);
    fill(const Color(0xFF3a3a4a), 9, 11, 5, 4);
    fill(const Color(0xFF2a2a3a), 10, 16, 3, 1);

    // Chair — pushed back / tilted
    final chairShift = frame == 1 ? 1.0 : 0.0;
    fill(const Color(0xFF3a3048), 22 + chairShift, 13, 4, 2); // backrest tilted
    fill(const Color(0xFF3a3048), 23 + chairShift, 15, 2, 3);
    fill(const Color(0xFF2a2038), 22 + chairShift, 20, 4, 1); // seat

    // Person — standing, taller pose, away from chair
    const px0 = 17.0; // person X base

    // Hair
    fill(PixelTheme.spriteHair, px0, 4, 3, 1);
    // Head
    fill(PixelTheme.spriteSkin, px0, 5, 3, 3);
    // Startled eyes (wide)
    px(PixelTheme.spriteHair, px0 + 0.5, 6);
    px(PixelTheme.spriteHair, px0 + 2, 6);
    // Open mouth
    px(PixelTheme.statusFailed, px0 + 1, 7);

    // Body (standing — taller: 3×6)
    fill(PixelTheme.spriteBody, px0, 8, 3, 6);

    // Arms out to sides (startled gesture)
    final armLift = frame == 1 ? -1.0 : 0.0;
    // Left arm
    px(PixelTheme.spriteSkin, px0 - 1, 9 + armLift);
    px(PixelTheme.spriteSkin, px0 - 2, 8 + armLift);
    px(PixelTheme.spriteSkin, px0 - 3, 8 + armLift);
    // Right arm
    px(PixelTheme.spriteSkin, px0 + 3, 9 + armLift);
    px(PixelTheme.spriteSkin, px0 + 4, 8 + armLift);
    px(PixelTheme.spriteSkin, px0 + 5, 8 + armLift);

    // Legs (standing)
    fill(PixelTheme.spriteHair, px0, 14, 1, 7);
    fill(PixelTheme.spriteHair, px0 + 2, 14, 1, 7);

    // Shoes
    fill(PixelTheme.furniture, px0 - 1, 21, 2, 1);
    fill(PixelTheme.furniture, px0 + 2, 21, 2, 1);

    // Desk legs
    fill(PixelTheme.furniture, 5, 18, 1, 4);
    fill(PixelTheme.furniture, 27, 18, 1, 4);
  }
}
