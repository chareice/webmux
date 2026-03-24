import 'package:flutter/material.dart';

import '../app/theme.dart';
import '../models/run.dart';

/// Compact bar showing todo item counts. Tap to expand a bottom sheet.
class TodoBar extends StatelessWidget {
  const TodoBar({
    super.key,
    required this.items,
  });

  final List<TodoEntry> items;

  int get _pendingCount =>
      items.where((e) => e.status == 'pending').length;

  int get _completedCount =>
      items.where((e) => e.status == 'completed').length;

  void _showTodoSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Text(
                      'Todo Items',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const Spacer(),
                    Text(
                      '$_completedCount / ${items.length} done',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              ConstrainedBox(
                constraints: BoxConstraints(
                  maxHeight: MediaQuery.of(context).size.height * 0.4,
                ),
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: items.length,
                  itemBuilder: (context, index) {
                    final item = items[index];
                    final isDone = item.status == 'completed';
                    return ListTile(
                      dense: true,
                      leading: Icon(
                        isDone
                            ? Icons.check_box_rounded
                            : Icons.check_box_outline_blank_rounded,
                        size: 20,
                        color: isDone
                            ? WebmuxTheme.statusSuccess
                            : WebmuxTheme.subtext,
                      ),
                      title: Text(
                        item.text,
                        style: TextStyle(
                          decoration: isDone
                              ? TextDecoration.lineThrough
                              : null,
                          color: isDone ? WebmuxTheme.subtext : null,
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();

    final pending = _pendingCount;
    if (pending == 0) return const SizedBox.shrink();

    return InkWell(
      onTap: () => _showTodoSheet(context),
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
              Icons.checklist_rounded,
              size: 16,
              color: WebmuxTheme.statusWarning,
            ),
            const SizedBox(width: 8),
            Text(
              '$pending remaining task${pending != 1 ? 's' : ''}',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: WebmuxTheme.statusWarning,
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
