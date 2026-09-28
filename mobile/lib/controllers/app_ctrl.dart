import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:livekit_client/livekit_client.dart' as sdk;
import 'package:livekit_components/livekit_components.dart' as components;
import 'package:logging/logging.dart';
import 'package:uuid/uuid.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

import '../services/cognito_auth.dart';
import '../services/background_call.dart';
import '../services/device_timezone.dart';
import '../services/session_context.dart';
import '../services/search_sources.dart';

enum AppScreenState { welcome, agent }

enum AgentScreenState { visualizer, transcription }

class AppCtrl extends ChangeNotifier with WidgetsBindingObserver {
  static const uuid = Uuid();
  static final _logger = Logger('AppCtrl');

  // States
  AppScreenState appScreenState = AppScreenState.welcome;
  AgentScreenState agentScreenState = AgentScreenState.visualizer;

  //Test
  bool isUserCameEnabled = false;
  bool isScreenshareEnabled = false;

  final messageCtrl = TextEditingController();
  final messageFocusNode = FocusNode();

  late final sdk.Room room = sdk.Room(roomOptions: const sdk.RoomOptions(enableVisualizer: true));
  late final roomContext = components.RoomContext(room: room);
  late final sdk.Session session = _createSession(room: room);

  // Diana registers as a *named* agent ("diana"), so the app must explicitly
  // request that agent when fetching a token. This must match AGENT_NAME in the
  // agent (see ../../agent/src/agent.py).
  static const agentName = 'diana';

  sdk.Session _createSession({required sdk.Room room}) {
    final endpoint = dotenv.env['LIVEKIT_TOKEN_ENDPOINT']?.trim() ?? '';
    return sdk.Session.withAgent(
      agentName,
      tokenSource: sdk.CustomTokenSource((options) async {
        if (!endpoint.startsWith('https://')) throw StateError('An HTTPS session endpoint is required');
        final token = await cognitoAuth.accessToken();
        if (_ending || _hasCleanedUp) throw StateError('Conversation start cancelled');
        final result = await fetchSessionContext(endpoint, token);
        if (_ending || _hasCleanedUp) throw StateError('Conversation start cancelled');
        return result;
      }),
      options: sdk.SessionOptions(room: room),
    );
  }

  bool isSendButtonEnabled = false;
  bool isSessionStarting = false;
  bool _hasCleanedUp = false;
  bool _ending = false;
  final BackgroundCall _backgroundCall = BackgroundCall();
  String? connectionError;
  final List<SearchSources> searchSources = [];
  sdk.EventsListener<sdk.RoomEvent>? _contextListener;
  Timer? _timezoneTimer;
  String? _lastTimezone;

