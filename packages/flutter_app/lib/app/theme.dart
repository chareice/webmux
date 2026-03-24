import 'package:flutter/material.dart';

class WebmuxTheme {
  WebmuxTheme._();

  // Status colors
  static const Color statusRunning = Color(0xFF7aa2f7);
  static const Color statusSuccess = Color(0xFF9ece6a);
  static const Color statusFailed = Color(0xFFf7768e);
  static const Color statusWarning = Color(0xFFe0af68);
  static const Color statusQueued = Color(0xFF565f89);

  // Semantic colors
  static const Color border = Color(0xFF292e42);
  static const Color subtext = Color(0xFF565f89);
  static const Color orange = Color(0xFFff9e64);

  // Base palette
  static const Color _background = Color(0xFF1a1b26);
  static const Color _surface = Color(0xFF1f2335);
  static const Color _primary = Color(0xFF7aa2f7);
  static const Color _text = Color(0xFFc0caf5);
  static const Color _error = Color(0xFFf7768e);

  static ThemeData get darkTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: const ColorScheme.dark(
        surface: _surface,
        primary: _primary,
        secondary: _primary,
        error: _error,
        onSurface: _text,
        onPrimary: _background,
        outline: border,
      ),
      scaffoldBackgroundColor: _background,
      appBarTheme: const AppBarTheme(
        backgroundColor: _background,
        foregroundColor: _text,
        elevation: 0,
        scrolledUnderElevation: 0,
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: _surface,
        selectedItemColor: _primary,
        unselectedItemColor: subtext,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
      navigationRailTheme: const NavigationRailThemeData(
        backgroundColor: _surface,
        selectedIconTheme: IconThemeData(color: _primary),
        unselectedIconTheme: IconThemeData(color: subtext),
        selectedLabelTextStyle: TextStyle(color: _primary, fontSize: 12),
        unselectedLabelTextStyle: TextStyle(color: subtext, fontSize: 12),
        indicatorColor: Color(0xFF292e42),
      ),
      cardTheme: CardTheme(
        color: _surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: border, width: 1),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: _surface,
        hintStyle: const TextStyle(color: subtext),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: _primary, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: _error),
        ),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      ),
      textTheme: const TextTheme(
        displayLarge: TextStyle(color: _text),
        displayMedium: TextStyle(color: _text),
        displaySmall: TextStyle(color: _text),
        headlineLarge: TextStyle(color: _text),
        headlineMedium: TextStyle(color: _text),
        headlineSmall: TextStyle(color: _text),
        titleLarge: TextStyle(color: _text),
        titleMedium: TextStyle(color: _text),
        titleSmall: TextStyle(color: _text),
        bodyLarge: TextStyle(color: _text),
        bodyMedium: TextStyle(color: _text),
        bodySmall: TextStyle(color: subtext),
        labelLarge: TextStyle(color: _text),
        labelMedium: TextStyle(color: _text),
        labelSmall: TextStyle(color: subtext),
      ),
      dividerTheme: const DividerThemeData(
        color: border,
        thickness: 1,
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: _primary,
          foregroundColor: _background,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: _text,
          side: const BorderSide(color: border),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
        ),
      ),
      iconTheme: const IconThemeData(color: _text),
      dialogTheme: DialogTheme(
        backgroundColor: _surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
      ),
    );
  }
}
