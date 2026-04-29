import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
	AndroidConfig,
	type ConfigPlugin,
	withAndroidManifest,
	withDangerousMod,
	withStringsXml,
} from 'expo/config-plugins';

const SERVICE_NAME = '.WisprAutomationAccessibilityService';
const SERVICE_LABEL = 'Fressh Wispr Automation';
const SERVICE_PERMISSION = 'android.permission.BIND_ACCESSIBILITY_SERVICE';
const ACCESSIBILITY_SERVICE_ACTION =
	'android.accessibilityservice.AccessibilityService';
const ACCESSIBILITY_SERVICE_RESOURCE =
	'@xml/wispr_automation_accessibility_service';

const DESCRIPTION_RESOURCE = 'wispr_automation_accessibility_description';
const DESCRIPTION_TEXT = 'Fressh local Wispr automation';
const SUMMARY_RESOURCE = 'wispr_automation_accessibility_summary';
const SUMMARY_TEXT =
	'Lets Fressh tap the Wispr Flow bubble for local dictation automation.';

const ACCESSIBILITY_SERVICE_XML = `<?xml version="1.0" encoding="utf-8"?>
<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
\tandroid:description="@string/${DESCRIPTION_RESOURCE}"
\tandroid:summary="@string/${SUMMARY_RESOURCE}"
\tandroid:accessibilityEventTypes="typeWindowsChanged|typeWindowStateChanged|typeViewClicked|typeViewFocused|typeViewTextChanged"
\tandroid:accessibilityFeedbackType="feedbackGeneric"
\tandroid:accessibilityFlags="flagRetrieveInteractiveWindows|flagReportViewIds"
\tandroid:canRetrieveWindowContent="true"
\tandroid:canPerformGestures="true"
\tandroid:notificationTimeout="50" />
`;

const ACCESSIBILITY_SERVICE_KOTLIN = `package com.finalapp.vibe2

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Path
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import java.lang.ref.WeakReference
import java.util.Locale

class WisprAutomationAccessibilityService : AccessibilityService() {
  companion object {
    private const val WISPR_PACKAGE = "com.wispr.flowapp"
    private const val PREFS = "wispr_automation"
    private const val KEY_LAST_X = "last_bubble_x"
    private const val KEY_LAST_Y = "last_bubble_y"
    private var activeService: WeakReference<WisprAutomationAccessibilityService>? = null

    fun isEnabled(context: Context): Boolean {
      val enabled = Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
      ) ?: return false
      val expected = "\${context.packageName}/\${WisprAutomationAccessibilityService::class.java.name}"
      return enabled.split(':').any { it.equals(expected, ignoreCase = true) }
    }

    fun getActive(): WisprAutomationAccessibilityService? = activeService?.get()
  }

  override fun onServiceConnected() {
    activeService = WeakReference(this)
  }

  override fun onUnbind(intent: android.content.Intent?): Boolean {
    activeService = null
    return super.onUnbind(intent)
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    event ?: return
    if (event.packageName?.toString() != WISPR_PACKAGE) return
    val source = event.source ?: return
    val bounds = android.graphics.Rect()
    source.getBoundsInScreen(bounds)
    if (!bounds.isEmpty) {
      getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putFloat(KEY_LAST_X, bounds.centerX().toFloat())
        .putFloat(KEY_LAST_Y, bounds.centerY().toFloat())
        .apply()
    }
  }

  override fun onInterrupt() = Unit

  fun tapWisprControl(callback: (Boolean, String) -> Unit) {
    val nodeCenter = findWisprClickableCenter()
    val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val fallbackX = prefs.getFloat(KEY_LAST_X, -1f)
    val fallbackY = prefs.getFloat(KEY_LAST_Y, -1f)

    val target = nodeCenter ?: if (fallbackX >= 0f && fallbackY >= 0f) {
      Point(fallbackX, fallbackY)
    } else {
      null
    }

    if (target == null) {
      callback(false, "Wispr bubble not found")
      return
    }

    dispatchTap(target.x, target.y, callback)
  }

  private fun findWisprClickableCenter(): Point? {
    val wisprWindows = windows.filter { window ->
      window.root?.packageName?.toString() == WISPR_PACKAGE
    }
    for (window in wisprWindows) {
      val center = findClickableCenter(window)
      if (center != null) return center
    }
    return null
  }

  private fun findClickableCenter(window: AccessibilityWindowInfo): Point? {
    val root = window.root ?: return null
    return findPreferredClickable(root)
  }

  private fun findPreferredClickable(node: AccessibilityNodeInfo): Point? {
    val label = listOfNotNull(
      node.text?.toString(),
      node.contentDescription?.toString()
    ).joinToString(" ").lowercase(Locale.US)

    val looksLikeWisprControl =
      label.contains("dictat") ||
        label.contains("record") ||
        label.contains("mic") ||
        label.contains("done") ||
        label.contains("check") ||
        label.contains("flow")

    if (node.isClickable && looksLikeWisprControl) {
      return centerOf(node)
    }

    for (index in 0 until node.childCount) {
      val child = node.getChild(index) ?: continue
      val found = findPreferredClickable(child)
      child.recycle()
      if (found != null) return found
    }

    return null
  }

  private fun centerOf(node: AccessibilityNodeInfo): Point? {
    val bounds = android.graphics.Rect()
    node.getBoundsInScreen(bounds)
    if (bounds.isEmpty) return null
    return Point(bounds.centerX().toFloat(), bounds.centerY().toFloat())
  }

  private fun dispatchTap(
    x: Float,
    y: Float,
    callback: (Boolean, String) -> Unit
  ) {
    val path = Path().apply { moveTo(x, y) }
    val gesture = GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0L, 80L))
      .build()

    val dispatched = dispatchGesture(
      gesture,
      object : GestureResultCallback() {
        override fun onCompleted(gestureDescription: GestureDescription?) {
          callback(true, "Tapped Wispr control")
        }

        override fun onCancelled(gestureDescription: GestureDescription?) {
          callback(false, "Wispr tap cancelled")
        }
      },
      null
    )

    if (!dispatched) {
      callback(false, "Wispr tap dispatch failed")
    }
  }

  data class Point(val x: Float, val y: Float)
}
`;

