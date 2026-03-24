import 'dart:async';
import 'dart:typed_data';

/// Callback for when an image is pasted from clipboard.
typedef OnImagePasted = void Function(Uint8List bytes, String mimeType, String name);

/// No-op on non-web platforms.
StreamSubscription<dynamic>? setupWebPasteListener(OnImagePasted onPasted) {
  return null;
}
