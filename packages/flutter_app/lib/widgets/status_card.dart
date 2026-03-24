import 'package:flutter/material.dart';

import '../app/theme.dart';
import 'status_indicator.dart';

/// A compact, high-density card used across the home dashboard.
///
/// Supports optional left accent border, status indicator, and action buttons.
class StatusCard extends StatelessWidget {
  const StatusCard({
    super.key,
    required this.child,
    this.onTap,
    this.accentColor,
    this.showPulse = false,
  });

  final Widget child;
  final VoidCallback? onTap;

  /// Optional left border accent color.
  final Color? accentColor;

  /// Whether to show a breathing/pulse animation on the accent border.
  final bool showPulse;

  @override
  Widget build(BuildContext context) {
    // Use a left border for the accent color instead of a separate Container
    // inside a Row+IntrinsicHeight, which causes overflow issues.
    Widget card = Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: WebmuxTheme.border, width: 1),
      ),
      child: accentColor != null
          ? Stack(
              children: [
                Positioned(
                  left: 0,
                  top: 0,
                  bottom: 0,
                  child: showPulse
                      ? _PulsingAccent(color: accentColor!)
                      : Container(
                          width: 3,
                          decoration: BoxDecoration(
                            color: accentColor,
                            borderRadius: const BorderRadius.only(
                              topLeft: Radius.circular(7),
                              bottomLeft: Radius.circular(7),
                            ),
                          ),
                        ),
                ),
                Padding(
                  padding: const EdgeInsets.only(
                      left: 13, right: 10, top: 8, bottom: 8),
                  child: child,
                ),
              ],
            )
          : Padding(
              padding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              child: child,
            ),
    );

    if (onTap != null) {
      return GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: card,
      );
    }

    return card;
  }
}

/// An attention card for the "Needs Attention" section.
class AttentionCard extends StatelessWidget {
  const AttentionCard({
    super.key,
    required this.status,
    required this.agentName,
    required this.summary,
    this.onTap,
    this.actions = const [],
  });

  final String status;
  final String agentName;
  final String summary;
  final VoidCallback? onTap;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final color = StatusIndicator.colorForStatus(status);

    return StatusCard(
      accentColor: color,
      onTap: onTap,
      child: Row(
        children: [
          StatusIndicator(status: status, size: 10),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                RichText(
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  text: TextSpan(
                    children: [
                      TextSpan(
                        text: agentName,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.onSurface,
                          fontWeight: FontWeight.w600,
                          fontSize: 13,
                        ),
                      ),
                      const TextSpan(
                        text: ' · ',
                        style: TextStyle(
                          color: WebmuxTheme.subtext,
                          fontSize: 13,
                        ),
                      ),
                      TextSpan(
                        text: summary,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.onSurface,
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (actions.isNotEmpty) ...[
            const SizedBox(width: 6),
            ...actions,
          ],
        ],
      ),
    );
  }
}

/// A card for the "Running" section showing active threads/tasks.
class ActiveCard extends StatelessWidget {
  const ActiveCard({
    super.key,
    required this.agentName,
    required this.projectName,
    required this.duration,
    this.latestOutput,
    this.onTap,
  });

  final String agentName;
  final String projectName;
  final String duration;
  final String? latestOutput;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return StatusCard(
      accentColor: WebmuxTheme.statusRunning,
      showPulse: true,
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Expanded(
                child: RichText(
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  text: TextSpan(
                    children: [
                      TextSpan(
                        text: agentName,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.onSurface,
                          fontWeight: FontWeight.w600,
                          fontSize: 13,
                        ),
                      ),
                      const TextSpan(
                        text: ' · ',
                        style: TextStyle(
                          color: WebmuxTheme.subtext,
                          fontSize: 13,
                        ),
                      ),
                      TextSpan(
                        text: projectName,
                        style: const TextStyle(
                          color: WebmuxTheme.subtext,
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                duration,
                style: const TextStyle(
                  color: WebmuxTheme.subtext,
                  fontSize: 12,
                  fontFeatures: [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
          if (latestOutput != null && latestOutput!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(
                latestOutput!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: WebmuxTheme.subtext,
                  fontSize: 11,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// A compact card for the "Recent" section showing completed threads.
class RecentCard extends StatelessWidget {
  const RecentCard({
    super.key,
    required this.status,
    required this.summary,
    required this.timeAgo,
    this.onTap,
  });

  final String status;
  final String summary;
  final String timeAgo;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return StatusCard(
      onTap: onTap,
      child: Row(
        children: [
          StatusIndicator(status: status, showIcon: true, size: 16),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              summary,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: Theme.of(context).colorScheme.onSurface,
                fontSize: 13,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            timeAgo,
            style: const TextStyle(
              color: WebmuxTheme.subtext,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

/// Animated pulsing left accent border for running threads.
class _PulsingAccent extends StatefulWidget {
  const _PulsingAccent({required this.color});

  final Color color;

  @override
  State<_PulsingAccent> createState() => _PulsingAccentState();
}

class _PulsingAccentState extends State<_PulsingAccent>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _opacity;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2000),
    )..repeat(reverse: true);
    _opacity = Tween<double>(begin: 0.4, end: 1.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _opacity,
      builder: (context, child) {
        return Container(
          width: 3,
          decoration: BoxDecoration(
            color: widget.color.withOpacity(_opacity.value),
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(8),
              bottomLeft: Radius.circular(8),
            ),
          ),
        );
      },
    );
  }
}
