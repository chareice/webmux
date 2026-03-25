import 'package:flutter/material.dart';

import '../app/pixel_theme.dart';
import '../models/office_layout.dart';

/// A top-down (bird's eye) pixel-art sprite that draws a robot at a desk.
///
/// Uses a 20x20 logical grid rendered at [size] (default 48px) with a square
/// aspect ratio. All drawing uses sharp rectangles — no circles.
class TopDownSprite extends StatefulWidget {
  const TopDownSprite({
    super.key,
    required this.status,
    this.idlePose,
    this.size = 48,
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
      duration: const Duration(milliseconds: 250),
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

/// Paints a top-down robot-at-desk on a 20×20 grid. All rectangles, no circles.
///
/// Layout (top to bottom):
///   rows 0-4:  desk (wood surface + monitor + keyboard)
///   rows 4-8:  robot head + antenna (facing desk)
///   rows 8-13: robot body + arms
///   rows 13-17: chair
class TopDownSpritePainter extends CustomPainter {
  TopDownSpritePainter({
    required this.status,
    this.idlePose,
    required this.frame,
  });

  final String status;
  final IdlePose? idlePose;
  final int frame;

  static const int _g = 20; // grid size

  // Robot colors
  static const _headLight = Color(0xFFCCD4E0);
  static const _headMain = Color(0xFFAAB4C8);
  static const _headDark = Color(0xFF8090A0);
  static const _bodyMain = Color(0xFF7888A0);
  static const _bodyAccent = PixelTheme.spriteBody; // blue
  static const _bodyAccentDark = Color(0xFF3A70B0);

  // Desk colors
  static const _deskTop = Color(0xFFD4A86A);
  static const _deskFront = Color(0xFFB88A50);
  static const _monitorBack = Color(0xFF2A2420);
  static const _monitorScreen = Color(0xFF4A8AB0);
  static const _keys = Color(0xFF3A3028);

  // Chair
  static const _chair = Color(0xFF3D2B1F);
  static const _chairLight = Color(0xFF5A4438);

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
        return const Color(0xFF5A8A4A); // dim green
    }
  }

  Color get _screenColor {
    switch (status) {
      case 'running':
      case 'starting':
        return _monitorScreen;
      case 'queued':
      case 'waiting':
      case 'waiting_for_input':
        return const Color(0xFFE8D090);
      case 'failed':
      case 'error':
        return const Color(0xFFD46070);
      default:
        return const Color(0xFF2A2A2A); // off
    }
  }

  @override
  void paint(Canvas canvas, Size size) {
    final p = size.width / _g;

    void f(Color c, double x, double y, double w, double h) {
      canvas.drawRect(Rect.fromLTWH(x * p, y * p, w * p, h * p), Paint()..color = c);
    }

    switch (status) {
      case 'running':
      case 'starting':
        _drawRunning(f, frame);
      case 'queued':
      case 'waiting':
      case 'waiting_for_input':
        _drawQueued(f);
      case 'failed':
      case 'error':
        _drawFailed(f);
      case 'completed':
      case 'success':
        _drawCompleted(f);
      case 'interrupted':
      case 'cancelled':
        _drawInterrupted(f);
      default:
        _drawRunning(f, 0);
    }
  }

  @override
  bool shouldRepaint(covariant TopDownSpritePainter old) =>
      old.status != status || old.frame != frame || old.idlePose != idlePose;

  // ── Desk (rows 0-4) ──

  void _desk(void Function(Color, double, double, double, double) f) {
    // Wood surface
    f(_deskTop, 2, 0, 16, 4);
    f(const Color(0xFFE0B87A), 2, 0, 16, 1); // highlight edge
    f(_deskFront, 2, 3, 16, 1); // front edge shadow
  }

  void _monitor(void Function(Color, double, double, double, double) f) {
    f(_monitorBack, 5, 0.5, 10, 2); // monitor casing
    f(_screenColor, 6, 1, 8, 1); // screen
  }

  void _keyboard(void Function(Color, double, double, double, double) f) {
    f(_keys, 6, 3, 8, 1);
    // Individual keys
    f(const Color(0xFF4A4038), 6.5, 3.2, 1, 0.6);
    f(const Color(0xFF4A4038), 8, 3.2, 1, 0.6);
    f(const Color(0xFF4A4038), 9.5, 3.2, 1, 0.6);
    f(const Color(0xFF4A4038), 11, 3.2, 1, 0.6);
    f(const Color(0xFF4A4038), 12.5, 3.2, 1, 0.6);
  }

  // ── Chair (rows 14-17) ──

  void _chairNormal(void Function(Color, double, double, double, double) f) {
    f(_chair, 6, 14, 8, 3);
    f(_chairLight, 6, 14, 8, 1); // back rest highlight
    // Arm rests
    f(_chair, 5, 15, 1, 2);
    f(_chair, 14, 15, 1, 2);
  }

  // ── Robot head from above (5x4 rectangle with eyes) ──

  void _head(void Function(Color, double, double, double, double) f, {
    double ox = 0, double oy = 0, bool eyesOff = false,
  }) {
    final x = 7.0 + ox;
    final y = 4.5 + oy;

    // Antenna stalk (1px wide, 2px up from head center)
    f(_headDark, x + 2.5, y - 2, 1, 2);
    // Antenna ball (2x1)
    f(_antennaColor, x + 2, y - 3, 2, 1.5);

    // Head body (6x4 rectangle)
    f(_headMain, x, y, 6, 4);
    // Top highlight
    f(_headLight, x, y, 6, 1);
    // Left highlight
    f(_headLight, x, y, 1, 4);
    // Bottom shadow
    f(_headDark, x, y + 3, 6, 1);

    // Face plate (dark inset)
    f(const Color(0xFF1A2A3A), x + 1, y + 1, 4, 2);

    if (!eyesOff) {
      // Eyes (two colored squares on face plate)
      f(_antennaColor, x + 1.5, y + 1.5, 1, 1);
      f(_antennaColor, x + 3.5, y + 1.5, 1, 1);
    }
  }

  // ── Robot body from above (rectangular torso) ──

  void _body(void Function(Color, double, double, double, double) f, {
    double ox = 0, double oy = 0,
  }) {
    final x = 6.5 + ox;
    final y = 9.0 + oy;

    // Main torso (7x4)
    f(_bodyMain, x, y, 7, 4);
    // Top highlight
    f(_headMain, x, y, 7, 1);
    // Blue accent panel
    f(_bodyAccent, x + 1.5, y + 1, 4, 2);
    f(_bodyAccentDark, x + 2, y + 2, 3, 0.5); // panel detail
  }

  // ── Arms ──

  void _armsTyping(void Function(Color, double, double, double, double) f, int frame) {
    // Arms reaching toward keyboard area
    final leftY = (frame == 0 || frame == 2) ? 5.0 : 5.5;
    final rightY = (frame == 1 || frame == 3) ? 5.0 : 5.5;
    // Left arm
    f(_headDark, 5, leftY, 1.5, 4);
    f(_headMain, 5, leftY, 1.5, 1); // hand
    // Right arm
    f(_headDark, 13.5, rightY, 1.5, 4);
    f(_headMain, 13.5, rightY, 1.5, 1); // hand
  }

  void _armsResting(void Function(Color, double, double, double, double) f) {
    f(_headDark, 5, 9, 1.5, 3);
    f(_headDark, 13.5, 9, 1.5, 3);
  }

  void _armsLimp(void Function(Color, double, double, double, double) f) {
    f(_headDark, 5, 10, 1.5, 4);
    f(_headDark, 13.5, 10, 1.5, 4);
  }

  void _armsSideways(void Function(Color, double, double, double, double) f) {
    f(_headDark, 3, 10, 3.5, 1.5);
    f(_headDark, 13.5, 10, 3.5, 1.5);
  }

  void _armsRaised(void Function(Color, double, double, double, double) f) {
    // Left resting, right up
    f(_headDark, 5, 9, 1.5, 3);
    f(_headDark, 13.5, 5, 1.5, 4);
    f(_headMain, 13.5, 5, 1.5, 1.5); // raised hand
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATES
  // ═══════════════════════════════════════════════════════════════════════════

  void _drawRunning(void Function(Color, double, double, double, double) f, int frame) {
    _desk(f);
    _monitor(f);
    _keyboard(f);
    _chairNormal(f);
    _body(f);
    _armsTyping(f, frame);
    _head(f);

    // Antenna glow on even frames
    if (frame.isEven) {
      f(_antennaColor.withOpacity(0.25), 8.5, 0.5, 3, 2);
    }

    // Typing flash on keyboard
    if (frame == 0 || frame == 2) {
      f(Colors.white70, 7, 3.3, 1, 0.4);
    } else {
      f(Colors.white70, 12, 3.3, 1, 0.4);
    }
  }

  void _drawQueued(void Function(Color, double, double, double, double) f) {
    _desk(f);
    _monitor(f);
    _keyboard(f);
    _chairNormal(f);
    _body(f);
    _armsRaised(f);
    _head(f);

    // "?" bubble (top right)
    f(const Color(0xFFD4A574), 14, 1, 5, 4);
    f(const Color(0xFFFFF8F0), 14.5, 1.5, 4, 3);
    // "?"
    f(PixelTheme.statusWarning, 16, 2, 1.5, 0.5);
    f(PixelTheme.statusWarning, 17, 2.5, 0.5, 0.5);
    f(PixelTheme.statusWarning, 16.5, 3, 0.5, 0.5);
    f(PixelTheme.statusWarning, 16.5, 3.8, 0.5, 0.5);
  }

  void _drawFailed(void Function(Color, double, double, double, double) f) {
    _desk(f);
    _monitor(f);
    _chairNormal(f);
    _body(f);
    _armsLimp(f);

    // Head slumped forward onto desk
    _head(f, oy: -2, eyesOff: true);
    // Eyes as X marks (on the slumped face)
    f(PixelTheme.statusFailed, 8.5, 3.5, 0.8, 0.8);
    f(PixelTheme.statusFailed, 11, 3.5, 0.8, 0.8);

    // "!" bubble
    f(const Color(0xFFD4A574), 14, 0, 4, 4);
    f(const Color(0xFFFFF8F0), 14.5, 0.5, 3, 3);
    f(PixelTheme.statusFailed, 15.5, 1, 1, 1.5);
    f(PixelTheme.statusFailed, 15.5, 2.8, 1, 0.5);

    // Smoke wisps
    f(const Color(0x50888888), 4, 2, 1, 1);
    f(const Color(0x35888888), 3, 1, 1.5, 1);
    f(const Color(0x20888888), 2, 0, 1, 1);
  }

  void _drawCompleted(void Function(Color, double, double, double, double) f) {
    switch (idlePose) {
      case IdlePose.sleeping:
        _drawSleeping(f);
      case IdlePose.phone:
        _drawPhone(f);
      case IdlePose.coffee:
        _drawCoffee(f);
      case null:
        _drawSleeping(f);
    }
  }

  void _drawSleeping(void Function(Color, double, double, double, double) f) {
    _desk(f);
    f(_monitorBack, 5, 0.5, 10, 2); // monitor (off)
    f(const Color(0xFF2A2A2A), 6, 1, 8, 1);
    _chairNormal(f);
    _body(f);

    // Arms resting on desk surface
    f(_headDark, 5, 5, 1.5, 5);
    f(_headDark, 13.5, 5, 1.5, 5);

    // Head down ON the desk (slumped way forward)
    f(_headMain, 7, 2, 6, 3);
    f(_headLight, 7, 2, 6, 1);
    f(_headDark, 7, 4, 6, 1);
    // Dim antenna flopping sideways
    f(_headDark, 13, 2.5, 2, 0.5);
    f(const Color(0xFF5A8A4A), 14.5, 2, 1.5, 1);

    // ZZZ (ascending to top-right)
    f(const Color(0xFFB0C0D0), 15, 3, 1, 0.5);
    f(const Color(0xFFB0C0D0), 15.5, 3.5, 0.5, 0.5);
    f(const Color(0xFFB0C0D0), 15, 4, 1, 0.5);

    f(const Color(0xFF90A8C0), 16, 1.5, 1.5, 0.5);
    f(const Color(0xFF90A8C0), 17, 2, 0.5, 0.5);
    f(const Color(0xFF90A8C0), 16, 2.5, 1.5, 0.5);

    f(const Color(0xFF7090B0), 17, 0, 2, 0.5);
    f(const Color(0xFF7090B0), 18.5, 0.5, 0.5, 0.5);
    f(const Color(0xFF7090B0), 17, 1, 2, 0.5);
  }

  void _drawPhone(void Function(Color, double, double, double, double) f) {
    _desk(f);
    f(_monitorBack, 5, 0.5, 10, 2); // monitor off
    f(const Color(0xFF2A2A2A), 6, 1, 8, 1);

    // Chair rotated (facing away from desk)
    f(_chair, 6, 14, 8, 3);
    f(_chairLight, 6, 16, 8, 1); // front rest

    // Body (slightly lower)
    _body(f, oy: 1);

    // Head facing DOWN (away from desk — bottom of cell)
    final hx = 7.0;
    final hy = 13.0;
    f(_headMain, hx, hy, 6, 4);
    f(_headDark, hx, hy, 6, 1); // top shadow (it's upside-down relative to desk)
    f(_headLight, hx, hy + 3, 6, 1); // bottom highlight
    // Face plate (facing down)
    f(const Color(0xFF1A2A3A), hx + 1, hy + 1, 4, 2);
    // Eyes looking down
    f(_antennaColor, hx + 1.5, hy + 1.5, 1, 1);
    f(_antennaColor, hx + 3.5, hy + 1.5, 1, 1);
    // Antenna pointing down
    f(_headDark, hx + 2.5, hy + 4, 1, 1.5);
    f(_antennaColor, hx + 2, hy + 5, 2, 1);

    // Arms holding phone
    f(_headDark, 6, 12, 1.5, 2);
    f(_headDark, 12.5, 12, 1.5, 2);
    // Phone
    f(const Color(0xFF1A1A2A), 8, 12, 4, 2);
    f(const Color(0xFF5577BB), 8.5, 12.3, 3, 1.4); // screen glow
  }

  void _drawCoffee(void Function(Color, double, double, double, double) f) {
    _desk(f);
    f(_monitorBack, 5, 0.5, 10, 2); // monitor off
    f(const Color(0xFF2A2A2A), 6, 1, 8, 1);
    _keyboard(f);
    _chairNormal(f);
    _body(f, oy: 0.5);
    _armsResting(f);
    _head(f, oy: 0.5, eyesOff: true);

    // Relaxed eyes (half-closed, lines)
    f(const Color(0xFF5A8A4A), 8.5, 6.5, 1, 0.5);
    f(const Color(0xFF5A8A4A), 11, 6.5, 1, 0.5);

    // Coffee cup on desk (right side)
    f(Colors.white, 14, 1.5, 2, 2); // cup body
    f(const Color(0xFF8B5A2A), 14, 1.5, 2, 0.5); // coffee top
    f(Colors.white, 16, 2, 0.5, 1); // handle

    // Steam
    f(const Color(0x40FFFFFF), 14.5, 0.5, 0.5, 1);
    f(const Color(0x30FFFFFF), 15.5, 0, 0.5, 1);
  }

  void _drawInterrupted(void Function(Color, double, double, double, double) f) {
    _desk(f);
    f(_monitorBack, 5, 0.5, 10, 2); // monitor off
    f(const Color(0xFF2A2A2A), 6, 1, 8, 1);

    // Chair pushed way back
    f(_chair, 6, 16, 8, 3);
    f(_chairLight, 6, 16, 8, 1);

    _body(f, oy: 1);
    _armsSideways(f);
    _head(f, oy: 1);

    // Alert exclamation marks
    f(PixelTheme.statusFailed, 4, 4, 1, 2);
    f(PixelTheme.statusFailed, 4, 6.5, 1, 0.5);
    f(PixelTheme.statusFailed, 15, 4, 1, 2);
    f(PixelTheme.statusFailed, 15, 6.5, 1, 0.5);
  }
}
