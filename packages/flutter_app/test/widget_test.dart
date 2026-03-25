import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:webmux/main.dart';

void main() {
  testWidgets('App renders smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(child: WebmuxApp()),
    );

    // Verify that the app renders (login screen shows on start).
    expect(find.text('Webmux'), findsWidgets);
  });
}
