import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/pixel_theme.dart';
import '../../app/theme.dart';
import '../../models/run.dart';
import '../../services/websocket_service.dart';
import '../../providers/api_provider.dart';
import '../../widgets/pixel_sprite.dart';
import '../../widgets/status_indicator.dart';
import '../../widgets/message_bubble.dart';
import '../../widgets/code_block.dart';
import 'composer.dart';

class ThreadDetailScreen extends ConsumerStatefulWidget {
  const ThreadDetailScreen({
    super.key,
    required this.agentId,
    required this.threadId,
  });

  final String agentId;
  final String threadId;

  @override
  ConsumerState<ThreadDetailScreen> createState() =>
      _ThreadDetailScreenState();
}

class _ThreadDetailScreenState extends ConsumerState<ThreadDetailScreen> {
  Run? _run;
  List<RunTurnDetail> _turns = [];
  bool _loading = true;
  String? _error;

  final ScrollController _scrollController = ScrollController();
  bool _userScrolledUp = false;
  bool _autoScrollEnabled = true;

  late WebSocketService _wsService;
  StreamSubscription<RunEvent>? _wsSubscription;

  // Throttle WebSocket-driven rebuilds to avoid jank on large threads.
  Timer? _throttleTimer;
  bool _hasPendingUpdate = false;
  // Cache the flat display-item list; only recompute when _turns change.
  List<_DisplayItem>? _cachedDisplayItems;
  int _lastTurnsVersion = 0;
  int _turnsVersion = 0;

