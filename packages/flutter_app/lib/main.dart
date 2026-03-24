import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/theme.dart';
import 'app/router.dart';
import 'providers/auth_provider.dart';
import 'utils/url_token.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: WebmuxApp()));
}

class WebmuxApp extends ConsumerStatefulWidget {
  const WebmuxApp({super.key});

  @override
  ConsumerState<WebmuxApp> createState() => _WebmuxAppState();
}

class _WebmuxAppState extends ConsumerState<WebmuxApp> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      // On web, check if the URL contains a token from OAuth redirect.
      final urlToken = extractTokenFromUrl();
      if (urlToken != null && urlToken.isNotEmpty) {
        clearTokenFromUrl();
        // Web is same-origin, so baseUrl is empty.
        await ref.read(authProvider.notifier).login('', urlToken);
      } else {
        ref.read(authProvider.notifier).checkAuth();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);

    return MaterialApp.router(
      title: 'Webmux',
      theme: WebmuxTheme.darkTheme,
      routerConfig: router,
      debugShowCheckedModeBanner: false,
    );
  }
}
