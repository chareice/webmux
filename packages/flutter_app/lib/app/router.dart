import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'app_shell.dart';
import '../providers/auth_provider.dart';
import '../screens/auth/login_screen.dart';
import '../screens/home/office_screen.dart';
import '../screens/threads/thread_list_screen.dart';
import '../screens/threads/thread_detail_screen.dart';
import '../screens/settings/settings_screen.dart';
import '../screens/settings/agents_screen.dart';
import '../screens/settings/projects_screen.dart';
import '../screens/settings/project_detail_screen.dart';
import '../screens/settings/task_detail_screen.dart';
import '../screens/settings/llm_config_screen.dart';

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

      // While checking stored credentials, don't redirect.
      if (isLoading) return null;

      // Not logged in and not on login page → go to login.
      if (!isLoggedIn && !isLoginRoute) return '/login';

      // Logged in and on login page → go home.
      if (isLoggedIn && isLoginRoute) return '/home';

      return null;
    },
    routes: [
      GoRoute(
        path: '/login',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => const LoginScreen(),
      ),
      // StatefulShellRoute preserves each tab's state across switches.
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) =>
            AppShell(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/home',
                builder: (context, state) => const OfficeScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/threads',
                builder: (context, state) => const ThreadListScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/settings',
                builder: (context, state) => const SettingsScreen(),
              ),
            ],
          ),
        ],
      ),
      // Full-screen routes outside the shell (no bottom nav / nav rail).
      GoRoute(
        path: '/threads/:agentId/:threadId',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => ThreadDetailScreen(
          agentId: state.pathParameters['agentId']!,
          threadId: state.pathParameters['threadId']!,
        ),
      ),
      GoRoute(
        path: '/settings/agents',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => const AgentsScreen(),
      ),
      GoRoute(
        path: '/settings/projects',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => const ProjectsScreen(),
      ),
      GoRoute(
        path: '/settings/projects/:projectId',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => ProjectDetailScreen(
          projectId: state.pathParameters['projectId']!,
        ),
      ),
      GoRoute(
        path: '/settings/projects/:projectId/tasks/:taskId',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => TaskDetailScreen(
          projectId: state.pathParameters['projectId']!,
          taskId: state.pathParameters['taskId']!,
        ),
      ),
      GoRoute(
        path: '/settings/llm-configs',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => const LlmConfigScreen(),
      ),
    ],
  );
});
