import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_assistant/services/background_call.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  final calls = <String>[];
  setUp(() {
    calls.clear();
    messenger.setMockMethodCallHandler(BackgroundCall.channel, (call) async {
      calls.add(call.method);
      return null;
    });
  });
  tearDown(() {
    BackgroundCall(enabled: true).onEnd(null);
    messenger.setMockMethodCallHandler(BackgroundCall.channel, null);
  });

  test('Android starts and stops the native call service', () async {
    final service = BackgroundCall(enabled: true);
    await service.start();
    await service.stop();
    expect(calls, ['start', 'stop']);
  });
  test('Other platforms do not invoke Android service methods', () async {
    final service = BackgroundCall(enabled: false);
    await service.start();
    await service.stop();
    expect(calls, isEmpty);
  });
  test('Permission/service failures propagate instead of starting unprotected calls', () async {
    messenger.setMockMethodCallHandler(BackgroundCall.channel, (_) async {
      throw PlatformException(code: 'microphone_denied');
    });
    await expectLater(BackgroundCall(enabled: true).start(), throwsA(isA<PlatformException>()));
  });
  test('Notification End delegates to the call owner and awaits cleanup', () async {
    final service = BackgroundCall(enabled: true);
    var ended = false;
    service.onEnd(() async {
      ended = true;
      await service.stop();
    });
    await messenger.handlePlatformMessage(
      'diana/background_call',
      const StandardMethodCodec().encodeMethodCall(const MethodCall('endCall')),
      (_) {},
    );
    expect(ended, isTrue);
    expect(calls, ['stop']);
  });
}
