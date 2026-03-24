import 'dart:js_interop';
import 'package:web/web.dart' as web;

/// On web, check if the current URL has a `?token=xxx` parameter
/// (set by the server after OAuth redirect).
String? extractTokenFromUrl() {
  final uri = Uri.parse(web.window.location.href);
  return uri.queryParameters['token'];
}

/// Always true on web.
bool get isWeb => true;

/// Remove the token query parameter from the browser URL to keep it clean.
void clearTokenFromUrl() {
  final uri = Uri.parse(web.window.location.href);
  if (uri.queryParameters.containsKey('token')) {
    final params = Map<String, String>.from(uri.queryParameters)
      ..remove('token');
    final cleaned = uri.replace(queryParameters: params.isEmpty ? null : params);
    final cleanedStr = cleaned.toString();
    web.window.history.replaceState(''.toJS, '', cleanedStr);
  }
}
