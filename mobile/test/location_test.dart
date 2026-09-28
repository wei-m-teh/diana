import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:voice_assistant/services/device_location.dart';
import 'package:voice_assistant/services/session_context.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  tearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(DeviceLocation.channel, null));
  test('location is rounded and denied/unavailable permission returns no fix', () async {
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(DeviceLocation.channel, (call) async {
      expect(call.arguments, false);
      return {
        'latitude': 47.60621,
        'longitude': -122.33207,
        'accuracyMeters': 20.0,
        'timestamp': DateTime.now().millisecondsSinceEpoch
      };
    });
    final fix = await DeviceLocation.current();
    expect(fix?['latitude'], 47.61);
    expect(fix?['accuracyMeters'], 1000);
    messenger.setMockMethodCallHandler(DeviceLocation.channel, (_) async => throw PlatformException(code: 'denied'));
    expect(await DeviceLocation.current(), isNull);
  });
  test('each device-enabled session refreshes location; off and manual never access device', () async {
    var mode = 'device', captures = 0;
    final fixes = <dynamic>[];
    final client = MockClient((request) async {
      expect(request.headers['Authorization'], 'Bearer token');
      if (request.method == 'GET') {
        return http.Response(
            jsonEncode({
              'email': 'a@b.com',
              'displayName': 'A',
              'preferences': {
                'voiceKey': 'delia',
                'location': {'mode': mode}
              },
              'subscription': {'planId': 'free', 'status': 'active'}
            }),
            200);
      }
      fixes.add(jsonDecode(request.body)['deviceLocation']);
      return http.Response(jsonEncode({'serverUrl': 'wss://example.org', 'participantToken': 'room-token'}), 200);
    });
    Future<void> start() async {
      await fetchSessionContext('https://example.org/sessions', 'token',
          client: client,
          timezone: () async => 'UTC',
          location: () async {
            captures++;
            return {'latitude': captures};
          });
    }

    await start();
    await start();
    expect(captures, 2);
    expect(fixes, [
      {'latitude': 1},
      {'latitude': 2}
    ]);
    mode = 'off';
    await start();
    mode = 'manual';
    await start();
    expect(captures, 2);
    expect(fixes.sublist(2), [null, null]);
  });
}
