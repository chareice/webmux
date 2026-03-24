import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists server URL and auth token using platform-secure storage.
class AuthService {
  static const _keyBaseUrl = 'webmux_base_url';
  static const _keyToken = 'webmux_token';

  final FlutterSecureStorage _storage;

  AuthService({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  /// Save the server URL and auth token.
  Future<void> saveCredentials(String baseUrl, String token) async {
    await Future.wait([
      _storage.write(key: _keyBaseUrl, value: baseUrl),
      _storage.write(key: _keyToken, value: token),
    ]);
  }

  /// Load previously stored credentials.
  ///
  /// Returns a map with keys `baseUrl` and `token`, or `null` if none are
  /// stored (or if either value is missing).
  Future<Map<String, String>?> loadCredentials() async {
    final results = await Future.wait([
      _storage.read(key: _keyBaseUrl),
      _storage.read(key: _keyToken),
    ]);
    final baseUrl = results[0];
    final token = results[1];

    if (baseUrl == null || token == null) return null;
    if (baseUrl.isEmpty || token.isEmpty) return null;

    return {'baseUrl': baseUrl, 'token': token};
  }

  /// Remove all stored credentials.
  Future<void> clearCredentials() async {
    await Future.wait([
      _storage.delete(key: _keyBaseUrl),
      _storage.delete(key: _keyToken),
    ]);
  }
}
