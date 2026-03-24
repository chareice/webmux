class LlmConfig {
  final String id;
  final String apiBaseUrl;
  final String apiKey;
  final String model;
  final String? projectId;
  final double createdAt;
  final double updatedAt;

  const LlmConfig({
    required this.id,
    required this.apiBaseUrl,
    required this.apiKey,
    required this.model,
    this.projectId,
    required this.createdAt,
    required this.updatedAt,
  });

  factory LlmConfig.fromJson(Map<String, dynamic> json) {
    return LlmConfig(
      id: json['id'] as String,
      apiBaseUrl: json['apiBaseUrl'] as String,
      apiKey: json['apiKey'] as String,
      model: json['model'] as String,
      projectId: json['projectId'] as String?,
      createdAt: (json['createdAt'] as num).toDouble(),
      updatedAt: (json['updatedAt'] as num).toDouble(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'apiBaseUrl': apiBaseUrl,
      'apiKey': apiKey,
      'model': model,
      if (projectId != null) 'projectId': projectId,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
    };
  }
}
