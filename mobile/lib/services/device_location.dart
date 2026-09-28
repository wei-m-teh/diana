import 'dart:async';
import 'dart:math';
import 'package:flutter/services.dart';

class DeviceLocation {
  static const channel = MethodChannel('diana/location');
  static Future<Map<String, dynamic>?> current({bool requestPermission = false}) async {
    try {
      final value = await channel
          .invokeMapMethod<String, dynamic>('current', requestPermission)
          .timeout(Duration(seconds: requestPermission ? 38 : 8));
      if (value == null) return null;
      final lat = value['latitude'],
          lon = value['longitude'],
          accuracy = value['accuracyMeters'],
          time = value['timestamp'];
      if (lat is! num ||
          lon is! num ||
          accuracy is! num ||
          time is! num ||
          !lat.isFinite ||
          !lon.isFinite ||
          !accuracy.isFinite ||
          !time.isFinite ||
          lat.abs() > 90 ||
          lon.abs() > 180 ||
          accuracy < 0 ||
          accuracy > 100000) {
        return null;
      }
      final age = DateTime.now().millisecondsSinceEpoch - time;
      if (age < -60000 || age > 600000) return null;
      return {
        'latitude': (lat * 100).round() / 100,
        'longitude': (lon * 100).round() / 100,
        'accuracyMeters': max(1000, accuracy),
        'capturedAt': DateTime.fromMillisecondsSinceEpoch(time.toInt(), isUtc: true).toIso8601String()
      };
    } on PlatformException {
      return null;
    } on MissingPluginException {
      return null;
    } on TimeoutException {
      return null;
    }
  }
}
