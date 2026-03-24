import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../../app/theme.dart';
import '../../models/agent.dart';
import '../../models/run.dart';
import '../../providers/api_provider.dart';
import '../../providers/threads_provider.dart';
import '../../services/api_client.dart';
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

  void _showNewThreadSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => _NewThreadSheet(
        apiClient: ref.read(apiClientProvider),
        onCreated: (agentId, threadId) {
          ref.read(threadsProvider.notifier).refresh();
          context.push('/threads/$agentId/$threadId');
        },
      ),
    );
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
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showNewThreadSheet(context),
        child: const Icon(Icons.add_rounded),
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

  String _displayTitle() {
    if (run.summary != null && run.summary!.isNotEmpty) {
      return run.summary!;
    }
    // Use first line of prompt, trimmed.
    final firstLine = run.prompt.split('\n').first.trim();
    return firstLine.isNotEmpty ? firstLine : run.prompt;
  }

  String _formatRepoName(String repoPath) {
    if (repoPath.isEmpty) return '';
    final parts = repoPath.split('/').where((p) => p.isNotEmpty).toList();
    if (parts.length <= 2) return repoPath;
    return parts.sublist(parts.length - 2).join('/');
  }

  Color _statusBadgeColor() {
    return StatusIndicator.colorForStatus(run.status);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final updatedAt = DateTime.fromMillisecondsSinceEpoch(
      run.updatedAt.toInt(),
    );
    final timeAgoStr = timeago.format(updatedAt, locale: 'en_short');
    final repoName = _formatRepoName(run.repoPath);

    final tile = Container(
      decoration: _isRunning
          ? const BoxDecoration(
              border: Border(
                left: BorderSide(
                  color: WebmuxTheme.statusRunning,
                  width: 3,
                ),
              ),
            )
          : null,
      child: InkWell(
        onTap: () {
          context.push('/threads/${run.agentId}/${run.id}');
        },
        child: Padding(
          padding: EdgeInsets.only(
            left: _isRunning ? 13 : 16,
            right: 16,
            top: 10,
            bottom: 10,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Status dot
              Padding(
                padding: const EdgeInsets.only(top: 5),
                child: StatusIndicator(status: run.status, size: 8),
              ),
              const SizedBox(width: 10),
              // Title & subtitle
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Title row: summary + status badge
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            _displayTitle(),
                            style: theme.textTheme.bodyMedium?.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 6, vertical: 1),
                          decoration: BoxDecoration(
                            color: _statusBadgeColor().withOpacity(0.15),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            run.status,
                            style: TextStyle(
                              color: _statusBadgeColor(),
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    // Subtitle: tool · repo · time ago
                    Text(
                      [
                        run.tool,
                        if (repoName.isNotEmpty) repoName,
                        timeAgoStr,
                      ].join(' \u00b7 '),
                      style: theme.textTheme.bodySmall,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );

    return Dismissible(
      key: ValueKey(run.id),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        color: WebmuxTheme.statusFailed.withOpacity(0.2),
        child: const Icon(
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
                child: const Text(
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

// ---------------------------------------------------------------------------
// New thread bottom sheet
// ---------------------------------------------------------------------------

class _NewThreadSheet extends StatefulWidget {
  const _NewThreadSheet({
    required this.apiClient,
    required this.onCreated,
  });

  final ApiClient apiClient;
  final void Function(String agentId, String threadId) onCreated;

  @override
  State<_NewThreadSheet> createState() => _NewThreadSheetState();
}

class _NewThreadSheetState extends State<_NewThreadSheet> {
  final _promptController = TextEditingController();
  final _repoPathController = TextEditingController();
  List<AgentInfo> _agents = [];
  AgentInfo? _selectedAgent;
  String _tool = 'claude';
  bool _loading = true;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadAgents();
  }

  @override
  void dispose() {
    _promptController.dispose();
    _repoPathController.dispose();
    super.dispose();
  }

  Future<void> _loadAgents() async {
    try {
      final agents = await widget.apiClient.listAgents();
      if (!mounted) return;
      setState(() {
        _agents = agents;
        // Auto-select first online agent, or first agent.
        _selectedAgent = agents.firstWhere(
          (a) => a.status == 'online',
          orElse: () => agents.first,
        );
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _create() async {
    final prompt = _promptController.text.trim();
    final repoPath = _repoPathController.text.trim();
    if (prompt.isEmpty || _selectedAgent == null || repoPath.isEmpty) return;

    setState(() {
      _sending = true;
      _error = null;
    });

    try {
      final result = await widget.apiClient.startThread(
        _selectedAgent!.id,
        StartRunRequest(
          tool: _tool,
          repoPath: repoPath,
          prompt: prompt,
        ),
      );
      if (!mounted) return;
      Navigator.of(context).pop();
      widget.onCreated(_selectedAgent!.id, result.run.id);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _sending = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('New Thread', style: theme.textTheme.titleMedium),
          const SizedBox(height: 16),

          if (_loading)
            const Center(child: Padding(
              padding: EdgeInsets.all(24),
              child: CircularProgressIndicator(),
            ))
          else if (_agents.isEmpty)
            const Text('No agents available. Register an agent first.')
          else ...[
            // Agent selector
            DropdownButtonFormField<AgentInfo>(
              value: _selectedAgent,
              decoration: const InputDecoration(
                labelText: 'Agent',
                border: OutlineInputBorder(),
                isDense: true,
              ),
              items: _agents.map((a) => DropdownMenuItem(
                value: a,
                child: Row(
                  children: [
                    Container(
                      width: 8, height: 8,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: a.status == 'online'
                            ? WebmuxTheme.statusSuccess
                            : WebmuxTheme.subtext,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(a.name),
                  ],
                ),
              )).toList(),
              onChanged: (v) => setState(() => _selectedAgent = v),
            ),
            const SizedBox(height: 12),

            // Repo path
            TextField(
              controller: _repoPathController,
              decoration: const InputDecoration(
                labelText: 'Repository Path',
                hintText: '/home/user/projects/my-project',
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 12),

            // Tool selector
            Row(
              children: [
                Text('Tool:', style: theme.textTheme.bodySmall),
                const SizedBox(width: 12),
                ChoiceChip(
                  label: const Text('Claude'),
                  selected: _tool == 'claude',
                  onSelected: (_) => setState(() => _tool = 'claude'),
                ),
                const SizedBox(width: 8),
                ChoiceChip(
                  label: const Text('Codex'),
                  selected: _tool == 'codex',
                  onSelected: (_) => setState(() => _tool = 'codex'),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Prompt
            TextField(
              controller: _promptController,
              maxLines: 4,
              minLines: 2,
              decoration: const InputDecoration(
                labelText: 'Message',
                hintText: 'What should the agent do?',
                border: OutlineInputBorder(),
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 12),

            if (_error != null) ...[
              Text(
                _error!,
                style: const TextStyle(color: WebmuxTheme.statusFailed, fontSize: 12),
              ),
              const SizedBox(height: 8),
            ],

            // Send button
            FilledButton.icon(
              onPressed: _sending ||
                      _promptController.text.trim().isEmpty ||
                      _repoPathController.text.trim().isEmpty ||
                      _selectedAgent == null
                  ? null
                  : _create,
              icon: _sending
                  ? const SizedBox(
                      width: 16, height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.send_rounded, size: 18),
              label: const Text('Start Thread'),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(44),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