  // Pagination: only show the last _visibleCount items initially.
  static const int _pageSize = 100;
  int _visibleCount = _pageSize;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    // Defer so that ref is available.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadData();
      _connectWebSocket();
    });
  }

  @override
  void dispose() {
    _wsSubscription?.cancel();
    _wsService.disconnect();
    _throttleTimer?.cancel();
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    // In a reversed ListView, offset 0 is the bottom (newest).
    // "Scrolled up" means offset > 100 (viewing older messages).
    _userScrolledUp = _scrollController.offset > 100;
    _autoScrollEnabled = !_userScrolledUp;
  }

  void _scrollToBottom({bool animate = true}) {
    if (!_scrollController.hasClients) return;
    // In a reversed ListView, bottom is offset 0.
    if (animate) {
      _scrollController.animateTo(
        0,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    } else {
      _scrollController.jumpTo(0);
    }
  }

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final detail =
          await api.getThreadDetail(widget.agentId, widget.threadId);
      if (!mounted) return;
      setState(() {
        _run = detail.run;
        _turns = detail.turns;
        _turnsVersion++;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  // -------------------------------------------------------------------------
  // WebSocket
  // -------------------------------------------------------------------------

  void _connectWebSocket() {
    _wsService = ref.read(webSocketServiceProvider);
    final stream = _wsService.connectThread(widget.threadId);
    _wsSubscription = stream.listen(_onWsEvent);
  }

  void _onWsEvent(RunEvent event) {
    if (!mounted) return;

    switch (event.type) {
      case 'run-status':
        if (event.run != null && event.run!.id == widget.threadId) {
          _run = event.run;
          _scheduleRebuild();
        }
        break;

      case 'run-turn':
        if (event.turn != null && event.runId == widget.threadId) {
          final idx = _turns.indexWhere((t) => t.id == event.turn!.id);
          if (idx >= 0) {
            final old = _turns[idx];
            _turns[idx] = RunTurnDetail(
              id: event.turn!.id,
              runId: event.turn!.runId,
              index: event.turn!.index,
              prompt: event.turn!.prompt,
              attachments: event.turn!.attachments,
              status: event.turn!.status,
              createdAt: event.turn!.createdAt,
              updatedAt: event.turn!.updatedAt,
              summary: event.turn!.summary,
              hasDiff: event.turn!.hasDiff,
              items: old.items,
            );
          } else {
            _turns.add(RunTurnDetail(
              id: event.turn!.id,
              runId: event.turn!.runId,
              index: event.turn!.index,
              prompt: event.turn!.prompt,
              attachments: event.turn!.attachments,
              status: event.turn!.status,
              createdAt: event.turn!.createdAt,
              updatedAt: event.turn!.updatedAt,
              summary: event.turn!.summary,
              hasDiff: event.turn!.hasDiff,
              items: [],
            ));
          }
          _turnsVersion++;
          _scheduleRebuild();
        }
        break;

      case 'run-item':
        if (event.item != null && event.runId == widget.threadId) {
          final turnIdx = _turns.indexWhere((t) => t.id == event.turnId);
          if (turnIdx >= 0) {
            final turn = _turns[turnIdx];
            final items = List<RunTimelineEvent>.from(turn.items);
            final itemIdx =
                items.indexWhere((i) => i.id == event.item!.id);
            if (itemIdx >= 0) {
              items[itemIdx] = event.item!;
            } else {
              items.add(event.item!);
            }
            _turns[turnIdx] = RunTurnDetail(
              id: turn.id,
              runId: turn.runId,
              index: turn.index,
              prompt: turn.prompt,
              attachments: turn.attachments,
              status: turn.status,
              createdAt: turn.createdAt,
              updatedAt: turn.updatedAt,
              summary: turn.summary,
              hasDiff: turn.hasDiff,
              items: items,
            );
          }
          _turnsVersion++;
          _scheduleRebuild();
        }
        break;
    }
  }

  /// Batch WebSocket-driven rebuilds: at most one setState per 300ms.
  void _scheduleRebuild() {
    _hasPendingUpdate = true;
    if (_throttleTimer?.isActive ?? false) return;
    _throttleTimer = Timer(const Duration(milliseconds: 300), () {
      if (_hasPendingUpdate && mounted) {
        _hasPendingUpdate = false;
        setState(() {});
        _maybeScrollToBottom();
      }
    });
  }

  void _maybeScrollToBottom() {
    if (_autoScrollEnabled) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _scrollToBottom();
      });
    }
  }

  // -------------------------------------------------------------------------
  // Optimistic update on message sent
  // -------------------------------------------------------------------------

  void _onMessageSent(String prompt) {
    if (prompt.isEmpty) return;
    // Optimistically add a fake turn so message appears immediately.
    final now = DateTime.now().millisecondsSinceEpoch.toDouble();
    setState(() {
      _turns.add(RunTurnDetail(
        id: 'optimistic-${now.toInt()}',
        runId: widget.threadId,
        index: _turns.length,
        prompt: prompt,
        attachments: const [],
        status: 'starting',
        createdAt: now,
        updatedAt: now,
        summary: null,
        hasDiff: false,
        items: const [],
      ));
      _cachedDisplayItems = null;
      _turnsVersion++;
    });
    _maybeScrollToBottom();
    // Also reload from server in background to get real data.
    _silentReload();
  }

  /// Reload thread data without showing loading state.
  Future<void> _silentReload() async {
    try {
      final api = ref.read(apiClientProvider);
      final detail =
          await api.getThreadDetail(widget.agentId, widget.threadId);
      if (!mounted) return;
      setState(() {
        _run = detail.run;
        _turns = detail.turns;
        _turnsVersion++;
        _cachedDisplayItems = null;
      });
    } catch (_) {
      // Silent — don't show errors for background reload.
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  String get _runStatus => _run?.status ?? 'unknown';

  bool get _isRunning =>
      _runStatus == 'running' || _runStatus == 'starting';

  List<TodoEntry> get _latestTodoItems {
    // Find the last todo event across all turns.
    for (final turn in _turns.reversed) {
      for (final item in turn.items.reversed) {
        if (item.type == 'todo' && item.items != null) {
          return item.items!;
        }
      }
    }
    return [];
  }

  List<RunTurn> get _queuedTurns {
    return _turns
        .where((t) => t.status == 'queued')
        .map((t) => RunTurn(
              id: t.id,
              runId: t.runId,
              index: t.index,
              prompt: t.prompt,
              attachments: t.attachments,
              status: t.status,
              createdAt: t.createdAt,
              updatedAt: t.updatedAt,
              summary: t.summary,
              hasDiff: t.hasDiff,
            ))
        .toList();
  }

  /// Build a flat list of display items from turns (cached).
  ///
  /// Only user/assistant messages are shown inline. ALL other events
  /// (activity, command, todo) are collapsed into a single group row
  /// between messages. This keeps the chat clean and focused.
  List<_DisplayItem> _getDisplayItems() {
    if (_cachedDisplayItems != null && _lastTurnsVersion == _turnsVersion) {
      return _cachedDisplayItems!;
    }

    final items = <_DisplayItem>[];
    List<RunTimelineEvent> pendingGroup = [];

    void flushGroup() {
      if (pendingGroup.isEmpty) return;
      items.add(_DisplayItem.eventGroup(List.of(pendingGroup)));
      pendingGroup = [];
    }

    for (final turn in _turns) {
      if (turn.status == 'queued') continue;

      // User prompt
      if (turn.prompt.isNotEmpty) {
        flushGroup();
        items.add(_DisplayItem.userMessage(turn.prompt));
      }

      // Timeline events: only messages shown inline, everything else grouped.
      for (final event in turn.items) {
        if (event.type == 'message') {
          flushGroup();
          if (event.role == 'user') {
            items.add(_DisplayItem._(
                type: _DisplayItemType.userMessage, text: event.text ?? ''));
          } else {
            items.add(_DisplayItem._(
                type: _DisplayItemType.assistantMessage,
                text: event.text ?? ''));
          }
        } else {
          // activity, command, todo → all go into the group
          pendingGroup.add(event);
        }
      }
    }
    flushGroup();

    _cachedDisplayItems = items;
    _lastTurnsVersion = _turnsVersion;
    return items;
  }

  // -------------------------------------------------------------------------
  // Build
  // -------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: _run == null
            ? const Text('Thread')
            : Row(
                children: [
                  PixelSprite(status: _runStatus, size: 24),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _run!.tool,
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        Text(
                          _run!.repoPath.split('/').last,
                          style: theme.textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
        actions: [
          if (_run != null)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: _StatusBadge(status: _runStatus),
            ),
        ],
      ),
      body: _buildBody(theme),
    );
  }

  Widget _buildBody(ThemeData theme) {
    if (_loading) {
      return const Center(
        child: SizedBox(
          width: 16,
          height: 16,
          child: Text('...', style: TextStyle(fontSize: 14)),
        ),
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Failed to load thread', style: theme.textTheme.bodyMedium),
            const SizedBox(height: 8),
            Text(_error!, style: theme.textTheme.bodySmall),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: _loadData,
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    final allItems = _getDisplayItems();
    // Only render the tail of the list for performance.
    final hiddenCount =
        (allItems.length - _visibleCount).clamp(0, allItems.length);
    final visibleItems = hiddenCount > 0
        ? allItems.sublist(hiddenCount)
        : allItems;
    final hasMore = hiddenCount > 0;

    return Column(
      children: [
        // Message list — reversed so newest messages appear at bottom without
        // needing to scroll. Index 0 in a reversed list = last item.
        Expanded(
          child: allItems.isEmpty
              ? Center(
                  child: Text(
                    'No messages yet',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: WebmuxTheme.subtext,
                    ),
                  ),
                )
              : ListView.builder(
                  controller: _scrollController,
                  reverse: true,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  itemCount: visibleItems.length + (hasMore ? 1 : 0),
                  itemBuilder: (context, index) {
                    // Reversed: index 0 = newest (last item in visibleItems).
                    // "Load more" button is at the end of the reversed list (top of screen).
                    if (hasMore && index == visibleItems.length) {
                      return Center(
                        child: Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: TextButton(
                            onPressed: () {
                              setState(() {
                                _visibleCount += _pageSize;
                              });
                            },
                            child: Text(
                              'Load $hiddenCount earlier messages',
                              style: const TextStyle(fontSize: 12),
                            ),
                          ),
                        ),
                      );
                    }
                    // Reverse the index: 0 → last item, 1 → second-to-last, etc.
                    final itemIndex = visibleItems.length - 1 - index;
                    return _buildDisplayItem(visibleItems[itemIndex]);
                  },
                ),
        ),
        // Running indicator with interrupt button — above composer.
        if (_isRunning)
          _RunningIndicator(
            status: _runStatus,
            onInterrupt: () async {
              await ref
                  .read(apiClientProvider)
                  .interruptThread(widget.agentId, widget.threadId);
            },
          ),
        // Composer.
        Composer(
          agentId: widget.agentId,
          threadId: widget.threadId,
          runStatus: _runStatus,
          apiClient: ref.read(apiClientProvider),
          hasTurns: _turns.isNotEmpty,
          tool: _run?.tool ?? 'claude',
          repoPath: _run?.repoPath ?? '',
          todoItems: _latestTodoItems,
          queuedTurns: _queuedTurns,
          onMessageSent: _onMessageSent,
        ),
      ],
    );
  }

  Widget _buildDisplayItem(_DisplayItem item) {
    switch (item.type) {
      case _DisplayItemType.userMessage:
        return MessageBubble(text: item.text!, isUser: true);
      case _DisplayItemType.assistantMessage:
        return MessageBubble(text: item.text!, isUser: false);
      case _DisplayItemType.eventGroup:
        return _EventGroupRow(events: item.events!);
      // These types are all folded into eventGroup now, but handle as fallback.
      case _DisplayItemType.todo:
      case _DisplayItemType.command:
      case _DisplayItemType.activity:
        return _EventGroupRow(events: item.event != null ? [item.event!] : []);
    }
  }
}

