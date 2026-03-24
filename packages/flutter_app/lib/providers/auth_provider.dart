import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import 'api_provider.dart';

// ---------------------------------------------------------------------------
// Auth state
// ---------------------------------------------------------------------------

enum AuthStatus { unauthenticated, loading, authenticated, error }

class AuthState {
  final AuthStatus status;
  final User? user;
  final String? token;
  final String? baseUrl;
  final String? errorMessage;

  const AuthState._({
    required this.status,
    this.user,
    this.token,
    this.baseUrl,
    this.errorMessage,
  });

  const AuthState.unauthenticated()
      : this._(status: AuthStatus.unauthenticated);

  const AuthState.loading() : this._(status: AuthStatus.loading);

  const AuthState.authenticated({
    required User user,
    required String token,
    required String baseUrl,
  }) : this._(
          status: AuthStatus.authenticated,
          user: user,
          token: token,
          baseUrl: baseUrl,
        );

  const AuthState.error(String message)
      : this._(status: AuthStatus.error, errorMessage: message);
}

// ---------------------------------------------------------------------------
// AuthNotifier
// ---------------------------------------------------------------------------

class AuthNotifier extends StateNotifier<AuthState> {
  final Ref _ref;

  AuthNotifier(this._ref) : super(const AuthState.unauthenticated());

  ApiClient get _apiClient => _ref.read(apiClientProvider);

  /// Attempt to load saved credentials and validate them.
  Future<void> checkAuth() async {
    state = const AuthState.loading();
    try {
      final authService = _ref.read(authServiceProvider);
      final creds = await authService.loadCredentials();
      if (creds == null) {
        state = const AuthState.unauthenticated();
        return;
      }

      final baseUrl = creds['baseUrl']!;
      final token = creds['token']!;

      _configureServices(baseUrl, token);

      final user = await _apiClient.getCurrentUser();
      state = AuthState.authenticated(
        user: user,
        token: token,
        baseUrl: baseUrl,
      );
    } on ApiException catch (e) {
      // Token invalid / expired – clear stored creds and go unauthenticated.
      if (e.statusCode == 401) {
        await _ref.read(authServiceProvider).clearCredentials();
        state = const AuthState.unauthenticated();
      } else {
        state = AuthState.error(e.message);
      }
    } catch (e) {
      state = AuthState.error(e.toString());
    }
  }

  /// Log in with a base URL and token.
  Future<void> login(String baseUrl, String token) async {
    state = const AuthState.loading();
    try {
      _configureServices(baseUrl, token);

      final user = await _apiClient.getCurrentUser();

      // Persist credentials.
      await _ref.read(authServiceProvider).saveCredentials(baseUrl, token);

      state = AuthState.authenticated(
        user: user,
        token: token,
        baseUrl: baseUrl,
      );
    } on ApiException catch (e) {
      state = AuthState.error(e.message);
    } catch (e) {
      state = AuthState.error(e.toString());
    }
  }

  /// Dev login — calls the /api/auth/dev endpoint.
  Future<void> devLogin(String baseUrl) async {
    state = const AuthState.loading();
    try {
      _ref.read(apiClientProvider).configure(baseUrl, '');
      final result = await _apiClient.devLogin();
      final token = result['token']!;

      _configureServices(baseUrl, token);
      final user = await _apiClient.getCurrentUser();

      await _ref.read(authServiceProvider).saveCredentials(baseUrl, token);

      state = AuthState.authenticated(
        user: user,
        token: token,
        baseUrl: baseUrl,
      );
    } on ApiException catch (e) {
      state = AuthState.error(e.message);
    } catch (e) {
      state = AuthState.error(e.toString());
    }
  }

  /// Log out and clear stored credentials.
  Future<void> logout() async {
    await _ref.read(authServiceProvider).clearCredentials();
    state = const AuthState.unauthenticated();
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  void _configureServices(String baseUrl, String token) {
    _ref.read(apiClientProvider).configure(baseUrl, token);
    _ref.read(webSocketServiceProvider).configure(baseUrl, token);
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref);
});
