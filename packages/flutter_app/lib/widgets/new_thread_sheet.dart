import 'package:flutter/material.dart';

import '../app/theme.dart';
import '../models/agent.dart';
import '../models/project.dart';
import '../models/run.dart';
import '../services/api_client.dart';

/// Reusable bottom sheet for creating a new thread.
///
/// Usage:
/// ```dart
/// showModalBottomSheet(
///   context: context,
///   isScrollControlled: true,
///   backgroundColor: Theme.of(context).colorScheme.surface,
///   shape: const RoundedRectangleBorder(
///     borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
///   ),
///   builder: (ctx) => NewThreadSheet(
///     apiClient: ref.read(apiClientProvider),
///     onCreated: (agentId, threadId) { ... },
///   ),
/// );
/// ```
class NewThreadSheet extends StatefulWidget {
  const NewThreadSheet({
    super.key,
    required this.apiClient,
    required this.onCreated,
  });

  final ApiClient apiClient;
  final void Function(String agentId, String threadId) onCreated;

  @override
  State<NewThreadSheet> createState() => _NewThreadSheetState();
}

class _NewThreadSheetState extends State<NewThreadSheet> {
  final _promptController = TextEditingController();
  final _repoPathController = TextEditingController();
  List<AgentInfo> _agents = [];
  AgentInfo? _selectedAgent;
  String _tool = 'claude';
  bool _loading = true;
  bool _sending = false;
  String? _error;
  List<String> _recentPaths = [];

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _promptController.dispose();
    _repoPathController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    try {
      // Load agents, projects, and threads in parallel to collect repo paths.
      final results = await Future.wait([
        widget.apiClient.listAgents(),
        widget.apiClient.listProjects(),
        widget.apiClient.listAllThreads(),
      ]);

      final agents = results[0] as List<AgentInfo>;
      final projects = results[1] as List<Project>;
      final threads = results[2] as List<Run>;

      // Collect unique repo paths from projects and recent threads.
      final paths = <String>{};
      for (final p in projects) {
        if (p.repoPath.isNotEmpty) paths.add(p.repoPath);
      }
      for (final t in threads) {
        if (t.repoPath.isNotEmpty) paths.add(t.repoPath);
      }

      if (!mounted) return;
      setState(() {
        _agents = agents;
        _selectedAgent = agents.isNotEmpty
            ? agents.firstWhere(
                (a) => a.status == 'online',
                orElse: () => agents.first,
              )
            : null;
        _recentPaths = paths.toList()..sort();
        // Auto-fill first path if available.
        if (_recentPaths.isNotEmpty) {
          _repoPathController.text = _recentPaths.first;
        }
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
              child: SizedBox(width: 16, height: 16, child: Text('...', style: TextStyle(fontSize: 14))),
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

            // Repo path — quick select from recent paths
            if (_recentPaths.isNotEmpty) ...[
              Text('Repository', style: theme.textTheme.bodySmall?.copyWith(
                color: WebmuxTheme.subtext,
              )),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: _recentPaths.map((path) {
                  final isSelected = _repoPathController.text == path;
                  final label = path.split('/').last;
                  return ChoiceChip(
                    label: Text(label, style: const TextStyle(fontSize: 12)),
                    selected: isSelected,
                    onSelected: (_) {
                      setState(() => _repoPathController.text = path);
                    },
                    tooltip: path,
                    visualDensity: VisualDensity.compact,
                  );
                }).toList(),
              ),
              const SizedBox(height: 8),
            ],
            // Manual repo path input
            TextField(
              controller: _repoPathController,
              decoration: InputDecoration(
                labelText: _recentPaths.isNotEmpty ? 'Or enter path' : 'Repository Path',
                hintText: '/home/user/projects/my-project',
                border: const OutlineInputBorder(),
                isDense: true,
              ),
              onChanged: (_) => setState(() {}),
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
                      child: Text('...', style: TextStyle(fontSize: 14)),
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
