import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import 'api_provider.dart';

// ---------------------------------------------------------------------------
// ProjectsNotifier
// ---------------------------------------------------------------------------

class ProjectsNotifier extends AsyncNotifier<List<Project>> {
  @override
  Future<List<Project>> build() async {
    return _fetch();
  }

  Future<List<Project>> _fetch() {
    return ref.read(apiClientProvider).listProjects();
  }

  /// Refresh the project list from the server.
  Future<void> refresh() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(_fetch);
  }

  /// Create a new project and refresh.
  Future<Project> createProject(CreateProjectRequest request) async {
    final project = await ref.read(apiClientProvider).createProject(request);
    state = await AsyncValue.guard(_fetch);
    return project;
  }

  /// Delete a project and refresh.
  Future<void> deleteProject(String projectId) async {
    await ref.read(apiClientProvider).deleteProject(projectId);
    state = await AsyncValue.guard(_fetch);
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

final projectsProvider =
    AsyncNotifierProvider<ProjectsNotifier, List<Project>>(() {
  return ProjectsNotifier();
});
