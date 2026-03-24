import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/theme.dart';
import '../../providers/providers.dart';
import '../../utils/url_token.dart';

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
      // On web, navigate in the same window (not a new tab).
      // The server will redirect back with ?token=xxx.
      final uri = Uri.parse(oauthUrl);
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, webOnlyWindowName: '_self');
      }
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
                  // Logo / Title
                  const Icon(
                    Icons.hub_rounded,
                    size: 64,
                    color: WebmuxTheme.statusRunning,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'Webmux',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'AI Agent Control Plane',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: WebmuxTheme.subtext,
                        ),
                  ),
                  const SizedBox(height: 48),

                  // Server URL field — only on native (mobile) platforms
                  if (!_isWebPlatform) ...[
                    TextFormField(
                      controller: _serverUrlController,
                      decoration: const InputDecoration(
                        labelText: 'Server URL',
                        hintText: 'https://webmux.example.com',
                        prefixIcon: Icon(Icons.dns_rounded),
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
                    const SizedBox(height: 24),
                  ],

                  // OAuth buttons
                  FilledButton.icon(
                    onPressed: _loading ? null : () => _launchOAuth('github'),
                    icon: const Icon(Icons.code_rounded),
                    label: const Text('Sign in with GitHub'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                    ),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: _loading ? null : () => _launchOAuth('google'),
                    icon: const Icon(Icons.g_mobiledata_rounded),
                    label: const Text('Sign in with Google'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                    ),
                  ),

                  // Dev login button (debug mode only)
                  if (kDebugMode) ...[
                    const SizedBox(height: 24),
                    const Divider(),
                    const SizedBox(height: 12),
                    Text(
                      'Development',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      onPressed: _loading ? null : _handleDevLogin,
                      icon: const Icon(Icons.bug_report_rounded),
                      label: _loading
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Dev Login'),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(48),
                        foregroundColor: WebmuxTheme.orange,
                        side: const BorderSide(color: WebmuxTheme.orange),
                      ),
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

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: WebmuxTheme.statusFailed.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
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
