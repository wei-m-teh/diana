import 'dart:convert';
import 'package:voice_assistant/services/device_timezone.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:voice_assistant/services/profile_service.dart';
import 'package:voice_assistant/screens/profile_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
        DeviceTimezone.channel, (call) async => call.method == 'current' ? 'America/New_York' : true);
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(DeviceTimezone.channel, null);
  });
  Map<String, dynamic> data() => {
        'email': 'test@example.com',
        'displayName': 'Alex',
        'preferences': {'voiceKey': 'delia'},
        'subscription': {'planId': 'free', 'status': 'active'},
      };
  ProfileService service(MockClient client) =>
      ProfileService(client: client, token: () async => 'test-access-token', endpoint: 'https://example.com/sessions');

  test('profile requests use access token and send only specified updates', () async {
    final profile = data();
    final api = service(MockClient((request) async {
      expect(request.url.toString(), 'https://example.com/me');
      expect(request.headers['Authorization'], 'Bearer test-access-token');
      if (request.method == 'PATCH') {
        expect(jsonDecode(request.body), {'displayName': 'Updated'});
        profile['displayName'] = 'Updated';
      }
      return http.Response(jsonEncode(profile), 200);
    }));
    expect((await api.load()).displayName, 'Alex');
    expect((await api.update({'displayName': 'Updated'})).displayName, 'Updated');
  });

  test('rejects unauthorized responses and hides backend error details', () async {
    for (final status in [401, 403, 503]) {
      final api = service(MockClient((_) async => http.Response('private-backend-details', status)));
      await expectLater(
          api.load(), throwsA(predicate((error) => !error.toString().contains('private-backend-details'))));
    }
  });

  testWidgets('loads, retries a failed save, and persists changed fields', (tester) async {
    final profile = data();
    var failSave = true;
    final api = service(MockClient((request) async {
      if (request.method == 'PATCH') {
        expect(jsonDecode(request.body), {'displayName': 'New name', 'voiceKey': 'thalia'});
        if (failSave) return http.Response('{}', 503);
        profile['displayName'] = 'New name';
        profile['preferences'] = {'voiceKey': 'thalia'};
      }
      return http.Response(jsonEncode(profile), 200);
    }));
    await tester.pumpWidget(MaterialApp(home: ProfileScreen(service: api)));
    await tester.pumpAndSettle();
    expect(find.text('test@example.com'), findsOneWidget);
    expect(find.text('Alex'), findsOneWidget);
    await tester.enterText(find.byType(TextFormField), 'New name');
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byType(DropdownButtonFormField<String>).first);
    await tester.tap(find.byType(DropdownButtonFormField<String>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Thalia — clear, upbeat').last);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Save changes'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();
    expect(find.text('Your changes could not be saved. Please try again.'), findsOneWidget);
    expect(find.text('New name'), findsOneWidget);
    failSave = false;
    await tester.ensureVisible(find.text('Save changes'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();
    expect(find.text('Profile saved.'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(MaterialApp(home: ProfileScreen(service: api)));
    await tester.pumpAndSettle();
    expect(find.text('New name'), findsOneWidget);
  });

  testWidgets('load failure offers retry and dirty navigation offers discard', (tester) async {
    var fail = true;
    final api = service(MockClient((_) async => http.Response(jsonEncode(data()), fail ? 503 : 200)));
    await tester.pumpWidget(MaterialApp(
        home: Builder(
            builder: (context) => TextButton(
                onPressed: () =>
                    Navigator.push(context, MaterialPageRoute<void>(builder: (_) => ProfileScreen(service: api))),
                child: const Text('Open settings')))));
    await tester.tap(find.text('Open settings'));
    await tester.pumpAndSettle();
    expect(find.text('Retry'), findsOneWidget);
    fail = false;
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), 'Unsaved');
    await tester.tap(find.byTooltip('Back to Diana'));
    await tester.pumpAndSettle();
    expect(find.text('Discard changes?'), findsOneWidget);
    await tester.tap(find.text('Keep editing'));
    await tester.pumpAndSettle();
    expect(find.text('Unsaved'), findsOneWidget);
    await tester.tap(find.byTooltip('Back to Diana'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Discard'));
    await tester.pumpAndSettle();
    expect(find.text('Open settings'), findsOneWidget);
  });
  testWidgets('manual location is saved and sharing can be turned off', (tester) async {
    final profile = data();
    final patches = <dynamic>[];
    final api = service(MockClient((request) async {
      if (request.method == 'PATCH') {
        final patch = jsonDecode(request.body);
        patches.add(patch);
        profile['preferences'] = {...(profile['preferences'] as Map), 'location': patch['location']};
      }
      return http.Response(jsonEncode(profile), 200);
    }));
    await tester.pumpWidget(MaterialApp(home: ProfileScreen(service: api)));
    await tester.pumpAndSettle();
    final dropdown = find.byKey(const ValueKey('location-off'));
    await tester.ensureVisible(dropdown);
    await tester.pumpAndSettle();
    await tester.tap(dropdown);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Use a city I enter').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).last, 'Paris, France');
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Save changes'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();
    expect(patches.last, {
      'location': {'mode': 'manual', 'city': 'Paris, France'}
    });
    expect(find.text('Profile saved.'), findsOneWidget);
    final manual = find.byKey(const ValueKey('location-manual'));
    await tester.ensureVisible(manual);
    await tester.pumpAndSettle();
    await tester.tap(manual);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Off — clear saved location').last);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('location-off')), findsOneWidget);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Save changes')).onPressed, isNotNull);
    await tester.ensureVisible(find.text('Save changes'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();
    expect(patches.last, {
      'location': {'mode': 'off'}
    });
  });
}
