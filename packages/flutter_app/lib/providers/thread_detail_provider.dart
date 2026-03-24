import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import '../services/websocket_service.dart';
import 'api_provider.dart';

// ---------------------------------------------------------------------------
// Thread key
// ---------------------------------------------------------------------------

/// Composite key for identifying a thread (agentId + threadId).
class ThreadKey {
  final String agentId;
  final String threadId;

  const ThreadKey({required this.agentId, required this.threadId});

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ThreadKey &&
          agentId == other.agentId &&
          threadId == other.threadId;

  @override
  int get hashCode => Object.hash(agentId, threadId);

  @override
  String toString() => 'ThreadKey($agentId, $threadId)';
}

// ---------------------------------------------------------------------------
// Thread detail state
// ---------------------------------------------------------------------------

class ThreadDetailState {
  final Run run;
  final List<RunTurnDetail> turns;

  const ThreadDetailState({required this.run, required this.turns});

  ThreadDetailState copyWith({Run? run, List<RunTurnDetail>? turns}) {
    return ThreadDetailState(
      run: run ?? this.run,
      turns: turns ?? this.turns,
    );
  }
}

// ---------------------------------------------------------------------------
// ThreadDetailNotifier
// ---------------------------------------------------------------------------

class ThreadDetailNotifier
    extends FamilyAsyncNotifier<ThreadDetailState, ThreadKey> {
  StreamSubscription<RunEvent>? _wsSubscription;

  @override
  Future<ThreadDetailState> build(ThreadKey arg) async {
    // Clean up WebSocket subscription when this provider is disposed.
    ref.onDispose(() {
      _wsSubscription?.cancel();
      _wsSubscription = null;
    });

    final detail = await ref
        .read(apiClientProvider)
        .getThreadDetail(arg.agentId, arg.threadId);

    // Connect WebSocket for real-time updates.
    _connectWebSocket(arg.threadId);

    return ThreadDetailState(run: detail.run, turns: detail.turns);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /// Send a new message (continue the thread).
  Future<void> sendMessage(
    String prompt, {
    List<RunImageAttachmentUpload>? attachments,
    RunTurnOptions? options,
  }) async {
    final api = ref.read(apiClientProvider);
    final detail = await api.continueThread(
      arg.agentId,
      arg.threadId,
      ContinueRunRequest(
        prompt: prompt,
        attachments: attachments,
        options: options,
      ),
    );
    state = AsyncValue.data(
      ThreadDetailState(run: detail.run, turns: detail.turns),
    );
  }

  /// Interrupt the running thread.
  Future<void> interrupt() async {
    await ref.read(apiClientProvider).interruptThread(arg.agentId, arg.threadId);
  }

  /// Update the prompt of a queued turn.
  Future<void> updateQueuedTurn(String turnId, String prompt) async {
    await ref
        .read(apiClientProvider)
        .updateQueuedTurn(arg.agentId, arg.threadId, turnId, prompt);
  }

  /// Delete a queued turn.
  Future<void> deleteQueuedTurn(String turnId) async {
    await ref
        .read(apiClientProvider)
        .deleteQueuedTurn(arg.agentId, arg.threadId, turnId);
    // Refresh to reflect the removed turn.
    await _refreshFromApi();
  }

  /// Discard all queued turns.
  Future<void> discardQueue() async {
    await ref
        .read(apiClientProvider)
        .discardQueue(arg.agentId, arg.threadId);
    await _refreshFromApi();
  }

  /// Resume processing the queue.
  Future<void> resumeQueue() async {
    final detail = await ref
        .read(apiClientProvider)
        .resumeQueue(arg.agentId, arg.threadId);
    state = AsyncValue.data(
      ThreadDetailState(run: detail.run, turns: detail.turns),
    );
  }

  // -------------------------------------------------------------------------
  // WebSocket handling
  // -------------------------------------------------------------------------

  void _connectWebSocket(String threadId) {
    final wsService = ref.read(webSocketServiceProvider);
    final stream = wsService.connectThread(threadId);

    _wsSubscription = stream.listen(
      _handleEvent,
      onError: (_) {
        // WebSocketService handles reconnection internally.
      },
    );
  }

  void _handleEvent(RunEvent event) {
    final current = state.valueOrNull;
    if (current == null) return;

    switch (event.type) {
      case 'run-status':
        if (event.run != null) {
          state = AsyncValue.data(current.copyWith(run: event.run));
        }
        break;

      case 'run-turn':
        if (event.turn != null) {
          _handleTurnEvent(current, event.turn!);
        }
        break;

      case 'run-item':
        if (event.item != null && event.turnId != null) {
          _handleItemEvent(current, event.turnId!, event.item!);
        }
        break;
    }
  }

  void _handleTurnEvent(ThreadDetailState current, RunTurn turn) {
    final turns = List<RunTurnDetail>.from(current.turns);
    final idx = turns.indexWhere((t) => t.id == turn.id);

    // Convert RunTurn to RunTurnDetail (preserving existing items if updating).
    final existing = idx >= 0 ? turns[idx] : null;
    final detail = RunTurnDetail(
      id: turn.id,
      runId: turn.runId,
      index: turn.index,
      prompt: turn.prompt,
      attachments: turn.attachments,
      status: turn.status,
      createdAt: turn.createdAt,
      updatedAt: turn.updatedAt,
      summary: turn.summary,
      hasDiff: turn.hasDiff,
      items: existing?.items ?? [],
    );

    if (idx >= 0) {
      turns[idx] = detail;
    } else {
      turns.add(detail);
    }

    state = AsyncValue.data(current.copyWith(turns: turns));
  }

  void _handleItemEvent(
    ThreadDetailState current,
    String turnId,
    RunTimelineEvent item,
  ) {
    final turns = List<RunTurnDetail>.from(current.turns);
    final turnIdx = turns.indexWhere((t) => t.id == turnId);

    if (turnIdx < 0) return;

    final turn = turns[turnIdx];
    final items = List<RunTimelineEvent>.from(turn.items);

    // Update existing item or append.
    final itemIdx = items.indexWhere((i) => i.id == item.id);
    if (itemIdx >= 0) {
      items[itemIdx] = item;
    } else {
      items.add(item);
    }

    turns[turnIdx] = RunTurnDetail(
      id: turn.id,
      runId: turn.runId,
      index: turn.index,
      prompt: turn.prompt,
      attachments: turn.attachments,
      status: turn.status,
      createdAt: turn.createdAt,
      updatedAt: turn.updatedAt,
      summary: turn.summary,
      hasDiff: turn.hasDiff,
      items: items,
    );

    state = AsyncValue.data(current.copyWith(turns: turns));
  }

  Future<void> _refreshFromApi() async {
    final detail = await ref
        .read(apiClientProvider)
        .getThreadDetail(arg.agentId, arg.threadId);
    state = AsyncValue.data(
      ThreadDetailState(run: detail.run, turns: detail.turns),
    );
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

final threadDetailProvider = AsyncNotifierProvider.family<
    ThreadDetailNotifier, ThreadDetailState, ThreadKey>(() {
  return ThreadDetailNotifier();
});
