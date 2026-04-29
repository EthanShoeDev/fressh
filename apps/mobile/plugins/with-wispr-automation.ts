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

const withWisprAutomationAccessibilityXml: ConfigPlugin = (config) =>
	withDangerousMod(config, [
		'android',
		async (config) => {
			const xmlPath = path.join(
				config.modRequest.platformProjectRoot,
				'app/src/main/res/xml/wispr_automation_accessibility_service.xml',
			);
			await fs.mkdir(path.dirname(xmlPath), { recursive: true });
			await fs.writeFile(xmlPath, ACCESSIBILITY_SERVICE_XML, 'utf8');

			return config;
		},
	]);

const withWisprAutomation: ConfigPlugin = (config) => {
	config = withWisprAutomationManifest(config);
	config = withWisprAutomationStrings(config);
	config = withWisprAutomationAccessibilityXml(config);
	return config;
};

export default withWisprAutomation;
