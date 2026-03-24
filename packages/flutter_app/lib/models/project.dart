class Project {
  final String id;
  final String name;
  final String description;
  final String repoPath;
  final String agentId;
  final String defaultTool;
  final double createdAt;
  final double updatedAt;

  const Project({
    required this.id,
    required this.name,
    required this.description,
    required this.repoPath,
    required this.agentId,
    required this.defaultTool,
    required this.createdAt,
    required this.updatedAt,
  });

  factory Project.fromJson(Map<String, dynamic> json) {
    return Project(
      id: json['id'] as String,
      name: json['name'] as String,
      description: json['description'] as String? ?? '',
      repoPath: json['repoPath'] as String,
      agentId: json['agentId'] as String,
      defaultTool: json['defaultTool'] as String? ?? 'claude',
      createdAt: (json['createdAt'] as num).toDouble(),
      updatedAt: (json['updatedAt'] as num).toDouble(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'description': description,
      'repoPath': repoPath,
      'agentId': agentId,
      'defaultTool': defaultTool,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
    };
  }
}

class ProjectAction {
  final String id;
  final String projectId;
  final String name;
  final String description;
  final String prompt;
  final String tool;
  final int sortOrder;
  final double createdAt;
  final double updatedAt;

  const ProjectAction({
    required this.id,
    required this.projectId,
    required this.name,
    required this.description,
    required this.prompt,
    required this.tool,
    required this.sortOrder,
    required this.createdAt,
    required this.updatedAt,
  });

  factory ProjectAction.fromJson(Map<String, dynamic> json) {
    return ProjectAction(
      id: json['id'] as String,
      projectId: json['projectId'] as String,
      name: json['name'] as String,
      description: json['description'] as String? ?? '',
      prompt: json['prompt'] as String,
      tool: json['tool'] as String? ?? 'claude',
      sortOrder: (json['sortOrder'] as num?)?.toInt() ?? 0,
      createdAt: (json['createdAt'] as num).toDouble(),
      updatedAt: (json['updatedAt'] as num).toDouble(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'projectId': projectId,
      'name': name,
      'description': description,
      'prompt': prompt,
      'tool': tool,
      'sortOrder': sortOrder,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
    };
  }
}
