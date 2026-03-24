import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../providers/providers.dart';
import '../../providers/connection_provider.dart' as conn;

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  @override
  void initState() {
    super.initState();
    // Trigger loading agents and projects for counts
    Future.microtask(() {
      ref.read(agentsProvider.notifier).refresh();
      ref.read(projectsProvider.notifier).refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);
    final connectionState = ref.watch(connectionProvider);
    final agentsAsync = ref.watch(agentsProvider);
    final projectsAsync = ref.watch(projectsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: 8),
        children: [
          // --- Server section ---
          const _SectionHeader(title: 'Server'),
          ListTile(
            leading: const Icon(Icons.dns_rounded),
            title: const Text('Server URL'),
            subtitle: Text(
              authState.baseUrl ?? 'Not connected',
              style: const TextStyle(color: WebmuxTheme.subtext),
            ),
          ),
          ListTile(
            leading: Icon(
              connectionState.isConnected
                  ? Icons.cloud_done_rounded
                  : Icons.cloud_off_rounded,
              color: connectionState.isConnected
                  ? WebmuxTheme.statusSuccess
                  : WebmuxTheme.statusFailed,
            ),
            title: const Text('Connection'),
            subtitle: Text(
              _connectionLabel(connectionState),
              style: TextStyle(
                color: connectionState.isConnected
                    ? WebmuxTheme.statusSuccess
                    : WebmuxTheme.subtext,
              ),
            ),
          ),
          const Divider(),

          // --- Management section ---
          const _SectionHeader(title: 'Management'),
          ListTile(
            leading: const Icon(Icons.computer_rounded),
            title: const Text('Agents'),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                agentsAsync.when(
                  data: (agents) => _CountBadge(count: agents.length),
                  loading: () => const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  error: (_, __) => const Icon(
                    Icons.error_outline,
                    size: 16,
                    color: WebmuxTheme.statusFailed,
                  ),
                ),
                const SizedBox(width: 4),
                const Icon(Icons.chevron_right),
              ],
            ),
            onTap: () => context.push('/settings/agents'),
          ),
          ListTile(
            leading: const Icon(Icons.folder_rounded),
            title: const Text('Projects'),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                projectsAsync.when(
                  data: (projects) => _CountBadge(count: projects.length),
                  loading: () => const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  error: (_, __) => const Icon(
                    Icons.error_outline,
                    size: 16,
                    color: WebmuxTheme.statusFailed,
                  ),
                ),
                const SizedBox(width: 4),
                const Icon(Icons.chevron_right),
              ],
            ),
            onTap: () => context.push('/settings/projects'),
          ),
          ListTile(
            leading: const Icon(Icons.smart_toy_rounded),
            title: const Text('LLM Configuration'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/settings/llm-configs'),
          ),
          const Divider(),

          // --- Account section ---
          const _SectionHeader(title: 'Account'),
          if (authState.user != null)
            ListTile(
              leading: authState.user!.avatarUrl != null
                  ? CircleAvatar(
                      radius: 18,
                      backgroundImage:
                          NetworkImage(authState.user!.avatarUrl!),
                    )
                  : const CircleAvatar(
                      radius: 18,
                      child: Icon(Icons.person_rounded, size: 20),
                    ),
              title: Text(authState.user!.displayName),
              subtitle: Text(
                authState.user!.role,
                style: const TextStyle(color: WebmuxTheme.subtext),
              ),
            ),
          ListTile(
            leading: const Icon(Icons.logout_rounded, color: WebmuxTheme.statusFailed),
            title: const Text(
              'Sign Out',
              style: TextStyle(color: WebmuxTheme.statusFailed),
            ),
            onTap: () => _confirmSignOut(context),
          ),
          const Divider(),

          // --- About section ---
          const _SectionHeader(title: 'About'),
          const ListTile(
            leading: Icon(Icons.info_outline_rounded),
            title: Text('Version'),
            subtitle: Text(
              '1.0.0',
              style: TextStyle(color: WebmuxTheme.subtext),
            ),
          ),
        ],
      ),
    );
  }

  String _connectionLabel(conn.ConnectionState connState) {
    switch (connState.status) {
      case conn.ConnectionStatus.connected:
        return 'Connected';
      case conn.ConnectionStatus.reconnecting:
        return connState.message ?? 'Reconnecting...';
      case conn.ConnectionStatus.disconnected:
        return connState.message ?? 'Disconnected';
    }
  }

  Future<void> _confirmSignOut(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign Out'),
        content: const Text('Are you sure you want to sign out?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(
              backgroundColor: WebmuxTheme.statusFailed,
            ),
            child: const Text('Sign Out'),
          ),
        ],
      ),
    );

    if (confirmed == true && mounted) {
      await ref.read(authProvider.notifier).logout();
      if (mounted) context.go('/login');
    }
  }
}

// ---------------------------------------------------------------------------
// Helper widgets
// ---------------------------------------------------------------------------

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      child: Text(
        title.toUpperCase(),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: WebmuxTheme.subtext,
              letterSpacing: 1.2,
              fontWeight: FontWeight.w600,
            ),
      ),
    );
  }
}

class _CountBadge extends StatelessWidget {
  const _CountBadge({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: WebmuxTheme.border,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        '$count',
        style: const TextStyle(fontSize: 12, color: WebmuxTheme.subtext),
      ),
    );
  }
}
