import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../../app/theme.dart';
import '../../models/models.dart';
import '../../providers/providers.dart';

class AgentsScreen extends ConsumerStatefulWidget {
  const AgentsScreen({super.key});

  @override
  ConsumerState<AgentsScreen> createState() => _AgentsScreenState();
}

class _AgentsScreenState extends ConsumerState<AgentsScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(agentsProvider.notifier).refresh());
  }

  @override
  Widget build(BuildContext context) {
    final agentsAsync = ref.watch(agentsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Agents'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add_rounded),
            tooltip: 'Register Agent',
            onPressed: () => _showRegisterSheet(context),
          ),
        ],
      ),
      body: agentsAsync.when(
        data: (agents) {
          if (agents.isEmpty) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.computer_rounded,
                    size: 48,
                    color: WebmuxTheme.subtext,
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'No agents registered',
                    style: TextStyle(color: WebmuxTheme.subtext),
                  ),
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    onPressed: () => _showRegisterSheet(context),
                    icon: const Icon(Icons.add_rounded),
                    label: const Text('Register Agent'),
                  ),
                ],
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: () => ref.read(agentsProvider.notifier).refresh(),
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: agents.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, index) =>
                  _AgentCard(agent: agents[index]),
            ),
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, color: WebmuxTheme.statusFailed),
              const SizedBox(height: 8),
              Text(
                'Failed to load agents',
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
              const SizedBox(height: 4),
              Text(
                error.toString(),
                style: const TextStyle(
                  color: WebmuxTheme.subtext,
                  fontSize: 12,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              OutlinedButton(
                onPressed: () =>
                    ref.read(agentsProvider.notifier).refresh(),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      ),
      floatingActionButton: agentsAsync.maybeWhen(
        data: (agents) => agents.isNotEmpty
            ? FloatingActionButton(
                onPressed: () => _showRegisterSheet(context),
                child: const Icon(Icons.add_rounded),
              )
            : null,
        orElse: () => null,
      ),
    );
  }

  Future<void> _showRegisterSheet(BuildContext context) async {
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _RegisterAgentSheet(),
    );
  }
}

// ---------------------------------------------------------------------------
// Agent card
// ---------------------------------------------------------------------------

class _AgentCard extends ConsumerWidget {
  const _AgentCard({required this.agent});

  final AgentInfo agent;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isOnline = agent.status == 'online';
    final lastSeen = agent.lastSeenAt != null
        ? timeago.format(
            DateTime.fromMillisecondsSinceEpoch(
                (agent.lastSeenAt! * 1000).toInt()),
          )
        : 'Never';

    return Card(
      child: ListTile(
        leading: Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(
            color: isOnline
                ? WebmuxTheme.statusSuccess
                : WebmuxTheme.subtext,
            shape: BoxShape.circle,
          ),
        ),
        title: Text(
          agent.name,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          isOnline ? 'Online' : 'Last seen $lastSeen',
          style: const TextStyle(fontSize: 12, color: WebmuxTheme.subtext),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              icon: const Icon(Icons.edit_rounded, size: 20),
              tooltip: 'Rename',
              onPressed: () => _showRenameDialog(context, ref),
            ),
            IconButton(
              icon: const Icon(
                Icons.delete_outline_rounded,
                size: 20,
                color: WebmuxTheme.statusFailed,
              ),
              tooltip: 'Delete',
              onPressed: () => _confirmDelete(context, ref),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _showRenameDialog(BuildContext context, WidgetRef ref) async {
    final controller = TextEditingController(text: agent.name);
    final newName = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Rename Agent'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Agent name',
          ),
          onSubmitted: (value) => Navigator.pop(ctx, value.trim()),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Rename'),
          ),
        ],
      ),
    );

    if (newName != null && newName.isNotEmpty && newName != agent.name) {
      await ref.read(agentsProvider.notifier).renameAgent(agent.id, newName);
    }
  }

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Agent'),
        content: Text('Delete "${agent.name}"? This cannot be undone.'),
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
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      await ref.read(agentsProvider.notifier).deleteAgent(agent.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Register agent bottom sheet
// ---------------------------------------------------------------------------

class _RegisterAgentSheet extends ConsumerStatefulWidget {
  const _RegisterAgentSheet();

  @override
  ConsumerState<_RegisterAgentSheet> createState() =>
      _RegisterAgentSheetState();
}

class _RegisterAgentSheetState extends ConsumerState<_RegisterAgentSheet> {
  final _nameController = TextEditingController();
  bool _loading = false;
  Map<String, dynamic>? _tokenData;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _generateToken() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final name = _nameController.text.trim();
      final data = await ref
          .read(agentsProvider.notifier)
          .createRegistrationToken(name: name.isEmpty ? null : name);
      setState(() {
        _tokenData = data;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);
    final serverUrl = authState.baseUrl ?? '';

    return Padding(
      padding: EdgeInsets.fromLTRB(
        24,
        24,
        24,
        24 + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Register Agent',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 16),

          if (_tokenData == null) ...[
            TextField(
              controller: _nameController,
              decoration: const InputDecoration(
                labelText: 'Agent name (optional)',
                hintText: 'e.g. my-dev-machine',
              ),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _loading ? null : _generateToken,
              child: _loading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Generate Registration Token'),
            ),
          ] else ...[
            Text(
              'Run this command on the machine you want to register:',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: WebmuxTheme.border,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: SelectableText(
                      'webmux agent register --server $serverUrl --token ${_tokenData!['token']}',
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 12,
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.copy_rounded, size: 18),
                    tooltip: 'Copy',
                    onPressed: () {
                      Clipboard.setData(ClipboardData(
                        text:
                            'webmux agent register --server $serverUrl --token ${_tokenData!['token']}',
                      ));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Copied to clipboard'),
                          duration: Duration(seconds: 2),
                        ),
                      );
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'This token expires in 10 minutes.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: WebmuxTheme.statusWarning,
                  ),
            ),
          ],

          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(
              _error!,
              style: const TextStyle(
                color: WebmuxTheme.statusFailed,
                fontSize: 13,
              ),
            ),
          ],

          const SizedBox(height: 8),
        ],
      ),
    );
  }
}
