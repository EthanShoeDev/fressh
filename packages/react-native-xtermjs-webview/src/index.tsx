import { useImperativeHandle, useRef, type ComponentProps } from 'react';
import { WebView } from 'react-native-webview';
import htmlString from '@fressh/react-native-xtermjs-webview-internal/dist/index.html?raw';
import { Base64 } from 'js-base64';

type StrictOmit<T, K extends keyof T> = Omit<T, K>;

export type XtermWebViewHandle = {
	write: (data: Uint8Array) => void;
};
const decoder = new TextDecoder('utf-8');

export function XtermJsWebView({
	ref,
	...props
}: StrictOmit<ComponentProps<typeof WebView>, 'source' | 'originWhitelist'> & {
	ref: React.RefObject<XtermWebViewHandle | null>;
}) {
	const webViewRef = useRef<WebView>(null);

	useImperativeHandle(ref, () => {
		return {
			write: (data) => {
				const base64Data = Base64.fromUint8Array(data);
				console.log('writing rn side', {
					base64Data,
					dataLength: data.length,
				});

				console.log(
					'try to decode',
					decoder.decode(Base64.toUint8Array(base64Data)),
				);
				webViewRef.current?.injectJavaScript(`
					window?.terminalWriteBase64('${base64Data}');
				`);
			},
		};
	});

	return (
		<WebView
			ref={webViewRef}
			originWhitelist={['*']}
			source={{ html: htmlString }}
			{...props}
		/>
	);
}
