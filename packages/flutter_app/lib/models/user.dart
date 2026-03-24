class User {
  final String id;
  final String displayName;
  final String? avatarUrl;
  final String role;

  const User({
    required this.id,
    required this.displayName,
    this.avatarUrl,
    required this.role,
  });

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'] as String,
      displayName: json['displayName'] as String,
      avatarUrl: json['avatarUrl'] as String?,
      role: json['role'] as String? ?? 'user',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'displayName': displayName,
      if (avatarUrl != null) 'avatarUrl': avatarUrl,
      'role': role,
    };
  }
}
