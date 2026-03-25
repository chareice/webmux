import 'package:flutter/material.dart';

import 'theme.dart';

/// Pixel art visual system for the office game UI.
///
/// Provides sharp-cornered decorations, a warm Stardew Valley-inspired color
/// palette, and style factories that complement the existing [WebmuxTheme]
/// dark theme. All pixel UI elements use sharp corners and 2px solid borders.
class PixelTheme {
  PixelTheme._();

  // ---------------------------------------------------------------------------
  // Pixel border constants
  // ---------------------------------------------------------------------------

  /// Standard pixel border width used everywhere.
  static const double borderWidth = 2.0;

  /// Sharp corners -- the defining trait of pixel UI.
  static const BorderRadius sharpCorners = BorderRadius.zero;

  // ---------------------------------------------------------------------------
  // Color palette -- office scene (warm wood & cozy walls)
  // ---------------------------------------------------------------------------

  /// Dark floor tile color (dark oak wood).
  static const Color floorDark = Color(0xFF8B6D47);

  /// Light floor tile color (honey oak, checkerboard alternate).
  static const Color floorLight = Color(0xFFA6854A);

  /// Wall / backdrop color (warm cream/beige).
  static const Color wall = Color(0xFFE8D5B5);

  /// Subtle wall accent detail (slightly darker beige).
  static const Color wallAccent = Color(0xFFD4B896);

  /// Desk / furniture wood tone (rich dark brown).
  static const Color furniture = Color(0xFF6B4226);

  /// Furniture highlight edge (lighter wood grain).
  static const Color furnitureLight = Color(0xFF8B5E3C);

  /// Furniture shadow (deep brown).
  static const Color furnitureDark = Color(0xFF4A2E1A);

  // ---------------------------------------------------------------------------
  // Color palette -- sprites (warm & cheerful)
  // ---------------------------------------------------------------------------

  /// Default sprite skin tone (warm peach).
  static const Color spriteSkin = Color(0xFFFFCBA4);

  /// Sprite body / shirt primary (cheerful blue).
  static const Color spriteBody = Color(0xFF4A90D9);

  /// Sprite body alternate (warm red/orange).
  static const Color spriteBodyAlt = Color(0xFFE07040);

  /// Sprite hair / dark detail (dark brown).
  static const Color spriteHair = Color(0xFF4A3728);

  /// Sprite shoes (dark leather brown).
  static const Color spriteShoes = Color(0xFF3D2B1F);

  // ---------------------------------------------------------------------------
  // Color palette -- environment details
  // ---------------------------------------------------------------------------

  /// Lush plant green.
  static const Color plantGreen = Color(0xFF5B8C3E);

  /// Lighter leaf / plant highlight.
  static const Color plantGreenLight = Color(0xFF7DB356);

  /// Dark leaf / plant shadow.
  static const Color plantGreenDark = Color(0xFF3D6B28);

  /// Sky blue for window panes.
  static const Color windowBlue = Color(0xFF87CEEB);

  /// Warm sunlight through windows.
  static const Color windowLight = Color(0xFFFFF8DC);

  /// Bookshelf accent -- red book.
  static const Color bookRed = Color(0xFFB44040);

  /// Bookshelf accent -- blue book.
  static const Color bookBlue = Color(0xFF4A6B8A);

  /// Bookshelf accent -- green book.
  static const Color bookGreen = Color(0xFF5A8A5A);

  /// Warm rug base color.
  static const Color rugWarm = Color(0xFFC17840);

  /// Rug pattern accent.
  static const Color rugAccent = Color(0xFF8B4513);

  // ---------------------------------------------------------------------------
  // Color palette -- terminal / event groups (warmer DOS-style)
  // ---------------------------------------------------------------------------

  /// Terminal background (slightly warmer dark).
  static const Color terminalBg = Color(0xFF1A1A2E);

  /// Terminal green text.
  static const Color terminalGreen = Color(0xFF39D353);

  /// Terminal dim green (for secondary text / timestamps).
  static const Color terminalGreenDim = Color(0xFF238636);

  /// Terminal cursor / highlight.
  static const Color terminalCursor = Color(0xFF58a6ff);

