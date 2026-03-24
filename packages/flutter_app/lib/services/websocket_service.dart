import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:web_socket_channel/web_socket_channel.dart';

import '../models/models.dart';

// ---------------------------------------------------------------------------
// RunEvent — typed WebSocket events from the server.
// ---------------------------------------------------------------------------

/// A discriminated-union style event received over the WebSocket.
class RunEvent {
  final String type;

  // Fields populated depending on [type].
  final Run? run;
  final String? runId;
  final RunTurn? turn;
  final String? turnId;
  final RunTimelineEvent? item;
  final Task? task;
  final String? taskId;
  final TaskStep? step;
  final TaskMessage? message;
  final Project? project;

  const RunEvent._({
    required this.type,
    this.run,
    this.runId,
    this.turn,
    this.turnId,
    this.item,
    this.task,
    this.taskId,
    this.step,
    this.message,
    this.project,
  });

  factory RunEvent.fromJson(Map<String, dynamic> json) {
    final type = json['type'] as String;

    switch (type) {
      case 'run-status':
        return RunEvent._(
          type: type,
          run: Run.fromJson(json['run'] as Map<String, dynamic>),
        );

      case 'run-turn':
        return RunEvent._(
          type: type,
          runId: json['runId'] as String?,
          turn: RunTurn.fromJson(json['turn'] as Map<String, dynamic>),
        );

      case 'run-item':
        return RunEvent._(
          type: type,
          runId: json['runId'] as String?,
          turnId: json['turnId'] as String?,
          item:
              RunTimelineEvent.fromJson(json['item'] as Map<String, dynamic>),
        );

      case 'task-status':
        return RunEvent._(
          type: type,
          task: Task.fromJson(json['task'] as Map<String, dynamic>),
        );

      case 'task-step':
        return RunEvent._(
          type: type,
          taskId: json['taskId'] as String?,
          step: TaskStep.fromJson(json['step'] as Map<String, dynamic>),
        );

      case 'task-message':
        return RunEvent._(
          type: type,
          taskId: json['taskId'] as String?,
          message:
              TaskMessage.fromJson(json['message'] as Map<String, dynamic>),
        );

      case 'project-status':
        return RunEvent._(
          type: type,
          project:
              Project.fromJson(json['project'] as Map<String, dynamic>),
        );

      default:
        return RunEvent._(type: type);
    }
  }
}

// ---------------------------------------------------------------------------
// WebSocketService
// ---------------------------------------------------------------------------

/// Manages WebSocket connections to the Webmux server with auto-reconnect.
class WebSocketService {
  WebSocketChannel? _channel;
  StreamController<RunEvent>? _controller;
  Timer? _reconnectTimer;
  String _baseUrl = '';
  String _token = '';
  bool _disposed = false;
  int _reconnectAttempt = 0;

  // Parameters for the current connection so we can reconnect.
  String? _currentPath;
  Map<String, String>? _currentParams;

  /// Reconfigure the server URL and auth token.
  void configure(String baseUrl, String token) {
    _baseUrl = baseUrl.replaceAll(RegExp(r'/+$'), '');
    _token = token;
  }

  /// Connect to a thread's WebSocket stream.
  ///
  /// Returns a broadcast stream of [RunEvent]s. The connection will
  /// auto-reconnect with exponential backoff on disconnect.
  Stream<RunEvent> connectThread(String threadId) {
    return _connect('/ws/thread', {'threadId': threadId});
  }

  /// Connect to a project's WebSocket stream.
  ///
  /// Returns a broadcast stream of [RunEvent]s. The connection will
  /// auto-reconnect with exponential backoff on disconnect.
  Stream<RunEvent> connectProject(String projectId) {
    return _connect('/ws/project', {'projectId': projectId});
  }

  /// Disconnect and clean up all resources.
  void disconnect() {
    _disposed = true;
    _cancelReconnect();
    _closeChannel();
    _controller?.close();
    _controller = null;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  Stream<RunEvent> _connect(String path, Map<String, String> params) {
    // Tear down any existing connection.
    disconnect();

    _disposed = false;
    _reconnectAttempt = 0;
    _currentPath = path;
    _currentParams = params;

    _controller = StreamController<RunEvent>.broadcast(
      onCancel: () {
        // When the last listener leaves, disconnect.
        disconnect();
      },
    );

    _doConnect();
    return _controller!.stream;
  }

  void _doConnect() {
    if (_disposed || _currentPath == null) return;

    final wsScheme = _baseUrl.startsWith('https') ? 'wss' : 'ws';
    final host = _baseUrl.replaceAll(RegExp(r'^https?://'), '');

    final queryParams = {
      ..._currentParams!,
      'token': _token,
    };
    final queryString = queryParams.entries
        .map((e) =>
            '${Uri.encodeComponent(e.key)}=${Uri.encodeComponent(e.value)}')
        .join('&');

    final uri = Uri.parse('$wsScheme://$host$_currentPath?$queryString');

    try {
      _channel = WebSocketChannel.connect(uri);
    } catch (e) {
      _scheduleReconnect();
      return;
    }

    _channel!.stream.listen(
      (data) {
        _reconnectAttempt = 0; // Reset on successful message.
        try {
          final json = jsonDecode(data as String) as Map<String, dynamic>;
          final event = RunEvent.fromJson(json);
          _controller?.add(event);
        } catch (_) {
          // Ignore malformed messages.
        }
      },
      onError: (_) {
        _scheduleReconnect();
      },
      onDone: () {
        _scheduleReconnect();
      },
    );
  }

  void _scheduleReconnect() {
    if (_disposed) return;

    _closeChannel();
    _reconnectAttempt++;

    // Exponential backoff: 1s, 2s, 4s, 8s, … capped at 30s.
    final delayMs = min(1000 * pow(2, _reconnectAttempt - 1).toInt(), 30000);
    _reconnectTimer = Timer(Duration(milliseconds: delayMs), () {
      _reconnectTimer = null;
      _doConnect();
    });
  }

  void _cancelReconnect() {
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
  }

  void _closeChannel() {
    try {
      _channel?.sink.close();
    } catch (_) {
      // Best-effort close.
    }
    _channel = null;
  }
}
