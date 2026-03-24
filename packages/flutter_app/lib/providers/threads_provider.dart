import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/models.dart';
import 'api_provider.dart';

// ---------------------------------------------------------------------------
// ThreadsNotifier
// ---------------------------------------------------------------------------

class ThreadsNotifier extends AsyncNotifier<List<Run>> {
  @override
  Future<List<Run>> build() async {
    return _fetch();
  }

  Future<List<Run>> _fetch() {
    return ref.read(apiClientProvider).listAllThreads();
  }

  /// Refresh the thread list from the server.
  Future<void> refresh() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(_fetch);
  }

  /// Delete a thread and refresh.
  Future<void> deleteThread(String agentId, String threadId) async {
    await ref.read(apiClientProvider).deleteThread(agentId, threadId);
    state = await AsyncValue.guard(_fetch);
  }

  // -------------------------------------------------------------------------
  // Computed helpers (operate on current data snapshot)
  // -------------------------------------------------------------------------

  /// Threads currently running.
  List<Run> get runningThreads =>
      _filterByStatus(const {'running', 'starting'});

  /// Threads waiting for user input.
  List<Run> get waitingThreads => _filterByStatus(const {'waiting'});

  /// Most recent threads (sorted by updatedAt descending).
  List<Run> get recentThreads {
    final data = state.valueOrNull;
    if (data == null) return [];
    final sorted = List<Run>.from(data)
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return sorted;
  }

  /// Threads grouped by their `repoPath` (used as a project key).
  Map<String, List<Run>> get threadsByProject {
    final data = state.valueOrNull;
    if (data == null) return {};
    final map = <String, List<Run>>{};
    for (final run in data) {
      (map[run.repoPath] ??= []).add(run);
    }
    return map;
  }

  List<Run> _filterByStatus(Set<String> statuses) {
    final data = state.valueOrNull;
    if (data == null) return [];
    return data.where((r) => statuses.contains(r.status)).toList();
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

final threadsProvider =
    AsyncNotifierProvider<ThreadsNotifier, List<Run>>(() {
  return ThreadsNotifier();
});
