import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

export function App() {
	const [count, setCount] = useState(0);
	const terminalRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!terminalRef.current) return;
		const terminal = new Terminal();
		terminal.open(terminalRef.current);
		terminal.write('Hello from Xterm.js!');
	}, []);

	return (
		<>
			<h1>Xterm.js</h1>
			<div className="card">
				<button onClick={() => setCount((count) => count + 1)}>
					count is {count}
				</button>
				<p>
					Edit <code>src/App.tsx</code> and save to test HMR
				</p>
			</div>
			<p className="read-the-docs">
				Click on the Vite and React logos to learn more
			</p>
			<div id="terminal" ref={terminalRef}></div>
		</>
	);
}
