import 'package:flutter_riverpod/flutter_riverpod.dart';

// ---------------------------------------------------------------------------
// Connection status
// ---------------------------------------------------------------------------

enum ConnectionStatus { connected, reconnecting, disconnected }

class ConnectionState {
  final ConnectionStatus status;
  final String? message;

  const ConnectionState._({required this.status, this.message});

  const ConnectionState.connected()
      : this._(status: ConnectionStatus.connected);

  const ConnectionState.reconnecting({String? message})
      : this._(status: ConnectionStatus.reconnecting, message: message);

  const ConnectionState.disconnected({String? message})
      : this._(status: ConnectionStatus.disconnected, message: message);

  bool get isConnected => status == ConnectionStatus.connected;
}

// ---------------------------------------------------------------------------
// ConnectionNotifier
// ---------------------------------------------------------------------------

class ConnectionNotifier extends StateNotifier<ConnectionState> {
  ConnectionNotifier() : super(const ConnectionState.disconnected());

  /// Mark the connection as established.
  void setConnected() {
    state = const ConnectionState.connected();
  }

  /// Mark the connection as attempting to reconnect.
  void setReconnecting({String? message}) {
    state = ConnectionState.reconnecting(message: message);
  }

  /// Mark the connection as disconnected.
  void setDisconnected({String? message}) {
    state = ConnectionState.disconnected(message: message);
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

final connectionProvider =
    StateNotifierProvider<ConnectionNotifier, ConnectionState>((ref) {
  return ConnectionNotifier();
});
