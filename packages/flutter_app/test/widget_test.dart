import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:webmux/main.dart';

void main() {
  testWidgets('App renders smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(child: WebmuxApp()),
    );

    // Verify that the Home screen is displayed.
    expect(find.text('Home'), findsWidgets);
  });
}
