import 'package:flutter/material.dart';

import '../app/pixel_theme.dart';
import '../models/run.dart';
import 'workstation.dart';

/// Each project is displayed as an independent "office room" building.
/// All rooms scroll vertically on a grass-colored outdoor background.
class OfficeScene extends StatelessWidget {
  const OfficeScene({
    super.key,
    required this.threads,
    this.onThreadTap,
    this.onThreadLongPress,
    this.onAddNew,
  });

  final List<Run> threads;
  final void Function(Run thread)? onThreadTap;
  final void Function(Run thread)? onThreadLongPress;
  final VoidCallback? onAddNew;

  Map<String, List<Run>> _groupByProject() {
    final map = <String, List<Run>>{};
    for (final run in threads) {
      final key = run.repoPath.isNotEmpty ? run.repoPath : 'Other';
      (map[key] ??= []).add(run);
    }
    return map;
  }

  static String _projectName(String repoPath) {
    if (repoPath == 'Other') return 'Other';
    final parts = repoPath.split('/').where((p) => p.isNotEmpty).toList();
    return parts.isNotEmpty ? parts.last : repoPath;
  }

  static String _labelFor(Run run) {
    final raw = run.summary ?? run.prompt;
    if (raw.length <= 40) return raw;
    return '${raw.substring(0, 37)}...';
  }

  @override
  Widget build(BuildContext context) {
    final groups = _groupByProject();

    return Column(
      children: [
        Expanded(
          child: Container(
            color: const Color(0xFF6B8E5A), // grass between buildings
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final entry in groups.entries) ...[
                    _OfficeRoom(
                      projectName: _projectName(entry.key),
                      runs: entry.value,
                      onThreadTap: onThreadTap,
                      onThreadLongPress: onThreadLongPress,
                      labelFor: _labelFor,
                    ),
                    const SizedBox(height: 14),
                  ],
                  const SizedBox(height: 20),
                ],
              ),
            ),
          ),
        ),
        _ActionBar(onAddNew: onAddNew, threadCount: threads.length),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Office room — one self-contained building per project
// ---------------------------------------------------------------------------

class _OfficeRoom extends StatelessWidget {
  const _OfficeRoom({
    required this.projectName,
    required this.runs,
    required this.onThreadTap,
    required this.onThreadLongPress,
    required this.labelFor,
  });

  final String projectName;
  final List<Run> runs;
  final void Function(Run)? onThreadTap;
  final void Function(Run)? onThreadLongPress;
  final String Function(Run) labelFor;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Roof
        Container(
          height: 8,
          decoration: const BoxDecoration(
            color: Color(0xFF8B4513),
            border: Border(
              top: BorderSide(color: Color(0xFFA0522D), width: 2),
            ),
          ),
        ),
        // Wall with room name sign + windows
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: const BoxDecoration(
            color: PixelTheme.wall,
            border: Border.symmetric(
              vertical: BorderSide(color: PixelTheme.wallAccent, width: 3),
            ),
          ),
          child: Row(
            children: [
              // Door
              Container(
                width: 14,
                height: 18,
                decoration: BoxDecoration(
                  color: PixelTheme.furniture,
                  border: Border.all(color: PixelTheme.furnitureDark, width: 1),
                ),
                child: const Align(
                  alignment: Alignment(0.5, 0),
                  child: CircleAvatar(
                      radius: 1.5, backgroundColor: PixelTheme.rugWarm),
                ),
              ),
              const SizedBox(width: 8),
              // Room name sign
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: PixelTheme.furnitureDark,
                  border: Border.all(color: PixelTheme.furniture, width: 1),
                ),
                child: Text(
                  projectName,
                  style: const TextStyle(
                    color: Color(0xFFE8D5B5),
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 0.5,
                  ),
                ),
              ),
              const Spacer(),
              // Windows
              _MiniWindow(),
              const SizedBox(width: 4),
              _MiniWindow(),
            ],
          ),
        ),
        // Floor area with workstations
        Container(
          decoration: const BoxDecoration(
            color: PixelTheme.floorLight,
            border: Border.symmetric(
              vertical: BorderSide(color: PixelTheme.furniture, width: 3),
            ),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
          child: _CubicleGrid(
            runs: runs,
            onThreadTap: onThreadTap,
            onThreadLongPress: onThreadLongPress,
            labelFor: labelFor,
          ),
        ),
        // Baseboard
        Container(
          height: 4,
          decoration: const BoxDecoration(
            color: PixelTheme.furnitureDark,
            border: Border(
              bottom: BorderSide(color: Color(0xFF3A2010), width: 1),
            ),
          ),
        ),
      ],
    );
  }
}

