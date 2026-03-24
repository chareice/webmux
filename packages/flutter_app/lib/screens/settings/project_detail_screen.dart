import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../../app/theme.dart';
import '../../models/models.dart';
import '../../providers/providers.dart';
import '../../services/api_client.dart';
import '../../widgets/status_indicator.dart';

class ProjectDetailScreen extends ConsumerStatefulWidget {
  const ProjectDetailScreen({super.key, required this.projectId});

  final String projectId;

  @override
  ConsumerState<ProjectDetailScreen> createState() =>
      _ProjectDetailScreenState();
}

class _ProjectDetailScreenState extends ConsumerState<ProjectDetailScreen> {
  ProjectDetailResponse? _detail;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final detail =
          await ref.read(apiClientProvider).getProjectDetail(widget.projectId);
      if (mounted) {
        setState(() {
          _detail = detail;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Scaffold(
        appBar: AppBar(title: const Text('Project')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    if (_error != null || _detail == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Project')),
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, color: WebmuxTheme.statusFailed),
              const SizedBox(height: 8),
              Text(_error ?? 'Failed to load project'),
              const SizedBox(height: 16),
              OutlinedButton(onPressed: _load, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }

    final project = _detail!.project;
    final tasks = _detail!.tasks;
    final actions = _detail!.actions;

    return Scaffold(
      appBar: AppBar(
        title: Text(project.name),
        actions: [
          IconButton(
            icon: const Icon(Icons.edit_rounded),
            tooltip: 'Edit',
            onPressed: () => _showEditDialog(context, project),
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline_rounded,
                color: WebmuxTheme.statusFailed),
            tooltip: 'Delete',
            onPressed: () => _confirmDelete(context, project),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // --- Project header ---
            _ProjectHeader(project: project),
            const SizedBox(height: 24),

            // --- Tasks section ---
            _SectionTitle(
              title: 'Tasks',
              trailing: FilledButton.tonalIcon(
                onPressed: () => _showCreateTaskDialog(context),
                icon: const Icon(Icons.add_rounded, size: 18),
                label: const Text('Create Task'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size(0, 36),
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                ),
              ),
            ),
            const SizedBox(height: 8),
            if (tasks.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: Text(
                  'No tasks yet',
                  style: TextStyle(color: WebmuxTheme.subtext),
                  textAlign: TextAlign.center,
                ),
              )
            else
              ...tasks.map((task) => _TaskCard(
                    task: task,
                    onTap: () => context.push(
                        '/settings/projects/${project.id}/tasks/${task.id}'),
                  )),

            const SizedBox(height: 24),

            // --- Actions section ---
            _SectionTitle(
              title: 'Actions',
              trailing: FilledButton.tonalIcon(
                onPressed: () => _showCreateActionDialog(context),
                icon: const Icon(Icons.add_rounded, size: 18),
                label: const Text('Add Action'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size(0, 36),
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                ),
              ),
            ),
            const SizedBox(height: 8),
            if (actions.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: Text(
                  'No actions yet',
                  style: TextStyle(color: WebmuxTheme.subtext),
                  textAlign: TextAlign.center,
                ),
              )
            else
              ...actions.map((action) => _ActionCard(
                    action: action,
                    projectId: project.id,
                    onRun: () => _runAction(context, action),
                    onRefresh: _load,
                  )),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Dialogs
  // ---------------------------------------------------------------------------

  Future<void> _showEditDialog(BuildContext context, Project project) async {
    final nameController = TextEditingController(text: project.name);
    final descController = TextEditingController(text: project.description);
    String selectedTool = project.defaultTool;

    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Edit Project'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: nameController,
                  decoration: const InputDecoration(labelText: 'Name'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: descController,
                  decoration:
                      const InputDecoration(labelText: 'Description'),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    const Text('Default tool: '),
                    const SizedBox(width: 8),
                    ChoiceChip(
                      label: const Text('Claude'),
                      selected: selectedTool == 'claude',
                      onSelected: (_) =>
                          setDialogState(() => selectedTool = 'claude'),
                    ),
                    const SizedBox(width: 8),
                    ChoiceChip(
                      label: const Text('Codex'),
                      selected: selectedTool == 'codex',
                      onSelected: (_) =>
                          setDialogState(() => selectedTool = 'codex'),
                    ),
                  ],
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );

    if (result == true) {
      try {
        await ref.read(apiClientProvider).updateProject(
              project.id,
              UpdateProjectRequest(
                name: nameController.text.trim(),
                description: descController.text.trim(),
                defaultTool: selectedTool,
              ),
            );
        await _load();
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Error: $e')),
          );
        }
      }
    }
  }

  Future<void> _confirmDelete(BuildContext context, Project project) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Project'),
        content: Text('Delete "${project.name}"? This cannot be undone.'),
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

    if (confirmed == true && mounted) {
      try {
        await ref.read(projectsProvider.notifier).deleteProject(project.id);
        if (mounted) context.pop();
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Error: $e')),
          );
        }
      }
    }
  }

  Future<void> _showCreateTaskDialog(BuildContext context) async {
    final titleController = TextEditingController();
    final promptController = TextEditingController();
    String tool = _detail!.project.defaultTool;

    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Create Task'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: titleController,
                  decoration: const InputDecoration(labelText: 'Title'),
                  autofocus: true,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: promptController,
                  decoration:
                      const InputDecoration(labelText: 'Prompt (optional)'),
                  maxLines: 3,
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    const Text('Tool: '),
                    const SizedBox(width: 8),
                    ChoiceChip(
                      label: const Text('Claude'),
                      selected: tool == 'claude',
                      onSelected: (_) =>
                          setDialogState(() => tool = 'claude'),
                    ),
                    const SizedBox(width: 8),
                    ChoiceChip(
                      label: const Text('Codex'),
                      selected: tool == 'codex',
                      onSelected: (_) =>
                          setDialogState(() => tool = 'codex'),
                    ),
                  ],
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Create'),
            ),
          ],
        ),
      ),
    );

    if (result == true && titleController.text.trim().isNotEmpty) {
      try {
        await ref.read(apiClientProvider).createTask(
              widget.projectId,
              CreateTaskRequest(
                title: titleController.text.trim(),
                prompt: promptController.text.trim().isEmpty
                    ? null
                    : promptController.text.trim(),
                tool: tool,
              ),
            );
        await _load();
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Error: $e')),
          );
        }
      }
    }
  }

  Future<void> _showCreateActionDialog(BuildContext context) async {
    final nameController = TextEditingController();
    final descController = TextEditingController();
    final promptController = TextEditingController();
    String tool = _detail!.project.defaultTool;

    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Add Action'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: nameController,
                  decoration: const InputDecoration(labelText: 'Name'),
                  autofocus: true,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: descController,
                  decoration:
                      const InputDecoration(labelText: 'Description (optional)'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: promptController,
                  decoration: const InputDecoration(labelText: 'Prompt'),
                  maxLines: 3,
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    const Text('Tool: '),
                    const SizedBox(width: 8),
                    ChoiceChip(
                      label: const Text('Claude'),
                      selected: tool == 'claude',
                      onSelected: (_) =>
                          setDialogState(() => tool = 'claude'),
                    ),
                    const SizedBox(width: 8),
                    ChoiceChip(
                      label: const Text('Codex'),
                      selected: tool == 'codex',
                      onSelected: (_) =>
                          setDialogState(() => tool = 'codex'),
                    ),
                  ],
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Add'),
            ),
          ],
        ),
      ),
    );

    if (result == true &&
        nameController.text.trim().isNotEmpty &&
        promptController.text.trim().isNotEmpty) {
      try {
        await ref.read(apiClientProvider).createAction(
              widget.projectId,
              CreateProjectActionRequest(
                name: nameController.text.trim(),
                description: descController.text.trim().isEmpty
                    ? null
                    : descController.text.trim(),
                prompt: promptController.text.trim(),
                tool: tool,
              ),
            );
        await _load();
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Error: $e')),
          );
        }
      }
    }
  }

  Future<void> _runAction(
      BuildContext context, ProjectAction action) async {
    try {
      await ref.read(apiClientProvider).runAction(widget.projectId, action.id);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Action "${action.name}" started')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Sub-widgets
// ---------------------------------------------------------------------------

class _ProjectHeader extends StatelessWidget {
  const _ProjectHeader({required this.project});

  final Project project;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              project.name,
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            if (project.description.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                project.description,
                style: const TextStyle(color: WebmuxTheme.subtext),
              ),
            ],
            const SizedBox(height: 12),
            _InfoRow(icon: Icons.folder_rounded, text: project.repoPath),
            const SizedBox(height: 4),
            _InfoRow(
              icon: Icons.computer_rounded,
              text: 'Agent: ${project.agentId}',
            ),
            const SizedBox(height: 4),
            _InfoRow(
              icon: Icons.smart_toy_rounded,
              text: 'Default tool: ${project.defaultTool}',
            ),
          ],
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 14, color: WebmuxTheme.subtext),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            text,
            style: const TextStyle(
              color: WebmuxTheme.subtext,
              fontSize: 12,
              fontFamily: 'monospace',
            ),
          ),
        ),
      ],
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, this.trailing});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          title,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
        ),
        const Spacer(),
        if (trailing != null) trailing!,
      ],
    );
  }
}

