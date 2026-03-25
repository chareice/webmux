import 'package:flutter_test/flutter_test.dart';
import 'package:webmux/models/office_layout.dart';

void main() {
  group('OfficeLayout', () {
    test('assigns desk positions to sessions', () {
      final layout = OfficeLayout();
      final pos1 = layout.deskFor('session-1');
      final pos2 = layout.deskFor('session-2');
      expect(pos1, isNotNull);
      expect(pos2, isNotNull);
      expect(pos1, isNot(equals(pos2)));
    });

    test('returns same position for same session', () {
      final layout = OfficeLayout();
      final pos1 = layout.deskFor('session-1');
      final pos2 = layout.deskFor('session-1');
      expect(pos1, equals(pos2));
    });

    test('removes session and frees desk', () {
      final layout = OfficeLayout();
      layout.deskFor('session-1');
      layout.remove('session-1');
      expect(layout.hasSession('session-1'), isFalse);
    });

    test('assigns random idle pose for completed status', () {
      final layout = OfficeLayout();
      final pose = layout.idlePoseFor('session-1');
      expect(IdlePose.values, contains(pose));
    });

    test('returns same idle pose for same session', () {
      final layout = OfficeLayout();
      final pose1 = layout.idlePoseFor('session-1');
      final pose2 = layout.idlePoseFor('session-1');
      expect(pose1, equals(pose2));
    });

    test('sync removes stale sessions', () {
      final layout = OfficeLayout();
      layout.deskFor('session-1');
      layout.deskFor('session-2');
      layout.deskFor('session-3');
      layout.sync({'session-1', 'session-3'});
      expect(layout.hasSession('session-1'), isTrue);
      expect(layout.hasSession('session-2'), isFalse);
      expect(layout.hasSession('session-3'), isTrue);
    });
  });

  group('FloorPagination', () {
    test('calculates floor count', () {
      expect(FloorPagination.floorCount(10, 8), equals(2));
      expect(FloorPagination.floorCount(8, 8), equals(1));
      expect(FloorPagination.floorCount(0, 8), equals(1));
      expect(FloorPagination.floorCount(1, 8), equals(1));
      expect(FloorPagination.floorCount(9, 8), equals(2));
    });

    test('returns sessions for a given floor', () {
      final sessions = List.generate(10, (i) => 'session-$i');
      final floor0 = FloorPagination.sessionsForFloor(sessions, 0, 8);
      final floor1 = FloorPagination.sessionsForFloor(sessions, 1, 8);
      expect(floor0.length, equals(8));
      expect(floor1.length, equals(2));
    });

    test('returns empty list for out-of-range floor', () {
      final sessions = List.generate(5, (i) => 'session-$i');
      final result = FloorPagination.sessionsForFloor(sessions, 5, 8);
      expect(result, isEmpty);
    });

    test('sorts by priority: running > error > queued > completed', () {
      final statuses = {
        's1': 'completed',
        's2': 'running',
        's3': 'failed',
        's4': 'queued',
        's5': 'completed',
      };
      final sorted = FloorPagination.sortByPriority(
        statuses.keys.toList(),
        (id) => statuses[id]!,
      );
      expect(sorted[0], equals('s2')); // running first
      expect(sorted[1], equals('s3')); // failed second
      expect(sorted[2], equals('s4')); // queued third
      // s1 and s5 are both completed, order among them doesn't matter
    });
  });
}
