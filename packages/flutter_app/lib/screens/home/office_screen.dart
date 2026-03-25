import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../models/agent.dart';
import '../../models/run.dart';
import '../../providers/api_provider.dart';
import '../../providers/threads_provider.dart';
import '../../widgets/new_thread_sheet.dart';
import '../../widgets/office_scene.dart';

/// Main office view — displays all threads as pixel-art workstations
/// arranged on a tile floor, with project filtering and real-time updates.
class OfficeScreen extends ConsumerStatefulWidget {
  const OfficeScreen({super.key});

  @override
  ConsumerState<OfficeScreen> createState() => _OfficeScreenState();
}

class _OfficeScreenState extends ConsumerState<OfficeScreen> {
  List<Run> _threads = [];
  Map<String, AgentInfo> _agentsMap = {};
  bool _loading = true;
  String? _error;

  /// Currently selected project filter. Null means "All Projects".
  String? _selectedProject;

  // Timer for updating running durations every second.
  // Timer for auto-refreshing thread data.
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    _loadData();

    // Auto-refresh every 10 seconds for status updates.
    // No per-second timer — sprite animations are handled internally.
    _refreshTimer = Timer.periodic(
      const Duration(seconds: 10),
      (_) {
        if (mounted) _loadData(silent: true);
      },
    );
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadData({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final api = ref.read(apiClientProvider);
      final results = await Future.wait([
        api.listAllThreads(),
        api.listAgents(),
      ]);

      final threads = results[0] as List<Run>;
      final agents = results[1] as List<AgentInfo>;

      if (!mounted) return;

      setState(() {
        _threads = threads;
        _agentsMap = {for (final a in agents) a.id: a};
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      if (!silent) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Computed helpers
  // -------------------------------------------------------------------------

  List<Run> get _runningThreads => _threads
      .where((t) =>
          t.status == 'running' ||
          t.status == 'starting' ||
          t.status == 'queued')
      .toList();

  /// Unique project paths extracted from all threads.
  List<String> get _projectPaths {
    final paths = <String>{};
    for (final t in _threads) {
      if (t.repoPath.isNotEmpty) paths.add(t.repoPath);
    }
    final sorted = paths.toList()..sort();
    return sorted;
  }

  /// Threads filtered by the currently selected project.
  List<Run> get _filteredThreads {
    if (_selectedProject == null) return _threads;
    return _threads
        .where((t) => t.repoPath == _selectedProject)
        .toList();
  }

  /// Extract the last path segment as a display name.
  String _displayName(String repoPath) {
    if (repoPath.isEmpty) return 'Unknown';
    final segments = repoPath.split('/').where((s) => s.isNotEmpty).toList();
    return segments.isNotEmpty ? segments.last : repoPath;
  }

  // -------------------------------------------------------------------------
  // Thread interactions
  // -------------------------------------------------------------------------

  void _onThreadTap(Run thread) {
    context.push('/threads/${thread.agentId}/${thread.id}');
  }

  void _onThreadLongPress(Run thread) {
    final isRunning =
        thread.status == 'running' || thread.status == 'starting';

    showModalBottomSheet(
      context: context,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.zero,
      ),
      builder: (ctx) {
        final agentName = _agentsMap[thread.agentId]?.name ?? thread.agentId;
        final summary = thread.summary ?? thread.prompt;
        final displaySummary = summary.length > 60
            ? '${summary.substring(0, 57)}...'
            : summary;

        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Header with thread info
                Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        displaySummary,
                        style: Theme.of(ctx).textTheme.titleSmall,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '$agentName \u00b7 ${thread.status}',
                        style: Theme.of(ctx).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                const Divider(height: 1),
                // Open
                ListTile(
                  leading: const Icon(Icons.open_in_new_rounded),
                  title: const Text('Open'),
                  onTap: () {
                    Navigator.of(ctx).pop();
                    _onThreadTap(thread);
                  },
                ),
                // Interrupt (only if running)
                if (isRunning)
                  ListTile(
                    leading: const Icon(
                      Icons.stop_circle_outlined,
                      color: WebmuxTheme.statusWarning,
                    ),
                    title: const Text(
                      'Interrupt',
                      style: TextStyle(color: WebmuxTheme.statusWarning),
                    ),
                    onTap: () async {
                      Navigator.of(ctx).pop();
                      try {
                        final api = ref.read(apiClientProvider);
                        await api.interruptThread(
                            thread.agentId, thread.id);
                        if (mounted) _loadData();
                      } catch (e) {
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('Failed to interrupt: $e')),
                          );
                        }
                      }
                    },
                  ),
                // Delete
                ListTile(
                  leading: const Icon(
                    Icons.delete_rounded,
                    color: WebmuxTheme.statusFailed,
                  ),
                  title: const Text(
                    'Delete',
                    style: TextStyle(color: WebmuxTheme.statusFailed),
                  ),
                  onTap: () async {
                    Navigator.of(ctx).pop();
                    final confirmed = await showDialog<bool>(
                      context: context,
                      builder: (dialogCtx) => AlertDialog(
                        title: const Text('Delete thread?'),
                        content: const Text(
                          'This will permanently delete this thread and all its data.',
                        ),
                        actions: [
                          TextButton(
                            onPressed: () =>
                                Navigator.of(dialogCtx).pop(false),
                            child: const Text('Cancel'),
                          ),
                          TextButton(
                            onPressed: () =>
                                Navigator.of(dialogCtx).pop(true),
                            child: const Text(
                              'Delete',
                              style:
                                  TextStyle(color: WebmuxTheme.statusFailed),
                            ),
                          ),
                        ],
                      ),
                    );
                    if (confirmed == true) {
                      try {
                        final api = ref.read(apiClientProvider);
                        await api.deleteThread(thread.agentId, thread.id);
                        // Also refresh the shared Riverpod threads provider.
                        ref.read(threadsProvider.notifier).refresh();
                        if (mounted) _loadData();
                      } catch (e) {
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('Failed to delete: $e')),
                          );
                        }
                      }
                    }
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _onAddNew() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.zero,
      ),
      builder: (ctx) => NewThreadSheet(
        apiClient: ref.read(apiClientProvider),
        onCreated: (agentId, threadId) {
          ref.read(threadsProvider.notifier).refresh();
          _loadData();
          context.push('/threads/$agentId/$threadId');
        },
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Build
  // -------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading && _threads.isEmpty) {
      return const Center(child: Text('Loading...', style: TextStyle(fontSize: 14, color: Color(0xFFE8D5B5))));
    }

    if (_error != null && _threads.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Failed to load',
              style: TextStyle(
                color: Theme.of(context).colorScheme.onSurface,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _error!,
              style: const TextStyle(color: WebmuxTheme.subtext, fontSize: 12),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            TextButton(
              onPressed: _loadData,
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadData,
      child: OfficeScene(
        threads: _threads,
        onThreadTap: _onThreadTap,
        onThreadLongPress: _onThreadLongPress,
        onAddNew: _onAddNew,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Project filter dropdown in the AppBar
// ---------------------------------------------------------------------------

class _ProjectFilterDropdown extends StatelessWidget {
  const _ProjectFilterDropdown({
    required this.paths,
    required this.selectedPath,
    required this.displayName,
    required this.onChanged,
  });

  final List<String> paths;
  final String? selectedPath;
  final String Function(String) displayName;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonHideUnderline(
      child: DropdownButton<String>(
        value: selectedPath,
        hint: const Text(
          'All Projects',
          style: TextStyle(fontSize: 13),
        ),
        icon: const Icon(Icons.filter_list_rounded, size: 18),
        isDense: true,
        style: TextStyle(
          color: Theme.of(context).colorScheme.onSurface,
          fontSize: 13,
        ),
        dropdownColor: Theme.of(context).colorScheme.surface,
        items: [
          const DropdownMenuItem<String>(
            value: null,
            child: Text('All Projects'),
          ),
          ...paths.map((path) => DropdownMenuItem<String>(
                value: path,
                child: Text(displayName(path)),
              )),
        ],
        onChanged: onChanged,
      ),
    );
  }
}
