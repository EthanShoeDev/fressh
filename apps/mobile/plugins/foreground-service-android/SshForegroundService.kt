package com.finalapp.vibe2

// Source of truth: apps/mobile/plugins/foreground-service-android.
// The checked-in android/ copy is a generated mirror for non-mutating Kotlin compile checks.

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class SshForegroundService : Service() {
  private val wakeLockHandler = Handler(Looper.getMainLooper())
  private val renewWakeLockRunnable = Runnable {
    if (wakeLock?.isHeld == true) {
      acquireWakeLock()
    }
  }
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onCreate() {
    super.onCreate()
    ensureNotificationChannels(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent == null) {
      isServiceRunning = false
      stopSelf(startId)
      return START_NOT_STICKY
    }
    val title = intent.getStringExtra(EXTRA_TITLE) ?: DEFAULT_TITLE
    val message = intent.getStringExtra(EXTRA_MESSAGE) ?: DEFAULT_MESSAGE
    startForeground(NOTIFICATION_ID, buildNotification(title, message))
    isServiceRunning = true
    acquireWakeLock()
    return START_NOT_STICKY
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    isServiceRunning = false
    stopSelf(startId)
  }

  override fun onDestroy() {
    isServiceRunning = false
    releaseWakeLock()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      stopForeground(true)
    }
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun buildNotification(title: String, message: String): Notification {
    val intent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pendingIntent = PendingIntent.getActivity(
      this,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(message)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }

  private fun acquireWakeLock() {
    releaseWakeLock()
    val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = powerManager.newWakeLock(
      PowerManager.PARTIAL_WAKE_LOCK,
      WAKE_LOCK_TAG
    ).apply { setReferenceCounted(false) }
    wakeLock?.acquire(WAKE_LOCK_LEASE_MS)
    scheduleWakeLockRenewal()
  }

  private fun scheduleWakeLockRenewal() {
    wakeLockHandler.removeCallbacks(renewWakeLockRunnable)
    wakeLockHandler.postDelayed(renewWakeLockRunnable, WAKE_LOCK_RENEWAL_MS)
  }

  private fun releaseWakeLock() {
    wakeLockHandler.removeCallbacks(renewWakeLockRunnable)
    try {
      if (wakeLock?.isHeld == true) {
        wakeLock?.release()
      }
    } finally {
      wakeLock = null
    }
  }

  companion object {
    private const val NOTIFICATION_ID = 4227
    private const val CHANNEL_ID = "fressh_ssh"
    private const val CHANNEL_NAME = "Fressh SSH"
    private const val CHANNEL_DESCRIPTION = "Keeps SSH sessions alive"
    private const val AGENT_ALERT_CHANNEL_ID = "fressh_agent_alerts"
    private const val AGENT_ALERT_CHANNEL_NAME = "Fressh Agent Alerts"
    private const val AGENT_ALERT_CHANNEL_DESCRIPTION = "Agent status notifications"
    private const val AGENT_ALERT_VIBRATE_CHANNEL_ID = "fressh_agent_alerts_vibrate"
    private const val AGENT_ALERT_VIBRATE_CHANNEL_NAME = "Fressh Agent Alerts"
    private val AGENT_ALERT_VIBRATE_PATTERN = longArrayOf(0L, 180L, 80L, 180L)
    private const val WAKE_LOCK_TAG = "Fressh::SshForegroundService"
    private const val WAKE_LOCK_LEASE_MS = 5L * 60L * 60L * 1000L
    private const val WAKE_LOCK_RENEWAL_MS = 4L * 60L * 60L * 1000L
    @Volatile private var isServiceRunning = false
    private const val DEFAULT_TITLE = "Fressh Terminal"
    private const val DEFAULT_MESSAGE = "Keeping SSH connection alive"
    const val EXTRA_TITLE = "title"
    const val EXTRA_MESSAGE = "message"
    const val EXTRA_AGENT_CONNECTION_ID = "agentConnectionId"
    const val EXTRA_AGENT_NOTIFICATION_CONNECTION_ID = "agentNotificationConnectionId"
    const val EXTRA_AGENT_SESSION = "agentSession"
    const val EXTRA_AGENT_TARGET = "agentTarget"
    const val EXTRA_AGENT_WINDOW_ID = "agentWindowId"
    const val EXTRA_AGENT_EVENT_ID = "agentEventId"
    const val EXTRA_AGENT_TAP_TOKEN = "agentTapToken"

    private fun ensureNotificationChannels(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val channel = NotificationChannel(
        CHANNEL_ID,
        CHANNEL_NAME,
        NotificationManager.IMPORTANCE_LOW
      )
      channel.description = CHANNEL_DESCRIPTION
      manager.createNotificationChannel(channel)

      val alertChannel = NotificationChannel(
        AGENT_ALERT_CHANNEL_ID,
        AGENT_ALERT_CHANNEL_NAME,
        NotificationManager.IMPORTANCE_DEFAULT
      )
      alertChannel.description = AGENT_ALERT_CHANNEL_DESCRIPTION
      alertChannel.lockscreenVisibility = Notification.VISIBILITY_PRIVATE
      alertChannel.enableVibration(false)
      manager.createNotificationChannel(alertChannel)

      val vibrateChannel = NotificationChannel(
        AGENT_ALERT_VIBRATE_CHANNEL_ID,
        AGENT_ALERT_VIBRATE_CHANNEL_NAME,
        NotificationManager.IMPORTANCE_DEFAULT
      )
      vibrateChannel.description = AGENT_ALERT_CHANNEL_DESCRIPTION
      vibrateChannel.lockscreenVisibility = Notification.VISIBILITY_PRIVATE
      vibrateChannel.enableVibration(true)
      vibrateChannel.vibrationPattern = AGENT_ALERT_VIBRATE_PATTERN
      manager.createNotificationChannel(vibrateChannel)
    }

    private fun agentAlertChannelId(vibrate: Boolean): String =
      if (vibrate) AGENT_ALERT_VIBRATE_CHANNEL_ID else AGENT_ALERT_CHANNEL_ID

    private fun buildAgentAlertPublicNotification(
      context: Context,
      vibrate: Boolean
    ): Notification {
      return NotificationCompat.Builder(context, agentAlertChannelId(vibrate))
        .setContentTitle("Fressh")
        .setContentText("Agent notification")
        .setSmallIcon(R.mipmap.ic_launcher)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .build()
    }

    private fun buildAgentAlertNotification(
      context: Context,
      notificationId: Int,
      title: String,
      message: String,
      connectionId: String,
      channelId: Int,
      notificationConnectionId: String,
      session: String,
      target: String,
      windowId: String,
      eventId: String,
      tapToken: String,
      vibrate: Boolean
    ): Notification {
      val route = Uri.Builder()
        .scheme("fressh")
        .path("/shell/detail")
        .appendQueryParameter("connectionId", connectionId)
        .appendQueryParameter("channelId", channelId.toString())
        .appendQueryParameter("agentConnectionId", notificationConnectionId)
        .appendQueryParameter("agentSession", session)
        .appendQueryParameter("agentWindowId", windowId)
        .appendQueryParameter("agentEventId", eventId)
        .appendQueryParameter("agentTapToken", tapToken)
        .build()
      val intent = Intent(Intent.ACTION_VIEW, route, context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        putExtra(EXTRA_AGENT_CONNECTION_ID, notificationConnectionId)
        putExtra(EXTRA_AGENT_NOTIFICATION_CONNECTION_ID, notificationConnectionId)
        putExtra(EXTRA_AGENT_SESSION, session)
        putExtra(EXTRA_AGENT_TARGET, target)
        putExtra(EXTRA_AGENT_WINDOW_ID, windowId)
        putExtra(EXTRA_AGENT_EVENT_ID, eventId)
        putExtra(EXTRA_AGENT_TAP_TOKEN, tapToken)
      }
      val pendingIntent = PendingIntent.getActivity(
        context,
        notificationId,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )

      val builder = NotificationCompat.Builder(context, agentAlertChannelId(vibrate))
        .setContentTitle(title)
        .setContentText(message)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentIntent(pendingIntent)
        .setAutoCancel(false)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setPublicVersion(buildAgentAlertPublicNotification(context, vibrate))
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)

      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O && vibrate) {
        builder.setVibrate(AGENT_ALERT_VIBRATE_PATTERN)
      }

      return builder.build()
    }

    fun start(context: Context, title: String, message: String) {
      val intent = Intent(context, SshForegroundService::class.java).apply {
        putExtra(EXTRA_TITLE, title)
        putExtra(EXTRA_MESSAGE, message)
      }
      ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context) {
      val intent = Intent(context, SshForegroundService::class.java)
      context.stopService(intent)
    }

    fun isRunning(): Boolean = isServiceRunning

    fun postAgentAlert(
      context: Context,
      notificationId: Int,
      title: String,
      message: String,
      connectionId: String,
      channelId: Int,
      notificationConnectionId: String,
      session: String,
      target: String,
      windowId: String,
      eventId: String,
      tapToken: String,
      vibrate: Boolean
    ) {
      ensureNotificationChannels(context)
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.notify(notificationId, buildAgentAlertNotification(
        context,
        notificationId,
        title,
        message,
        connectionId,
        channelId,
        notificationConnectionId,
        session,
        target,
        windowId,
        eventId,
        tapToken,
        vibrate
      ))
    }

    fun cancelAgentAlert(context: Context, notificationId: Int) {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.cancel(notificationId)
    }
  }
}
