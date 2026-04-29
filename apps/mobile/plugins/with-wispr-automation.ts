import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
	AndroidConfig,
	type ConfigPlugin,
	withAndroidManifest,
	withDangerousMod,
	withMainApplication,
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
const FOREGROUND_SERVICE_PACKAGE_REGISTRATION =
	'add(ForegroundServicePackage())';

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

  override fun onDestroy() {
    activeService = null
    super.onDestroy()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    event ?: return
    if (event.packageName?.toString() != WISPR_PACKAGE) return
    val source = event.source ?: return
    val center = findPreferredClickable(source)
    if (center != null) {
      getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putFloat(KEY_LAST_X, center.x)
        .putFloat(KEY_LAST_Y, center.y)
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

const WISPR_AUTOMATION_MODULE_KOTLIN = `package com.finalapp.vibe2

import android.content.Intent
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap

class WisprAutomationModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "FresshWisprAutomation"

  @ReactMethod
  fun getStatus(promise: Promise) {
    val status = WritableNativeMap()
    status.putBoolean(
      "serviceEnabled",
      WisprAutomationAccessibilityService.isEnabled(reactContext)
    )
    status.putBoolean(
      "serviceConnected",
      WisprAutomationAccessibilityService.getActive() != null
    )
    status.putString("wisprPackage", "com.wispr.flowapp")
    promise.resolve(status)
  }

  @ReactMethod
  fun openAccessibilitySettings(promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(intent)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("ACCESSIBILITY_SETTINGS_FAILED", e)
    }
  }

  @ReactMethod
  fun tapWisprControl(promise: Promise) {
    val service = WisprAutomationAccessibilityService.getActive()
    if (service == null) {
      promise.reject(
        "WISPR_AUTOMATION_SERVICE_DISABLED",
        "Fressh Wispr Automation accessibility service is not enabled"
      )
      return
    }

    service.tapWisprControl { success, message ->
      if (success) {
        promise.resolve(message)
      } else {
        promise.reject("WISPR_AUTOMATION_TAP_FAILED", message)
      }
    }
  }
}
`;

const FOREGROUND_SERVICE_PACKAGE_KOTLIN = `package com.finalapp.vibe2

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class ForegroundServicePackage : ReactPackage {
  override fun createNativeModules(
    reactContext: ReactApplicationContext
  ) = listOf(
    ForegroundServiceModule(reactContext),
    WisprAutomationModule(reactContext)
  )

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> = emptyList()
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

function findMatchingBrace(contents: string, openBraceIndex: number): number {
	let depth = 0;

	for (let index = openBraceIndex; index < contents.length; index += 1) {
		const char = contents[index];
		if (char === '{') {
			depth += 1;
		} else if (char === '}') {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}

	return -1;
}

function addForegroundServicePackageRegistration(contents: string): string {
	const packageListApply = 'PackageList(this).packages.apply {';
	const applyIndex = contents.indexOf(packageListApply);
	if (applyIndex === -1) {
		throw new Error(
			`Could not find ${packageListApply} in Android MainApplication.kt`,
		);
	}

	const openBraceIndex = contents.indexOf('{', applyIndex);
	const closeBraceIndex = findMatchingBrace(contents, openBraceIndex);
	if (closeBraceIndex === -1) {
		throw new Error(
			'Could not find PackageList(this).packages.apply block end in Android MainApplication.kt',
		);
	}

	const applyBlock = contents.slice(openBraceIndex + 1, closeBraceIndex);
	if (applyBlock.includes(FOREGROUND_SERVICE_PACKAGE_REGISTRATION)) {
		return contents;
	}

	const blockLines = applyBlock.split('\n');
	const indentedLine = blockLines.find((line) => line.trim().length > 0);
	const indent = indentedLine?.match(/^\s*/)?.[0] ?? '              ';
	const closeBraceLineStart = contents.lastIndexOf('\n', closeBraceIndex) + 1;

	return `${contents.slice(0, closeBraceLineStart)}${indent}${FOREGROUND_SERVICE_PACKAGE_REGISTRATION}\n${contents.slice(closeBraceLineStart)}`;
}

const withForegroundServicePackageRegistration: ConfigPlugin = (config) =>
	withMainApplication(config, (config) => {
		config.modResults.contents = addForegroundServicePackageRegistration(
			config.modResults.contents,
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

			const modulePath = path.join(
				config.modRequest.platformProjectRoot,
				'app/src/main/java/com/finalapp/vibe2/WisprAutomationModule.kt',
			);
			await fs.writeFile(modulePath, WISPR_AUTOMATION_MODULE_KOTLIN, 'utf8');

			const packagePath = path.join(
				config.modRequest.platformProjectRoot,
				'app/src/main/java/com/finalapp/vibe2/ForegroundServicePackage.kt',
			);
			await fs.writeFile(
				packagePath,
				FOREGROUND_SERVICE_PACKAGE_KOTLIN,
				'utf8',
			);

			return config;
		},
	]);

const withWisprAutomation: ConfigPlugin = (config) => {
	config = withWisprAutomationManifest(config);
	config = withWisprAutomationStrings(config);
	config = withForegroundServicePackageRegistration(config);
	config = withWisprAutomationNativeFiles(config);
	return config;
};

export default withWisprAutomation;
