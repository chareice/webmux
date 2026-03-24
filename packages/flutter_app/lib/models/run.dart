/// Represents a thread/run in the Webmux system.
class Run {
  final String id;
  final String agentId;
  final String tool;
  final String repoPath;
  final String branch;
  final String prompt;
  final String status;
  final double createdAt;
  final double updatedAt;
  final String? summary;
  final bool hasDiff;
  final bool unread;

  const Run({
    required this.id,
    required this.agentId,
    required this.tool,
    required this.repoPath,
    required this.branch,
    required this.prompt,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    this.summary,
    required this.hasDiff,
    required this.unread,
  });

  factory Run.fromJson(Map<String, dynamic> json) {
    return Run(
      id: json['id'] as String,
      agentId: json['agentId'] as String,
      tool: json['tool'] as String,
      repoPath: json['repoPath'] as String,
      branch: json['branch'] as String? ?? '',
      prompt: json['prompt'] as String,
      status: json['status'] as String,
      createdAt: (json['createdAt'] as num).toDouble(),
      updatedAt: (json['updatedAt'] as num).toDouble(),
      summary: json['summary'] as String?,
      hasDiff: json['hasDiff'] as bool? ?? false,
      unread: json['unread'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'agentId': agentId,
      'tool': tool,
      'repoPath': repoPath,
      'branch': branch,
      'prompt': prompt,
      'status': status,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
      if (summary != null) 'summary': summary,
      'hasDiff': hasDiff,
      'unread': unread,
    };
  }
}

/// Image attachment metadata (returned from server).
class RunImageAttachment {
  final String id;
  final String name;
  final String mimeType;
  final int sizeBytes;

  const RunImageAttachment({
    required this.id,
    required this.name,
    required this.mimeType,
    required this.sizeBytes,
  });

  factory RunImageAttachment.fromJson(Map<String, dynamic> json) {
    return RunImageAttachment(
      id: json['id'] as String,
      name: json['name'] as String,
      mimeType: json['mimeType'] as String,
      sizeBytes: (json['sizeBytes'] as num).toInt(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'mimeType': mimeType,
      'sizeBytes': sizeBytes,
    };
  }
}

/// Image attachment with base64 data for uploads.
class RunImageAttachmentUpload {
  final String id;
  final String name;
  final String mimeType;
  final int sizeBytes;
  final String base64;

  const RunImageAttachmentUpload({
    required this.id,
    required this.name,
    required this.mimeType,
    required this.sizeBytes,
    required this.base64,
  });

  factory RunImageAttachmentUpload.fromJson(Map<String, dynamic> json) {
    return RunImageAttachmentUpload(
      id: json['id'] as String,
      name: json['name'] as String,
      mimeType: json['mimeType'] as String,
      sizeBytes: (json['sizeBytes'] as num).toInt(),
      base64: json['base64'] as String,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'mimeType': mimeType,
      'sizeBytes': sizeBytes,
      'base64': base64,
    };
  }
}

/// A single turn within a run.
class RunTurn {
  final String id;
  final String runId;
  final int index;
  final String prompt;
  final List<RunImageAttachment> attachments;
  final String status;
  final double createdAt;
  final double updatedAt;
  final String? summary;
  final bool hasDiff;

  const RunTurn({
    required this.id,
    required this.runId,
    required this.index,
    required this.prompt,
    required this.attachments,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    this.summary,
    required this.hasDiff,
  });

