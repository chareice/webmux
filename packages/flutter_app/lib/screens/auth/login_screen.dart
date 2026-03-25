import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/pixel_theme.dart';
import '../../app/theme.dart';
import '../../providers/providers.dart';
import '../../utils/url_token.dart';
import '../../utils/web_navigation.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _serverUrlController = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _loading = false;
  String? _error;

  /// On web, we don't need a server URL (same-origin).
  bool get _isWebPlatform => isWeb;

  @override
  void dispose() {
    _serverUrlController.dispose();
    super.dispose();
  }

  String get _baseUrl {
    if (_isWebPlatform) return ''; // Same-origin on web.
    var url = _serverUrlController.text.trim();
    while (url.endsWith('/')) {
      url = url.substring(0, url.length - 1);
    }
    return url;
  }

  Future<void> _launchOAuth(String provider) async {
    if (!_isWebPlatform && !_formKey.currentState!.validate()) return;

    final base = _baseUrl;
    final oauthUrl = '$base/api/auth/$provider';

    if (_isWebPlatform) {
      // On web, navigate directly in the same window.
      // url_launcher's canLaunchUrl fails on relative URLs.
      navigateToUrl(oauthUrl);
    } else {
      final uri = Uri.parse(oauthUrl);
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      } else {
        if (mounted) {
          setState(() => _error = 'Could not open browser');
        }
      }
    }
  }

  Future<void> _handleDevLogin() async {
    if (!_isWebPlatform && !_formKey.currentState!.validate()) return;

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      await ref.read(authProvider.notifier).devLogin(_baseUrl);
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);

    return Scaffold(
      backgroundColor: const Color(0xFF6B8E5A), // grass green, like the office bg
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(32),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Game-style title card
                  Container(
                    padding: const EdgeInsets.symmetric(vertical: 24),
                    decoration: BoxDecoration(
                      color: PixelTheme.wall,
                      border: Border.all(color: PixelTheme.furniture, width: 3),
                      boxShadow: const [
                        BoxShadow(color: PixelTheme.furnitureDark, offset: Offset(0, 3)),
                      ],
                    ),
                    child: Column(
                      children: [
                        const Icon(
                          Icons.smart_toy_rounded,
                          size: 64,
                          color: PixelTheme.spriteBody,
                        ),
                        const SizedBox(height: 12),
                        const Text(
                          'Webmux',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: PixelTheme.furnitureDark,
                            fontSize: 28,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'AI Agent Office',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: PixelTheme.furniture,
                            fontSize: 14,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),

                  // Server URL field — only on native (mobile) platforms
                  if (!_isWebPlatform) ...[
                    Container(
                      decoration: BoxDecoration(
                        color: PixelTheme.floorLight,
                        border: Border.all(color: PixelTheme.furniture, width: 2),
                      ),
                      child: TextFormField(
                        controller: _serverUrlController,
                        style: const TextStyle(color: PixelTheme.furnitureDark),
                        decoration: InputDecoration(
                          labelText: 'Server URL',
                          labelStyle: const TextStyle(color: PixelTheme.furniture),
                          hintText: 'https://webmux.example.com',
                          hintStyle: TextStyle(color: PixelTheme.furniture.withAlpha(120)),
                          prefixIcon: const Icon(Icons.dns_rounded, color: PixelTheme.furniture),
                          border: InputBorder.none,
                          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                        ),
                        keyboardType: TextInputType.url,
                        autocorrect: false,
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return 'Please enter a server URL';
                          }
                          final trimmed = value.trim();
                          if (!trimmed.startsWith('http://') &&
                              !trimmed.startsWith('https://')) {
                            return 'URL must start with http:// or https://';
                          }
                          return null;
                        },
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],

                  // OAuth buttons — game style
                  _GameButton(
                    onPressed: _loading ? null : () => _launchOAuth('github'),
                    icon: Icons.code_rounded,
                    label: 'Sign in with GitHub',
                    color: const Color(0xFF4A90D9),
                    borderColor: const Color(0xFF6AB0FF),
                    shadowColor: const Color(0xFF2A5090),
                  ),
                  const SizedBox(height: 10),
                  _GameButton(
                    onPressed: _loading ? null : () => _launchOAuth('google'),
                    icon: Icons.g_mobiledata_rounded,
                    label: 'Sign in with Google',
                    color: PixelTheme.furniture,
                    borderColor: PixelTheme.furnitureLight,
                    shadowColor: PixelTheme.furnitureDark,
                  ),

                  // Dev login button (debug mode only)
                  if (kDebugMode) ...[
                    const SizedBox(height: 20),
                    Container(height: 2, color: PixelTheme.furniture),
                    const SizedBox(height: 12),
                    _GameButton(
                      onPressed: _loading ? null : _handleDevLogin,
                      icon: Icons.bug_report_rounded,
                      label: _loading ? '...' : 'Dev Login',
                      color: const Color(0xFFB87333),
                      borderColor: const Color(0xFFD4935A),
                      shadowColor: const Color(0xFF8A5520),
                    ),
                  ],

                  // Error display
                  if (_error != null) ...[
                    const SizedBox(height: 16),
                    _ErrorBanner(message: _error!),
                  ],
                  if (authState.status == AuthStatus.error &&
                      authState.errorMessage != null) ...[
                    const SizedBox(height: 16),
                    _ErrorBanner(message: authState.errorMessage!),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _GameButton extends StatelessWidget {
  const _GameButton({
    required this.label,
    required this.icon,
    required this.color,
    required this.borderColor,
    required this.shadowColor,
    this.onPressed,
  });

  final String label;
  final IconData icon;
  final Color color;
  final Color borderColor;
  final Color shadowColor;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onPressed,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: onPressed != null ? color : color.withAlpha(100),
          border: Border.all(color: borderColor, width: 2),
          boxShadow: onPressed != null
              ? [BoxShadow(color: shadowColor, offset: const Offset(0, 3))]
              : null,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 18, color: Colors.white),
            const SizedBox(width: 8),
            Text(
              label,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 14,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: WebmuxTheme.statusFailed.withOpacity(0.1),
        borderRadius: BorderRadius.zero,
        border: Border.all(
          color: WebmuxTheme.statusFailed.withOpacity(0.3),
        ),
      ),
      child: Text(
        message,
        style: const TextStyle(
          color: WebmuxTheme.statusFailed,
          fontSize: 13,
        ),
      ),
    );
  }
}
