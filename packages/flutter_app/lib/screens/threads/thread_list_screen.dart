import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../../app/theme.dart';
import '../../models/run.dart';
import '../../providers/threads_provider.dart';
import '../../widgets/status_indicator.dart';

class ThreadListScreen extends ConsumerStatefulWidget {
  const ThreadListScreen({super.key});

  @override
  ConsumerState<ThreadListScreen> createState() => _ThreadListScreenState();
}

class _ThreadListScreenState extends ConsumerState<ThreadListScreen> {
  String _searchQuery = '';
  final _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<Run> _filterThreads(List<Run> threads) {
    if (_searchQuery.isEmpty) return threads;
    final q = _searchQuery.toLowerCase();
    return threads.where((r) {
      return r.prompt.toLowerCase().contains(q) ||
          r.repoPath.toLowerCase().contains(q) ||
          (r.summary?.toLowerCase().contains(q) ?? false) ||
          r.tool.toLowerCase().contains(q) ||
          r.agentId.toLowerCase().contains(q);
    }).toList();
  }

  /// Group threads by repoPath and sort each group by updatedAt descending.
  Map<String, List<Run>> _groupByProject(List<Run> threads) {
    final sorted = List<Run>.from(threads)
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    final map = <String, List<Run>>{};
    for (final run in sorted) {
      final key = run.repoPath.isNotEmpty ? run.repoPath : 'Unknown';
      (map[key] ??= []).add(run);
    }
    return map;
  }

  String _formatRepoName(String repoPath) {
    // Show last 2 path segments for brevity.
    final parts = repoPath.split('/').where((p) => p.isNotEmpty).toList();
    if (parts.length <= 2) return repoPath;
    return parts.sublist(parts.length - 2).join('/');
  }

  @override
  Widget build(BuildContext context) {
    final threadsAsync = ref.watch(threadsProvider);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Threads'),
      ),
      body: Column(
        children: [
          // Search bar
          Padding(
            padding:
                const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Search threads...',
                prefixIcon:
                    const Icon(Icons.search_rounded, size: 20),
                suffixIcon: _searchQuery.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear_rounded, size: 18),
                        onPressed: () {
                          _searchController.clear();
                          setState(() => _searchQuery = '');
                        },
                      )
                    : null,
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(
                    horizontal: 12, vertical: 10),
              ),
              onChanged: (value) {
                setState(() => _searchQuery = value);
              },
            ),
          ),
          // Thread list
          Expanded(
            child: threadsAsync.when(
              loading: () => const Center(
                child: CircularProgressIndicator(),
              ),
              error: (error, _) => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Failed to load threads',
                      style: theme.textTheme.bodyMedium,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      error.toString(),
                      style: theme.textTheme.bodySmall,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 16),
                    OutlinedButton(
                      onPressed: () =>
                          ref.read(threadsProvider.notifier).refresh(),
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
              data: (threads) {
                final filtered = _filterThreads(threads);
                if (filtered.isEmpty) {
                  return RefreshIndicator(
                    onRefresh: () =>
                        ref.read(threadsProvider.notifier).refresh(),
                    child: ListView(
                      children: [
                        SizedBox(
                          height: MediaQuery.of(context).size.height * 0.5,
                          child: Center(
                            child: Text(
                              _searchQuery.isNotEmpty
                                  ? 'No matching threads'
                                  : 'No threads yet',
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: WebmuxTheme.subtext,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  );
                }

                final grouped = _groupByProject(filtered);
                final projectKeys = grouped.keys.toList();

                return RefreshIndicator(
                  onRefresh: () =>
                      ref.read(threadsProvider.notifier).refresh(),
                  child: ListView.builder(
                    padding: const EdgeInsets.only(bottom: 16),
                    itemCount: projectKeys.length,
                    itemBuilder: (context, sectionIndex) {
                      final projectPath = projectKeys[sectionIndex];
                      final projectThreads = grouped[projectPath]!;
                      return _ProjectSection(
                        projectPath: projectPath,
                        displayName: _formatRepoName(projectPath),
                        threads: projectThreads,
                        onDelete: (run) async {
                          await ref
                              .read(threadsProvider.notifier)
                              .deleteThread(run.agentId, run.id);
                        },
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Project section with collapsible header
// ---------------------------------------------------------------------------

class _ProjectSection extends StatefulWidget {
  const _ProjectSection({
    required this.projectPath,
    required this.displayName,
    required this.threads,
    required this.onDelete,
  });

  final String projectPath;
  final String displayName;
  final List<Run> threads;
  final Future<void> Function(Run) onDelete;

  @override
  State<_ProjectSection> createState() => _ProjectSectionState();
}

class _ProjectSectionState extends State<_ProjectSection> {
  bool _collapsed = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Section header
        InkWell(
          onTap: () => setState(() => _collapsed = !_collapsed),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Row(
              children: [
                Icon(
                  _collapsed
                      ? Icons.chevron_right_rounded
                      : Icons.expand_more_rounded,
                  size: 18,
                  color: WebmuxTheme.subtext,
                ),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    widget.displayName,
                    style: theme.textTheme.labelMedium?.copyWith(
                      color: WebmuxTheme.subtext,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                Text(
                  '${widget.threads.length}',
                  style: theme.textTheme.labelSmall,
                ),
              ],
            ),
          ),
        ),
        if (!_collapsed)
          ...widget.threads.map(
            (run) => _ThreadTile(
              run: run,
              onDelete: () => widget.onDelete(run),
            ),
          ),
        const Divider(height: 1),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Thread tile
// ---------------------------------------------------------------------------

class _ThreadTile extends StatelessWidget {
  const _ThreadTile({
    required this.run,
    required this.onDelete,
  });

  final Run run;
  final VoidCallback onDelete;

  bool get _isRunning =>
      run.status == 'running' || run.status == 'starting';

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final updatedAt = DateTime.fromMillisecondsSinceEpoch(
      run.updatedAt.toInt(),
    );

    final tile = Container(
      decoration: _isRunning
          ? BoxDecoration(
              border: Border(
                left: BorderSide(
                  color: WebmuxTheme.statusRunning,
                  width: 3,
                ),
              ),
            )
          : null,
      child: ListTile(
        contentPadding: EdgeInsets.only(
          left: _isRunning ? 13 : 16,
          right: 16,
        ),
        leading: StatusIndicator(status: run.status, size: 10),
        title: Text(
          run.tool,
          style: theme.textTheme.bodyMedium?.copyWith(
            fontWeight: FontWeight.w600,
          ),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Text(
          run.summary ?? run.prompt,
          style: theme.textTheme.bodySmall,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: Text(
          timeago.format(updatedAt, locale: 'en_short'),
          style: theme.textTheme.labelSmall,
        ),
        onTap: () {
          context.go('/threads/${run.agentId}/${run.id}');
        },
      ),
    );

    return Dismissible(
      key: ValueKey(run.id),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        color: WebmuxTheme.statusFailed.withOpacity(0.2),
        child: Icon(
          Icons.delete_rounded,
          color: WebmuxTheme.statusFailed,
        ),
      ),
      confirmDismiss: (direction) async {
        return await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Delete thread?'),
            content: const Text(
                'This will permanently delete this thread and all its data.'),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: const Text('Cancel'),
              ),
              TextButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: Text(
                  'Delete',
                  style: TextStyle(color: WebmuxTheme.statusFailed),
                ),
              ),
            ],
          ),
        );
      },
      onDismissed: (_) => onDelete(),
      child: tile,
    );
  }
}
