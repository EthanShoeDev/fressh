import React from 'react';

export type AppTheme = {
	colors: {
		background: string;
		surface: string;
		terminalBackground: string;
		border: string;
		textPrimary: string;
		textSecondary: string;
		muted: string;
		primary: string;
		buttonTextOnPrimary: string;
		inputBackground: string;
	};
};

export const darkTheme: AppTheme = {
	colors: {
		background: '#0B1324',
		surface: '#111B34',
		terminalBackground: '#0E172B',
		border: '#2A3655',
		textPrimary: '#E5E7EB',
		textSecondary: '#C6CBD3',
		muted: '#9AA0A6',
		primary: '#2563EB',
		buttonTextOnPrimary: '#FFFFFF',
		inputBackground: '#0E172B',
	},
};

type ThemeContextValue = {
	theme: AppTheme;
	setTheme: (theme: AppTheme) => void;
};

const ThemeContext = React.createContext<ThemeContextValue | undefined>(
	undefined,
);

export function ThemeProvider(props: { children: React.ReactNode }) {
	const [theme, setTheme] = React.useState<AppTheme>(darkTheme);

	const value = React.useMemo(() => ({ theme, setTheme }), [theme]);

	return (
		<ThemeContext.Provider value={value}>
			{props.children}
		</ThemeContext.Provider>
	);
}

export function useTheme() {
	const ctx = React.useContext(ThemeContext);
	if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
	return ctx.theme;
}
