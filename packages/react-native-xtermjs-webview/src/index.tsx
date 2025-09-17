import { WebView } from 'react-native-webview';
import htmlString from 'react-native-xtermjs-webview-internal/dist/assets/index.html?raw';

export function XtermJsWebView() {
	return <WebView originWhitelist={['*']} source={{ html: htmlString }} />;
}