  // ---------------------------------------------------------------------------
  // Color palette -- message bubbles (warmer tints)
  // ---------------------------------------------------------------------------

  /// User bubble background (warm blue tint).
  static const Color userBubbleBg = Color(0xFF2A3A5A);

  /// User bubble border (warm blue).
  static const Color userBubbleBorder = Color(0xFF4A6A9E);

  /// Assistant bubble background (warm green tint).
  static const Color assistantBubbleBg = Color(0xFF2A3A2A);

  /// Assistant bubble border (warm green).
  static const Color assistantBubbleBorder = Color(0xFF4A7A4A);

  // ---------------------------------------------------------------------------
  // Color palette -- status (pixel versions, mapped from WebmuxTheme)
  // ---------------------------------------------------------------------------

  /// Running status -- maps to [WebmuxTheme.statusRunning].
  static const Color statusRunning = WebmuxTheme.statusRunning;

  /// Success status -- maps to [WebmuxTheme.statusSuccess].
  static const Color statusSuccess = WebmuxTheme.statusSuccess;

  /// Failed status -- maps to [WebmuxTheme.statusFailed].
  static const Color statusFailed = WebmuxTheme.statusFailed;

  /// Warning status -- maps to [WebmuxTheme.statusWarning].
  static const Color statusWarning = WebmuxTheme.statusWarning;

  /// Queued status -- maps to [WebmuxTheme.statusQueued].
  static const Color statusQueued = WebmuxTheme.statusQueued;

  // ---------------------------------------------------------------------------
  // Pixel border decoration helpers
  // ---------------------------------------------------------------------------

  /// Standard pixel border side using the existing theme border color.
  static const BorderSide pixelBorder = BorderSide(
    color: WebmuxTheme.border,
    width: borderWidth,
  );

  /// A basic pixel-styled box: sharp corners, 2px solid border, dark surface.
  static BoxDecoration pixelBox({
    Color? color,
    Color? borderColor,
  }) {
    return BoxDecoration(
      color: color,
      border: Border.all(
        color: borderColor ?? WebmuxTheme.border,
        width: borderWidth,
      ),
      borderRadius: sharpCorners,
    );
  }

  // ---------------------------------------------------------------------------
  // Message bubble style factories
  // ---------------------------------------------------------------------------

  /// [BoxDecoration] for a user message bubble.
  ///
  /// Blue-tinted background, 2px border, sharp corners.
  static BoxDecoration userBubbleDecoration() {
    return BoxDecoration(
      color: userBubbleBg,
      border: Border.all(
        color: userBubbleBorder,
        width: borderWidth,
      ),
      borderRadius: sharpCorners,
    );
  }

  /// [BoxDecoration] for an assistant message bubble.
  ///
  /// Green-tinted background, 2px border, sharp corners.
  static BoxDecoration assistantBubbleDecoration() {
    return BoxDecoration(
      color: assistantBubbleBg,
      border: Border.all(
        color: assistantBubbleBorder,
        width: borderWidth,
      ),
      borderRadius: sharpCorners,
    );
  }

  /// Returns the appropriate bubble decoration based on the sender role.
  static BoxDecoration messageBubbleDecoration({required bool isUser}) {
    return isUser ? userBubbleDecoration() : assistantBubbleDecoration();
  }

  // ---------------------------------------------------------------------------
  // Terminal / event group styles
  // ---------------------------------------------------------------------------

  /// [BoxDecoration] for a terminal-style event group container.
  ///
  /// Black background, green border, sharp corners.
  static BoxDecoration terminalDecoration({
    Color? borderColor,
  }) {
    return BoxDecoration(
      color: terminalBg,
      border: Border.all(
        color: borderColor ?? terminalGreen,
        width: borderWidth,
      ),
      borderRadius: sharpCorners,
    );
  }

  /// [TextStyle] for primary terminal text (green monospace on dark bg).
  static const TextStyle terminalTextStyle = TextStyle(
    fontFamily: 'monospace',
    color: terminalGreen,
    fontSize: 12,
    height: 1.4,
  );

  /// [TextStyle] for secondary/dim terminal text.
  static const TextStyle terminalTextDimStyle = TextStyle(
    fontFamily: 'monospace',
    color: terminalGreenDim,
    fontSize: 11,
    height: 1.4,
  );

