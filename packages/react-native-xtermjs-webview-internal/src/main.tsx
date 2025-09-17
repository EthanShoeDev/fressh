import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

const decoder = new TextDecoder('utf-8');

const terminal = new Terminal();
terminal.open(document.getElementById('terminal')!);
terminal.write('Hello from Xterm.js!');
window.terminal = terminal;
const postMessage = (arg: string) => {
	window.ReactNativeWebView?.postMessage?.(arg);
};
setTimeout(() => {
	postMessage('DEBUG: set timeout');
}, 1000);
function terminalWriteBase64(base64Data: string) {
	try {
		postMessage(`DEBUG: terminalWriteBase64 ${base64Data}`);
		const data = new Uint8Array(Buffer.from(base64Data, 'base64'));
		postMessage(`DEBUG: terminalWriteBase64 decoded ${decoder.decode(data)}`);

		terminal.write(data);
	} catch (e) {
		postMessage(`DEBUG: terminalWriteBase64 error ${e}`);
	}
}
window.terminalWriteBase64 = terminalWriteBase64;
