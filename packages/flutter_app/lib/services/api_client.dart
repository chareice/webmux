import 'package:dio/dio.dart';

import '../models/models.dart';

// ---------------------------------------------------------------------------
// Request / Response DTOs
// ---------------------------------------------------------------------------

/// Request to start a new thread.
class StartRunRequest {
  final String tool;
  final String repoPath;
  final String prompt;
  final String? existingSessionId;
  final List<RunImageAttachmentUpload>? attachments;
  final RunTurnOptions? options;

  const StartRunRequest({
    required this.tool,
    required this.repoPath,
    required this.prompt,
    this.existingSessionId,
    this.attachments,
    this.options,
  });

  Map<String, dynamic> toJson() {
    return {
      'tool': tool,
      'repoPath': repoPath,
      'prompt': prompt,
      if (existingSessionId != null) 'existingSessionId': existingSessionId,
      if (attachments != null && attachments!.isNotEmpty)
        'attachments': attachments!.map((e) => e.toJson()).toList(),
      if (options != null) 'options': options!.toJson(),
    };
  }
}

/// Request to continue an existing thread with a new turn.
class ContinueRunRequest {
  final String prompt;
  final List<RunImageAttachmentUpload>? attachments;
  final RunTurnOptions? options;

  const ContinueRunRequest({
    required this.prompt,
    this.attachments,
    this.options,
  });

  Map<String, dynamic> toJson() {
    return {
      'prompt': prompt,
      if (attachments != null && attachments!.isNotEmpty)
        'attachments': attachments!.map((e) => e.toJson()).toList(),
      if (options != null) 'options': options!.toJson(),
    };
  }
}

/// Options for a run turn (model, effort level, session control).
class RunTurnOptions {
  final String? model;
  final String? claudeEffort;
  final String? codexEffort;
  final bool? clearSession;

  const RunTurnOptions({
    this.model,
    this.claudeEffort,
    this.codexEffort,
    this.clearSession,
  });

  Map<String, dynamic> toJson() {
    return {
      if (model != null) 'model': model,
      if (claudeEffort != null) 'claudeEffort': claudeEffort,
      if (codexEffort != null) 'codexEffort': codexEffort,
      if (clearSession != null) 'clearSession': clearSession,
    };
  }
}

/// Response containing a run and its turn details.
class RunDetailResponse {
  final Run run;
  final List<RunTurnDetail> turns;

  const RunDetailResponse({required this.run, required this.turns});

