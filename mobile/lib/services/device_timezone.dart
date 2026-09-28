import 'dart:async';
import 'package:flutter/services.dart';

class DeviceTimezone {
  static const channel = MethodChannel('diana/timezone');
  static Future<String?> current() async {
    try {
      return await channel.invokeMethod<String>('current').timeout(const Duration(seconds: 2));
    } on TimeoutException {
      return null;
    } on PlatformException {
      return null;
    } on MissingPluginException {
      return null;
    }
  }

  static Future<bool> isValid(String value) async {
    if (value.isEmpty || value.length > 100) return false;
    try {
      return await channel.invokeMethod<bool>('isValid', value).timeout(const Duration(seconds: 2)) ?? false;
    } on TimeoutException {
      return false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }
}