  factory RunTurn.fromJson(Map<String, dynamic> json) {
    return RunTurn(
      id: json['id'] as String,
      runId: json['runId'] as String,
      index: (json['index'] as num).toInt(),
      prompt: json['prompt'] as String,
      attachments: (json['attachments'] as List<dynamic>?)
              ?.map((e) =>
                  RunImageAttachment.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      status: json['status'] as String,
      createdAt: (json['createdAt'] as num).toDouble(),
      updatedAt: (json['updatedAt'] as num).toDouble(),
      summary: json['summary'] as String?,
      hasDiff: json['hasDiff'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'runId': runId,
      'index': index,
      'prompt': prompt,
      'attachments': attachments.map((e) => e.toJson()).toList(),
      'status': status,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
      if (summary != null) 'summary': summary,
      'hasDiff': hasDiff,
    };
  }
}

/// A timeline event within a turn.
class RunTimelineEvent {
  final int id;
  final String type;
  final double createdAt;

  // Fields for 'message' type
  final String? role;
  final String? text;

  // Fields for 'command' type
  final String? commandStatus;
  final String? command;
  final String? output;
  final int? exitCode;

  // Fields for 'activity' type
  final String? activityStatus;
  final String? label;
  final String? detail;

  // Fields for 'todo' type
  final List<TodoEntry>? items;

  const RunTimelineEvent({
    required this.id,
    required this.type,
    required this.createdAt,
    this.role,
    this.text,
    this.commandStatus,
    this.command,
    this.output,
    this.exitCode,
    this.activityStatus,
    this.label,
    this.detail,
    this.items,
  });

  factory RunTimelineEvent.fromJson(Map<String, dynamic> json) {
    final type = json['type'] as String;
    return RunTimelineEvent(
      id: (json['id'] as num).toInt(),
      type: type,
      createdAt: (json['createdAt'] as num).toDouble(),
      role: json['role'] as String?,
      text: json['text'] as String?,
      commandStatus: type == 'command' ? json['status'] as String? : null,
      command: json['command'] as String?,
      output: json['output'] as String?,
      exitCode: (json['exitCode'] as num?)?.toInt(),
      activityStatus: type == 'activity' ? json['status'] as String? : null,
      label: json['label'] as String?,
      detail: json['detail'] as String?,
      items: (json['items'] as List<dynamic>?)
          ?.map((e) => TodoEntry.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{
      'id': id,
      'type': type,
      'createdAt': createdAt,
    };
    switch (type) {
      case 'message':
        if (role != null) map['role'] = role;
        if (text != null) map['text'] = text;
        break;
      case 'command':
        if (commandStatus != null) map['status'] = commandStatus;
        if (command != null) map['command'] = command;
        if (output != null) map['output'] = output;
        if (exitCode != null) map['exitCode'] = exitCode;
        break;
      case 'activity':
        if (activityStatus != null) map['status'] = activityStatus;
        if (label != null) map['label'] = label;
        if (detail != null) map['detail'] = detail;
        break;
      case 'todo':
        if (items != null) {
          map['items'] = items!.map((e) => e.toJson()).toList();
        }
        break;
    }
    return map;
  }
}

/// A todo entry within a 'todo' timeline event.
class TodoEntry {
  final String text;
  final String status;

  const TodoEntry({
    required this.text,
    required this.status,
  });

  factory TodoEntry.fromJson(Map<String, dynamic> json) {
    return TodoEntry(
      text: json['text'] as String,
      status: json['status'] as String? ?? 'pending',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'text': text,
      'status': status,
    };
  }
}

/// A turn with its timeline items included.
class RunTurnDetail {
  final String id;
  final String runId;
  final int index;
  final String prompt;
  final List<RunImageAttachment> attachments;
  final String status;
  final double createdAt;
  final double updatedAt;
  final String? summary;
  final bool hasDiff;
  final List<RunTimelineEvent> items;

  const RunTurnDetail({
    required this.id,
    required this.runId,
    required this.index,
    required this.prompt,
    required this.attachments,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    this.summary,
    required this.hasDiff,
    required this.items,
  });

  factory RunTurnDetail.fromJson(Map<String, dynamic> json) {
    return RunTurnDetail(
      id: json['id'] as String,
      runId: json['runId'] as String,
      index: (json['index'] as num).toInt(),
      prompt: json['prompt'] as String,
      attachments: (json['attachments'] as List<dynamic>?)
              ?.map((e) =>
                  RunImageAttachment.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      status: json['status'] as String,
      createdAt: (json['createdAt'] as num).toDouble(),
      updatedAt: (json['updatedAt'] as num).toDouble(),
      summary: json['summary'] as String?,
      hasDiff: json['hasDiff'] as bool? ?? false,
      items: (json['items'] as List<dynamic>?)
              ?.map((e) =>
                  RunTimelineEvent.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'runId': runId,
      'index': index,
      'prompt': prompt,
      'attachments': attachments.map((e) => e.toJson()).toList(),
      'status': status,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
      if (summary != null) 'summary': summary,
      'hasDiff': hasDiff,
      'items': items.map((e) => e.toJson()).toList(),
    };
  }
}