  Future<void> _syncTimezone() async {
    if (_hasCleanedUp || session.connectionState != sdk.ConnectionState.connected) return;
    final zone = await DeviceTimezone.current();
    if (zone == null || zone == _lastTimezone || _hasCleanedUp) return;
    try {
      final participant = room.localParticipant;
      if (participant == null) return;
      await participant.publishData(utf8.encode(jsonEncode({'timezone': zone})),
          reliable: true, topic: 'diana.timezone');
      _lastTimezone = zone;
    } catch (_) {/* Retry on next poll or resume. */}
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_syncTimezone());
  }

  AppCtrl() {
    WidgetsBinding.instance.addObserver(this);
    _timezoneTimer = Timer.periodic(const Duration(seconds: 30), (_) => unawaited(_syncTimezone()));
    _contextListener = room.createListener()
      ..on<sdk.DataReceivedEvent>((event) {
        if (event.topic != 'diana.sources' ||
            event.participant?.kind != sdk.ParticipantKind.AGENT ||
            event.data.length > 16000) {
          return;
        }
        try {
          final sources = SearchSources.parse(jsonDecode(utf8.decode(event.data)));
          if (sources != null && !_hasCleanedUp) {
            searchSources.removeWhere((item) => item.id == sources.id);
            searchSources.add(sources);
            if (searchSources.length > 10) searchSources.removeAt(0);
            notifyListeners();
          }
        } catch (_) {/* Ignore malformed source messages. */}
      });
    _backgroundCall.onEnd(disconnect);
    final format = DateFormat('HH:mm:ss');
    // configure logs for debugging
    Logger.root.level = Level.WARNING;
    Logger.root.onRecord.listen((record) {
      debugPrint('${format.format(record.time)}: ${record.message}');
    });

    messageCtrl.addListener(() {
      final newValue = messageCtrl.text.isNotEmpty;
      if (newValue != isSendButtonEnabled) {
        isSendButtonEnabled = newValue;
        notifyListeners();
      }
    });

    session.addListener(_handleSessionChange);
  }

  Future<void> cleanUp() async {
    if (_hasCleanedUp) return;
    _hasCleanedUp = true;
    WidgetsBinding.instance.removeObserver(this);
    _timezoneTimer?.cancel();
    await _contextListener?.dispose();

    session.removeListener(_handleSessionChange);
    _backgroundCall.onEnd(null);
    await session.dispose();
    await _backgroundCall.stop();
    await room.dispose();
    roomContext.dispose();
    messageCtrl.dispose();
    messageFocusNode.dispose();
  }

  @override
  void dispose() {
    unawaited(cleanUp());
    super.dispose();
  }

  void sendMessage() async {
    isSendButtonEnabled = false;

    final text = messageCtrl.text;
    messageCtrl.clear();
    notifyListeners();

    if (text.isEmpty) return;
    await session.sendText(text);
  }

  void toggleUserCamera(components.MediaDeviceContext? deviceCtx) {
    isUserCameEnabled = !isUserCameEnabled;
    isUserCameEnabled ? deviceCtx?.enableCamera() : deviceCtx?.disableCamera();
    notifyListeners();
  }

  void toggleScreenShare() {
    isScreenshareEnabled = !isScreenshareEnabled;
    notifyListeners();
  }

  void toggleAgentScreenMode() {
    agentScreenState =
        agentScreenState == AgentScreenState.visualizer ? AgentScreenState.transcription : AgentScreenState.visualizer;
    notifyListeners();
  }

  void connect() async {
    if (isSessionStarting) {
      _logger.fine('Connection attempt ignored: session already starting.');
      return;
    }

    _logger.info('Starting session connection…');
    isSessionStarting = true;
    _lastTimezone = null;
    searchSources.clear();
    connectionError = null;
    notifyListeners();

    try {
      await _backgroundCall.start();
      if (_hasCleanedUp || _ending) {
        await _backgroundCall.stop();
        return;
      }
      await session.start();
      if (_ending) {
        await session.end();
        return;
      }
      if (session.connectionState == sdk.ConnectionState.connected) {
        appScreenState = AppScreenState.agent;
        notifyListeners();
      }
    } catch (error, stackTrace) {
      _logger.severe('Connection error: $error', error, stackTrace);
      try {
        await session.end();
      } finally {
        await _backgroundCall.stop();
      }
      connectionError = 'Could not start the conversation. Check microphone permission and try again.';
      appScreenState = AppScreenState.welcome;
      notifyListeners();
    } finally {
      if (session.connectionState == sdk.ConnectionState.disconnected) {
        await _backgroundCall.stop();
      }
      if (isSessionStarting) {
        isSessionStarting = false;
        _ending = false;
        notifyListeners();
      }
    }
  }

  Future<void> disconnect() async {
    if (_ending) return;
    _ending = true;
    try {
      await session.end();
    } finally {
      await _backgroundCall.stop();
      // Leave the flag set until an in-flight start has finished cancelling.
      if (!isSessionStarting) _ending = false;
    }
    session.restoreMessageHistory(const []);
    appScreenState = AppScreenState.welcome;
    agentScreenState = AgentScreenState.visualizer;
    notifyListeners();
  }

  void _handleSessionChange() {
    final sdk.ConnectionState state = session.connectionState;
    AppScreenState? nextScreen;
    switch (state) {
      case sdk.ConnectionState.connected:
        unawaited(_syncTimezone());
        nextScreen = AppScreenState.agent;
        break;
      case sdk.ConnectionState.reconnecting:
        _lastTimezone = null;
        nextScreen = AppScreenState.agent;
        break;
      case sdk.ConnectionState.disconnected:
        if (!isSessionStarting) unawaited(_backgroundCall.stop());
        nextScreen = AppScreenState.welcome;
        break;
      case sdk.ConnectionState.connecting:
        nextScreen = null;
        break;
    }

    if (nextScreen != null && nextScreen != appScreenState) {
      appScreenState = nextScreen;
      notifyListeners();
    }
  }
}
