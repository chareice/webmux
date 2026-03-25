import 'package:flutter/material.dart';

import '../app/pixel_theme.dart';
import '../models/agent.dart';
import '../models/project.dart';
import '../models/run.dart';
import '../services/api_client.dart';

/// Reusable bottom sheet for creating a new thread.
///
/// Styled as a pixel-art game configuration menu with warm cream background,
/// wood-colored borders, and game-style buttons.
///
/// Usage:
/// ```dart
/// showModalBottomSheet(
///   context: context,
///   isScrollControlled: true,
///   backgroundColor: Colors.transparent,
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

  /// Pixel-styled input decoration with wood borders and warm fill.
  InputDecoration _pixelInputDecoration({
    required String labelText,
    String? hintText,
    bool alignLabelWithHint = false,
  }) {
    return InputDecoration(
      labelText: labelText,
      hintText: hintText,
      alignLabelWithHint: alignLabelWithHint,
      isDense: true,
      labelStyle: const TextStyle(color: PixelTheme.furniture),
      hintStyle: TextStyle(color: PixelTheme.furniture.withOpacity(0.5)),
      filled: true,
      fillColor: PixelTheme.floorLight,
      border: const OutlineInputBorder(
        borderRadius: PixelTheme.sharpCorners,
        borderSide: BorderSide(
          color: PixelTheme.furniture,
          width: PixelTheme.borderWidth,
        ),
      ),
      enabledBorder: const OutlineInputBorder(
        borderRadius: PixelTheme.sharpCorners,
        borderSide: BorderSide(
          color: PixelTheme.furniture,
          width: PixelTheme.borderWidth,
        ),
      ),
      focusedBorder: const OutlineInputBorder(
        borderRadius: PixelTheme.sharpCorners,
        borderSide: BorderSide(
          color: PixelTheme.furnitureDark,
          width: PixelTheme.borderWidth,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: PixelTheme.wall,
        border: Border(
          top: BorderSide(color: PixelTheme.furniture, width: PixelTheme.borderWidth),
          left: BorderSide(color: PixelTheme.furniture, width: PixelTheme.borderWidth),
          right: BorderSide(color: PixelTheme.furniture, width: PixelTheme.borderWidth),
        ),
      ),
      child: Padding(
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
            const Text(
              'New Session',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: PixelTheme.furnitureDark,
              ),
            ),
            const SizedBox(height: 16),

            if (_loading)
              const Center(child: Padding(
                padding: EdgeInsets.all(24),
                child: SizedBox(
                  width: 16, height: 16,
                  child: Text('...', style: TextStyle(fontSize: 14, color: PixelTheme.furnitureDark)),
                ),
              ))
            else if (_agents.isEmpty)
              const Text(
                'No agents available. Register an agent first.',
                style: TextStyle(color: PixelTheme.furnitureDark),
              )
            else ...[
              // Agent selector
              Theme(
                data: Theme.of(context).copyWith(
                  canvasColor: PixelTheme.floorLight,
                ),
                child: DropdownButtonFormField<AgentInfo>(
                  value: _selectedAgent,
                  decoration: _pixelInputDecoration(labelText: 'Agent'),
                  style: const TextStyle(color: PixelTheme.furnitureDark, fontSize: 14),
                  dropdownColor: PixelTheme.floorLight,
                  items: _agents.map((a) => DropdownMenuItem(
                    value: a,
                    child: Row(
                      children: [
                        Container(
                          width: 8, height: 8,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: a.status == 'online'
                                ? PixelTheme.statusSuccess
                                : PixelTheme.furniture,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(a.name, style: const TextStyle(color: PixelTheme.furnitureDark)),
                      ],
                    ),
                  )).toList(),
                  onChanged: (v) => setState(() => _selectedAgent = v),
                ),
              ),
              const SizedBox(height: 12),

              // Repo path — quick select from recent paths
              if (_recentPaths.isNotEmpty) ...[
                const Text(
                  'Repository',
                  style: TextStyle(
                    color: PixelTheme.furniture,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: _recentPaths.map((path) {
                    final isSelected = _repoPathController.text == path;
                    final label = path.split('/').last;
                    return GestureDetector(
                      onTap: () {
                        setState(() => _repoPathController.text = path);
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: isSelected ? PixelTheme.spriteBody : PixelTheme.floorLight,
                          border: Border.all(
                            color: isSelected ? PixelTheme.spriteBody : PixelTheme.furniture,
                            width: PixelTheme.borderWidth,
                          ),
                          borderRadius: PixelTheme.sharpCorners,
                        ),
                        child: Text(
                          label,
                          style: TextStyle(
                            fontSize: 12,
                            color: isSelected ? Colors.white : PixelTheme.furnitureDark,
                          ),
                        ),
                      ),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 8),
              ],
              // Manual repo path input
              TextField(
                controller: _repoPathController,
                style: const TextStyle(color: PixelTheme.furnitureDark),
                decoration: _pixelInputDecoration(
                  labelText: _recentPaths.isNotEmpty ? 'Or enter path' : 'Repository Path',
                  hintText: '/home/user/projects/my-project',
                ),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 12),

              // Tool selector
              Row(
                children: [
                  const Text(
                    'Tool:',
                    style: TextStyle(
                      color: PixelTheme.furniture,
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(width: 12),
                  _buildToolChip('Claude', 'claude'),
                  const SizedBox(width: 8),
                  _buildToolChip('Codex', 'codex'),
                ],
              ),
              const SizedBox(height: 12),

              // Prompt
              TextField(
                controller: _promptController,
                maxLines: 4,
                minLines: 2,
                style: const TextStyle(color: PixelTheme.furnitureDark),
                decoration: _pixelInputDecoration(
                  labelText: 'Message',
                  hintText: 'What should the agent do?',
                  alignLabelWithHint: true,
                ),
              ),
              const SizedBox(height: 12),

              if (_error != null) ...[
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: PixelTheme.statusFailed.withOpacity(0.1),
                    border: Border.all(
                      color: PixelTheme.statusFailed,
                      width: PixelTheme.borderWidth,
                    ),
                    borderRadius: PixelTheme.sharpCorners,
                  ),
                  child: Text(
                    _error!,
                    style: const TextStyle(color: PixelTheme.statusFailed, fontSize: 12),
                  ),
                ),
                const SizedBox(height: 8),
              ],

              // Send button — game-style blue with shadow
              GestureDetector(
                onTap: _sending ||
                        _promptController.text.trim().isEmpty ||
                        _repoPathController.text.trim().isEmpty ||
                        _selectedAgent == null
                    ? null
                    : _create,
                child: Container(
                  height: 44,
                  decoration: BoxDecoration(
                    color: _sending ||
                            _promptController.text.trim().isEmpty ||
                            _repoPathController.text.trim().isEmpty ||
                            _selectedAgent == null
                        ? PixelTheme.furniture.withOpacity(0.5)
                        : const Color(0xFF4A90D9),
                    border: Border.all(
                      color: _sending ||
                              _promptController.text.trim().isEmpty ||
                              _repoPathController.text.trim().isEmpty ||
                              _selectedAgent == null
                          ? PixelTheme.furniture
                          : const Color(0xFF6AB0FF),
                      width: 2,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: _sending ||
                                _promptController.text.trim().isEmpty ||
                                _repoPathController.text.trim().isEmpty ||
                                _selectedAgent == null
                            ? Colors.transparent
                            : const Color(0xFF2A5090),
                        offset: const Offset(0, 2),
                      ),
                    ],
                    borderRadius: PixelTheme.sharpCorners,
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      if (_sending)
                        const Text(
                          '...',
                          style: TextStyle(fontSize: 14, color: Colors.white),
                        )
                      else
                        const Icon(Icons.send_rounded, size: 18, color: Colors.white),
                      const SizedBox(width: 8),
                      const Text(
                        'Start Session',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// Builds a pixel-styled tool selection chip.
  Widget _buildToolChip(String label, String value) {
    final isSelected = _tool == value;
    return GestureDetector(
      onTap: () => setState(() => _tool = value),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected ? PixelTheme.spriteBody : PixelTheme.floorLight,
          border: Border.all(
            color: isSelected ? PixelTheme.spriteBody : PixelTheme.furniture,
            width: PixelTheme.borderWidth,
          ),
          borderRadius: PixelTheme.sharpCorners,
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            color: isSelected ? Colors.white : PixelTheme.furnitureDark,
            fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ),
    );
  }
}
