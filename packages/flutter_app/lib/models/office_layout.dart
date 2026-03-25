import 'dart:math';

/// Idle pose assigned to completed sessions.
enum IdlePose { sleeping, phone, coffee }

/// Manages fixed desk positions and idle poses for sessions.
///
/// Positions are assigned on first access and remain stable until removed.
/// Idle poses are randomly assigned on first access.
class OfficeLayout {
  final _deskPositions = <String, int>{};
  final _idlePoses = <String, IdlePose>{};
  final _random = Random();
  int _nextDesk = 0;

  /// Get or assign a desk index for [sessionId].
  int deskFor(String sessionId) {
    return _deskPositions.putIfAbsent(sessionId, () => _nextDesk++);
  }

  /// Get or assign a random idle pose for [sessionId].
  IdlePose idlePoseFor(String sessionId) {
    return _idlePoses.putIfAbsent(
      sessionId,
      () => IdlePose.values[_random.nextInt(IdlePose.values.length)],
    );
  }

  bool hasSession(String sessionId) => _deskPositions.containsKey(sessionId);

  void remove(String sessionId) {
    _deskPositions.remove(sessionId);
    _idlePoses.remove(sessionId);
  }

  /// Sync layout with current session list — remove stale entries.
  void sync(Set<String> activeSessionIds) {
    _deskPositions.removeWhere((id, _) => !activeSessionIds.contains(id));
    _idlePoses.removeWhere((id, _) => !activeSessionIds.contains(id));
  }
}

/// Floor pagination logic.
class FloorPagination {
  static const defaultDesksPerFloor = 8;

  static int floorCount(int sessionCount, [int desksPerFloor = defaultDesksPerFloor]) {
    if (sessionCount <= 0) return 1;
    return (sessionCount / desksPerFloor).ceil();
  }

  static List<T> sessionsForFloor<T>(
    List<T> sessions,
    int floor, [
    int desksPerFloor = defaultDesksPerFloor,
  ]) {
    final start = floor * desksPerFloor;
    if (start >= sessions.length) return [];
    final end = (start + desksPerFloor).clamp(0, sessions.length);
    return sessions.sublist(start, end);
  }

  /// Sort session IDs by display priority.
  static List<String> sortByPriority(
    List<String> sessionIds,
    String Function(String) statusOf,
  ) {
    int priority(String status) {
      switch (status) {
        case 'running':
        case 'starting':
          return 0;
        case 'failed':
        case 'error':
          return 1;
        case 'queued':
        case 'waiting':
        case 'waiting_for_input':
          return 2;
        case 'interrupted':
        case 'cancelled':
          return 3;
        default: // completed, success
          return 4;
      }
    }

    return [...sessionIds]..sort((a, b) {
      return priority(statusOf(a)).compareTo(priority(statusOf(b)));
    });
  }
}