class _MiniWindow extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      width: 16,
      height: 14,
      decoration: BoxDecoration(
        color: PixelTheme.windowBlue,
        border: Border.all(color: PixelTheme.furniture, width: 2),
      ),
      child: Center(
        child: Container(width: 1, height: 10, color: PixelTheme.furniture),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Cubicle grid — workstations separated by wooden divider walls
// ---------------------------------------------------------------------------

class _CubicleGrid extends StatelessWidget {
  const _CubicleGrid({
    required this.runs,
    required this.onThreadTap,
    required this.onThreadLongPress,
    required this.labelFor,
  });

  final List<Run> runs;
  final void Function(Run)? onThreadTap;
  final void Function(Run)? onThreadLongPress;
  final String Function(Run) labelFor;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        const cubicleWidth = 88.0;
        const dividerWidth = 3.0;
        final cols =
            ((constraints.maxWidth + dividerWidth) / (cubicleWidth + dividerWidth))
                .floor()
                .clamp(2, 6);

        final rows = <Widget>[];
        for (var i = 0; i < runs.length; i += cols) {
          final rowRuns = runs.sublist(i, (i + cols).clamp(0, runs.length));
          if (i > 0) {
            rows.add(const _WoodDivider(horizontal: true));
          }
          rows.add(
            IntrinsicHeight(
              child: Row(
                children: [
                  for (var j = 0; j < rowRuns.length; j++) ...[
                    if (j > 0) const _WoodDivider(horizontal: false),
                    Expanded(
                      child: Workstation(
                        label: labelFor(rowRuns[j]),
                        status: rowRuns[j].status,
                        onTap: onThreadTap == null
                            ? null
                            : () => onThreadTap!(rowRuns[j]),
                        onLongPress: onThreadLongPress == null
                            ? null
                            : () => onThreadLongPress!(rowRuns[j]),
                      ),
                    ),
                  ],
                  for (var j = rowRuns.length; j < cols; j++) ...[
                    const _WoodDivider(horizontal: false),
                    const Expanded(child: SizedBox()),
                  ],
                ],
              ),
            ),
          );
        }

        return Column(
          mainAxisSize: MainAxisSize.min,
          children: rows,
        );
      },
    );
  }
}

class _WoodDivider extends StatelessWidget {
  const _WoodDivider({required this.horizontal});
  final bool horizontal;

  @override
  Widget build(BuildContext context) {
    if (horizontal) {
      return Container(
        height: 3,
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              PixelTheme.furnitureLight,
              PixelTheme.furniture,
              PixelTheme.furnitureDark,
            ],
          ),
        ),
      );
    }
    return Container(
      width: 3,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
          colors: [
            PixelTheme.furnitureLight,
            PixelTheme.furniture,
            PixelTheme.furnitureDark,
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Bottom action bar
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
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
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
              InkWell(
                onTap: onAddNew,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                  decoration: BoxDecoration(
                    color: const Color(0xFF4A90D9),
                    border:
                        Border.all(color: const Color(0xFF6AB0FF), width: 2),
                    boxShadow: const [
                      BoxShadow(color: Color(0xFF2A5090), offset: Offset(0, 2)),
                    ],
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.add_rounded, size: 16, color: Colors.white),
                      SizedBox(width: 4),
                      Text(
                        'New Session',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 0.5,
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
