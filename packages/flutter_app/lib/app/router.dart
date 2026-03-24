import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'app_shell.dart';
import '../screens/auth/login_screen.dart';
import '../screens/home/home_screen.dart';
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
final GlobalKey<NavigatorState> _shellNavigatorKey =
    GlobalKey<NavigatorState>(debugLabel: 'shell');

final GoRouter router = GoRouter(
  navigatorKey: _rootNavigatorKey,
  initialLocation: '/home',
  redirect: (context, state) {
    // TODO: Add authentication check
    // final isLoggedIn = ...;
    // final isLoginRoute = state.matchedLocation == '/login';
    // if (!isLoggedIn && !isLoginRoute) return '/login';
    // if (isLoggedIn && isLoginRoute) return '/home';
    return null;
  },
  routes: [
    GoRoute(
      path: '/login',
      parentNavigatorKey: _rootNavigatorKey,
      builder: (context, state) => const LoginScreen(),
    ),
    ShellRoute(
      navigatorKey: _shellNavigatorKey,
      builder: (context, state, child) => AppShell(child: child),
      routes: [
        GoRoute(
          path: '/home',
          parentNavigatorKey: _shellNavigatorKey,
          builder: (context, state) => const HomeScreen(),
        ),
        GoRoute(
          path: '/threads',
          parentNavigatorKey: _shellNavigatorKey,
          builder: (context, state) => const ThreadListScreen(),
          routes: [
            GoRoute(
              path: ':agentId/:threadId',
              parentNavigatorKey: _rootNavigatorKey,
              builder: (context, state) => ThreadDetailScreen(
                agentId: state.pathParameters['agentId']!,
                threadId: state.pathParameters['threadId']!,
              ),
            ),
          ],
        ),
        GoRoute(
          path: '/settings',
          parentNavigatorKey: _shellNavigatorKey,
          builder: (context, state) => const SettingsScreen(),
          routes: [
            GoRoute(
              path: 'agents',
              parentNavigatorKey: _rootNavigatorKey,
              builder: (context, state) => const AgentsScreen(),
            ),
            GoRoute(
              path: 'projects',
              parentNavigatorKey: _rootNavigatorKey,
              builder: (context, state) => const ProjectsScreen(),
            ),
            GoRoute(
              path: 'projects/:projectId',
              parentNavigatorKey: _rootNavigatorKey,
              builder: (context, state) => ProjectDetailScreen(
                projectId: state.pathParameters['projectId']!,
              ),
              routes: [
                GoRoute(
                  path: 'tasks/:taskId',
                  parentNavigatorKey: _rootNavigatorKey,
                  builder: (context, state) => TaskDetailScreen(
                    projectId: state.pathParameters['projectId']!,
                    taskId: state.pathParameters['taskId']!,
                  ),
                ),
              ],
            ),
            GoRoute(
              path: 'llm-configs',
              parentNavigatorKey: _rootNavigatorKey,
              builder: (context, state) => const LlmConfigScreen(),
            ),
          ],
        ),
      ],
    ),
  ],
);
