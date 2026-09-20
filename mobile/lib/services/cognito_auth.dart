import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

final cognitoAuth = CognitoAuth();

class CognitoAuth extends ChangeNotifier {
  final _appAuth = const FlutterAppAuth();
  final _storage = const FlutterSecureStorage();
  String? _accessToken;
  String? _idToken;
  DateTime? _expires;
  bool busy = false;
  String? error;
  bool get signedIn => _accessToken != null;
  String get _client => dotenv.env['COGNITO_CLIENT_ID'] ?? '';
  String get _issuer => dotenv.env['COGNITO_ISSUER'] ?? '';
  String get _domain => dotenv.env['COGNITO_DOMAIN'] ?? '';
  String get _redirect => 'com.diana.app:/oauth2redirect';
  List<String> get _scopes => ['openid', 'email', 'diana/sessions.create'];
  String get _storageKey => 'diana.refresh.$_client';

  Future<void> _accept(TokenResponse response) async {
    if (response.accessToken == null) throw StateError('Missing access token');
    _accessToken = response.accessToken;
    _idToken = response.idToken ?? _idToken;
    _expires = response.accessTokenExpirationDateTime;
    if (response.refreshToken != null) {
      await _storage.write(key: _storageKey, value: response.refreshToken);
    }
    notifyListeners();
  }

  Future<void> restore() async {
    try {
      if (_client.isEmpty) return;
      final refresh = await _storage.read(key: _storageKey);
      if (refresh != null) await _refresh(refresh);
    } catch (_) {
      // Network failures can be retried through sign-in; never use an expired token.
      _accessToken = null;
    }
  }

  Future<void> signIn() async {
    if (busy) return;
    busy = true;
    error = null;
    notifyListeners();
    try {
      if (_client.isEmpty || !_issuer.startsWith('https://')) throw StateError('Sign-in is not configured');
      await _accept(await _appAuth.authorizeAndExchangeCode(AuthorizationTokenRequest(
        _client,
        _redirect,
        issuer: _issuer,
        scopes: _scopes,
      )));
    } catch (_) {
      error = 'Sign-in was not completed. Please try again.';
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> _refresh(String refresh) async {
    await _accept(await _appAuth.token(TokenRequest(
      _client,
      _redirect,
      issuer: _issuer,
      refreshToken: refresh,
      scopes: _scopes,
    )));
  }

  Future<String> accessToken() async {
    try {
      if (_accessToken == null ||
          _expires == null ||
          _expires!.isBefore(DateTime.now().add(const Duration(seconds: 60)))) {
        final refresh = await _storage.read(key: _storageKey);
        if (refresh == null) throw StateError('Sign in required');
        await _refresh(refresh);
      }
      return _accessToken!;
    } catch (_) {
      _accessToken = null;
      error = 'Please sign in again.';
      notifyListeners();
      throw StateError('Sign in required');
    }
  }

  Future<void> signOut() async {
    final idToken = _idToken;
    final refresh = await _storage.read(key: _storageKey);
    _accessToken = null;
    _idToken = null;
    _expires = null;
    await _storage.delete(key: _storageKey);
    notifyListeners();
    try {
      if (refresh != null) {
        await http.post(Uri.parse('$_domain/oauth2/revoke'),
            body: {'token': refresh, 'client_id': _client}).timeout(const Duration(seconds: 10));
      }
    } catch (_) {
      // Clear local credentials even if the revocation endpoint is unreachable.
    }
    try {
      await _appAuth.endSession(EndSessionRequest(
        idTokenHint: idToken,
        postLogoutRedirectUrl: 'com.diana.app:/signout',
        serviceConfiguration: AuthorizationServiceConfiguration(
          authorizationEndpoint: '$_domain/oauth2/authorize',
          tokenEndpoint: '$_domain/oauth2/token',
          endSessionEndpoint: '$_domain/logout',
        ),
        additionalParameters: {'client_id': _client, 'logout_uri': 'com.diana.app:/signout'},
      ));
    } catch (_) {
      error = 'Signed out of Diana. Browser sign-out was not completed.';
      notifyListeners();
    }
  }
}
