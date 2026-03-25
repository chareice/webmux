import 'package:flutter/material.dart';

import '../app/pixel_theme.dart';
import '../models/office_layout.dart';
import '../models/run.dart';
import 'indoor_floor_view.dart';
import 'park_view.dart';

// ---------------------------------------------------------------------------
// Top-level scene controller — park <-> indoor view switching
// ---------------------------------------------------------------------------

class OfficeSceneV2 extends StatefulWidget {
  const OfficeSceneV2({
    super.key,
    required this.threads,
    this.onThreadTap,
    this.onThreadLongPress,
    this.onAddNew,
    this.onAddNewForProject,
  });

  final List<Run> threads;
  final void Function(Run thread)? onThreadTap;
  final void Function(Run thread)? onThreadLongPress;
  final VoidCallback? onAddNew;
  final void Function(String repoPath)? onAddNewForProject;

  @override
  State<OfficeSceneV2> createState() => _OfficeSceneV2State();
}

class _OfficeSceneV2State extends State<OfficeSceneV2> {
  String? _selectedProject; // null = park view, non-null = indoor view
  int _currentFloor = 0;
  final _layout = OfficeLayout(); // persistent desk/pose assignments

  // -------------------------------------------------------------------------
  // Data pipeline
  // -------------------------------------------------------------------------

  /// Group threads by repoPath. Empty repoPath maps to 'Other'.
  Map<String, List<Run>> _groupByProject() {
    final map = <String, List<Run>>{};
    for (final run in widget.threads) {
      final key = run.repoPath.isNotEmpty ? run.repoPath : 'Other';
      (map[key] ??= []).add(run);
    }
    return map;
  }

  /// Build BuildingData list for the park view.
  List<BuildingData> _buildBuildingList() {
    final groups = _groupByProject();
    final buildings = <BuildingData>[];

    for (final entry in groups.entries) {
      int running = 0;
      int error = 0;
      int idle = 0;

      for (final run in entry.value) {
        if (_isRunning(run.status)) {
          running++;
        } else if (_isError(run.status)) {
          error++;
        } else {
          idle++;
        }
      }

      buildings.add(BuildingData(
        projectName: _projectName(entry.key),
        repoPath: entry.key,
        runningCount: running,
        errorCount: error,
        idleCount: idle,
        totalCount: entry.value.length,
      ));
    }

    // Sort: active first, then errors, then by total count descending
    buildings.sort((a, b) {
      if (a.hasActiveWork != b.hasActiveWork) {
        return a.hasActiveWork ? -1 : 1;
      }
      if (a.hasErrors != b.hasErrors) {
        return a.hasErrors ? -1 : 1;
      }
      return b.totalCount.compareTo(a.totalCount);
    });

    return buildings;
  }

  /// Build DeskSlot list for indoor view of the selected project.
  List<DeskSlot> _buildDeskSlots(List<Run> runs) {
    // Map session IDs -> runs for quick lookup
    final runMap = <String, Run>{};
    for (final run in runs) {
      runMap[run.id] = run;
    }

    // Sort by priority
    final sortedIds = FloorPagination.sortByPriority(
      runs.map((r) => r.id).toList(),
      (id) => runMap[id]!.status,
    );

    // Get sessions for current floor
    final floorIds = FloorPagination.sessionsForFloor(sortedIds, _currentFloor);

    // Sync layout to remove stale sessions
    _layout.sync(runs.map((r) => r.id).toSet());

    // Create DeskSlot for each
    return floorIds.map((id) {
      final run = runMap[id]!;
      final idle = _isIdle(run.status);
      // Ensure desk position is assigned
      _layout.deskFor(id);
      return DeskSlot(
        sessionId: id,
        status: run.status,
        label: _labelFor(run),
        idlePose: idle ? _layout.idlePoseFor(id) : null,
      );
    }).toList();
  }

  // -------------------------------------------------------------------------
  // View switching
  // -------------------------------------------------------------------------

  void _enterBuilding(String repoPath) {
    setState(() {
      _selectedProject = repoPath;
      _currentFloor = 0;
    });
  }

