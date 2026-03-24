import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../../app/theme.dart';
import '../../models/models.dart';
import '../../providers/providers.dart';
import '../../services/websocket_service.dart';
import '../../widgets/status_indicator.dart';

class TaskDetailScreen extends ConsumerStatefulWidget {
  const TaskDetailScreen({
    super.key,
    required this.projectId,
    required this.taskId,
  });

  final String projectId;
  final String taskId;

  @override
  ConsumerState<TaskDetailScreen> createState() => _TaskDetailScreenState();
}

class _TaskDetailScreenState extends ConsumerState<TaskDetailScreen> {
  Task? _task;
  List<TaskStep> _steps = [];
  List<TaskMessage> _messages = [];
  bool _loading = true;
  String? _error;
  final _messageController = TextEditingController();
  bool _sending = false;
  StreamSubscription<RunEvent>? _wsSubscription;

  @override
  void initState() {
    super.initState();
    _load();
    _connectWebSocket();
  }

  @override
  void dispose() {
    _messageController.dispose();
    _wsSubscription?.cancel();
    super.dispose();
  }

  void _connectWebSocket() {
    final wsService = ref.read(webSocketServiceProvider);
    final stream = wsService.connectProject(widget.projectId);
    _wsSubscription = stream.listen((event) {
      if (!mounted) return;

      switch (event.type) {
        case 'task-status':
          if (event.task != null && event.task!.id == widget.taskId) {
            setState(() => _task = event.task);
          }
          break;
        case 'task-step':
          if (event.taskId == widget.taskId && event.step != null) {
            setState(() {
              final idx = _steps.indexWhere((s) => s.id == event.step!.id);
              if (idx >= 0) {
                _steps[idx] = event.step!;
              } else {
                _steps.add(event.step!);
              }
            });
          }
          break;
        case 'task-message':
          if (event.taskId == widget.taskId && event.message != null) {
            setState(() {
              if (!_messages.any((m) => m.id == event.message!.id)) {
                _messages.add(event.message!);
              }
            });
          }
          break;
      }
    });
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final api = ref.read(apiClientProvider);

      // Load project detail to get the task
      final detail = await api.getProjectDetail(widget.projectId);
      final task = detail.tasks.where((t) => t.id == widget.taskId).firstOrNull;

      if (task == null) {
        setState(() {
          _error = 'Task not found';
          _loading = false;
        });
        return;
      }

      // Load steps and messages in parallel
      final results = await Future.wait([
        api.getTaskSteps(widget.projectId, widget.taskId),
        api.getTaskMessages(widget.projectId, widget.taskId),
      ]);

      if (mounted) {
        setState(() {
          _task = task;
          _steps = results[0] as List<TaskStep>;
          _messages = results[1] as List<TaskMessage>;
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

  Future<void> _sendMessage() async {
    final content = _messageController.text.trim();
    if (content.isEmpty) return;

    setState(() => _sending = true);
    try {
      final message = await ref
          .read(apiClientProvider)
          .sendTaskMessage(widget.projectId, widget.taskId, content);
      _messageController.clear();
      setState(() {
        if (!_messages.any((m) => m.id == message.id)) {
          _messages.add(message);
        }
        _sending = false;
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
        setState(() => _sending = false);
      }
    }
  }

  Future<void> _retryTask() async {
    try {
      await ref
          .read(apiClientProvider)
          .retryTask(widget.projectId, widget.taskId);
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }

  Future<void> _completeTask() async {
    try {
      await ref
          .read(apiClientProvider)
          .completeTask(widget.projectId, widget.taskId);
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }

  Future<void> _deleteTask() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Task'),
        content: const Text('Delete this task? This cannot be undone.'),
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
        await ref
            .read(apiClientProvider)
            .deleteTask(widget.projectId, widget.taskId);
        if (mounted) Navigator.pop(context);
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Error: $e')),
          );
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Scaffold(
        appBar: AppBar(title: const Text('Task')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    if (_error != null || _task == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Task')),
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, color: WebmuxTheme.statusFailed),
              const SizedBox(height: 8),
              Text(_error ?? 'Task not found'),
              const SizedBox(height: 16),
              OutlinedButton(onPressed: _load, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }

    final task = _task!;
    final canRetry =
        task.status == 'failed' ||
        task.status == 'waiting' ||
        task.status == 'completed' ||
        task.status == 'waiting_for_input';
    final canComplete =
        task.status == 'waiting' ||
        task.status == 'waiting_for_input' ||
        task.status == 'running';
    final canDelete =
        task.status != 'running' && task.status != 'starting';

    return Scaffold(
      appBar: AppBar(
        title: Text(task.title, overflow: TextOverflow.ellipsis),
      ),
      body: Column(
        children: [
          Expanded(
            child: RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  // --- Task header ---
                  _TaskHeader(task: task),
                  const SizedBox(height: 12),

                  // --- Action buttons ---
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      if (canRetry)
                        OutlinedButton.icon(
                          onPressed: _retryTask,
                          icon: const Icon(Icons.replay_rounded, size: 18),
                          label: const Text('Retry'),
                        ),
                      if (canComplete)
                        OutlinedButton.icon(
                          onPressed: _completeTask,
                          icon: const Icon(Icons.check_rounded, size: 18),
                          label: const Text('Complete'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: WebmuxTheme.statusSuccess,
                            side: const BorderSide(
                                color: WebmuxTheme.statusSuccess),
                          ),
                        ),
                      if (canDelete)
                        OutlinedButton.icon(
                          onPressed: _deleteTask,
                          icon: const Icon(Icons.delete_outline_rounded,
                              size: 18),
                          label: const Text('Delete'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: WebmuxTheme.statusFailed,
                            side: const BorderSide(
                                color: WebmuxTheme.statusFailed),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 24),

                  // --- Steps timeline ---
                  if (_steps.isNotEmpty) ...[
                    Text(
                      'Steps',
                      style:
                          Theme.of(context).textTheme.titleMedium?.copyWith(
                                fontWeight: FontWeight.w600,
                              ),
                    ),
                    const SizedBox(height: 8),
                    ..._steps.map((step) => _StepTile(step: step)),
                    const SizedBox(height: 24),
                  ],

                  // --- Messages ---
                  Text(
                    'Messages',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                  ),
                  const SizedBox(height: 8),
                  if (_messages.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 16),
                      child: Text(
                        'No messages yet',
                        style: TextStyle(color: WebmuxTheme.subtext),
                        textAlign: TextAlign.center,
                      ),
                    )
                  else
                    ..._messages.map((msg) => _MessageBubble(message: msg)),
                ],
              ),
            ),
          ),

          // --- Composer ---
          Container(
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surface,
              border: const Border(
                top: BorderSide(color: WebmuxTheme.border),
              ),
            ),
            padding: EdgeInsets.fromLTRB(
              12,
              8,
              12,
              8 + MediaQuery.of(context).viewPadding.bottom,
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _messageController,
                    decoration: const InputDecoration(
                      hintText: 'Send a message...',
                      border: InputBorder.none,
                      contentPadding:
                          EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    ),
                    maxLines: 3,
                    minLines: 1,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => _sendMessage(),
                  ),
                ),
                IconButton(
                  onPressed: _sending ? null : _sendMessage,
                  icon: _sending
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.send_rounded),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Sub-widgets
// ---------------------------------------------------------------------------

class _TaskHeader extends StatelessWidget {
  const _TaskHeader({required this.task});

  final Task task;

  @override
  Widget build(BuildContext context) {
    final createdAt =
        DateTime.fromMillisecondsSinceEpoch(task.createdAt.toInt());
    final updatedAt =
        DateTime.fromMillisecondsSinceEpoch(task.updatedAt.toInt());
    final color = StatusIndicator.colorForStatus(task.status);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                StatusIndicator(status: task.status, size: 12),
                const SizedBox(width: 8),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    task.status,
                    style: TextStyle(
                      fontSize: 12,
                      color: color,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                if (task.priority > 0) ...[
                  const SizedBox(width: 8),
                  Text(
                    'Priority ${task.priority}',
                    style: const TextStyle(
                      fontSize: 12,
                      color: WebmuxTheme.statusWarning,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 12),
            Text(
              task.title,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            if (task.prompt.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                task.prompt,
                style: const TextStyle(color: WebmuxTheme.subtext, fontSize: 13),
              ),
            ],
            const SizedBox(height: 12),
            Wrap(
              spacing: 16,
              runSpacing: 4,
              children: [
                _MetaItem(
                  icon: Icons.schedule_rounded,
                  text: 'Created ${timeago.format(createdAt)}',
                ),
                _MetaItem(
                  icon: Icons.update_rounded,
                  text: 'Updated ${timeago.format(updatedAt)}',
                ),
                if (task.branchName != null)
                  _MetaItem(
                    icon: Icons.commit_rounded,
                    text: task.branchName!,
                  ),
                _MetaItem(
                  icon: Icons.smart_toy_rounded,
                  text: task.tool,
                ),
              ],
            ),
            if (task.errorMessage != null) ...[
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: WebmuxTheme.statusFailed.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: WebmuxTheme.statusFailed.withOpacity(0.3),
                  ),
                ),
                child: Text(
                  task.errorMessage!,
                  style: const TextStyle(
                    color: WebmuxTheme.statusFailed,
                    fontSize: 12,
                    fontFamily: 'monospace',
                  ),
                ),
              ),
            ],
            if (task.summary != null) ...[
              const SizedBox(height: 12),
              Text(
                task.summary!,
                style: const TextStyle(fontSize: 13),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _MetaItem extends StatelessWidget {
  const _MetaItem({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 12, color: WebmuxTheme.subtext),
        const SizedBox(width: 4),
        Text(
          text,
          style: const TextStyle(fontSize: 11, color: WebmuxTheme.subtext),
        ),
      ],
    );
  }
}

class _StepTile extends StatelessWidget {
  const _StepTile({required this.step});

  final TaskStep step;

  @override
  Widget build(BuildContext context) {
    final color = StatusIndicator.colorForStatus(step.status);
    final icon = StatusIndicator.iconForStatus(step.status);

    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            children: [
              Icon(icon, size: 18, color: color),
              if (step != step) // placeholder for timeline line
                Container(width: 2, height: 20, color: WebmuxTheme.border),
            ],
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      step.label.isNotEmpty ? step.label : step.type,
                      style: const TextStyle(
                        fontWeight: FontWeight.w500,
                        fontSize: 13,
                      ),
                    ),
                    if (step.detail != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        step.detail!,
                        style: const TextStyle(
                          fontSize: 12,
                          color: WebmuxTheme.subtext,
                        ),
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                    if (step.durationMs != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          '${(step.durationMs! / 1000).toStringAsFixed(1)}s',
                          style: const TextStyle(
                            fontSize: 11,
                            color: WebmuxTheme.subtext,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message});

  final TaskMessage message;

  @override
  Widget build(BuildContext context) {
    final isUser = message.role == 'user';
    final createdAt = DateTime.fromMillisecondsSinceEpoch(
        message.createdAt.toInt());

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Align(
        alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width * 0.8,
          ),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: isUser
                  ? WebmuxTheme.statusRunning.withOpacity(0.15)
                  : WebmuxTheme.border,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      isUser ? 'You' : 'Agent',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: isUser
                            ? WebmuxTheme.statusRunning
                            : WebmuxTheme.subtext,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      timeago.format(createdAt),
                      style: const TextStyle(
                        fontSize: 10,
                        color: WebmuxTheme.subtext,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  message.content,
                  style: const TextStyle(fontSize: 13),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
