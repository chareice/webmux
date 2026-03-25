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

  // -- Shared palette constants --
  static const Color _bezel = Color(0xFF3A3028); // warm dark brown bezel
  static const Color _bezelHighlight = Color(0xFF5A4A3A); // bezel edge
  static const Color _chairSeat = Color(0xFF8B5E3C); // warm brown chair
  static const Color _chairBack = Color(0xFF6B4226); // darker chair back
  static const Color _keyboard = Color(0xFF4A3A2E); // warm brown keyboard
  static const Color _coffee = Color(0xFF6A4A2A); // coffee brown
  static const Color _steam = Color(0x60FFFFFF); // translucent white steam
  static const Color _bubbleWhite = Color(0xFFFFF8F0); // warm white bubble
  static const Color _bubbleBorder = Color(0xFFD4A574); // warm tan border
  static const Color _sweatDrop = Color(0xFF87CEEB); // light blue

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

  /// Draw the monitor on the desk. Screen color and content vary by state.
  static void _drawMonitor(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px, {
    required Color screenColor,
    bool showCursor = false,
    bool showCheck = false,
    bool showX = false,
    bool showDots = false,
  }) {
    // Monitor bezel (rounded look via extra pixels)
    fill(_bezel, 7, 9, 9, 7); // main body
    fill(_bezelHighlight, 7, 9, 9, 1); // top highlight
    fill(_bezelHighlight, 7, 9, 1, 7); // left highlight

    // Screen area with warm glow
    fill(screenColor, 8, 10, 7, 5);

    // Screen content
    if (showCursor) {
      // Blinking cursor and text lines
      fill(Colors.white70, 9, 11, 3, 1); // text line 1
      fill(Colors.white54, 9, 12, 4, 1); // text line 2
      fill(Colors.white, 9, 13, 1, 1); // cursor
    }
    if (showCheck) {
      // Cute checkmark
      px(Colors.white, 9, 13);
      px(Colors.white, 10, 14);
      px(Colors.white, 11, 13);
      px(Colors.white, 12, 12);
      px(Colors.white, 13, 11);
    }
    if (showX) {
      // X mark
      px(Colors.white, 9, 11);
      px(Colors.white, 13, 11);
      px(Colors.white, 10, 12);
      px(Colors.white, 12, 12);
      px(Colors.white, 11, 13);
      px(Colors.white, 10, 14);
      px(Colors.white, 12, 14);
      px(Colors.white, 9, 15); // extra for visibility
      px(Colors.white, 13, 15); // extra for visibility
    }
    if (showDots) {
      // "..." waiting dots
      px(Colors.white70, 9, 12);
      px(Colors.white70, 11, 12);
      px(Colors.white70, 13, 12);
    }

    // Monitor stand (chunky, centered)
    fill(_bezel, 10, 16, 3, 1);
    // Stand base
    fill(_bezel, 9, 16, 5, 0.5);
  }

  /// Draw the office chair behind the person.
  static void _drawChair(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px, {
    double offsetX = 0,
  }) {
    // Chair backrest (rounded top)
    fill(_chairBack, 19 + offsetX, 11, 5, 2);
    px(_chairBack, 20 + offsetX, 10); // rounded top-left
    px(_chairBack, 22 + offsetX, 10); // rounded top-right
    // Chair backrest lower
    fill(_chairBack, 20 + offsetX, 13, 3, 3);
    // Chair seat cushion
    fill(_chairSeat, 19 + offsetX, 16, 5, 1);
    // Chair legs
    fill(PixelTheme.furnitureDark, 19 + offsetX, 20, 1, 2);
    fill(PixelTheme.furnitureDark, 23 + offsetX, 20, 1, 2);
    // Chair wheel dots
    px(PixelTheme.furnitureDark, 18.5 + offsetX, 22);
    px(PixelTheme.furnitureDark, 23.5 + offsetX, 22);
  }

  /// Draw the character's head with hair (4x4 head, big cute head).
  /// [headX], [headY] = top-left of hair block.
  static void _drawHead(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px, {
    required double headX,
    required double headY,
    bool happyEyes = false,
    bool sadEyes = false,
    bool surprisedEyes = false,
    bool openMouth = false,
    bool smile = false,
  }) {
    // Hair (extends 1px beyond head on each side, 2px tall on top)
    fill(PixelTheme.spriteHair, headX - 0.5, headY, 5, 2);
    // Hair side tufts
    px(PixelTheme.spriteHair, headX - 0.5, headY + 2);
    px(PixelTheme.spriteHair, headX + 3.5, headY + 2);

    // Head / face (4x4)
    fill(PixelTheme.spriteSkin, headX, headY + 1.5, 4, 3.5);

    // Eyes
    if (happyEyes) {
      // Closed happy eyes (horizontal lines)
      fill(PixelTheme.spriteHair, headX + 0.5, headY + 3, 1, 0.5);
      fill(PixelTheme.spriteHair, headX + 2.5, headY + 3, 1, 0.5);
    } else if (sadEyes) {
      // Droopy sad eyes
      px(PixelTheme.spriteHair, headX + 0.5, headY + 3.5);
      px(PixelTheme.spriteHair, headX + 2.5, headY + 3.5);
    } else if (surprisedEyes) {
      // Wide surprised eyes (bigger dots)
      fill(PixelTheme.spriteHair, headX + 0.5, headY + 2.5, 1, 1.5);
      fill(PixelTheme.spriteHair, headX + 2.5, headY + 2.5, 1, 1.5);
    } else {
      // Normal cute eyes (simple dots)
      px(PixelTheme.spriteHair, headX + 0.5, headY + 3);
      px(PixelTheme.spriteHair, headX + 2.5, headY + 3);
    }

    // Mouth
    if (openMouth) {
      // Surprised open mouth
      px(PixelTheme.statusFailed, headX + 1.5, headY + 4.5);
    } else if (smile) {
      // Happy smile
      px(PixelTheme.spriteHair, headX + 1, headY + 4.5);
      px(PixelTheme.spriteHair, headX + 2, headY + 4.5);
    }
    // Default: no mouth (neutral) -- cute pixel characters often have no mouth

    // Rosy cheeks (subtle blush for cuteness)
    fill(const Color(0x30FF8080), headX, headY + 3.5, 1, 1);
    fill(const Color(0x30FF8080), headX + 3, headY + 3.5, 1, 1);
  }

  /// Draw the seated body (shirt), legs, and shoes.
  static void _drawSeatedBody(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px, {
    required double bodyX,
    required double bodyY,
  }) {
    // Body / shirt (4x4 sitting)
    fill(PixelTheme.spriteBody, bodyX, bodyY, 4, 4);
    // Shirt collar detail
    fill(PixelTheme.spriteSkin, bodyX + 1, bodyY, 2, 1);

    // Legs (seated, under desk -- pants in hair color)
    fill(PixelTheme.spriteHair, bodyX, bodyY + 4, 2, 4);
    fill(PixelTheme.spriteHair, bodyX + 2, bodyY + 4, 2, 4);

    // Shoes
    fill(PixelTheme.spriteShoes, bodyX - 0.5, bodyY + 8, 2.5, 1);
    fill(PixelTheme.spriteShoes, bodyX + 2, bodyY + 8, 2.5, 1);
  }

  // =========================================================================
  // State: running / starting -- typing at keyboard
  // =========================================================================

  static void _drawTyping(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    int frame,
  ) {
    // -- Background furniture --
    _drawChair(fill, px);
    _drawDesk(fill, px);

    // Keyboard on desk (warm brown)
    fill(_keyboard, 12, 15, 7, 1);
    fill(const Color(0xFF5A4A3E), 12, 15, 7, 0.5); // highlight top

    // Monitor with active warm screen
    final screenColor = frame.isEven
        ? const Color(0xFF6BA4C8) // warm blue screen
        : const Color(0xFF5E94B8); // slightly dimmer
    _drawMonitor(fill, px, screenColor: screenColor, showCursor: frame.isEven);

    // -- Character --
    // Head at (16, 3) -- centered above body
    _drawHead(fill, px, headX: 16, headY: 3);

    // Body at (16, 8)
    _drawSeatedBody(fill, px, bodyX: 16, bodyY: 8);

    // Arms -- animate typing: alternate which arm is up/down
    final leftArmY = (frame == 0 || frame == 2) ? 14.5 : 14.0;
    final rightArmY = (frame == 1 || frame == 3) ? 14.5 : 14.0;
    // Left arm toward keyboard
    fill(PixelTheme.spriteSkin, 14, leftArmY, 2, 1);
    // Right arm toward keyboard
    fill(PixelTheme.spriteSkin, 20, rightArmY, 2, 1);

    // Small focus sparkle (occasionally)
    if (frame == 2) {
      px(const Color(0xFFFFF8DC), 24, 6);
      px(const Color(0xFFFFF8DC), 25, 5);
      px(const Color(0xFFFFF8DC), 26, 6);
      px(const Color(0xFFFFF8DC), 25, 7);
    }
  }

  // =========================================================================
  // State: queued / waiting -- hand raised, "?" bubble
  // =========================================================================

  static void _drawQueued(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    int frame,
  ) {
    // -- Background furniture --
    _drawChair(fill, px);
    _drawDesk(fill, px);

    // Monitor with waiting screen (warm yellow)
    _drawMonitor(
      fill,
      px,
      screenColor: const Color(0xFFE8D090),
      showDots: true,
    );

    // -- Character with slight head tilt --
    final tiltX = (frame == 1) ? 0.5 : 0.0;
    final tiltY = (frame == 2) ? 0.5 : 0.0;

    // Head (tilted slightly)
    _drawHead(fill, px, headX: 16 + tiltX, headY: 3 + tiltY);

    // Body
    _drawSeatedBody(fill, px, bodyX: 16, bodyY: 8);

    // Left arm resting
    fill(PixelTheme.spriteSkin, 14, 14, 2, 1);
    // Right arm raised (waving)
    final waveY = frame == 1 ? -1.0 : 0.0;
    px(PixelTheme.spriteSkin, 20, 10 + waveY);
    px(PixelTheme.spriteSkin, 21, 9 + waveY);
    px(PixelTheme.spriteSkin, 22, 8 + waveY);
    // Hand (open palm)
    px(PixelTheme.spriteSkin, 22, 7 + waveY);
    px(PixelTheme.spriteSkin, 23, 7 + waveY);

    // "?" speech bubble (warm white with border)
    // Bubble body
    fill(_bubbleBorder, 24, 1, 7, 6); // border
    fill(_bubbleWhite, 25, 2, 5, 4); // inner
    // Bubble tail
    px(_bubbleBorder, 24, 7);
    px(_bubbleWhite, 25, 6);

    // "?" character in warm color
    px(PixelTheme.statusWarning, 26, 2.5);
    px(PixelTheme.statusWarning, 27, 2.5);
    px(PixelTheme.statusWarning, 28, 2.5);
    px(PixelTheme.statusWarning, 28, 3.5);
    px(PixelTheme.statusWarning, 27, 3.5);
    px(PixelTheme.statusWarning, 27, 4.5);
    // Dot
    px(PixelTheme.statusWarning, 27, 5.5);
  }

  // =========================================================================
  // State: failed / error -- sad, head drooped
  // =========================================================================

  static void _drawFailed(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    int frame,
  ) {
    // -- Background furniture --
    _drawChair(fill, px);
    _drawDesk(fill, px);

    // Monitor with red error screen
    _drawMonitor(
      fill,
      px,
      screenColor: const Color(0xFFD46070),
      showX: true,
    );

    // -- Character (head drooped forward) --
    // Head lower and tilted forward
    _drawHead(fill, px, headX: 15, headY: 5, sadEyes: true);

    // Body (slightly hunched)
    _drawSeatedBody(fill, px, bodyX: 16, bodyY: 9);

    // Arms hanging / limp
    fill(PixelTheme.spriteSkin, 14, 14, 2, 1);
    fill(PixelTheme.spriteSkin, 20, 14, 2, 1);

    // "!" bubble (warm red tint, flashing)
    if (frame == 0) {
      // Bubble body
      fill(const Color(0xFFF0D0D0), 24, 2, 5, 5); // warm pink bubble
      fill(const Color(0xFFD08080), 24, 2, 5, 1); // top border
      fill(const Color(0xFFD08080), 24, 6, 5, 1); // bottom border
      fill(const Color(0xFFD08080), 24, 2, 1, 5); // left border
      fill(const Color(0xFFD08080), 28, 2, 1, 5); // right border
      // Tail
      px(const Color(0xFFD08080), 24, 7);
      // "!" in warm red
      fill(PixelTheme.statusFailed, 26, 3, 1, 2);
      px(PixelTheme.statusFailed, 26, 6);
    }

    // Sweat drop (alternating side)
    if (frame == 0) {
      px(_sweatDrop, 14, 5);
      px(_sweatDrop, 14, 6);
    } else {
      px(_sweatDrop, 14, 6);
      px(_sweatDrop, 14, 7);
    }
  }

  // =========================================================================
  // State: success / completed -- happy, relaxing with coffee
  // =========================================================================

  static void _drawSuccess(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    int frame,
  ) {
    // -- Background furniture --
    _drawChair(fill, px);
    _drawDesk(fill, px);

    // Monitor with green success screen
    _drawMonitor(
      fill,
      px,
      screenColor: const Color(0xFF7AB85A),
      showCheck: true,
    );

    // Coffee cup on desk
    fill(const Color(0xFFF5E6D0), 23, 14, 3, 2); // mug body (cream)
    fill(_coffee, 24, 14, 1, 1); // coffee surface
    px(const Color(0xFFF5E6D0), 26, 14.5); // mug handle
    px(const Color(0xFFF5E6D0), 26, 15);
    // Steam wisps (animated)
    if (frame == 0 || frame == 2) {
      px(_steam, 24, 12);
      px(_steam, 23, 13);
    } else {
      px(_steam, 23, 12);
      px(_steam, 24, 13);
      px(_steam, 25, 12);
    }

    // -- Character (leaning back, happy) --
    _drawHead(
      fill,
      px,
      headX: 17,
      headY: 3,
      happyEyes: true,
      smile: true,
    );

    // Body (shifted right slightly, leaning back)
    _drawSeatedBody(fill, px, bodyX: 17, bodyY: 8);

    // Left arm resting on desk
    fill(PixelTheme.spriteSkin, 15, 14, 2, 1);
    // Right arm resting on lap
    fill(PixelTheme.spriteSkin, 21, 13, 2, 1);

    // Happy sparkles around character
    if (frame == 1) {
      px(const Color(0xFFFFF8DC), 13, 4);
      px(const Color(0xFFFFF8DC), 24, 3);
    }
    if (frame == 2) {
      px(const Color(0xFFFFF8DC), 14, 2);
      px(const Color(0xFFFFF8DC), 25, 5);
    }
  }

  // =========================================================================
  // State: interrupted / cancelled -- standing up surprised
  // =========================================================================

  static void _drawInterrupted(
    void Function(Color, double, double, double, double) fill,
    void Function(Color, double, double) px,
    int frame,
  ) {
    // Chair pushed back
    final chairPush = frame == 1 ? 2.0 : 1.0;
    _drawChair(fill, px, offsetX: chairPush);
    _drawDesk(fill, px);

    // Monitor (dim / off)
    _drawMonitor(fill, px, screenColor: const Color(0xFF5A5040));

    // -- Character (standing up!) --
    const cx = 16.0; // character center-X

    // Head (higher up since standing)
    _drawHead(fill, px, headX: cx, headY: 1, surprisedEyes: true, openMouth: true);

    // Body (standing -- taller)
    fill(PixelTheme.spriteBody, cx, 6.5, 4, 5);
    // Shirt collar
    fill(PixelTheme.spriteSkin, cx + 1, 6.5, 2, 1);

    // Arms out to sides (startled!)
    final armLift = frame == 1 ? -1.0 : 0.0;
    // Left arm
    px(PixelTheme.spriteSkin, cx - 1, 8 + armLift);
    px(PixelTheme.spriteSkin, cx - 2, 7 + armLift);
    px(PixelTheme.spriteSkin, cx - 3, 7 + armLift);
    // Right arm
    px(PixelTheme.spriteSkin, cx + 4, 8 + armLift);
    px(PixelTheme.spriteSkin, cx + 5, 7 + armLift);
    px(PixelTheme.spriteSkin, cx + 6, 7 + armLift);

    // Legs (standing)
    fill(PixelTheme.spriteHair, cx, 11.5, 2, 7);
    fill(PixelTheme.spriteHair, cx + 2, 11.5, 2, 7);

    // Shoes
    fill(PixelTheme.spriteShoes, cx - 0.5, 18.5, 2.5, 1);
    fill(PixelTheme.spriteShoes, cx + 2, 18.5, 2.5, 1);

    // Surprise lines above head
    if (frame == 0) {
      px(PixelTheme.statusWarning, cx + 1, 0);
      px(PixelTheme.statusWarning, cx + 3, 0);
    } else {
      px(PixelTheme.statusWarning, cx, 0);
      px(PixelTheme.statusWarning, cx + 2, 0);
      px(PixelTheme.statusWarning, cx + 4, 0);
    }
  }
}
