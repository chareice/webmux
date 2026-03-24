import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../../app/theme.dart';
import '../../models/agent.dart';
import '../../models/run.dart';
import '../../providers/api_provider.dart';
import '../../widgets/status_card.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  List<Run> _threads = [];
  Map<String, AgentInfo> _agentsMap = {};
  bool _loading = true;
  String? _error;

  // Timer for updating running durations.
  Timer? _durationTimer;

  @override
  void initState() {
    super.initState();
    _loadData();
    // Tick every second to update running durations.
    _durationTimer = Timer.periodic(
      const Duration(seconds: 1),
      (_) {
        if (_runningThreads.isNotEmpty && mounted) {
          setState(() {});
        }
      },
    );
  }

  @override
  void dispose() {
    _durationTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final api = ref.read(apiClientProvider);
      final results = await Future.wait([
        api.listAllThreads(),
        api.listAgents(),
      ]);

      final threads = results[0] as List<Run>;
      final agents = results[1] as List<AgentInfo>;

      if (!mounted) return;

      setState(() {
        _threads = threads;
        _agentsMap = {for (final a in agents) a.id: a};
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  // -- Categorized thread lists --

  List<Run> get _attentionThreads => _threads
      .where((t) =>
          t.status == 'waiting' ||
          t.status == 'waiting_for_input' ||
          t.status == 'failed' ||
          t.status == 'error')
      .toList();

  List<Run> get _runningThreads => _threads
      .where((t) => t.status == 'running' || t.status == 'starting')
      .toList();

  List<Run> get _recentThreads => _threads
      .where((t) =>
          t.status == 'completed' ||
          t.status == 'interrupted' ||
          t.status == 'cancelled')
      .take(20)
      .toList();

  String _agentName(String agentId) {
    return _agentsMap[agentId]?.name ?? agentId;
  }

  String _threadSummary(Run thread) {
    if (thread.summary != null && thread.summary!.isNotEmpty) {
      return thread.summary!;
    }
    return thread.prompt;
  }

  String _repoName(Run thread) {
    final path = thread.repoPath;
    if (path.isEmpty) return '';
    // Extract last path segment as project name.
    final segments = path.split('/');
    return segments.last;
  }

  String _runningDuration(Run thread) {
    final startMs = (thread.createdAt * 1000).toInt();
    final start = DateTime.fromMillisecondsSinceEpoch(startMs);
    final elapsed = DateTime.now().difference(start);

    if (elapsed.inHours > 0) {
      final m = elapsed.inMinutes.remainder(60);
      return '${elapsed.inHours}h ${m.toString().padLeft(2, '0')}m';
    }
    if (elapsed.inMinutes > 0) {
      final s = elapsed.inSeconds.remainder(60);
      return '${elapsed.inMinutes}m ${s.toString().padLeft(2, '0')}s';
    }
    return '${elapsed.inSeconds}s';
  }

  String _timeAgo(Run thread) {
    final updatedMs = (thread.updatedAt * 1000).toInt();
    final dt = DateTime.fromMillisecondsSinceEpoch(updatedMs);
    return timeago.format(dt, locale: 'en_short');
  }

  void _openThread(Run thread) {
    context.push('/threads/${thread.agentId}/${thread.id}');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard'),
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading && _threads.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null && _threads.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Failed to load',
              style: TextStyle(
                color: Theme.of(context).colorScheme.onSurface,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _error!,
              style: const TextStyle(color: WebmuxTheme.subtext, fontSize: 12),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            TextButton(
              onPressed: _loadData,
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    final attention = _attentionThreads;
    final running = _runningThreads;
    final recent = _recentThreads;

    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          // -- Attention section --
          if (attention.isNotEmpty) ...[
            _SectionHeader(
              title: 'Needs Attention',
              count: attention.length,
              countColor: WebmuxTheme.statusFailed,
            ),
            const SizedBox(height: 6),
            ...attention.map((t) => Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: AttentionCard(
                    status: t.status,
                    agentName: _agentName(t.agentId),
                    summary: _threadSummary(t),
                    onTap: () => _openThread(t),
                    actions: _buildAttentionActions(t),
                  ),
                )),
            const SizedBox(height: 12),
          ],

          // -- Active/Running section --
          _SectionHeader(
            title: 'Running',
            count: running.length,
            countColor: WebmuxTheme.statusRunning,
          ),
          const SizedBox(height: 6),
          if (running.isEmpty)
            const Padding(
              padding: EdgeInsets.only(bottom: 6),
              child: Text(
                'No active runs',
                style: TextStyle(color: WebmuxTheme.subtext, fontSize: 13),
              ),
            )
          else
            ...running.map((t) => Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: ActiveCard(
                    agentName: _agentName(t.agentId),
                    projectName: _repoName(t),
                    duration: _runningDuration(t),
                    latestOutput: _threadSummary(t),
                    onTap: () => _openThread(t),
                  ),
                )),
          const SizedBox(height: 12),

          // -- Recent section --
          _SectionHeader(
            title: 'Recent',
            count: recent.length,
          ),
          const SizedBox(height: 6),
          if (recent.isEmpty)
            const Padding(
              padding: EdgeInsets.only(bottom: 6),
              child: Text(
                'No recent threads',
                style: TextStyle(color: WebmuxTheme.subtext, fontSize: 13),
              ),
            )
          else
            ...recent.map((t) => Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: RecentCard(
                    status: t.status,
                    summary: _threadSummary(t),
                    timeAgo: _timeAgo(t),
                    onTap: () => _openThread(t),
                  ),
                )),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  List<Widget> _buildAttentionActions(Run thread) {
    if (thread.status == 'waiting' || thread.status == 'waiting_for_input') {
      return [
        _CompactActionButton(
          label: 'Reply',
          icon: Icons.reply_rounded,
          onPressed: () => _openThread(thread),
        ),
      ];
    }

    if (thread.status == 'failed' || thread.status == 'error') {
      return [
        _CompactActionButton(
          label: 'Open',
          icon: Icons.open_in_new_rounded,
          onPressed: () => _openThread(thread),
        ),
      ];
    }

    return [];
  }
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.title,
    this.count,
    this.countColor,
  });

  final String title;
  final int? count;
  final Color? countColor;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          title,
          style: TextStyle(
            color: Theme.of(context).colorScheme.onSurface,
            fontSize: 14,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.3,
          ),
        ),
        if (count != null) ...[
          const SizedBox(width: 6),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
            decoration: BoxDecoration(
              color: (countColor ?? WebmuxTheme.subtext).withOpacity(0.15),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(
              count.toString(),
              style: TextStyle(
                color: countColor ?? WebmuxTheme.subtext,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Compact action button for attention cards
// ---------------------------------------------------------------------------

class _CompactActionButton extends StatelessWidget {
  const _CompactActionButton({
    required this.label,
    required this.icon,
    required this.onPressed,
  });

  final String label;
  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 28,
      child: TextButton.icon(
        onPressed: onPressed,
        icon: Icon(icon, size: 14),
        label: Text(label, style: const TextStyle(fontSize: 12)),
        style: TextButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 8),
          minimumSize: Size.zero,
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          foregroundColor: Theme.of(context).colorScheme.primary,
        ),
      ),
    );
  }
}
