import 'package:flutter/material.dart';

import '../app/theme.dart';
import '../models/run.dart';
import '../services/api_client.dart';

/// Compact bar showing queued turn count. Tap to expand with edit/delete/reorder.
class QueueBar extends StatelessWidget {
  const QueueBar({
    super.key,
    required this.queuedTurns,
    required this.agentId,
    required this.threadId,
    required this.apiClient,
    this.onChanged,
  });

  final List<RunTurn> queuedTurns;
  final String agentId;
  final String threadId;
  final ApiClient apiClient;
  final VoidCallback? onChanged;

  void _showQueueSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Theme.of(context).colorScheme.surface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.zero,
      ),
      builder: (sheetContext) {
        return _QueueSheet(
          queuedTurns: List.of(queuedTurns),
          agentId: agentId,
          threadId: threadId,
          apiClient: apiClient,
          onChanged: () {
            onChanged?.call();
            Navigator.of(sheetContext).pop();
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    if (queuedTurns.isEmpty) return const SizedBox.shrink();

    final count = queuedTurns.length;

    return InkWell(
      onTap: () => _showQueueSheet(context),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(color: WebmuxTheme.border),
          ),
        ),
        child: Row(
          children: [
            Icon(
              Icons.queue_rounded,
              size: 16,
              color: WebmuxTheme.statusQueued,
            ),
            const SizedBox(width: 8),
            Text(
              '$count queued msg${count != 1 ? 's' : ''}',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: WebmuxTheme.subtext,
                  ),
            ),
            const Spacer(),
            Icon(
              Icons.expand_more_rounded,
              size: 16,
              color: WebmuxTheme.subtext,
            ),
          ],
        ),
      ),
    );
  }
}

/// Bottom sheet content for managing queued messages.
class _QueueSheet extends StatefulWidget {
  const _QueueSheet({
    required this.queuedTurns,
    required this.agentId,
    required this.threadId,
    required this.apiClient,
    required this.onChanged,
  });

  final List<RunTurn> queuedTurns;
  final String agentId;
  final String threadId;
  final ApiClient apiClient;
  final VoidCallback onChanged;

  @override
  State<_QueueSheet> createState() => _QueueSheetState();
}

class _QueueSheetState extends State<_QueueSheet> {
  late List<RunTurn> _items;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _items = List.of(widget.queuedTurns);
  }

  Future<void> _editItem(int index) async {
    final turn = _items[index];
    final controller = TextEditingController(text: turn.prompt);

    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Edit Message'),
        content: TextField(
          controller: controller,
          maxLines: 6,
          minLines: 3,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'Message content...',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(controller.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    controller.dispose();

    if (result == null || result.isEmpty || result == turn.prompt) return;

    setState(() => _busy = true);
    try {
      await widget.apiClient.updateQueuedTurn(
        widget.agentId,
        widget.threadId,
        turn.id,
        result,
      );
      widget.onChanged();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to update: $e')),
        );
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _deleteItem(int index) async {
    final turn = _items[index];
    setState(() => _busy = true);
    try {
      await widget.apiClient.deleteQueuedTurn(
        widget.agentId,
        widget.threadId,
        turn.id,
      );
      widget.onChanged();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to delete: $e')),
        );
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _clearAll() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Clear Queue'),
        content: const Text('Delete all queued messages?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Clear All',
                style: TextStyle(color: WebmuxTheme.statusFailed)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() => _busy = true);
    try {
      await widget.apiClient.discardQueue(widget.agentId, widget.threadId);
      widget.onChanged();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to clear: $e')),
        );
        setState(() => _busy = false);
      }
    }
  }

  void _onReorder(int oldIndex, int newIndex) {
    setState(() {
      if (newIndex > oldIndex) newIndex -= 1;
      final item = _items.removeAt(oldIndex);
      _items.insert(newIndex, item);
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Header
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 8, 0),
            child: Row(
              children: [
                Text('Queued Messages', style: theme.textTheme.titleMedium),
                const SizedBox(width: 8),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                  decoration: BoxDecoration(
                    color: WebmuxTheme.subtext.withOpacity(0.15),
                    borderRadius: BorderRadius.zero,
                  ),
                  child: Text(
                    '${_items.length}',
                    style: const TextStyle(
                        fontSize: 11, color: WebmuxTheme.subtext),
                  ),
                ),
                const Spacer(),
                if (_items.length > 1)
                  TextButton(
                    onPressed: _busy ? null : _clearAll,
                    child: const Text('Clear All',
                        style: TextStyle(
                            fontSize: 12, color: WebmuxTheme.statusFailed)),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Text(
              'Drag to reorder. Tap to edit.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: WebmuxTheme.subtext, fontSize: 11),
            ),
          ),
          const Divider(height: 1),

          // Reorderable list
          if (_busy)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: Text('...', style: TextStyle(fontSize: 14))),
            )
          else
            ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: MediaQuery.of(context).size.height * 0.45,
              ),
              child: ReorderableListView.builder(
                shrinkWrap: true,
                onReorder: _onReorder,
                itemCount: _items.length,
                proxyDecorator: (child, index, animation) {
                  return Material(
                    color: theme.colorScheme.surface,
                    elevation: 4,
                    borderRadius: BorderRadius.zero,
                    child: child,
                  );
                },
                itemBuilder: (context, index) {
                  final turn = _items[index];
                  return _QueueItem(
                    key: ValueKey(turn.id),
                    index: index,
                    prompt: turn.prompt,
                    onEdit: () => _editItem(index),
                    onDelete: () => _deleteItem(index),
                  );
                },
              ),
            ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}

class _QueueItem extends StatelessWidget {
  const _QueueItem({
    super.key,
    required this.index,
    required this.prompt,
    required this.onEdit,
    required this.onDelete,
  });

  final int index;
  final String prompt;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.zero,
        border: Border.all(color: WebmuxTheme.border),
      ),
      child: Row(
        children: [
          // Drag handle
          ReorderableDragStartListener(
            index: index,
            child: const Padding(
              padding: EdgeInsets.symmetric(horizontal: 8, vertical: 12),
              child: Icon(Icons.drag_handle_rounded,
                  size: 18, color: WebmuxTheme.subtext),
            ),
          ),
          // Order number
          Container(
            width: 20,
            height: 20,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: WebmuxTheme.subtext.withOpacity(0.15),
              borderRadius: BorderRadius.zero,
            ),
            child: Text(
              '${index + 1}',
              style: const TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  color: WebmuxTheme.subtext),
            ),
          ),
          const SizedBox(width: 8),
          // Message text
          Expanded(
            child: InkWell(
              onTap: onEdit,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Text(
                  prompt,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall,
                ),
              ),
            ),
          ),
          // Edit button
          IconButton(
            icon: const Icon(Icons.edit_outlined, size: 16),
            color: WebmuxTheme.subtext,
            onPressed: onEdit,
            visualDensity: VisualDensity.compact,
            tooltip: 'Edit',
          ),
          // Delete button
          IconButton(
            icon: const Icon(Icons.close_rounded, size: 16),
            color: WebmuxTheme.statusFailed,
            onPressed: onDelete,
            visualDensity: VisualDensity.compact,
            tooltip: 'Delete',
          ),
          const SizedBox(width: 4),
        ],
      ),
    );
  }
}