// ---------------------------------------------------------------------------
// Display item model
// ---------------------------------------------------------------------------

enum _DisplayItemType {
  userMessage,
  assistantMessage,
  command,
  activity,
  todo,
  eventGroup,
}

class _DisplayItem {
  final _DisplayItemType type;
  final String? text;
  final RunTimelineEvent? event;
  final List<RunTimelineEvent>? events; // For eventGroup

  const _DisplayItem._({required this.type, this.text, this.event, this.events});

  factory _DisplayItem.userMessage(String text) =>
      _DisplayItem._(type: _DisplayItemType.userMessage, text: text);

  factory _DisplayItem.fromEvent(RunTimelineEvent event) {
    switch (event.type) {
      case 'message':
        if (event.role == 'user') {
          return _DisplayItem._(
            type: _DisplayItemType.userMessage,
            text: event.text ?? '',
          );
        }
        return _DisplayItem._(
          type: _DisplayItemType.assistantMessage,
          text: event.text ?? '',
        );
      case 'command':
        return _DisplayItem._(
            type: _DisplayItemType.command, event: event);
      case 'activity':
        return _DisplayItem._(
            type: _DisplayItemType.activity, event: event);
      case 'todo':
        return _DisplayItem._(
            type: _DisplayItemType.todo, event: event);
      default:
        return _DisplayItem._(
            type: _DisplayItemType.activity, event: event);
    }
  }

