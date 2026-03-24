import 'package:flutter/material.dart';

import '../app/theme.dart';
import '../models/run.dart';
import '../services/api_client.dart';

/// Compact bar showing queued turn count. Tap to expand with edit/delete.
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
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (sheetContext) {
        return SafeArea(
          child: StatefulBuilder(
            builder: (context, setSheetState) {
              return Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        Text(
                          'Queued Messages',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const Spacer(),
                        Text(
                          '${queuedTurns.length} queued',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                  const Divider(height: 1),
                  ConstrainedBox(
                    constraints: BoxConstraints(
                      maxHeight:
                          MediaQuery.of(context).size.height * 0.4,
                    ),
                    child: ListView.builder(
                      shrinkWrap: true,
                      itemCount: queuedTurns.length,
                      itemBuilder: (context, index) {
                        final turn = queuedTurns[index];
                        return ListTile(
                          dense: true,
                          title: Text(
                            turn.prompt,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          trailing: IconButton(
                            icon: Icon(
                              Icons.delete_outline_rounded,
                              size: 18,
                              color: WebmuxTheme.statusFailed,
                            ),
                            onPressed: () async {
                              await apiClient.deleteQueuedTurn(
                                agentId,
                                threadId,
                                turn.id,
                              );
                              onChanged?.call();
                              if (context.mounted) {
                                Navigator.of(context).pop();
                              }
                            },
                          ),
                        );
                      },
                    ),
                  ),
                ],
              );
            },
          ),
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
