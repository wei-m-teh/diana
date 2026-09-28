package com.livekit.example.VoiceAssistantFlutter

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.*

/** Keeps the existing Flutter/LiveKit call alive; never starts or restarts a call. */
class ConversationService : Service() {
    companion object {
        const val END = "com.diana.END_CALL"
        const val CHANNEL = "diana_conversation"
        const val NOTIFICATION = 1042
        var onReady: ((String?) -> Unit)? = null
        var onEndRequested: (() -> Unit)? = null
    }
    private var wakeLock: PowerManager.WakeLock? = null
    private val handler = Handler(Looper.getMainLooper())
    override fun onBind(intent: Intent?) = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == END) {
            requestEnd()
            return START_NOT_STICKY
        }
        try {
            val manager = getSystemService(NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= 26) {
                manager.createNotificationChannel(NotificationChannel(
                    CHANNEL, "Diana conversations", NotificationManager.IMPORTANCE_LOW
                ))
            }
            val open = PendingIntent.getActivity(this, 0,
                Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val end = PendingIntent.getService(this, 1,
                Intent(this, ConversationService::class.java).setAction(END),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL)
                else Notification.Builder(this)
            val notification = builder
                .setSmallIcon(R.drawable.ic_call_notification)
                .setContentTitle("Diana conversation")
                .setContentText("Voice conversation active · Tap End to disconnect")
                .setCategory(Notification.CATEGORY_CALL)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(open)
                .addAction(Notification.Action.Builder(null, "End", end).build())
                .build()
            if (Build.VERSION.SDK_INT >= 30) {
                startForeground(NOTIFICATION, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            } else {
                startForeground(NOTIFICATION, notification)
            }
            if (wakeLock == null) {
                wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
                    .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Diana:Conversation")
                    .apply { setReferenceCounted(false); acquire() }
            }
            onReady?.invoke(null)
            onReady = null
        } catch (error: Exception) {
            onReady?.invoke("Android could not enable background calling. Keep Diana open and try again.")
            onReady = null
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun requestEnd() {
        val callback = onEndRequested
        if (callback == null) stopSelf() else {
            callback()
            // Bound cleanup if the Flutter engine cannot respond.
            handler.postDelayed({ stopSelf() }, 10_000)
        }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        requestEnd()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}
