package com.finalapp.vibe2

// Source of truth: apps/mobile/plugins/foreground-service-android.
// The checked-in android/ copy is a generated mirror for non-mutating Kotlin compile checks.

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

  @ReactMethod
  fun isRunning(promise: Promise) {
    promise.resolve(SshForegroundService.isRunning())
  }

  @ReactMethod
  fun postAgentAlert(
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
    vibrate: Boolean,
    promise: Promise
  ) {
    try {
      SshForegroundService.postAgentAlert(
        reactContext.applicationContext,
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
      )
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("AGENT_ALERT_POST_FAILED", e)
    }
  }

  @ReactMethod
  fun cancelAgentAlert(notificationId: Int, promise: Promise) {
    try {
      SshForegroundService.cancelAgentAlert(
        reactContext.applicationContext,
        notificationId
      )
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("AGENT_ALERT_CANCEL_FAILED", e)
    }
  }
}