type ServiceWithMetadata = NonNullable<
	NonNullable<
		ReturnType<typeof AndroidConfig.Manifest.getMainApplication>
	>['service']
>[number] & {
	$: {
		'android:name': string;
		'android:permission'?: string;
		'android:exported'?: 'true' | 'false';
		'android:label'?: string;
	};
	'meta-data'?: Array<{
		$: {
			'android:name': string;
			'android:resource': string;
		};
	}>;
};

const withWisprAutomationManifest: ConfigPlugin = (config) =>
	withAndroidManifest(config, (config) => {
		const app = AndroidConfig.Manifest.getMainApplicationOrThrow(
			config.modResults,
		);
		const services = (app.service ??= []);
		const existingService = services.find(
			(service) => service.$['android:name'] === SERVICE_NAME,
		) as ServiceWithMetadata | undefined;

		const service =
			existingService ??
			({
				$: {
					'android:name': SERVICE_NAME,
					'android:permission': SERVICE_PERMISSION,
					'android:exported': 'true',
					'android:label': SERVICE_LABEL,
				},
			} as ServiceWithMetadata);

		service.$['android:permission'] = SERVICE_PERMISSION;
		service.$['android:exported'] = 'true';
		service.$['android:label'] = SERVICE_LABEL;
		service['intent-filter'] = [
			{
				action: [
					{
						$: {
							'android:name': ACCESSIBILITY_SERVICE_ACTION,
						},
					},
				],
			},
		];
		service['meta-data'] = [
			{
				$: {
					'android:name': 'android.accessibilityservice',
					'android:resource': ACCESSIBILITY_SERVICE_RESOURCE,
				},
			},
		];

		if (!existingService) {
			services.push(service);
		}

		return config;
	});

const withWisprAutomationStrings: ConfigPlugin = (config) =>
	withStringsXml(config, (config) => {
		config.modResults = AndroidConfig.Strings.setStringItem(
			[
				AndroidConfig.Resources.buildResourceItem({
					name: DESCRIPTION_RESOURCE,
					value: DESCRIPTION_TEXT,
				}),
				AndroidConfig.Resources.buildResourceItem({
					name: SUMMARY_RESOURCE,
					value: SUMMARY_TEXT,
				}),
			],
			config.modResults,
		);

		return config;
	});

const withWisprAutomationNativeFiles: ConfigPlugin = (config) =>
	withDangerousMod(config, [
		'android',
		async (config) => {
			const xmlPath = path.join(
				config.modRequest.platformProjectRoot,
				'app/src/main/res/xml/wispr_automation_accessibility_service.xml',
			);
			await fs.mkdir(path.dirname(xmlPath), { recursive: true });
			await fs.writeFile(xmlPath, ACCESSIBILITY_SERVICE_XML, 'utf8');

			const servicePath = path.join(
				config.modRequest.platformProjectRoot,
				'app/src/main/java/com/finalapp/vibe2/WisprAutomationAccessibilityService.kt',
			);
			await fs.mkdir(path.dirname(servicePath), { recursive: true });
			await fs.writeFile(servicePath, ACCESSIBILITY_SERVICE_KOTLIN, 'utf8');

			return config;
		},
	]);

const withWisprAutomation: ConfigPlugin = (config) => {
	config = withWisprAutomationManifest(config);
	config = withWisprAutomationStrings(config);
	config = withWisprAutomationNativeFiles(config);
	return config;
};

export default withWisprAutomation;
