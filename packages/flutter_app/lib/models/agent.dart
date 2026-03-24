class AgentInfo {
  final String id;
  final String name;
  final String status;
  final double? lastSeenAt;

  const AgentInfo({
    required this.id,
    required this.name,
    required this.status,
    this.lastSeenAt,
  });

  factory AgentInfo.fromJson(Map<String, dynamic> json) {
    return AgentInfo(
      id: json['id'] as String,
      name: json['name'] as String,
      status: json['status'] as String? ?? 'offline',
      lastSeenAt: (json['lastSeenAt'] as num?)?.toDouble(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'status': status,
      if (lastSeenAt != null) 'lastSeenAt': lastSeenAt,
    };
  }
}
