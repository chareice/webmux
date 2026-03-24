import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/api_client.dart';
import '../services/auth_service.dart';
import '../services/websocket_service.dart';

/// Singleton provider for [ApiClient].
final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient();
});

/// Singleton provider for [AuthService].
final authServiceProvider = Provider<AuthService>((ref) {
  return AuthService();
});

/// Singleton provider for [WebSocketService].
final webSocketServiceProvider = Provider<WebSocketService>((ref) {
  return WebSocketService();
});
