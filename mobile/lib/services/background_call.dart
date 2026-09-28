import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Android keeps the existing LiveKit call alive, not a second background call.
class BackgroundCall {
  static const channel = MethodChannel('diana/background_call');
  final bool enabled;
  BackgroundCall({bool? enabled}) : enabled = enabled ?? (!kIsWeb && defaultTargetPlatform == TargetPlatform.android);

  void onEnd(Future<void> Function()? callback) {
    if (!enabled) return;
    channel.setMethodCallHandler(callback == null
        ? null
        : (call) async {
            if (call.method == 'endCall') await callback();
          });
  }

  Future<void> start() async {
    if (enabled) await channel.invokeMethod<void>('start');
  }

  Future<void> stop() async {
    if (enabled) await channel.invokeMethod<void>('stop');
  }
}
