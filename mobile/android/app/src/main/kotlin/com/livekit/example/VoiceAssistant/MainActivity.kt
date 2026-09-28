package com.livekit.example.VoiceAssistantFlutter

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import java.util.TimeZone
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var deviceLocation: DeviceLocation? = null
    private var locationChannel: MethodChannel? = null
    private var pendingStart: MethodChannel.Result? = null
    private var channel: MethodChannel? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        deviceLocation = DeviceLocation(this)
        locationChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "diana/location")
        locationChannel?.setMethodCallHandler { call, result ->
            if (call.method == "current") deviceLocation?.current(call.arguments == true, result)
            else result.notImplemented()
        }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "diana/timezone").setMethodCallHandler { call, result ->
            when (call.method) {
                "current" -> result.success(TimeZone.getDefault().id)
                "isValid" -> result.success(call.arguments is String && TimeZone.getAvailableIDs().contains(call.arguments as String))
                else -> result.notImplemented()
            }
        }
        channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "diana/background_call")
        ConversationService.onEndRequested = { channel?.invokeMethod("endCall", null) }
        channel?.setMethodCallHandler { call, result ->
            when (call.method) {
                "start" -> {
                    if (pendingStart != null) {
                        result.error("busy", "A call is already starting.", null)
                    } else {
                        pendingStart = result
                        val permissions = mutableListOf(Manifest.permission.RECORD_AUDIO)
                        if (Build.VERSION.SDK_INT >= 31) permissions.add(Manifest.permission.BLUETOOTH_CONNECT)
                        if (Build.VERSION.SDK_INT >= 33) permissions.add(Manifest.permission.POST_NOTIFICATIONS)
                        val missing = permissions.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
                        if (missing.isEmpty()) startCallService()
                        else requestPermissions(missing.toTypedArray(), 1042)
                    }
                }
                "stop" -> {
                    stopService(Intent(this, ConversationService::class.java))
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == DeviceLocation.REQUEST) deviceLocation?.permissionResult()
        if (requestCode == 1042) startCallService()
    }

    private fun startCallService() {
        if (pendingStart == null) return
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingStart?.error("microphone_denied", "Allow microphone access to start a voice conversation.", null)
            pendingStart = null
            return
        }
        ConversationService.onReady = { error ->
            if (error == null) pendingStart?.success(null)
            else pendingStart?.error("background_call_failed", error, null)
            pendingStart = null
        }
        try {
            val intent = Intent(this, ConversationService::class.java)
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent) else startService(intent)
        } catch (error: Exception) {
            ConversationService.onReady = null
            pendingStart?.error("background_call_failed", "Open Diana before starting a voice conversation.", null)
            pendingStart = null
        }
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        deviceLocation?.close()
        deviceLocation = null
        locationChannel?.setMethodCallHandler(null)
        locationChannel = null
        ConversationService.onReady = null
        ConversationService.onEndRequested = null
        pendingStart?.error("activity_closed", "Diana was closed before the call started.", null)
        pendingStart = null
        channel?.setMethodCallHandler(null)
        channel = null
        stopService(Intent(this, ConversationService::class.java))
        super.cleanUpFlutterEngine(flutterEngine)
    }
}
