import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../models/models.dart';
import '../../providers/providers.dart';
import '../../services/api_client.dart';

class LlmConfigScreen extends ConsumerStatefulWidget {
  const LlmConfigScreen({super.key});

  @override
  ConsumerState<LlmConfigScreen> createState() => _LlmConfigScreenState();
}

class _LlmConfigScreenState extends ConsumerState<LlmConfigScreen> {
  List<LlmConfig> _configs = [];
  List<Project> _projects = [];
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
      final api = ref.read(apiClientProvider);
      final results = await Future.wait([
        api.listLlmConfigs(),
        api.listProjects(),
      ]);
      if (mounted) {
        setState(() {
          _configs = results[0] as List<LlmConfig>;
          _projects = results[1] as List<Project>;
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

  String? _projectName(String? projectId) {
    if (projectId == null) return null;
    final project = _projects.where((p) => p.id == projectId).firstOrNull;
    return project?.name;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('LLM Configuration')),
      body: _buildBody(context),
      floatingActionButton: !_loading && _configs.isNotEmpty
          ? FloatingActionButton(
              onPressed: () => _showConfigDialog(context, null),
              child: const Icon(Icons.add_rounded),
            )
          : null,
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: WebmuxTheme.statusFailed),
            const SizedBox(height: 8),
            Text(_error!),
            const SizedBox(height: 16),
            OutlinedButton(onPressed: _load, child: const Text('Retry')),
          ],
        ),
      );
    }

    if (_configs.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.smart_toy_rounded,
              size: 48,
              color: WebmuxTheme.subtext,
            ),
            const SizedBox(height: 16),
            const Text(
              'No LLM configurations',
              style: TextStyle(color: WebmuxTheme.subtext),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: () => _showConfigDialog(context, null),
              icon: const Icon(Icons.add_rounded),
              label: const Text('Add Configuration'),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: _configs.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (context, index) {
          final config = _configs[index];
          return _ConfigCard(
            config: config,
            projectName: _projectName(config.projectId),
            onEdit: () => _showConfigDialog(context, config),
            onDelete: () => _confirmDelete(context, config),
          );
        },
      ),
    );
  }

  Future<void> _showConfigDialog(
      BuildContext context, LlmConfig? existing) async {
    final apiBaseUrlController =
        TextEditingController(text: existing?.apiBaseUrl ?? '');
    final apiKeyController =
        TextEditingController(text: existing?.apiKey ?? '');
    final modelController =
        TextEditingController(text: existing?.model ?? '');
    String? selectedProjectId = existing?.projectId;
    final formKey = GlobalKey<FormState>();

    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: Text(
              existing != null ? 'Edit Configuration' : 'Add Configuration'),
          content: Form(
            key: formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextFormField(
                    controller: apiBaseUrlController,
                    decoration:
                        const InputDecoration(labelText: 'API Base URL'),
                    validator: (v) =>
                        (v == null || v.trim().isEmpty) ? 'Required' : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: apiKeyController,
                    decoration:
                        const InputDecoration(labelText: 'API Key'),
                    obscureText: true,
                    validator: (v) {
                      if (existing == null &&
                          (v == null || v.trim().isEmpty)) {
                        return 'Required';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: modelController,
                    decoration:
                        const InputDecoration(labelText: 'Model name'),
                    validator: (v) =>
                        (v == null || v.trim().isEmpty) ? 'Required' : null,
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String?>(
                    value: selectedProjectId,
                    decoration: const InputDecoration(
                      labelText: 'Project (optional)',
                    ),
                    items: [
                      const DropdownMenuItem(
                        value: null,
                        child: Text('Global (all projects)'),
                      ),
                      ..._projects.map((p) => DropdownMenuItem(
                            value: p.id,
                            child: Text(p.name),
                          )),
                    ],
                    onChanged: (v) =>
                        setDialogState(() => selectedProjectId = v),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                if (formKey.currentState!.validate()) {
                  Navigator.pop(ctx, true);
                }
              },
              child: Text(existing != null ? 'Save' : 'Add'),
            ),
          ],
        ),
      ),
    );

    if (result == true) {
      try {
        final api = ref.read(apiClientProvider);
        if (existing != null) {
          await api.updateLlmConfig(
            existing.id,
            UpdateLlmConfigRequest(
              apiBaseUrl: apiBaseUrlController.text.trim(),
              apiKey: apiKeyController.text.trim().isEmpty
                  ? null
                  : apiKeyController.text.trim(),
              model: modelController.text.trim(),
            ),
          );
        } else {
          await api.createLlmConfig(
            CreateLlmConfigRequest(
              apiBaseUrl: apiBaseUrlController.text.trim(),
              apiKey: apiKeyController.text.trim(),
              model: modelController.text.trim(),
              projectId: selectedProjectId,
            ),
          );
        }
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

  Future<void> _confirmDelete(
      BuildContext context, LlmConfig config) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Configuration'),
        content: Text(
            'Delete the "${config.model}" configuration? This cannot be undone.'),
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
      try {
        await ref.read(apiClientProvider).deleteLlmConfig(config.id);
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
}

// ---------------------------------------------------------------------------
// Config card
// ---------------------------------------------------------------------------

class _ConfigCard extends StatelessWidget {
  const _ConfigCard({
    required this.config,
    required this.projectName,
    required this.onEdit,
    required this.onDelete,
  });

  final LlmConfig config;
  final String? projectName;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    config.model,
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 15,
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.edit_rounded, size: 20),
                  tooltip: 'Edit',
                  onPressed: onEdit,
                ),
                IconButton(
                  icon: const Icon(
                    Icons.delete_outline_rounded,
                    size: 20,
                    color: WebmuxTheme.statusFailed,
                  ),
                  tooltip: 'Delete',
                  onPressed: onDelete,
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              config.apiBaseUrl,
              style: const TextStyle(
                color: WebmuxTheme.subtext,
                fontSize: 12,
                fontFamily: 'monospace',
              ),
            ),
            if (projectName != null) ...[
              const SizedBox(height: 4),
              Row(
                children: [
                  const Icon(Icons.folder_rounded,
                      size: 12, color: WebmuxTheme.subtext),
                  const SizedBox(width: 4),
                  Text(
                    projectName!,
                    style: const TextStyle(
                      color: WebmuxTheme.subtext,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ] else ...[
              const SizedBox(height: 4),
              const Text(
                'Global',
                style: TextStyle(
                  color: WebmuxTheme.subtext,
                  fontSize: 12,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
