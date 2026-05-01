import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
	AndroidConfig,
	type ConfigPlugin,
	withAndroidManifest,
	withDangerousMod,
} from 'expo/config-plugins';

const PERMISSIONS = [
	'android.permission.FOREGROUND_SERVICE',
	'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
	'android.permission.POST_NOTIFICATIONS',
	'android.permission.WAKE_LOCK',
];

const SERVICE_NAME = '.SshForegroundService';

const SSH_FOREGROUND_SERVICE_KOTLIN = `package com.finalapp.vibe2

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class SshForegroundService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onCreate() {
    super.onCreate()
    ensureNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: DEFAULT_TITLE
    val message = intent?.getStringExtra(EXTRA_MESSAGE) ?: DEFAULT_MESSAGE
    startForeground(NOTIFICATION_ID, buildNotification(title, message))
    acquireWakeLock()
    return START_STICKY
  }

  override fun onDestroy() {
    releaseWakeLock()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      stopForeground(true)
    }
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(
      CHANNEL_ID,
      CHANNEL_NAME,
      NotificationManager.IMPORTANCE_LOW
    )
    channel.description = CHANNEL_DESCRIPTION
    manager.createNotificationChannel(channel)
  }

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
    if (wakeLock?.isHeld == true) return
    val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = powerManager.newWakeLock(
      PowerManager.PARTIAL_WAKE_LOCK,
      WAKE_LOCK_TAG
    ).apply { setReferenceCounted(false) }
    wakeLock?.acquire()
  }

  private fun releaseWakeLock() {
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
    private const val WAKE_LOCK_TAG = "Fressh::SshForegroundService"
    private const val DEFAULT_TITLE = "Fressh Terminal"
    private const val DEFAULT_MESSAGE = "Keeping SSH connection alive"
    const val EXTRA_TITLE = "title"
    const val EXTRA_MESSAGE = "message"

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
  }
}
`;

const FOREGROUND_SERVICE_MODULE_KOTLIN = `package com.finalapp.vibe2

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class ForegroundServiceModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "FresshForegroundService"

  @ReactMethod
  fun start(title: String, message: String, promise: Promise) {
    try {
      SshForegroundService.start(reactContext, title, message)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("FOREGROUND_SERVICE_START_FAILED", e)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      SshForegroundService.stop(reactContext)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("FOREGROUND_SERVICE_STOP_FAILED", e)
    }
  }
}
`;

const withForegroundServiceManifest: ConfigPlugin = (config) =>
	withAndroidManifest(config, (config) => {
		const manifest = config.modResults;

		AndroidConfig.Permissions.ensurePermissions(manifest, PERMISSIONS);

		const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
		app.service = app.service ?? [];
		type ServiceAttributesWithStopWithTask =
			(typeof app.service)[number]['$'] & {
				'android:stopWithTask'?: 'true' | 'false';
			};
		const alreadyPresent = app.service.some(
			(service) => service.$['android:name'] === SERVICE_NAME,
		);
		if (!alreadyPresent) {
			app.service.push({
				$: {
					'android:name': SERVICE_NAME,
					'android:exported': 'false',
					'android:foregroundServiceType': 'dataSync',
					'android:stopWithTask': 'true',
				} as ServiceAttributesWithStopWithTask,
			});
		}

		return config;
	});

const withForegroundServiceNativeFiles: ConfigPlugin = (config) =>
	withDangerousMod(config, [
		'android',
		async (config) => {
			const javaPackagePath = path.join(
				config.modRequest.platformProjectRoot,
				'app/src/main/java/com/finalapp/vibe2',
			);
			await fs.mkdir(javaPackagePath, { recursive: true });

			await fs.writeFile(
				path.join(javaPackagePath, 'SshForegroundService.kt'),
				SSH_FOREGROUND_SERVICE_KOTLIN,
				'utf8',
			);
			await fs.writeFile(
				path.join(javaPackagePath, 'ForegroundServiceModule.kt'),
				FOREGROUND_SERVICE_MODULE_KOTLIN,
				'utf8',
			);

			return config;
		},
	]);

const withForegroundService: ConfigPlugin = (config) => {
	config = withForegroundServiceManifest(config);
	config = withForegroundServiceNativeFiles(config);
	return config;
};

export default withForegroundService;
