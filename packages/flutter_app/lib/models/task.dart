class Task {
  final String id;
  final String projectId;
  final String title;
  final String prompt;
  final String tool;
  final String status;
  final int priority;
  final String? branchName;
  final String? worktreePath;
  final String? runId;
  final String? errorMessage;
  final String? summary;
  final double createdAt;
  final double updatedAt;
  final double? claimedAt;
  final double? completedAt;

  const Task({
    required this.id,
    required this.projectId,
    required this.title,
    required this.prompt,
    required this.tool,
    required this.status,
    required this.priority,
    this.branchName,
    this.worktreePath,
    this.runId,
    this.errorMessage,
    this.summary,
    required this.createdAt,
    required this.updatedAt,
    this.claimedAt,
    this.completedAt,
  });

  factory Task.fromJson(Map<String, dynamic> json) {
    return Task(
      id: json['id'] as String,
      projectId: json['projectId'] as String,
      title: json['title'] as String,
      prompt: json['prompt'] as String,
      tool: json['tool'] as String? ?? 'claude',
      status: json['status'] as String? ?? 'pending',
      priority: (json['priority'] as num?)?.toInt() ?? 0,
      branchName: json['branchName'] as String?,
      worktreePath: json['worktreePath'] as String?,
      runId: json['runId'] as String?,
      errorMessage: json['errorMessage'] as String?,
      summary: json['summary'] as String?,
      createdAt: (json['createdAt'] as num).toDouble(),
      updatedAt: (json['updatedAt'] as num).toDouble(),
      claimedAt: (json['claimedAt'] as num?)?.toDouble(),
      completedAt: (json['completedAt'] as num?)?.toDouble(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'projectId': projectId,
      'title': title,
      'prompt': prompt,
      'tool': tool,
      'status': status,
      'priority': priority,
      if (branchName != null) 'branchName': branchName,
      if (worktreePath != null) 'worktreePath': worktreePath,
      if (runId != null) 'runId': runId,
      if (errorMessage != null) 'errorMessage': errorMessage,
      if (summary != null) 'summary': summary,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
      if (claimedAt != null) 'claimedAt': claimedAt,
      if (completedAt != null) 'completedAt': completedAt,
    };
  }
}

class TaskStep {
  final String id;
  final String taskId;
  final String type;
  final String label;
  final String status;
  final String? detail;
  final String toolName;
  final String? runId;
  final double? durationMs;
  final double createdAt;
  final double? completedAt;

  const TaskStep({
    required this.id,
    required this.taskId,
    required this.type,
    required this.label,
    required this.status,
    this.detail,
    required this.toolName,
    this.runId,
    this.durationMs,
    required this.createdAt,
    this.completedAt,
  });

  factory TaskStep.fromJson(Map<String, dynamic> json) {
    return TaskStep(
      id: json['id'] as String,
      taskId: json['taskId'] as String,
      type: json['type'] as String,
      label: json['label'] as String? ?? '',
      status: json['status'] as String? ?? 'running',
      detail: json['detail'] as String?,
      toolName: json['toolName'] as String? ?? '',
      runId: json['runId'] as String?,
      durationMs: (json['durationMs'] as num?)?.toDouble(),
      createdAt: (json['createdAt'] as num).toDouble(),
      completedAt: (json['completedAt'] as num?)?.toDouble(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'taskId': taskId,
      'type': type,
      'label': label,
      'status': status,
      if (detail != null) 'detail': detail,
      'toolName': toolName,
      if (runId != null) 'runId': runId,
      if (durationMs != null) 'durationMs': durationMs,
      'createdAt': createdAt,
      if (completedAt != null) 'completedAt': completedAt,
    };
  }
}

class TaskMessage {
  final String id;
  final String taskId;
  final String role;
  final String content;
  final double createdAt;

  const TaskMessage({
    required this.id,
    required this.taskId,
    required this.role,
    required this.content,
    required this.createdAt,
  });

  factory TaskMessage.fromJson(Map<String, dynamic> json) {
    return TaskMessage(
      id: json['id'] as String,
      taskId: json['taskId'] as String,
      role: json['role'] as String,
      content: json['content'] as String? ?? '',
      createdAt: (json['createdAt'] as num).toDouble(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'taskId': taskId,
      'role': role,
      'content': content,
      'createdAt': createdAt,
    };
  }
}