  factory RunDetailResponse.fromJson(Map<String, dynamic> json) {
    return RunDetailResponse(
      run: Run.fromJson(json['run'] as Map<String, dynamic>),
      turns: (json['turns'] as List<dynamic>)
          .map((e) => RunTurnDetail.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}

/// Response containing a project with its tasks and actions.
class ProjectDetailResponse {
  final Project project;
  final List<Task> tasks;
  final List<ProjectAction> actions;

  const ProjectDetailResponse({
    required this.project,
    required this.tasks,
    required this.actions,
  });

  factory ProjectDetailResponse.fromJson(Map<String, dynamic> json) {
    return ProjectDetailResponse(
      project: Project.fromJson(json['project'] as Map<String, dynamic>),
      tasks: (json['tasks'] as List<dynamic>)
          .map((e) => Task.fromJson(e as Map<String, dynamic>))
          .toList(),
      actions: (json['actions'] as List<dynamic>)
          .map((e) => ProjectAction.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}

/// Request to create a project.
class CreateProjectRequest {
  final String name;
  final String? description;
  final String repoPath;
  final String agentId;
  final String? defaultTool;

  const CreateProjectRequest({
    required this.name,
    this.description,
    required this.repoPath,
    required this.agentId,
    this.defaultTool,
  });

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      if (description != null) 'description': description,
      'repoPath': repoPath,
      'agentId': agentId,
      if (defaultTool != null) 'defaultTool': defaultTool,
    };
  }
}

/// Request to update a project.
class UpdateProjectRequest {
  final String? name;
  final String? description;
  final String? defaultTool;

  const UpdateProjectRequest({this.name, this.description, this.defaultTool});

  Map<String, dynamic> toJson() {
    return {
      if (name != null) 'name': name,
      if (description != null) 'description': description,
      if (defaultTool != null) 'defaultTool': defaultTool,
    };
  }
}

/// Request to create a task.
class CreateTaskRequest {
  final String title;
  final String? prompt;
  final int? priority;
  final String? tool;

  const CreateTaskRequest({
    required this.title,
    this.prompt,
    this.priority,
    this.tool,
  });

  Map<String, dynamic> toJson() {
    return {
      'title': title,
      if (prompt != null) 'prompt': prompt,
      if (priority != null) 'priority': priority,
      if (tool != null) 'tool': tool,
    };
  }
}

/// Request to update a task.
class UpdateTaskRequest {
  final String? title;
  final String? prompt;
  final int? priority;

  const UpdateTaskRequest({this.title, this.prompt, this.priority});

  Map<String, dynamic> toJson() {
    return {
      if (title != null) 'title': title,
      if (prompt != null) 'prompt': prompt,
      if (priority != null) 'priority': priority,
    };
  }
}

/// Request to create an LLM config.
class CreateLlmConfigRequest {
  final String apiBaseUrl;
  final String apiKey;
  final String model;
  final String? projectId;

  const CreateLlmConfigRequest({
    required this.apiBaseUrl,
    required this.apiKey,
    required this.model,
    this.projectId,
  });

  Map<String, dynamic> toJson() {
    return {
      'apiBaseUrl': apiBaseUrl,
      'apiKey': apiKey,
      'model': model,
      if (projectId != null) 'projectId': projectId,
    };
  }
}

/// Request to update an LLM config.
class UpdateLlmConfigRequest {
  final String? apiBaseUrl;
  final String? apiKey;
  final String? model;

  const UpdateLlmConfigRequest({this.apiBaseUrl, this.apiKey, this.model});

  Map<String, dynamic> toJson() {
    return {
      if (apiBaseUrl != null) 'apiBaseUrl': apiBaseUrl,
      if (apiKey != null) 'apiKey': apiKey,
      if (model != null) 'model': model,
    };
  }
}

/// Request to create a project action.
class CreateProjectActionRequest {
  final String name;
  final String? description;
  final String prompt;
  final String? tool;

  const CreateProjectActionRequest({
    required this.name,
    this.description,
    required this.prompt,
    this.tool,
  });

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      if (description != null) 'description': description,
      'prompt': prompt,
      if (tool != null) 'tool': tool,
    };
  }
}

/// Request to update a project action.
class UpdateProjectActionRequest {
  final String? name;
  final String? description;
  final String? prompt;
  final String? tool;
  final int? sortOrder;

  const UpdateProjectActionRequest({
    this.name,
    this.description,
    this.prompt,
    this.tool,
    this.sortOrder,
  });

  Map<String, dynamic> toJson() {
    return {
      if (name != null) 'name': name,
      if (description != null) 'description': description,
      if (prompt != null) 'prompt': prompt,
      if (tool != null) 'tool': tool,
      if (sortOrder != null) 'sortOrder': sortOrder,
    };
  }
}

// ---------------------------------------------------------------------------
// API Exceptions
// ---------------------------------------------------------------------------

/// Typed exception for API errors.
class ApiException implements Exception {
  final int statusCode;
  final String message;

  const ApiException({required this.statusCode, required this.message});

  @override
  String toString() => 'ApiException($statusCode): $message';
}

// ---------------------------------------------------------------------------
// ApiClient
// ---------------------------------------------------------------------------

/// Dio-based REST client for the Webmux API.
class ApiClient {
  late final Dio _dio;
  String _baseUrl = '';
  String _token = '';

  ApiClient() {
    _dio = Dio();
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        if (_token.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $_token';
        }
        handler.next(options);
      },
      onError: (error, handler) {
        final response = error.response;
        if (response != null) {
          final body = response.data;
          String message;
          if (body is Map && body.containsKey('error')) {
            message = body['error'].toString();
          } else if (body is String && body.isNotEmpty) {
            message = body;
          } else {
            message = error.message ?? 'Unknown error';
          }
          handler.reject(DioException(
            requestOptions: error.requestOptions,
            response: response,
            error: ApiException(
              statusCode: response.statusCode ?? 0,
              message: message,
            ),
          ));
        } else {
          handler.next(error);
        }
      },
    ));
  }

  /// Reconfigure base URL and auth token.
  void configure(String baseUrl, String token) {
    _baseUrl = baseUrl.replaceAll(RegExp(r'/+$'), '');
    _token = token;
    _dio.options.baseUrl = '$_baseUrl/api';
  }

  String get baseUrl => _baseUrl;
  String get token => _token;

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  /// Get the current authenticated user.
  Future<User> getCurrentUser() async {
    final response = await _dio.get<Map<String, dynamic>>('/auth/me');
    return User.fromJson(response.data!);
  }

  /// Build the OAuth redirect URL for the given provider.
  String getOAuthUrl(String provider) {
    return '$_baseUrl/api/auth/$provider';
  }

  /// Dev login — creates/returns a dev user with a token.
  /// Only available when the server is running in development mode.
  Future<Map<String, String>> devLogin() async {
    final response =
        await _dio.post<Map<String, dynamic>>('/auth/dev');
    return {
      'token': response.data!['token'] as String,
    };
  }

  // -------------------------------------------------------------------------
  // Agents
  // -------------------------------------------------------------------------

  /// List all registered agents.
  Future<List<AgentInfo>> listAgents() async {
    final response = await _dio.get<Map<String, dynamic>>('/agents');
    final agents = response.data!['agents'] as List<dynamic>;
    return agents
        .map((e) => AgentInfo.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Delete an agent.
  Future<void> deleteAgent(String agentId) async {
    await _dio.delete('/agents/$agentId');
  }

  /// Rename an agent.
  Future<void> renameAgent(String agentId, String name) async {
    await _dio.patch('/agents/$agentId', data: {'name': name});
  }

  /// Create a registration token for a new agent.
  Future<Map<String, dynamic>> createRegistrationToken({String? name}) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/agents/register-token',
      data: {if (name != null) 'name': name},
    );
    return response.data!;
  }

  // -------------------------------------------------------------------------
  // Threads / Runs
  // -------------------------------------------------------------------------

  /// List all threads across all agents.
  Future<List<Run>> listAllThreads() async {
    final response = await _dio.get<Map<String, dynamic>>('/threads');
    final runs = response.data!['runs'] as List<dynamic>;
    return runs
        .map((e) => Run.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// List threads for a specific agent.
  Future<List<Run>> listAgentThreads(String agentId) async {
    final response =
        await _dio.get<Map<String, dynamic>>('/agents/$agentId/threads');
    final runs = response.data!['runs'] as List<dynamic>;
    return runs
        .map((e) => Run.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Get full detail for a thread (run + turns with items).
  Future<RunDetailResponse> getThreadDetail(
    String agentId,
    String threadId,
  ) async {
    final response = await _dio
        .get<Map<String, dynamic>>('/agents/$agentId/threads/$threadId');
    return RunDetailResponse.fromJson(response.data!);
  }

  /// Start a new thread on the given agent.
  Future<RunDetailResponse> startThread(
    String agentId,
    StartRunRequest request,
  ) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/agents/$agentId/threads',
      data: request.toJson(),
    );
    return RunDetailResponse.fromJson(response.data!);
  }

  /// Continue an existing thread with a new turn.
  Future<RunDetailResponse> continueThread(
    String agentId,
    String threadId,
    ContinueRunRequest request,
  ) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/agents/$agentId/threads/$threadId/turns',
      data: request.toJson(),
    );
    return RunDetailResponse.fromJson(response.data!);
  }

  /// Interrupt a running thread.
  Future<void> interruptThread(String agentId, String threadId) async {
    await _dio.post('/agents/$agentId/threads/$threadId/interrupt');
  }

  /// Delete a thread.
  Future<void> deleteThread(String agentId, String threadId) async {
    await _dio.delete('/agents/$agentId/threads/$threadId');
  }

  /// Update the prompt of a queued turn.
  Future<void> updateQueuedTurn(
    String agentId,
    String threadId,
    String turnId,
    String prompt,
  ) async {
    await _dio.patch(
      '/agents/$agentId/threads/$threadId/turns/$turnId',
      data: {'prompt': prompt},
    );
  }

  /// Delete a queued turn.
  Future<void> deleteQueuedTurn(
    String agentId,
    String threadId,
    String turnId,
  ) async {
    await _dio.delete('/agents/$agentId/threads/$threadId/turns/$turnId');
  }

  /// Discard all queued turns for a thread.
  Future<void> discardQueue(String agentId, String threadId) async {
    await _dio.post('/agents/$agentId/threads/$threadId/discard-queue');
  }

  /// Resume processing the queue for a thread.
  Future<RunDetailResponse> resumeQueue(
    String agentId,
    String threadId,
  ) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/agents/$agentId/threads/$threadId/resume-queue',
    );
    return RunDetailResponse.fromJson(response.data!);
  }

  /// Mark a thread as read.
  Future<void> markThreadRead(String agentId, String threadId) async {
    await _dio.post('/agents/$agentId/threads/$threadId/read');
  }

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  /// List all projects.
  Future<List<Project>> listProjects() async {
    final response = await _dio.get<Map<String, dynamic>>('/projects');
    final projects = response.data!['projects'] as List<dynamic>;
    return projects
        .map((e) => Project.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Get full detail for a project (project + tasks + actions).
  Future<ProjectDetailResponse> getProjectDetail(String projectId) async {
    final response =
        await _dio.get<Map<String, dynamic>>('/projects/$projectId');
    return ProjectDetailResponse.fromJson(response.data!);
  }

  /// Create a new project.
  Future<Project> createProject(CreateProjectRequest request) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/projects',
      data: request.toJson(),
    );
    return Project.fromJson(
        response.data!['project'] as Map<String, dynamic>);
  }

  /// Update a project.
  Future<void> updateProject(
    String projectId,
    UpdateProjectRequest request,
  ) async {
    await _dio.patch('/projects/$projectId', data: request.toJson());
  }

  /// Delete a project.
  Future<void> deleteProject(String projectId) async {
    await _dio.delete('/projects/$projectId');
  }

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------

  /// Create a task in a project.
  Future<Task> createTask(
    String projectId,
    CreateTaskRequest request,
  ) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/projects/$projectId/tasks',
      data: request.toJson(),
    );
    return Task.fromJson(response.data!['task'] as Map<String, dynamic>);
  }

  /// Update a task.
  Future<void> updateTask(
    String projectId,
    String taskId,
    UpdateTaskRequest request,
  ) async {
    await _dio.patch(
      '/projects/$projectId/tasks/$taskId',
      data: request.toJson(),
    );
  }

  /// Delete a task.
  Future<void> deleteTask(String projectId, String taskId) async {
    await _dio.delete('/projects/$projectId/tasks/$taskId');
  }

  /// Retry a failed/waiting/completed task, optionally with a new prompt.
  Future<void> retryTask(
    String projectId,
    String taskId, {
    String? prompt,
  }) async {
    await _dio.post(
      '/projects/$projectId/tasks/$taskId/retry',
      data: prompt != null ? {'prompt': prompt} : null,
    );
  }

  /// Mark a task as completed.
  Future<void> completeTask(String projectId, String taskId) async {
    await _dio.post('/projects/$projectId/tasks/$taskId/complete');
  }

  /// Get steps for a task.
  Future<List<TaskStep>> getTaskSteps(
    String projectId,
    String taskId,
  ) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/projects/$projectId/tasks/$taskId/steps',
    );
    final steps = response.data!['steps'] as List<dynamic>;
    return steps
        .map((e) => TaskStep.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Get messages for a task.
  Future<List<TaskMessage>> getTaskMessages(
    String projectId,
    String taskId,
  ) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/projects/$projectId/tasks/$taskId/messages',
    );
    final messages = response.data!['messages'] as List<dynamic>;
    return messages
        .map((e) => TaskMessage.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Send a message to a task.
  Future<TaskMessage> sendTaskMessage(
    String projectId,
    String taskId,
    String content, {
    List<RunImageAttachmentUpload>? attachments,
  }) async {
    final data = <String, dynamic>{'content': content};
    if (attachments != null && attachments.isNotEmpty) {
      data['attachments'] = attachments.map((e) => e.toJson()).toList();
    }
    final response = await _dio.post<Map<String, dynamic>>(
      '/projects/$projectId/tasks/$taskId/messages',
      data: data,
    );
    return TaskMessage.fromJson(
        response.data!['message'] as Map<String, dynamic>);
  }

  // -------------------------------------------------------------------------
  // LLM Configs
  // -------------------------------------------------------------------------

  /// List all LLM configurations.
  Future<List<LlmConfig>> listLlmConfigs() async {
    final response = await _dio.get<Map<String, dynamic>>('/llm-configs');
    final configs = response.data!['configs'] as List<dynamic>;
    return configs
        .map((e) => LlmConfig.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Create a new LLM configuration.
  Future<LlmConfig> createLlmConfig(CreateLlmConfigRequest request) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/llm-configs',
      data: request.toJson(),
    );
    return LlmConfig.fromJson(
        response.data!['config'] as Map<String, dynamic>);
  }

  /// Update an LLM configuration.
  Future<LlmConfig> updateLlmConfig(
    String configId,
    UpdateLlmConfigRequest request,
  ) async {
    final response = await _dio.patch<Map<String, dynamic>>(
      '/llm-configs/$configId',
      data: request.toJson(),
    );
    return LlmConfig.fromJson(
        response.data!['config'] as Map<String, dynamic>);
  }

  /// Delete an LLM configuration.
  Future<void> deleteLlmConfig(String configId) async {
    await _dio.delete('/llm-configs/$configId');
  }

  // -------------------------------------------------------------------------
  // Project Actions
  // -------------------------------------------------------------------------

  /// List all actions for a project.
  Future<List<ProjectAction>> listActions(String projectId) async {
    final response =
        await _dio.get<Map<String, dynamic>>('/projects/$projectId/actions');
    final actions = response.data!['actions'] as List<dynamic>;
    return actions
        .map((e) => ProjectAction.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Create a new action for a project.
  Future<ProjectAction> createAction(
    String projectId,
    CreateProjectActionRequest request,
  ) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/projects/$projectId/actions',
      data: request.toJson(),
    );
    return ProjectAction.fromJson(
        response.data!['action'] as Map<String, dynamic>);
  }

  /// Update a project action.
  Future<void> updateAction(
    String projectId,
    String actionId,
    UpdateProjectActionRequest request,
  ) async {
    await _dio.patch(
      '/projects/$projectId/actions/$actionId',
      data: request.toJson(),
    );
  }

  /// Delete a project action.
  Future<void> deleteAction(String projectId, String actionId) async {
    await _dio.delete('/projects/$projectId/actions/$actionId');
  }

  /// Generate an action from a description using AI.
  Future<ProjectAction> generateAction(
    String projectId,
    String description,
  ) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/projects/$projectId/actions/generate',
      data: {'description': description},
    );
    return ProjectAction.fromJson(
        response.data!['action'] as Map<String, dynamic>);
  }

  /// Run a project action, starting a new thread.
  Future<Run> runAction(String projectId, String actionId) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/projects/$projectId/actions/$actionId/run',
    );
    // Server returns { runId: string }, fetch the full run.
    // The action run endpoint returns a minimal response; the caller should
    // use the returned Run id to open the thread detail or watch via WS.
    final runId = response.data!['runId'] as String;
    return Run(
      id: runId,
      agentId: '',
      tool: '',
      repoPath: '',
      branch: '',
      prompt: '',
      status: 'starting',
      createdAt: 0,
      updatedAt: 0,
      hasDiff: false,
      unread: false,
    );
  }

  // -------------------------------------------------------------------------
  // Attachments
  // -------------------------------------------------------------------------

  /// Build the URL for downloading an attachment image.
  String getAttachmentUrl(String attachmentId) {
    return '$_baseUrl/api/attachments/$attachmentId/image';
  }
}