  // ---------------------------------------------------------------------------
  // Pixel button styles
  // ---------------------------------------------------------------------------

  /// A primary pixel-styled [ButtonStyle] (filled).
  ///
  /// Sharp corners, 2px border, solid primary background.
  static ButtonStyle primaryButtonStyle() {
    return ButtonStyle(
      backgroundColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.disabled)) {
          return WebmuxTheme.statusQueued;
        }
        return WebmuxTheme.statusRunning;
      }),
      foregroundColor: WidgetStateProperty.all(const Color(0xFF1a1b26)),
      shape: WidgetStateProperty.all(
        const RoundedRectangleBorder(
          borderRadius: sharpCorners,
          side: BorderSide(
            color: WebmuxTheme.border,
            width: borderWidth,
          ),
        ),
      ),
      padding: WidgetStateProperty.all(
        const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      ),
      elevation: WidgetStateProperty.all(0),
      overlayColor: WidgetStateProperty.all(Colors.white10),
    );
  }

  /// An outlined pixel-styled [ButtonStyle] (ghost).
  ///
  /// Sharp corners, 2px border, transparent background.
  static ButtonStyle outlinedButtonStyle({
    Color? borderColor,
    Color? textColor,
  }) {
    return ButtonStyle(
      backgroundColor: WidgetStateProperty.all(Colors.transparent),
      foregroundColor:
          WidgetStateProperty.all(textColor ?? const Color(0xFFc0caf5)),
      shape: WidgetStateProperty.all(
        RoundedRectangleBorder(
          borderRadius: sharpCorners,
          side: BorderSide(
            color: borderColor ?? WebmuxTheme.border,
            width: borderWidth,
          ),
        ),
      ),
      padding: WidgetStateProperty.all(
        const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      ),
      elevation: WidgetStateProperty.all(0),
      overlayColor: WidgetStateProperty.all(Colors.white10),
    );
  }

  /// A danger/destructive pixel button style.
  static ButtonStyle dangerButtonStyle() {
    return ButtonStyle(
      backgroundColor: WidgetStateProperty.all(Colors.transparent),
      foregroundColor: WidgetStateProperty.all(statusFailed),
      shape: WidgetStateProperty.all(
        const RoundedRectangleBorder(
          borderRadius: sharpCorners,
          side: BorderSide(
            color: WebmuxTheme.statusFailed,
            width: borderWidth,
          ),
        ),
      ),
      padding: WidgetStateProperty.all(
        const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      ),
      elevation: WidgetStateProperty.all(0),
      overlayColor: WidgetStateProperty.all(
        WebmuxTheme.statusFailed.withOpacity(0.1),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Pixel status badge
  // ---------------------------------------------------------------------------

  /// Creates a pixel-styled status badge [BoxDecoration].
  ///
  /// Square badge with 2px border colored by status. Use with a small
  /// [Container] and a centered label or icon.
  static BoxDecoration statusBadgeDecoration(String status) {
    final color = _colorForStatus(status);
    return BoxDecoration(
      color: color.withOpacity(0.15),
      border: Border.all(
        color: color,
        width: borderWidth,
      ),
      borderRadius: sharpCorners,
    );
  }

  /// Returns the [TextStyle] for a status badge label.
  static TextStyle statusBadgeTextStyle(String status) {
    return TextStyle(
      color: _colorForStatus(status),
      fontSize: 11,
      fontWeight: FontWeight.bold,
      letterSpacing: 0.5,
    );
  }

  /// Maps a status string to its pixel theme color.
  static Color _colorForStatus(String status) {
    switch (status) {
      case 'running':
      case 'starting':
        return statusRunning;
      case 'completed':
        return statusSuccess;
      case 'failed':
      case 'error':
        return statusFailed;
      case 'waiting':
      case 'waiting_for_input':
        return statusWarning;
      case 'queued':
      case 'pending':
        return statusQueued;
      case 'interrupted':
      case 'cancelled':
        return WebmuxTheme.subtext;
      default:
        return WebmuxTheme.subtext;
    }
  }
}
