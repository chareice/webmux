import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/auth_provider.dart';
import '../screens/auth/login_screen.dart';
import '../screens/home/office_screen.dart';
import '../screens/threads/thread_detail_screen.dart';

final GlobalKey<NavigatorState> _rootNavigatorKey =
    GlobalKey<NavigatorState>(debugLabel: 'root');

/// A [ChangeNotifier] that listens to auth state changes and notifies the
/// router so it can re-evaluate its redirect logic.
class AuthChangeNotifier extends ChangeNotifier {
  AuthChangeNotifier(Ref ref) {
    ref.listen<AuthState>(authProvider, (_, __) {
      notifyListeners();
    });
  }
}

/// Provider for the [AuthChangeNotifier] used by the router.
final authChangeNotifierProvider = Provider<AuthChangeNotifier>((ref) {
  return AuthChangeNotifier(ref);
});

/// Provider for the [GoRouter], so it can access auth state.
final routerProvider = Provider<GoRouter>((ref) {
  final authNotifier = ref.watch(authChangeNotifierProvider);

  return GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: '/home',
    refreshListenable: authNotifier,
    redirect: (context, state) {
      final authState = ref.read(authProvider);
      final isLoggedIn = authState.status == AuthStatus.authenticated;
      final isLoading = authState.status == AuthStatus.loading;
      final isLoginRoute = state.matchedLocation == '/login';

      if (isLoading) return null;
      if (!isLoggedIn && !isLoginRoute) return '/login';
      if (isLoggedIn && isLoginRoute) return '/home';

      return null;
    },
    routes: [
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      // Office is the only top-level screen — no tabs, no shell.
      GoRoute(
        path: '/home',
        builder: (context, state) => const OfficeScreen(),
      ),
      // Thread detail — full screen, push on top of office.
      GoRoute(
        path: '/threads/:agentId/:threadId',
        builder: (context, state) => ThreadDetailScreen(
          agentId: state.pathParameters['agentId']!,
          threadId: state.pathParameters['threadId']!,
        ),
      ),
    ],
  );
});
