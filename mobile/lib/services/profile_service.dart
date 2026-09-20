import 'dart:convert';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:http/http.dart' as http;
import 'cognito_auth.dart';

// Keys mirror web/lib/voices.ts and agent/src/voices.py.
const profileVoices = {
  'delia': 'Delia — warm, friendly',
  'thalia': 'Thalia — clear, upbeat',
  'andromeda': 'Andromeda — calm',
  'apollo': 'Apollo — confident',
  'orion': 'Orion — deep',
  'aria': 'Aria — expressive',
  'nova': 'Nova — lively',
};

class UserProfile {
  final String email, displayName, voiceKey, planId, status;
  const UserProfile(
      {required this.email,
      required this.displayName,
      required this.voiceKey,
      required this.planId,
      required this.status});
  factory UserProfile.fromJson(Map<String, dynamic> value) => UserProfile(
        email: value['email'] as String,
        displayName: value['displayName'] as String,
        voiceKey: value['preferences']['voiceKey'] as String,
        planId: value['subscription']['planId'] as String,
        status: value['subscription']['status'] as String,
      );
}

class ProfileService {
  ProfileService({http.Client? client, Future<String> Function()? token, String? endpoint})
      : _client = client,
        _token = token ?? cognitoAuth.accessToken,
        _endpoint = endpoint;
  final http.Client? _client;
  final Future<String> Function() _token;
  final String? _endpoint;

  Future<UserProfile> load() => _request();
  Future<UserProfile> update(Map<String, String> patch) => _request(patch);

  Future<UserProfile> _request([Map<String, String>? patch]) async {
    final session = Uri.parse(_endpoint ?? dotenv.env['LIVEKIT_TOKEN_ENDPOINT'] ?? '');
    if (session.scheme != 'https' || !session.path.endsWith('/sessions')) {
      throw Exception('Profile settings are not configured.');
    }
    final endpoint = Uri(
      scheme: session.scheme,
      host: session.host,
      port: session.hasPort ? session.port : null,
      path: session.path.replaceFirst(RegExp(r'/sessions$'), '/me'),
    );
    final token = await _token();
    final client = _client ?? http.Client();
    try {
      final headers = {'Authorization': 'Bearer $token', 'Content-Type': 'application/json'};
      final response = await (patch == null
              ? client.get(endpoint, headers: headers)
              : client.patch(endpoint, headers: headers, body: jsonEncode(patch)))
          .timeout(const Duration(seconds: 15));
      if (response.statusCode == 401 || response.statusCode == 403) {
        throw Exception('Please go back and sign in again.');
      }
      if (response.statusCode != 200) throw Exception('Unable to access your profile. Please try again.');
      return UserProfile.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
    } finally {
      if (_client == null) client.close();
    }
  }
}
