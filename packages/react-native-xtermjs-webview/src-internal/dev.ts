// This file is only loaded in dev mode.

// These lines should replicate injectedJavaScriptBeforeContentLoaded from src/index.tsx
document.body.style.backgroundColor = '#0B1324';

// Replicate injectedJavaScriptObject from src/index.tsx
window.ReactNativeWebView = {
	postMessage: (data: string) => {
		console.log('postMessage', data);
	},
	injectedObjectJson: () => {
		return JSON.stringify({});
	},
};
