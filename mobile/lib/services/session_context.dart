import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:livekit_client/livekit_client.dart' as sdk;
import 'device_timezone.dart';
import 'device_location.dart';
import 'profile_service.dart';

Future<sdk.TokenSourceResponse> fetchSessionContext(String endpoint, String token,
    {http.Client? client,
    Future<String?> Function()? timezone,
    Future<Map<String, dynamic>?> Function()? location}) async {
  final requestClient = client ?? http.Client();
  try {
    final profile = await ProfileService(client: requestClient, token: () async => token, endpoint: endpoint).load();
    final fix = profile.locationMode == 'device' ? await (location ?? DeviceLocation.current)() : null;
    final response = await requestClient
        .post(Uri.parse(endpoint),
            headers: {
              'Authorization': 'Bearer $token',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({'deviceTimezone': await (timezone ?? DeviceTimezone.current)(), 'deviceLocation': fix}))
        .timeout(const Duration(seconds: 15));
    if (response.statusCode != 200) throw StateError('Unable to start conversation');
    return sdk.TokenSourceResponse.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  } finally {
    if (client == null) requestClient.close();
  }
}
