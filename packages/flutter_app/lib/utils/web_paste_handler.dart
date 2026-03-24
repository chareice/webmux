import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'dart:js_interop';

import 'package:web/web.dart' as web;

/// Callback for when an image is pasted from clipboard on web.
typedef OnImagePasted = void Function(Uint8List bytes, String mimeType, String name);

/// Sets up a document-level paste event listener that intercepts image pastes.
/// Returns a function to remove the listener.
StreamSubscription<web.ClipboardEvent> setupWebPasteListener(OnImagePasted onPasted) {
  final sub = web.EventStreamProviders.pasteEvent
      .forTarget(web.document)
      .listen((event) {
    final clipboardData = event.clipboardData;
    if (clipboardData == null) return;

    final items = clipboardData.items;
    for (var i = 0; i < items.length; i++) {
      final item = items[i];
      final type = item.type;
      if (type.startsWith('image/')) {
        event.preventDefault();
        final file = item.getAsFile();
        if (file == null) continue;

        final reader = web.FileReader();
        reader.onLoadEnd.listen((_) {
          final result = reader.result;
          if (result == null) return;

          // result is an ArrayBuffer
          final jsArrayBuffer = result as JSArrayBuffer;
          final bytes = jsArrayBuffer.toDart.asUint8List();
          final name = 'pasted-image-${DateTime.now().millisecondsSinceEpoch}.${_extensionForMime(type)}';
          onPasted(bytes, type, name);
        });
        reader.readAsArrayBuffer(file);
        break; // Only handle the first image
      }
    }
  });

  return sub;
}

String _extensionForMime(String mime) {
  if (mime.contains('png')) return 'png';
  if (mime.contains('jpeg') || mime.contains('jpg')) return 'jpg';
  if (mime.contains('gif')) return 'gif';
  if (mime.contains('webp')) return 'webp';
  return 'png';
}
