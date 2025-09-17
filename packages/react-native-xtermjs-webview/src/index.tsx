import { useImperativeHandle, useRef, type ComponentProps } from 'react';
import { WebView } from 'react-native-webview';
import htmlString from '../dist-internal/index.html?raw';
import { Base64 } from 'js-base64';

type StrictOmit<T, K extends keyof T> = Omit<T, K>;

export type XtermWebViewHandle = {
	write: (data: Uint8Array) => void;
};

export function XtermJsWebView({
	ref,
	onMessage,
	...props
}: StrictOmit<
	ComponentProps<typeof WebView>,
	'source' | 'originWhitelist' | 'onMessage'
> & {
	ref: React.RefObject<XtermWebViewHandle | null>;
	onMessage?: (
		data: { type: 'data'; data: Uint8Array } | { type: 'initialized' },
	) => void;
}) {
	const webViewRef = useRef<WebView>(null);

	useImperativeHandle(ref, () => {
		return {
			write: (data) => {
				const base64Data = Base64.fromUint8Array(data.slice());
				webViewRef.current?.injectJavaScript(`
					window?.terminalWriteBase64?.('${base64Data}');
				`);
			},
		};
	});

	return (
		<WebView
			ref={webViewRef}
			originWhitelist={['*']}
			source={{ html: htmlString }}
			onMessage={(event) => {
				const message = event.nativeEvent.data;
				if (message === 'initialized') {
					onMessage?.({ type: 'initialized' });
					return;
				}
				const data = Base64.toUint8Array(message.slice());
				onMessage?.({ type: 'data', data });
			}}
			{...props}
		/>
	);
}
