import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../models/run.dart';
import '../../services/websocket_service.dart';
import '../../providers/api_provider.dart';
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
    final maxScroll = _scrollController.position.maxScrollExtent;
    final currentScroll = _scrollController.offset;
    // Consider "scrolled up" if more than 100px from bottom.
    _userScrolledUp = (maxScroll - currentScroll) > 100;
    _autoScrollEnabled = !_userScrolledUp;
  }

  void _scrollToBottom({bool animate = true}) {
    if (!_scrollController.hasClients) return;
    if (animate) {
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    } else {
      _scrollController
          .jumpTo(_scrollController.position.maxScrollExtent);
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
      // Scroll to bottom after data loaded.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _scrollToBottom(animate: false);
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
    // Add user message to display list immediately without reloading.
    setState(() {
      _cachedDisplayItems = null; // Invalidate cache.
      _turnsVersion++;
    });
    _maybeScrollToBottom();
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
  /// Consecutive activity/command events are merged into a single
  /// [_DisplayItemType.eventGroup] so the chat view stays clean.
  List<_DisplayItem> _getDisplayItems() {
    if (_cachedDisplayItems != null && _lastTurnsVersion == _turnsVersion) {
      return _cachedDisplayItems!;
    }

    // First pass: raw flat list.
    final raw = <_DisplayItem>[];
    for (final turn in _turns) {
      if (turn.status == 'queued') continue;
      if (turn.prompt.isNotEmpty) {
        raw.add(_DisplayItem.userMessage(turn.prompt));
      }
      for (final event in turn.items) {
        raw.add(_DisplayItem.fromEvent(event));
      }
    }

    // Second pass: merge consecutive activity/command into groups.
    final items = <_DisplayItem>[];
    List<RunTimelineEvent> pendingGroup = [];

    void flushGroup() {
      if (pendingGroup.isEmpty) return;
      items.add(_DisplayItem.eventGroup(List.of(pendingGroup)));
      pendingGroup = [];
    }

    for (final item in raw) {
      if (item.type == _DisplayItemType.activity ||
          item.type == _DisplayItemType.command) {
        pendingGroup.add(item.event!);
      } else {
        flushGroup();
        items.add(item);
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
            : Column(
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
        actions: [
          if (_run != null)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: _StatusBadge(status: _runStatus),
            ),
          if (_isRunning)
            IconButton(
              icon: const Icon(Icons.stop_rounded),
              tooltip: 'Interrupt',
              onPressed: () async {
                await ref
                    .read(apiClientProvider)
                    .interruptThread(widget.agentId, widget.threadId);
              },
            ),
        ],
      ),
      body: _buildBody(theme),
    );
  }

  Widget _buildBody(ThemeData theme) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
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
        // Status bar when running.
        if (_isRunning) _RunningStatusBar(status: _runStatus),
        // Message list.
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
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  itemCount: visibleItems.length + (hasMore ? 1 : 0),
                  itemBuilder: (context, index) {
                    if (hasMore && index == 0) {
                      return Center(
                        child: Padding(
                          padding: const EdgeInsets.only(bottom: 8),
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
                    final itemIndex = hasMore ? index - 1 : index;
                    return _buildDisplayItem(visibleItems[itemIndex]);
                  },
                ),
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
      case _DisplayItemType.todo:
        return _TodoCard(items: item.event!.items ?? []);
      case _DisplayItemType.eventGroup:
        return _EventGroupRow(events: item.events!);
      // Individual activity/command should not appear after grouping,
      // but handle them as fallback.
      case _DisplayItemType.command:
      case _DisplayItemType.activity:
        return _EventGroupRow(events: [item.event!]);
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
    final color = StatusIndicator.colorForStatus(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          StatusIndicator(status: status, size: 6),
          const SizedBox(width: 6),
          Text(
            status,
            style: TextStyle(
              color: color,
              fontSize: 11,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Running status bar
// ---------------------------------------------------------------------------

class _RunningStatusBar extends StatefulWidget {
  const _RunningStatusBar({required this.status});
  final String status;

  @override
  State<_RunningStatusBar> createState() => _RunningStatusBarState();
}

class _RunningStatusBarState extends State<_RunningStatusBar>
    with SingleTickerProviderStateMixin {
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat(reverse: true);
    _pulseAnimation = Tween<double>(begin: 0.5, end: 1.0).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = StatusIndicator.colorForStatus(widget.status);
    return AnimatedBuilder(
      animation: _pulseAnimation,
      builder: (context, child) {
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 6),
          decoration: BoxDecoration(
            color: color.withOpacity(0.08 * _pulseAnimation.value),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              SizedBox(
                width: 12,
                height: 12,
                child: CircularProgressIndicator(
                  strokeWidth: 1.5,
                  color: color.withOpacity(_pulseAnimation.value),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                'Running...',
                style: TextStyle(
                  color: color.withOpacity(_pulseAnimation.value),
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        );
      },
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
    final theme = Theme.of(context);
    final commandCount = events.where((e) => e.type == 'command').length;
    final activityCount = events.where((e) => e.type == 'activity').length;
    final errorCount = events
        .where((e) =>
            e.activityStatus == 'error' ||
            e.commandStatus == 'failed')
        .length;

    final parts = <String>[];
    if (commandCount > 0) parts.add('$commandCount commands');
    if (activityCount > 0) parts.add('$activityCount actions');
    final summary = parts.join(', ');

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: InkWell(
        borderRadius: BorderRadius.circular(6),
        onTap: () => _openDetailPage(context),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: theme.colorScheme.surface,
            borderRadius: BorderRadius.circular(6),
            border: Border.all(color: WebmuxTheme.border, width: 0.5),
          ),
          child: Row(
            children: [
              Icon(
                Icons.terminal_rounded,
                size: 14,
                color: errorCount > 0
                    ? WebmuxTheme.statusFailed
                    : WebmuxTheme.subtext,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  summary,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: WebmuxTheme.subtext,
                    fontSize: 12,
                  ),
                ),
              ),
              if (errorCount > 0) ...[
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                  decoration: BoxDecoration(
                    color: WebmuxTheme.statusFailed.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(4),
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
              const Icon(
                Icons.chevron_right_rounded,
                size: 16,
                color: WebmuxTheme.subtext,
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
// Event detail page — full list of events in a group
// ---------------------------------------------------------------------------

class _EventDetailPage extends StatelessWidget {
  const _EventDetailPage({required this.events});
  final List<RunTimelineEvent> events;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text('${events.length} Events'),
      ),
      body: ListView.builder(
        padding: const EdgeInsets.all(12),
        itemCount: events.length,
        itemBuilder: (context, index) {
          final event = events[index];
          return _buildEventTile(event, theme);
        },
      ),
    );
  }

  Widget _buildEventTile(RunTimelineEvent event, ThemeData theme) {
    if (event.type == 'command') {
      return _CommandTile(event: event);
    }
    // Activity
    return _ActivityTile(event: event);
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
        borderRadius: BorderRadius.circular(8),
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
                const BorderRadius.vertical(top: Radius.circular(8)),
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
                        borderRadius: BorderRadius.circular(4),
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
                    BorderRadius.vertical(bottom: Radius.circular(8)),
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
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: WebmuxTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            borderRadius:
                const BorderRadius.vertical(top: Radius.circular(8)),
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
