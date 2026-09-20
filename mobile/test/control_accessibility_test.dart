import 'package:flutter/material.dart';
import 'package:flutter_sficon/flutter_sficon.dart' as sf;
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_assistant/widgets/floating_glass.dart';
import 'package:voice_assistant/widgets/message_bar.dart';

void main() {
  testWidgets('Call control exposes its name without decorative icon text', (tester) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(MaterialApp(
        home: FloatingGlassButton(
      semanticLabel: 'End call',
      sfIcon: sf.SFIcons.sf_phone_down_fill,
      onTap: () {},
    )));
    expect(tester.getSemantics(find.byType(FloatingGlassButton)).label, 'End call');
    semantics.dispose();
  });

  testWidgets('Send control exposes its name without decorative icon text', (tester) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(MaterialApp(home: MessageBarButton(onTap: () {})));
    expect(tester.getSemantics(find.byType(MessageBarButton)).label, 'Send message');
    semantics.dispose();
  });
}
