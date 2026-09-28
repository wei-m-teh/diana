import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:voice_assistant/services/device_timezone.dart';
import 'package:voice_assistant/services/session_context.dart';
import 'package:voice_assistant/services/search_sources.dart';
import 'package:voice_assistant/services/profile_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('Android timezone channel returns IANA names, not abbreviations', () async {
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(DeviceTimezone.channel,
        (call) async => call.method == 'current' ? 'America/New_York' : call.arguments == 'America/New_York');
    expect(await DeviceTimezone.current(), 'America/New_York');
    expect(await DeviceTimezone.isValid('America/New_York'), isTrue);
    expect(await DeviceTimezone.isValid('bad'), isFalse);
    messenger.setMockMethodCallHandler(DeviceTimezone.channel, null);
  });
  test('session request sends device timezone and retains authorization', () async {
    final client = MockClient((request) async {
      expect(request.headers['Authorization'], 'Bearer access-token');
      if (request.method == 'GET') {
        return http.Response(
            jsonEncode({
              'email': 'a@b.com',
              'displayName': 'A',
              'preferences': {'voiceKey': 'delia'},
              'subscription': {'planId': 'free', 'status': 'active'}
            }),
            200);
      }
      expect(jsonDecode(request.body), {'deviceTimezone': 'Asia/Tokyo', 'deviceLocation': null});
      return http.Response(jsonEncode({'serverUrl': 'wss://example.org', 'participantToken': 'room-token'}), 200);
    });
    final result = await fetchSessionContext('https://example.org/sessions', 'access-token',
        client: client, timezone: () async => 'Asia/Tokyo');
    expect(result.participantToken, 'room-token');
  });
  test('profile supports manual and automatic timezone without dropping existing fields', () {
    final profile = {
      'email': 'test@example.org',
      'displayName': 'Test',
      'preferences': {'voiceKey': 'delia', 'timezone': 'Europe/Paris'},
      'subscription': {'planId': 'free', 'status': 'active'}
    };
    expect(UserProfile.fromJson(profile).timezone, 'Europe/Paris');
    (profile['preferences'] as Map).remove('timezone');
    expect(UserProfile.fromJson(profile).timezone, isNull);
  });
  test('source links reject executable URLs', () {
    final value = {
      'id': 'a',
      'query': 'news',
      'retrievedAt': '2026-09-27T12:00:00Z',
      'sources': [
        {'title': 'Bad', 'url': 'javascript:alert(1)'}
      ]
    };
    expect(SearchSources.parse(value), isNull);
    value['sources'] = [
      {'title': 'Official source', 'url': 'https://example.org'}
    ];
    expect(SearchSources.parse(value)?.sources.single.title, 'Official source');
  });
}