  factory _DisplayItem.eventGroup(List<RunTimelineEvent> events) =>
      _DisplayItem._(type: _DisplayItemType.eventGroup, events: events);
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: PixelTheme.statusBadgeDecoration(status),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          StatusIndicator(status: status, size: 6),
          const SizedBox(width: 6),
          Text(
            status,
            style: PixelTheme.statusBadgeTextStyle(status),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Running indicator — compact breathing dot above composer
// ---------------------------------------------------------------------------

class _RunningIndicator extends StatelessWidget {
  const _RunningIndicator({required this.status, this.onInterrupt});
  final String status;
  final VoidCallback? onInterrupt;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: Row(
        children: [
          PixelSprite(status: status, size: 24),
          const SizedBox(width: 6),
          Text(
            'Agent is working...',
            style: TextStyle(
              color: WebmuxTheme.subtext,
              fontSize: 11,
            ),
          ),
          const Spacer(),
          SizedBox(
            height: 24,
            child: TextButton.icon(
              onPressed: onInterrupt,
              icon: const Icon(Icons.stop_rounded, size: 14),
              label: const Text(
                'Stop',
                style: TextStyle(fontSize: 11),
              ),
              style: PixelTheme.dangerButtonStyle().copyWith(
                padding: WidgetStateProperty.all(
                  const EdgeInsets.symmetric(horizontal: 8),
                ),
                minimumSize: WidgetStateProperty.all(Size.zero),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Event group row — collapsed summary of activity/command events
// ---------------------------------------------------------------------------

class _EventGroupRow extends StatelessWidget {
  const _EventGroupRow({required this.events});
  final List<RunTimelineEvent> events;

  @override
  Widget build(BuildContext context) {
    final commandCount = events.where((e) => e.type == 'command').length;
    final activityCount = events.where((e) => e.type == 'activity').length;
    final todoCount = events.where((e) => e.type == 'todo').length;
    final errorCount = events
        .where((e) =>
            e.activityStatus == 'error' ||
            e.commandStatus == 'failed')
        .length;

    final total = events.length;
    final parts = <String>[];
    if (commandCount > 0) parts.add('$commandCount commands');
    if (activityCount > 0) parts.add('$activityCount actions');
    if (todoCount > 0) parts.add('$todoCount todos');
    final summary = parts.isNotEmpty ? parts.join(', ') : '$total events';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: InkWell(
        borderRadius: PixelTheme.sharpCorners,
        onTap: () => _openDetailPage(context),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: PixelTheme.terminalDecoration(
            borderColor: errorCount > 0 ? WebmuxTheme.statusFailed : null,
          ),
          child: Row(
            children: [
              Icon(
                Icons.terminal_rounded,
                size: 14,
                color: errorCount > 0
                    ? WebmuxTheme.statusFailed
                    : PixelTheme.terminalGreen,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  summary,
                  style: PixelTheme.terminalTextStyle,
                ),
              ),
              if (errorCount > 0) ...[
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                  decoration: BoxDecoration(
                    color: WebmuxTheme.statusFailed.withOpacity(0.15),
                    borderRadius: PixelTheme.sharpCorners,
                  ),
                  child: Text(
                    '$errorCount errors',
                    style: const TextStyle(
                      color: WebmuxTheme.statusFailed,
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                const SizedBox(width: 4),
              ],
              Icon(
                Icons.chevron_right_rounded,
                size: 16,
                color: errorCount > 0
                    ? WebmuxTheme.statusFailed
                    : PixelTheme.terminalGreen,
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _openDetailPage(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _EventDetailPage(events: events),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Event detail page — tabbed view of events in a group
// ---------------------------------------------------------------------------

class _EventDetailPage extends StatefulWidget {
  const _EventDetailPage({required this.events});
  final List<RunTimelineEvent> events;

  @override
  State<_EventDetailPage> createState() => _EventDetailPageState();
}

class _EventDetailPageState extends State<_EventDetailPage>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  late List<RunTimelineEvent> _commands;
  late List<RunTimelineEvent> _activities;
  late List<RunTimelineEvent> _todos;

  @override
  void initState() {
    super.initState();
    _commands = widget.events.where((e) => e.type == 'command').toList();
    _activities = widget.events.where((e) => e.type == 'activity').toList();
    _todos = widget.events.where((e) => e.type == 'todo').toList();

    // Only show tabs that have content.
    _tabController = TabController(
      length: 1 +
          (_commands.isNotEmpty ? 1 : 0) +
          (_activities.isNotEmpty ? 1 : 0) +
          (_todos.isNotEmpty ? 1 : 0),
      vsync: this,
    );
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  List<Tab> _buildTabs() {
    final tabs = <Tab>[
      Tab(text: 'All (${widget.events.length})'),
    ];
    if (_commands.isNotEmpty) {
      tabs.add(Tab(text: 'Commands (${_commands.length})'));
    }
    if (_activities.isNotEmpty) {
      tabs.add(Tab(text: 'Activity (${_activities.length})'));
    }
    if (_todos.isNotEmpty) {
      tabs.add(Tab(text: 'Todos (${_todos.length})'));
    }
    return tabs;
  }

  List<Widget> _buildTabViews() {
    final views = <Widget>[
      _EventList(events: widget.events),
    ];
    if (_commands.isNotEmpty) {
      views.add(_EventList(events: _commands));
    }
    if (_activities.isNotEmpty) {
      views.add(_EventList(events: _activities));
    }
    if (_todos.isNotEmpty) {
      views.add(_EventList(events: _todos));
    }
    return views;
  }

  @override
  Widget build(BuildContext context) {
    final errorCount = widget.events
        .where((e) =>
            e.activityStatus == 'error' || e.commandStatus == 'failed')
        .length;

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Text('${widget.events.length} Events'),
            if (errorCount > 0) ...[
              const SizedBox(width: 8),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: WebmuxTheme.statusFailed.withOpacity(0.15),
                  borderRadius: BorderRadius.zero,
                ),
                child: Text(
                  '$errorCount errors',
                  style: const TextStyle(
                    color: WebmuxTheme.statusFailed,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ],
        ),
        bottom: TabBar(
          controller: _tabController,
          tabs: _buildTabs(),
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          labelStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
          unselectedLabelStyle: const TextStyle(fontSize: 13),
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: _buildTabViews(),
      ),
    );
  }
}

class _EventList extends StatelessWidget {
  const _EventList({required this.events});
  final List<RunTimelineEvent> events;

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      padding: const EdgeInsets.all(12),
      itemCount: events.length,
      itemBuilder: (context, index) {
        final event = events[index];
        if (event.type == 'command') {
          return _CommandTile(event: event);
        }
        if (event.type == 'todo') {
          return _TodoTile(event: event);
        }
        return _ActivityTile(event: event);
      },
    );
  }
}

class _TodoTile extends StatelessWidget {
  const _TodoTile({required this.event});
  final RunTimelineEvent event;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final items = event.items ?? [];
    final completed = items.where((i) => i.status == 'completed').length;

    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.zero,
        border: Border.all(color: WebmuxTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.checklist_rounded,
                  size: 14, color: WebmuxTheme.statusWarning),
              const SizedBox(width: 6),
              Text(
                'Todo ($completed/${items.length})',
                style: theme.textTheme.bodySmall
                    ?.copyWith(fontWeight: FontWeight.w600),
              ),
            ],
          ),
          const SizedBox(height: 6),
          ...items.map((item) {
            final isDone = item.status == 'completed';
            return Padding(
              padding: const EdgeInsets.only(bottom: 3),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    isDone
                        ? Icons.check_box_rounded
                        : Icons.check_box_outline_blank_rounded,
                    size: 16,
                    color: isDone
                        ? WebmuxTheme.statusSuccess
                        : WebmuxTheme.subtext,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      item.text,
                      style: theme.textTheme.bodySmall?.copyWith(
                        decoration:
                            isDone ? TextDecoration.lineThrough : null,
                        color: isDone ? WebmuxTheme.subtext : null,
                        fontSize: 12,
                      ),
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }
}

class _CommandTile extends StatefulWidget {
  const _CommandTile({required this.event});
  final RunTimelineEvent event;

  @override
  State<_CommandTile> createState() => _CommandTileState();
}

class _CommandTileState extends State<_CommandTile> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isFailed = widget.event.commandStatus == 'failed';
    final exitCode = widget.event.exitCode;

    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.zero,
        border: Border.all(
          color: isFailed
              ? WebmuxTheme.statusFailed.withOpacity(0.3)
              : WebmuxTheme.border,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            borderRadius:
                BorderRadius.zero,
            onTap: () => setState(() => _expanded = !_expanded),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              child: Row(
                children: [
                  Icon(
                    Icons.terminal_rounded,
                    size: 14,
                    color: isFailed
                        ? WebmuxTheme.statusFailed
                        : WebmuxTheme.statusSuccess,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      widget.event.command ?? 'command',
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontFamily: 'monospace',
                        fontSize: 12,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (exitCode != null) ...[
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 5, vertical: 1),
                      decoration: BoxDecoration(
                        color: (isFailed
                                ? WebmuxTheme.statusFailed
                                : WebmuxTheme.statusSuccess)
                            .withOpacity(0.15),
                        borderRadius: BorderRadius.zero,
                      ),
                      child: Text(
                        'exit $exitCode',
                        style: TextStyle(
                          color: isFailed
                              ? WebmuxTheme.statusFailed
                              : WebmuxTheme.statusSuccess,
                          fontSize: 10,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                  ],
                  Icon(
                    _expanded
                        ? Icons.expand_less_rounded
                        : Icons.expand_more_rounded,
                    size: 16,
                    color: WebmuxTheme.subtext,
                  ),
                ],
              ),
            ),
          ),
          if (_expanded &&
              widget.event.output != null &&
              widget.event.output!.isNotEmpty) ...[
            const Divider(height: 1),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: const BoxDecoration(
                color: Colors.black26,
                borderRadius:
                    BorderRadius.zero,
              ),
              child: SelectableText(
                widget.event.output!,
                style: theme.textTheme.bodySmall?.copyWith(
                  fontFamily: 'monospace',
                  fontSize: 11,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ActivityTile extends StatelessWidget {
  const _ActivityTile({required this.event});
  final RunTimelineEvent event;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isError = event.activityStatus == 'error';
    final isSuccess = event.activityStatus == 'success';

    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: [
          Icon(
            isError
                ? Icons.error_outline_rounded
                : isSuccess
                    ? Icons.check_circle_outline_rounded
                    : Icons.info_outline_rounded,
            size: 14,
            color: isError
                ? WebmuxTheme.statusFailed
                : isSuccess
                    ? WebmuxTheme.statusSuccess
                    : WebmuxTheme.subtext,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              event.label ?? event.detail ?? 'Activity',
              style: theme.textTheme.bodySmall?.copyWith(
                color: isError
                    ? WebmuxTheme.statusFailed
                    : WebmuxTheme.subtext,
                fontSize: 12,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Todo card
// ---------------------------------------------------------------------------

class _TodoCard extends StatefulWidget {
  const _TodoCard({required this.items});
  final List<TodoEntry> items;

  @override
  State<_TodoCard> createState() => _TodoCardState();
}

class _TodoCardState extends State<_TodoCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final completed =
        widget.items.where((e) => e.status == 'completed').length;
    final total = widget.items.length;

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.zero,
        border: Border.all(color: WebmuxTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            borderRadius: BorderRadius.zero,
            child: Padding(
              padding: const EdgeInsets.symmetric(
                  horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  Icon(
                    Icons.checklist_rounded,
                    size: 14,
                    color: WebmuxTheme.statusWarning,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    'Todo ($completed/$total)',
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const Spacer(),
                  Icon(
                    _expanded
                        ? Icons.expand_less_rounded
                        : Icons.expand_more_rounded,
                    size: 16,
                    color: WebmuxTheme.subtext,
                  ),
                ],
              ),
            ),
          ),
          if (_expanded) ...[
            const Divider(height: 1),
            ...widget.items.map((item) {
              final isDone = item.status == 'completed';
              return Padding(
                padding: const EdgeInsets.symmetric(
                    horizontal: 12, vertical: 4),
                child: Row(
                  children: [
                    Icon(
                      isDone
                          ? Icons.check_box_rounded
                          : Icons.check_box_outline_blank_rounded,
                      size: 16,
                      color: isDone
                          ? WebmuxTheme.statusSuccess
                          : WebmuxTheme.subtext,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        item.text,
                        style: theme.textTheme.bodySmall?.copyWith(
                          decoration: isDone
                              ? TextDecoration.lineThrough
                              : null,
                          color: isDone ? WebmuxTheme.subtext : null,
                        ),
                      ),
                    ),
                  ],
                ),
              );
            }),
            const SizedBox(height: 4),
          ],
        ],
      ),
    );
  }
}
