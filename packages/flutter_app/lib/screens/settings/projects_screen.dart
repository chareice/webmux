import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../models/models.dart';
import '../../providers/providers.dart';
import '../../services/api_client.dart';

class ProjectsScreen extends ConsumerStatefulWidget {
  const ProjectsScreen({super.key});

  @override
  ConsumerState<ProjectsScreen> createState() => _ProjectsScreenState();
}

class _ProjectsScreenState extends ConsumerState<ProjectsScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(projectsProvider.notifier).refresh();
      ref.read(agentsProvider.notifier).refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    final projectsAsync = ref.watch(projectsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Projects')),
      body: projectsAsync.when(
        data: (projects) {
          if (projects.isEmpty) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.folder_rounded,
                    size: 48,
                    color: WebmuxTheme.subtext,
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'No projects yet',
                    style: TextStyle(color: WebmuxTheme.subtext),
                  ),
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    onPressed: () => _showCreateDialog(context),
                    icon: const Icon(Icons.add_rounded),
                    label: const Text('Create Project'),
                  ),
                ],
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: () => ref.read(projectsProvider.notifier).refresh(),
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: projects.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, index) {
                final project = projects[index];
                return _ProjectCard(
                  project: project,
                  onTap: () => context
                      .push('/settings/projects/${project.id}'),
                );
              },
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
                'Failed to load projects',
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
              const SizedBox(height: 16),
              OutlinedButton(
                onPressed: () =>
                    ref.read(projectsProvider.notifier).refresh(),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      ),
      floatingActionButton: projectsAsync.maybeWhen(
        data: (projects) => projects.isNotEmpty
            ? FloatingActionButton(
                onPressed: () => _showCreateDialog(context),
                child: const Icon(Icons.add_rounded),
              )
            : null,
        orElse: () => null,
      ),
    );
  }

  Future<void> _showCreateDialog(BuildContext context) async {
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _CreateProjectSheet(),
    );
  }
}

// ---------------------------------------------------------------------------
// Project card
// ---------------------------------------------------------------------------

class _ProjectCard extends StatelessWidget {
  const _ProjectCard({required this.project, required this.onTap});

  final Project project;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      project.name,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 15,
                      ),
                    ),
                  ),
                  _ToolChip(tool: project.defaultTool),
                ],
              ),
              if (project.description.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  project.description,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: WebmuxTheme.subtext,
                    fontSize: 13,
                  ),
                ),
              ],
              const SizedBox(height: 6),
              Text(
                project.repoPath,
                style: const TextStyle(
                  color: WebmuxTheme.subtext,
                  fontSize: 12,
                  fontFamily: 'monospace',
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ToolChip extends StatelessWidget {
  const _ToolChip({required this.tool});

  final String tool;

  @override
  Widget build(BuildContext context) {
    final isClaude = tool.toLowerCase() == 'claude';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: isClaude
            ? WebmuxTheme.statusRunning.withOpacity(0.15)
            : WebmuxTheme.orange.withOpacity(0.15),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        tool.substring(0, 1).toUpperCase() + tool.substring(1),
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: isClaude ? WebmuxTheme.statusRunning : WebmuxTheme.orange,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Create project bottom sheet
// ---------------------------------------------------------------------------

class _CreateProjectSheet extends ConsumerStatefulWidget {
  const _CreateProjectSheet();

  @override
  ConsumerState<_CreateProjectSheet> createState() =>
      _CreateProjectSheetState();
}

class _CreateProjectSheetState extends ConsumerState<_CreateProjectSheet> {
  final _nameController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _repoPathController = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  String? _selectedAgentId;
  String _selectedTool = 'claude';
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _repoPathController.dispose();
    super.dispose();
  }

  Future<void> _createProject() async {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedAgentId == null) {
      setState(() => _error = 'Please select an agent');
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      await ref.read(projectsProvider.notifier).createProject(
            CreateProjectRequest(
              name: _nameController.text.trim(),
              description: _descriptionController.text.trim().isEmpty
                  ? null
                  : _descriptionController.text.trim(),
              repoPath: _repoPathController.text.trim(),
              agentId: _selectedAgentId!,
              defaultTool: _selectedTool,
            ),
          );
      if (mounted) Navigator.pop(context);
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
    final agentsAsync = ref.watch(agentsProvider);

    return Padding(
      padding: EdgeInsets.fromLTRB(
        24,
        24,
        24,
        24 + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Create Project',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 16),

              TextFormField(
                controller: _nameController,
                decoration: const InputDecoration(labelText: 'Name'),
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              const SizedBox(height: 12),

              TextFormField(
                controller: _descriptionController,
                decoration:
                    const InputDecoration(labelText: 'Description (optional)'),
              ),
              const SizedBox(height: 12),

              TextFormField(
                controller: _repoPathController,
                decoration: const InputDecoration(
                  labelText: 'Repository path',
                  hintText: '/path/to/repo',
                ),
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              const SizedBox(height: 12),

              // Agent selector
              agentsAsync.when(
                data: (agents) => DropdownButtonFormField<String>(
                  value: _selectedAgentId,
                  decoration: const InputDecoration(labelText: 'Agent'),
                  items: agents
                      .map((a) => DropdownMenuItem(
                            value: a.id,
                            child: Text(a.name),
                          ))
                      .toList(),
                  onChanged: (v) => setState(() => _selectedAgentId = v),
                  validator: (v) => v == null ? 'Required' : null,
                ),
                loading: () => const InputDecorator(
                  decoration: InputDecoration(labelText: 'Agent'),
                  child: Text('Loading agents...',
                      style: TextStyle(color: WebmuxTheme.subtext)),
                ),
                error: (_, __) => const InputDecorator(
                  decoration: InputDecoration(labelText: 'Agent'),
                  child: Text('Failed to load agents',
                      style: TextStyle(color: WebmuxTheme.statusFailed)),
                ),
              ),
              const SizedBox(height: 12),

              // Tool selector
              Row(
                children: [
                  const Text('Default tool: '),
                  const SizedBox(width: 12),
                  ChoiceChip(
                    label: const Text('Claude'),
                    selected: _selectedTool == 'claude',
                    onSelected: (_) =>
                        setState(() => _selectedTool = 'claude'),
                  ),
                  const SizedBox(width: 8),
                  ChoiceChip(
                    label: const Text('Codex'),
                    selected: _selectedTool == 'codex',
                    onSelected: (_) =>
                        setState(() => _selectedTool = 'codex'),
                  ),
                ],
              ),
              const SizedBox(height: 16),

              FilledButton(
                onPressed: _loading ? null : _createProject,
                child: _loading
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Create'),
              ),

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
        ),
      ),
    );
  }
}