  void _exitToPark() {
    setState(() {
      _selectedProject = null;
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  static String _projectName(String repoPath) {
    if (repoPath == 'Other') return 'Other';
    final parts = repoPath.split('/').where((p) => p.isNotEmpty).toList();
    return parts.isNotEmpty ? parts.last : repoPath;
  }

  static String _labelFor(Run run) {
    final raw = run.summary ?? run.prompt;
    if (raw.length <= 30) return raw;
    return '${raw.substring(0, 27)}...';
  }

  static bool _isIdle(String status) {
    return status == 'completed' || status == 'success';
  }

  static bool _isRunning(String status) {
    return status == 'running' || status == 'starting';
  }

  static bool _isError(String status) {
    return status == 'failed' || status == 'error';
  }

  Run? _findRun(String sessionId) {
    for (final run in widget.threads) {
      if (run.id == sessionId) return run;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Build
  // -------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    if (_selectedProject != null) {
      return _buildIndoorView();
    }
    return _buildParkView();
  }

  Widget _buildParkView() {
    final buildings = _buildBuildingList();
    return Column(
      children: [
        Expanded(
          child: ParkView(
            buildings: buildings,
            onBuildingTap: _enterBuilding,
          ),
        ),
        _ActionBar(
          onAddNew: widget.onAddNew,
          threadCount: widget.threads.length,
        ),
      ],
    );
  }

  Widget _buildIndoorView() {
    final groups = _groupByProject();
    final projectRuns = groups[_selectedProject] ?? [];
    final desks = _buildDeskSlots(projectRuns);
    final totalFloors = FloorPagination.floorCount(projectRuns.length);

    // Clamp current floor in case threads were removed
    if (_currentFloor >= totalFloors) {
      _currentFloor = (totalFloors - 1).clamp(0, totalFloors);
    }

    return IndoorFloorView(
      desks: desks,
      projectName: _projectName(_selectedProject!),
      floorIndex: _currentFloor,
      floorCount: totalFloors,
      onDeskTap: (sessionId) {
        final run = _findRun(sessionId);
        if (run != null) widget.onThreadTap?.call(run);
      },
      onDeskLongPress: (sessionId) {
        final run = _findRun(sessionId);
        if (run != null) widget.onThreadLongPress?.call(run);
      },
      onEmptyDeskTap: widget.onAddNewForProject != null
          ? () => widget.onAddNewForProject!(_selectedProject!)
          : null,
      onFloorChange: (floor) {
        setState(() {
          _currentFloor = floor;
        });
      },
      onBack: _exitToPark,
    );
  }
}

// ---------------------------------------------------------------------------
// Bottom action bar (park view only) — copied from office_scene.dart
// ---------------------------------------------------------------------------

class _ActionBar extends StatelessWidget {
  const _ActionBar({this.onAddNew, required this.threadCount});

  final VoidCallback? onAddNew;
  final int threadCount;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: PixelTheme.furnitureDark,
        border: Border(top: BorderSide(color: PixelTheme.furniture, width: 3)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(
            children: [
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: PixelTheme.furniture,
                  border:
                      Border.all(color: PixelTheme.furnitureLight, width: 1),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.smart_toy_rounded,
                        size: 14, color: Color(0xFFB0B8C8)),
                    const SizedBox(width: 4),
                    Text(
                      '$threadCount',
                      style: const TextStyle(
                        color: Color(0xFFE8D5B5),
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
              const Spacer(),
              // Pixel game button with 3D depth effect
              GestureDetector(
                onTap: onAddNew,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  decoration: const BoxDecoration(
                    color: Color(0xFF5B8C3E), // green like Stardew buttons
                    border: Border(
                      top: BorderSide(
                          color: Color(0xFF7DB356), width: 2), // highlight
                      left: BorderSide(color: Color(0xFF7DB356), width: 2),
                      right: BorderSide(
                          color: Color(0xFF3D6B28), width: 2), // shadow
                      bottom: BorderSide(
                          color: Color(0xFF3D6B28),
                          width: 3), // thick bottom shadow
                    ),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '+',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      SizedBox(width: 6),
                      Text(
                        'New Session',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