class _TaskCard extends StatelessWidget {
  const _TaskCard({required this.task, required this.onTap});

  final Task task;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final createdAt = DateTime.fromMillisecondsSinceEpoch(
        task.createdAt.toInt());

    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              StatusIndicator(status: task.status, size: 10),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      task.title,
                      style: const TextStyle(fontWeight: FontWeight.w500),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      timeago.format(createdAt),
                      style: const TextStyle(
                        fontSize: 11,
                        color: WebmuxTheme.subtext,
                      ),
                    ),
                  ],
                ),
              ),
              _StatusChip(status: task.status),
              if (task.priority > 0) ...[
                const SizedBox(width: 8),
                Text(
                  'P${task.priority}',
                  style: const TextStyle(
                    fontSize: 11,
                    color: WebmuxTheme.statusWarning,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final color = StatusIndicator.colorForStatus(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        status,
        style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w600),
      ),
    );
  }
}

class _ActionCard extends StatelessWidget {
  const _ActionCard({
    required this.action,
    required this.projectId,
    required this.onRun,
    required this.onRefresh,
  });

  final ProjectAction action;
  final String projectId;
  final VoidCallback onRun;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    action.name,
                    style: const TextStyle(fontWeight: FontWeight.w500),
                  ),
                  if (action.description.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      action.description,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        color: WebmuxTheme.subtext,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            FilledButton.tonalIcon(
              onPressed: onRun,
              icon: const Icon(Icons.play_arrow_rounded, size: 18),
              label: const Text('Run'),
              style: FilledButton.styleFrom(
                minimumSize: const Size(0, 32),
                padding: const EdgeInsets.symmetric(horizontal: 12),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
