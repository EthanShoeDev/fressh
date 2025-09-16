import React from 'react';
import { preferences } from './preferences';

export type AppTheme = {
	colors: {
		background: string;
		surface: string;
		terminalBackground: string;
		border: string;
		borderStrong: string;
		textPrimary: string;
		textSecondary: string;
		muted: string;
		primary: string;
		buttonTextOnPrimary: string;
		inputBackground: string;
		danger: string;
		overlay: string;
		transparent: string;
		shadow: string;
		primaryDisabled: string;
	};
};

export const darkTheme: AppTheme = {
	colors: {
		background: '#0B1324',
		surface: '#111B34',
		terminalBackground: '#0E172B',
		border: '#2A3655',
		borderStrong: '#1E293B',
		textPrimary: '#E5E7EB',
		textSecondary: '#C6CBD3',
		muted: '#9AA0A6',
		primary: '#2563EB',
		buttonTextOnPrimary: '#FFFFFF',
		inputBackground: '#0E172B',
		danger: '#FCA5A5',
		overlay: 'rgba(0,0,0,0.4)',
		transparent: 'transparent',
		shadow: '#000000',
		primaryDisabled: '#3B82F6',
	},
};

export const lightTheme: AppTheme = {
	colors: {
		background: '#F9FAFB',
		surface: '#FFFFFF',
		terminalBackground: '#F3F4F6',
		border: '#E5E7EB',
		borderStrong: '#D1D5DB',
		textPrimary: '#111827',
		textSecondary: '#374151',
		muted: '#6B7280',
		primary: '#2563EB',
		buttonTextOnPrimary: '#FFFFFF',
		inputBackground: '#FFFFFF',
		danger: '#DC2626',
		overlay: 'rgba(0,0,0,0.2)',
		transparent: 'transparent',
		shadow: '#000000',
		primaryDisabled: '#93C5FD',
	},
};

export type ThemeName = 'dark' | 'light';
export const themes: Record<ThemeName, AppTheme> = {
	dark: darkTheme,
	light: lightTheme,
};

type ThemeContextValue = {
	theme: AppTheme;
	themeName: ThemeName;
	setThemeName: (name: ThemeName) => void;
};

const ThemeContext = React.createContext<ThemeContextValue | undefined>(
	undefined,
);

export function ThemeProvider(props: { children: React.ReactNode }) {
	const [themeName, setThemeName] = preferences.theme.useThemePref();
	const theme = themes[themeName];

	const value = React.useMemo<ThemeContextValue>(
		() => ({
			theme,
			themeName,
			setThemeName,
		}),
		[theme, themeName, setThemeName],
	);

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

export function useThemeControls() {
	const ctx = React.useContext(ThemeContext);
	if (!ctx)
		throw new Error('useThemeControls must be used within ThemeProvider');
	const { themeName, setThemeName } = ctx;
	return { themeName, setThemeName };
}
