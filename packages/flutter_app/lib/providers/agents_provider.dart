import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/models.dart';
import 'api_provider.dart';

// ---------------------------------------------------------------------------
// AgentsNotifier
// ---------------------------------------------------------------------------

class AgentsNotifier extends AsyncNotifier<List<AgentInfo>> {
  @override
  Future<List<AgentInfo>> build() async {
    return _fetch();
  }

  Future<List<AgentInfo>> _fetch() {
    return ref.read(apiClientProvider).listAgents();
  }

  /// Refresh the agent list from the server.
  Future<void> refresh() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(_fetch);
  }

  /// Delete an agent by id and refresh.
  Future<void> deleteAgent(String agentId) async {
    await ref.read(apiClientProvider).deleteAgent(agentId);
    state = await AsyncValue.guard(_fetch);
  }

  /// Rename an agent and refresh.
  Future<void> renameAgent(String agentId, String name) async {
    await ref.read(apiClientProvider).renameAgent(agentId, name);
    state = await AsyncValue.guard(_fetch);
  }

  /// Create a registration token for a new agent.
  Future<Map<String, dynamic>> createRegistrationToken({String? name}) {
    return ref.read(apiClientProvider).createRegistrationToken(name: name);
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

final agentsProvider =
    AsyncNotifierProvider<AgentsNotifier, List<AgentInfo>>(() {
  return AgentsNotifier();
});
