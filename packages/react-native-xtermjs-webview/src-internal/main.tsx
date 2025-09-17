import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Base64 } from 'js-base64';

import '@xterm/xterm/css/xterm.css';

const terminal = new Terminal();
const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);
terminal.open(document.getElementById('terminal')!);
fitAddon.fit();
window.terminal = terminal;
window.fitAddon = fitAddon;
const postMessage = (arg: string) => {
	window.ReactNativeWebView?.postMessage?.(arg);
};
setTimeout(() => {
	postMessage('initialized');
}, 10);

terminal.onData((data) => {
	const base64Data = Base64.encode(data);
	postMessage(base64Data);
});
function terminalWriteBase64(base64Data: string) {
	try {
		const data = Base64.toUint8Array(base64Data);
		terminal.write(data);
	} catch (e) {
		postMessage(`DEBUG: terminalWriteBase64 error ${e}`);
	}
}
window.terminalWriteBase64 = terminalWriteBase64;
