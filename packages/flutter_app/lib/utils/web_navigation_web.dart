import 'package:web/web.dart' as web;

/// Navigate the current window to the given URL.
void navigateToUrl(String url) {
  web.window.location.href = url;
}
