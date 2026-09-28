package com.livekit.example.VoiceAssistantFlutter

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import io.flutter.plugin.common.MethodChannel

/** One foreground, approximate fix. No background location permission or tracking. */
class DeviceLocation(private val activity: Activity) {
    private val handler = Handler(Looper.getMainLooper())
    private val manager = activity.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private var pending: MethodChannel.Result? = null
    private var cancellation: CancellationSignal? = null
    private var listener: LocationListener? = null
    private val timeout = Runnable { finish(null) }

    fun current(requestPermission: Boolean, result: MethodChannel.Result) {
        if (pending != null) { result.success(null); return }
        pending = result
        if (activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            if (requestPermission) {
                handler.postDelayed(timeout, 35000)
                activity.requestPermissions(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION), REQUEST)
            } else finish(null)
            return
        }
        locate()
    }

    fun permissionResult() {
        if (pending == null) return
        handler.removeCallbacks(timeout)
        if (activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) locate()
        else finish(null)
    }

    @Suppress("DEPRECATION")
    private fun locate() {
        handler.postDelayed(timeout, 6500)
        try {
            val provider = when {
                manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
                Build.VERSION.SDK_INT >= 31 && manager.isProviderEnabled(LocationManager.FUSED_PROVIDER) -> LocationManager.FUSED_PROVIDER
                else -> { finish(null); return }
            }
            if (Build.VERSION.SDK_INT >= 30) {
                cancellation = CancellationSignal()
                manager.getCurrentLocation(provider, cancellation, activity.mainExecutor) { finish(it) }
            } else {
                val callback = object : LocationListener {
                    override fun onLocationChanged(location: Location) { finish(location) }
                    override fun onProviderDisabled(provider: String) { finish(null) }
                    override fun onProviderEnabled(provider: String) {}
                    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
                }
                listener = callback
                manager.requestSingleUpdate(provider, callback, Looper.getMainLooper())
            }
        } catch (_: Exception) { finish(null) }
    }

    private fun finish(location: Location?) {
        val result = pending ?: return
        pending = null
        handler.removeCallbacks(timeout)
        cancellation?.cancel()
        cancellation = null
        listener?.let { try { manager.removeUpdates(it) } catch (_: Exception) {} }
        listener = null
        val age = location?.let { System.currentTimeMillis() - it.time }
        if (location == null || !location.hasAccuracy() || age == null || age < -60000 || age > 600000) result.success(null)
        else result.success(mapOf("latitude" to location.latitude, "longitude" to location.longitude,
            "accuracyMeters" to location.accuracy.toDouble(), "timestamp" to location.time))
    }
    fun close() { finish(null) }
    companion object { const val REQUEST = 1043 }
}
