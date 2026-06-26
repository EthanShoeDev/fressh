import AppStoreBadge from '@fressh/assets/third-party-brands/apple-app-store/Black_lockup/SVG/Download_on_the_App_Store_Badge_US-UK_RGB_blk_092917.svg';
import GithubMark from '@fressh/assets/third-party-brands/github-mark/github-mark.svg';
import GooglePlayBadge from '@fressh/assets/third-party-brands/google-play/GetItOnGooglePlay_Badge_Web_color_English.trimmed.svg';
import mobileAppIconDark from '@fressh/assets/mobile-app-icon-dark.png';
import npmLogoRed from '@fressh/assets/third-party-brands/npm-js/npm-logo-red.png';
import { Link, createFileRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const title = 'Fressh — Mobile SSH Client Powered by Alacritty';
const description =
	'An open-source mobile SSH client built around the real Alacritty terminal engine. Rust SSH via russh, alacritty_terminal as the VT core, and a native GPU renderer — no WebView.';

export const Route = createFileRoute('/')({
	head: () => ({
		meta: [
			{ title },
			{ name: 'description', content: description },
			{ property: 'og:type', content: 'website' },
			{ property: 'og:title', content: title },
			{ property: 'og:description', content: description },
			{ property: 'og:image', content: mobileAppIconDark },
			{ name: 'twitter:card', content: 'summary_large_image' },
			{ name: 'twitter:title', content: title },
			{ name: 'twitter:description', content: description },
			{ name: 'twitter:image', content: mobileAppIconDark },
		],
	}),
	component: HomePage,
});

// Mirrors APP_THEMES in apps/mobile/src/lib/app-themes.ts — keep the swatches in
// sync when a theme is added or retuned there.
const themes = [
	{
		id: 'phosphor',
		label: 'Phosphor',
		bg: '#120f0a',
		accent: '#ffb454',
		accent2: '#79e08a',
		voice: 'warm CRT amber, scanlines, lowercase mono',
	},
	{
		id: 'graphite',
		label: 'Graphite',
		bg: '#14161b',
		accent: '#818cf8',
		accent2: '#a78bfa',
		voice: 'cool indigo, quiet and focused',
	},
	{
		id: 'aurora',
		label: 'Aurora',
		bg: '#06070d',
		accent: '#2de6c6',
		accent2: '#a487ff',
		voice: 'frosted glass, drifting gradient blobs',
	},
	{
		id: 'monolith',
		label: 'Monolith',
		bg: '#0a0a0a',
		accent: '#ccff00',
		accent2: '#f4f4f2',
		voice: 'brutalist, sharp edges, ALL CAPS',
	},
	{
		id: 'native',
		label: 'Native',
		bg: '#1c1c1e',
		accent: '#0a84ff',
		accent2: '#30d158',
		voice: 'feels like the OS — SwiftUI / Material 3',
	},
] as const;

// Google Play closed testing: testers must be on the email list in Play
// Console before the opt-in link works for them. The tester list points at a
// public Google Group, so joining the group adds you instantly — no manual
// approval step on our end.
const betaGroupUrl = 'https://groups.google.com/g/fressh-android-testing';
const testFlightUrl = 'https://testflight.apple.com/join/XhKX68Xv';
const playOptInUrl = 'https://play.google.com/apps/testing/dev.fressh.app';
const playStoreUrl =
	'https://play.google.com/store/apps/details?id=dev.fressh.app';

// The native terminal core is published to the public npm registry; the website
// mirrors the README's npm branding (logo, version badge, install line) so the
// package reads as a first-class, installable library — not just a source folder.
const npmPackageName = '@fressh/react-native-terminal';
const npmPackageUrl = `https://www.npmjs.com/package/${npmPackageName}`;
const npmVersionBadgeUrl = `https://img.shields.io/npm/v/${npmPackageName}?label=npm&color=10b981`;
const githubPackageUrl =
	'https://github.com/EthanShoeDev/fressh/tree/main/packages/react-native-terminal';

type ThemeId = (typeof themes)[number]['id'];
type Platform = 'ios' | 'android';

const platforms = [
	{ id: 'ios', label: 'iOS' },
	{ id: 'android', label: 'Android' },
] as const satisfies readonly { id: Platform; label: string }[];

type Screenshot = { src: string; alt: string };

// Hero-screen display order + alt text, keyed by the `<screen>` segment of a
// capture filename. Screens not listed still render (sorted last) with a generic
// alt — keep the captures that matter for the marketing reel up top.
const SCREEN_META = [
	['servers', 'Servers tab — saved hosts with live session status'],
	['connect', 'New connection form'],
	['terminal', 'Live terminal — a real SSH session'],
	['smart-terminal', 'Smart terminal — command status, timing & working dir'],
	['keys', 'Keys tab — generate or import SSH keys'],
	['commands', 'Commands tab — one-tap command presets'],
	['settings', 'Settings tab — themes and terminal options'],
] as const satisfies readonly [string, string][];
const screenOrder = (screen: string) => {
	const i = SCREEN_META.findIndex(([s]) => s === screen);
	return i === -1 ? SCREEN_META.length : i;
};
const screenAlt = (screen: string) =>
	SCREEN_META.find(([s]) => s === screen)?.[1] ?? screen;

// Vite eagerly globs every capture (as URLs, not modules) so new
// `<screen>-<theme>-<platform>.png` files from the screenshot pipeline slot into
// the theme/platform switchers with NO code change — the manifest builds itself.
// The pattern is relative to this file (apps/web/src/routes → repo packages/assets).
const screenshotUrls: Record<string, string> = import.meta.glob(
	'../../../../packages/assets/mobile-screenshots/*.png',
	{ eager: true, import: 'default', query: '?url' },
);

// `<screen>` may itself contain a hyphen (`smart-terminal`), so parse the filename
// right-to-left: platform, then theme, then the remainder is the screen.
function buildScreenshotManifest() {
	const themeIds = new Set<string>(themes.map((t) => t.id));
	const collected: Partial<
		Record<
			ThemeId,
			Partial<Record<Platform, { screen: string; src: string }[]>>
		>
	> = {};
	for (const [filePath, src] of Object.entries(screenshotUrls)) {
		const base =
			filePath
				.split('/')
				.pop()
				?.replace(/\.png$/, '') ?? '';
		const parts = base.split('-');
		const platform = parts.pop();
		const theme = parts.pop();
		const screen = parts.join('-');
		if (!platform || !theme || !screen) continue;
		if (platform !== 'ios' && platform !== 'android') continue;
		if (!themeIds.has(theme)) continue;
		const byPlatform = (collected[theme as ThemeId] ??= {});
		(byPlatform[platform] ??= []).push({ screen, src });
	}
	const manifest: Partial<
		Record<ThemeId, Partial<Record<Platform, readonly Screenshot[]>>>
	> = {};
	for (const [theme, byPlatform] of Object.entries(collected)) {
		const out: Partial<Record<Platform, readonly Screenshot[]>> = {};
		for (const [platform, shots] of Object.entries(byPlatform)) {
			out[platform as Platform] = shots
				.sort((a, b) => screenOrder(a.screen) - screenOrder(b.screen))
				.map(({ screen, src }) => ({ src, alt: screenAlt(screen) }));
		}
		manifest[theme as ThemeId] = out;
	}
	return manifest;
}

const screenshotManifest = buildScreenshotManifest();

function HomePage() {
	return (
		<div className='dark min-h-screen bg-[#07090c] text-gray-200 selection:bg-emerald-400/30'>
			{/* ambient glow */}
			<div
				aria-hidden='true'
				className='pointer-events-none fixed inset-0 overflow-hidden'
			>
				<div className='absolute -top-48 left-1/2 h-[32rem] w-[56rem] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl' />
				<div className='absolute top-1/3 -right-40 h-96 w-96 rounded-full bg-cyan-500/5 blur-3xl' />
			</div>

			<div className='relative mx-auto w-full max-w-6xl px-6'>
				<Header />
				<main>
					<Hero />
					<AndroidBeta />
					<PoweredByAlacritty />
					<Features />
					<Themes />
					<Screenshots />
					<OpenSource />
				</main>
				<Footer />
			</div>
		</div>
	);
}

function Header() {
	return (
		<header className='flex items-center justify-between py-6'>
			<div className='flex items-center gap-3'>
				<img
					src={mobileAppIconDark}
					alt='Fressh app icon'
					className='h-10 w-10 rounded-xl border border-white/10 shadow-lg shadow-emerald-500/10'
					loading='eager'
				/>
				<span className='font-mono text-lg font-semibold tracking-tight text-white'>
					fressh
				</span>
			</div>
			<div className='flex items-center gap-3'>
				<a
					href='https://github.com/EthanShoeDev/fressh'
					target='_blank'
					rel='noopener noreferrer'
					className='inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-gray-200 transition hover:border-white/25 hover:bg-white/10'
				>
					<img
						src={GithubMark}
						alt=''
						aria-hidden='true'
						className='h-4 w-4 invert'
					/>
					GitHub
				</a>
				<a
					href='#beta'
					className='inline-flex items-center gap-2 rounded-full bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-300'
				>
					Join the beta
				</a>
			</div>
		</header>
	);
}

function Hero() {
	return (
		<section className='grid items-center gap-14 py-16 lg:grid-cols-[1.1fr_1fr] lg:py-24'>
			<div className='space-y-7'>
				<p className='inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 font-mono text-xs text-emerald-300'>
					<span className='inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400' />
					open source · MIT · android closed beta open now
				</p>
				<h1 className='text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl'>
					A real terminal,
					<br />
					in your pocket.
				</h1>
				<p className='max-w-xl text-lg leading-relaxed text-gray-400'>
					Fressh is a mobile SSH client built around the{' '}
					<a
						href='https://github.com/alacritty/alacritty'
						target='_blank'
						rel='noopener noreferrer'
						className='font-semibold text-emerald-300 underline decoration-emerald-300/40 decoration-dotted underline-offset-4 hover:decoration-solid'
					>
						Alacritty
					</a>{' '}
					terminal engine — the same battle-tested VT core and GPU renderer that
					powers one of the fastest terminals on the desktop, running natively
					on your phone. No WebView. No compromises.
				</p>
				<div className='flex flex-wrap items-start gap-x-8 gap-y-5 pt-2'>
					<StoreBadge
						src={AppStoreBadge}
						alt='Download on the App Store'
						note='join the TestFlight beta'
						href={testFlightUrl}
						badgeHref={testFlightUrl}
						imgClassName='h-[46px]'
					/>
					<StoreBadge
						src={GooglePlayBadge}
						alt='Get it on Google Play'
						note='in closed beta — join the test'
						href='#beta'
						badgeHref={betaGroupUrl}
						imgClassName='h-[43px]'
					/>
				</div>
			</div>
			<TerminalWindow />
		</section>
	);
}

function StoreBadge({
	src,
	alt,
	note = 'coming soon',
	href,
	badgeHref,
	imgClassName,
}: Readonly<{
	src: string;
	alt: string;
	note?: string;
	href?: string;
	badgeHref?: string;
	imgClassName: string;
}>) {
	// inline-flex (not a bare inline span) so vertical padding/border contribute to
	// the box height identically whether the pill is a <span> or an <a> — otherwise
	// the two pills render at different heights and don't line up.
	const pillClassName = `inline-flex items-center rounded-full border border-dashed px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase ${
		href
			? 'border-emerald-400/50 text-emerald-300 transition hover:border-emerald-300 hover:bg-emerald-400/10'
			: 'border-gray-700 text-gray-500'
	}`;
	// The App Store and Google Play artworks have different aspect ratios, so matching
	// either dimension alone makes one look bigger. Each is sized for equal visual
	// AREA (Apple a hair taller, Google a hair wider) and centered in a shared-height
	// box, so they read as the same size and the pills below line up. GooglePlayBadge
	// is a viewBox-trimmed copy with the baked-in clear space removed.
	const badge = (
		<span className='flex h-[46px] items-center'>
			<img src={src} alt={alt} className={`select-none ${imgClassName}`} />
		</span>
	);
	return (
		<div className='flex flex-col items-start gap-2'>
			{badgeHref ? (
				<a
					href={badgeHref}
					target='_blank'
					rel='noopener noreferrer'
					className='transition hover:opacity-90'
				>
					{badge}
				</a>
			) : (
				badge
			)}
			{href ? (
				// External pill links (e.g. TestFlight) open in a new tab; in-page
				// anchors like `#beta` stay in the same tab.
				<a
					href={href}
					{...(href.startsWith('http')
						? { target: '_blank', rel: 'noopener noreferrer' }
						: {})}
					className={pillClassName}
				>
					{note}
				</a>
			) : (
				<span className={pillClassName}>{note}</span>
			)}
		</div>
	);
}

function TerminalWindow() {
	return (
		<div className='overflow-hidden rounded-2xl border border-white/10 bg-[#0b0e13] shadow-2xl shadow-emerald-500/10'>
			<div className='flex items-center gap-2 border-b border-white/5 bg-white/5 px-4 py-3'>
				<span className='h-3 w-3 rounded-full bg-red-500/80' />
				<span className='h-3 w-3 rounded-full bg-yellow-500/80' />
				<span className='h-3 w-3 rounded-full bg-green-500/80' />
				<span className='ml-3 font-mono text-xs text-gray-500'>
					fressh — ssh
				</span>
			</div>
			<div className='space-y-1.5 px-5 py-5 font-mono text-[13px] leading-relaxed'>
				<p>
					<span className='text-emerald-400'>$</span>{' '}
					<span className='text-gray-200'>ssh deploy@prod-web-01</span>
				</p>
				<p className='text-gray-500'>
					host key verified · ed25519 · trusted on first use
				</p>
				<p>
					<span className='text-cyan-400'>deploy@prod-web-01</span>
					<span className='text-gray-500'>:</span>
					<span className='text-violet-400'>~</span>
					<span className='text-gray-500'>$</span>{' '}
					<span className='text-gray-200'>uptime</span>
				</p>
				<p className='text-gray-400'>
					{' '}
					14:32:07 up 212 days, 3:11, 1 user, load average: 0.04, 0.07, 0.05
				</p>
				<p>
					<span className='text-cyan-400'>deploy@prod-web-01</span>
					<span className='text-gray-500'>:</span>
					<span className='text-violet-400'>~</span>
					<span className='text-gray-500'>$</span>{' '}
					<span className='text-gray-200'>
						echo &quot;rendered by alacritty&quot;
					</span>
				</p>
				<p className='text-emerald-300'>rendered by alacritty</p>
				<p>
					<span className='text-cyan-400'>deploy@prod-web-01</span>
					<span className='text-gray-500'>:</span>
					<span className='text-violet-400'>~</span>
					<span className='text-gray-500'>$</span>{' '}
					<span className='inline-block h-4 w-2 translate-y-0.5 animate-pulse bg-emerald-400' />
				</p>
			</div>
		</div>
	);
}

function AndroidBeta() {
	const steps = [
		{
			title: 'Join the testing group',
			detail: (
				<>
					Join the{' '}
					<a
						href={betaGroupUrl}
						target='_blank'
						rel='noopener noreferrer'
						className='text-emerald-300 underline decoration-dotted underline-offset-4 hover:decoration-solid'
					>
						Fressh Android Testing group
					</a>{' '}
					with the Google account tied to your Play Store. Google only lets
					group members into the test, so this step is required.
				</>
			),
		},
		{
			title: 'Opt in to the test',
			detail: (
				<>
					Once you&apos;ve joined the group, accept the invite at{' '}
					<a
						href={playOptInUrl}
						target='_blank'
						rel='noopener noreferrer'
						className='break-all text-emerald-300 underline decoration-dotted underline-offset-4 hover:decoration-solid'
					>
						play.google.com/apps/testing/dev.fressh.app
					</a>
					.
				</>
			),
		},
		{
			title: 'Install and keep it',
			detail: (
				<>
					Grab the app from{' '}
					<a
						href={playStoreUrl}
						target='_blank'
						rel='noopener noreferrer'
						className='text-emerald-300 underline decoration-dotted underline-offset-4 hover:decoration-solid'
					>
						Google Play
					</a>{' '}
					and stay opted in — Google counts testers over a continuous 14-day
					window.
				</>
			),
		},
	] as const;
	return (
		<section
			id='beta'
			className='scroll-mt-8 rounded-3xl border border-emerald-400/25 bg-emerald-400/[0.06] p-8 sm:p-10'
		>
			<p className='font-mono text-xs tracking-[0.25em] text-emerald-400 uppercase'>
				android beta
			</p>
			<div className='mt-3 flex flex-wrap items-end justify-between gap-6'>
				<div className='max-w-2xl'>
					<h2 className='text-2xl font-bold tracking-tight text-white sm:text-3xl'>
						Help Fressh launch on Google Play.
					</h2>
					<p className='mt-4 text-base leading-relaxed text-gray-400'>
						Before an app can go live on the Play Store, Google requires a
						closed test with at least 12 opted-in testers for 14 days. Three
						steps and you&apos;ve directly unblocked the launch — and you get
						the app first.
					</p>
				</div>
				<a
					href={betaGroupUrl}
					target='_blank'
					rel='noopener noreferrer'
					className='inline-flex shrink-0 items-center gap-2 rounded-full bg-emerald-400 px-6 py-3 text-sm font-semibold text-emerald-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300'
				>
					Become a tester →
				</a>
			</div>
			<ol className='mt-8 grid gap-4 lg:grid-cols-3'>
				{steps.map((step, i) => (
					<li
						key={step.title}
						className='rounded-2xl border border-white/10 bg-[#07090c]/60 p-6'
					>
						<span className='font-mono text-xs text-emerald-400/70'>
							{String(i + 1).padStart(2, '0')}
						</span>
						<h3 className='mt-2 text-sm font-semibold text-white'>
							{step.title}
						</h3>
						<p className='mt-2 text-sm leading-relaxed text-gray-400'>
							{step.detail}
						</p>
					</li>
				))}
			</ol>
			<p className='mt-6 text-xs leading-relaxed text-gray-500'>
				iPhone user? The iOS build goes through TestFlight instead — watch the{' '}
				<a
					href='https://github.com/EthanShoeDev/fressh'
					target='_blank'
					rel='noopener noreferrer'
					className='underline decoration-dotted underline-offset-4 hover:text-gray-300 hover:decoration-solid'
				>
					GitHub repo
				</a>{' '}
				for updates.
			</p>
		</section>
	);
}

function PoweredByAlacritty() {
	const stages: readonly { name: string; detail: string; href?: string }[] = [
		{
			name: 'russh',
			detail: 'Rust SSH transport — auth, channels, and crypto, fully native',
			href: 'https://github.com/Eugeny/russh',
		},
		{
			name: 'alacritty_terminal',
			detail:
				'Alacritty’s VT engine parses every byte into durable terminal state',
			href: 'https://github.com/alacritty/alacritty',
		},
		{
			name: 'GPU renderer',
			detail:
				'Alacritty’s GLES renderer draws the grid — ANGLE→Metal on iOS, GLES on Android',
		},
	];
	return (
		<Section
			eyebrow='powered by alacritty'
			title='SSH bytes never touch JavaScript.'
			lead='Most mobile SSH apps render the terminal in a WebView. Fressh ships the real thing: Alacritty’s terminal core and renderer compiled into one native library, with React Native only driving the chrome around it.'
		>
			<ol className='grid gap-4 lg:grid-cols-3'>
				{stages.map((stage, i) => (
					<li
						key={stage.name}
						className='relative rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-emerald-400/30'
					>
						<span className='font-mono text-xs text-emerald-400/70'>
							{String(i + 1).padStart(2, '0')}
						</span>
						<h3 className='mt-2 font-mono text-base font-semibold text-white'>
							{stage.href ? (
								<a
									href={stage.href}
									target='_blank'
									rel='noopener noreferrer'
									className='hover:text-emerald-300'
								>
									{stage.name}
								</a>
							) : (
								stage.name
							)}
						</h3>
						<p className='mt-2 text-sm leading-relaxed text-gray-400'>
							{stage.detail}
						</p>
					</li>
				))}
			</ol>
			<div className='mt-6 grid gap-4 sm:grid-cols-2'>
				<Callout title='Consistent visuals'>
					One render layer for both platforms — iOS and Android draw the exact
					same glyphs, colors, and cursor.
				</Callout>
				<Callout title='Fast and durable'>
					Rendering stays off the JS thread, and the terminal state lives in
					native code — sessions reattach tmux-style with full scrollback.
				</Callout>
			</div>
		</Section>
	);
}

function Callout({
	title,
	children,
}: Readonly<{ title: string; children: ReactNode }>) {
	return (
		<div className='rounded-2xl border border-emerald-400/15 bg-emerald-400/5 p-6'>
			<h3 className='text-sm font-semibold text-emerald-300'>{title}</h3>
			<p className='mt-2 text-sm leading-relaxed text-gray-400'>{children}</p>
		</div>
	);
}

function Features() {
	const features = [
		{
			title: 'Secure connection history',
			detail:
				'Hosts and credentials live in the device keychain, never in plain storage.',
		},
		{
			title: 'SSH keys',
			detail:
				'Generate ed25519 keys on-device or import the ones you already use.',
		},
		{
			title: 'Host-key verification',
			detail: 'Trust-on-first-use prompts backed by a known-hosts store.',
		},
		{
			title: 'Command presets',
			detail: 'Your most-used commands, one tap away on the terminal toolbar.',
		},
		{
			title: 'Session reattach',
			detail:
				'Leave and come back — sessions survive with full scrollback, tmux-style.',
		},
		{
			title: 'Theming',
			detail:
				'Five distinct themes that restyle the whole app, not just the terminal colors.',
		},
	] as const;
	return (
		<Section
			eyebrow='features'
			title='Clean and simple, without giving anything up.'
		>
			<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
				{features.map((feature) => (
					<div
						key={feature.title}
						className='rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-white/25'
					>
						<h3 className='flex items-center gap-2 text-sm font-semibold text-white'>
							<span className='text-emerald-400'>✓</span>
							{feature.title}
						</h3>
						<p className='mt-2 text-sm leading-relaxed text-gray-400'>
							{feature.detail}
						</p>
					</div>
				))}
			</div>
			<div className='mt-6 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-6'>
				<h3 className='font-mono text-xs tracking-wider text-amber-300 uppercase'>
					coming soon
				</h3>
				<p className='mt-2 text-sm leading-relaxed text-gray-400'>
					On-device LLM for command completion and output summarization — no
					cloud round-trips for your shell history.
				</p>
			</div>
		</Section>
	);
}

function Themes() {
	return (
		<Section
			eyebrow='themes'
			title='Pick a personality.'
			lead='Each theme restyles the entire app — typography, shapes, glow, and canvas — not just a color palette.'
		>
			<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-5'>
				{themes.map((theme) => (
					<div
						key={theme.id}
						className='overflow-hidden rounded-2xl border border-white/10 transition hover:-translate-y-1 hover:border-white/25'
						style={{ backgroundColor: theme.bg }}
					>
						<div className='flex gap-2 px-5 pt-5'>
							<span
								className='h-8 w-8 rounded-full'
								style={{ backgroundColor: theme.accent }}
							/>
							<span
								className='h-8 w-8 rounded-full opacity-80'
								style={{ backgroundColor: theme.accent2 }}
							/>
						</div>
						<div className='px-5 pt-4 pb-5'>
							<h3
								className='font-mono text-sm font-bold'
								style={{ color: theme.accent }}
							>
								{theme.label}
							</h3>
							<p className='mt-1 text-xs leading-relaxed text-gray-400'>
								{theme.voice}
							</p>
						</div>
					</div>
				))}
			</div>
		</Section>
	);
}

function Screenshots() {
	const [themeId, setThemeId] = useState<ThemeId>('graphite');
	const [platform, setPlatform] = useState<Platform>('ios');
	const theme = themes.find((t) => t.id === themeId) ?? themes[0];
	const shots = screenshotManifest[themeId]?.[platform];
	return (
		<Section
			eyebrow='screenshots'
			title='See it in your theme.'
			lead='Browse every screen, per theme and per platform.'
		>
			<div className='flex flex-wrap items-center justify-between gap-4'>
				<Tabs
					value={themeId}
					onValueChange={(value) => {
						setThemeId(value as ThemeId);
					}}
				>
					<TabsList className='h-auto flex-wrap'>
						{themes.map((t) => (
							<TabsTrigger key={t.id} value={t.id} className='gap-2 px-3 py-1'>
								<span
									aria-hidden='true'
									className='h-2.5 w-2.5 rounded-full'
									style={{ backgroundColor: t.accent }}
								/>
								{t.label}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>
				<ToggleGroup
					value={[platform]}
					variant='outline'
					spacing={0}
					onValueChange={(value: unknown[]) => {
						const next = value.at(0);
						if (next === 'ios' || next === 'android') setPlatform(next);
					}}
				>
					{platforms.map((p) => (
						<ToggleGroupItem
							key={p.id}
							value={p.id}
							aria-label={`Show ${p.label} screenshots`}
						>
							{p.label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</div>
			<div className='mt-8'>
				{shots ? (
					<div className='flex snap-x gap-5 overflow-x-auto pb-4 lg:grid lg:grid-cols-5 lg:overflow-visible'>
						{shots.map((shot) => (
							<img
								key={shot.alt}
								src={shot.src}
								alt={shot.alt}
								className='w-44 shrink-0 snap-center border border-white/10 shadow-xl shadow-black/40 lg:w-full'
								loading='lazy'
							/>
						))}
					</div>
				) : (
					<div
						className='flex min-h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 p-10 text-center'
						style={{ backgroundColor: theme.bg }}
					>
						<p
							className='font-mono text-sm font-semibold'
							style={{ color: theme.accent }}
						>
							{theme.label} · {platform === 'ios' ? 'iOS' : 'Android'}
						</p>
						<p className='max-w-sm text-sm leading-relaxed text-gray-400'>
							Not captured yet — the screenshot pipeline will soon generate
							every theme on both platforms automatically.
						</p>
					</div>
				)}
			</div>
		</Section>
	);
}

function OpenSource() {
	return (
		<Section
			eyebrow='open source'
			title='Free. No paywalled SSH.'
			lead='Some mobile SSH clients lock basics like one-off commands behind a subscription. Fressh is MIT-licensed and free — and the native terminal core is published on npm for any React Native app to use.'
		>
			<div className='rounded-2xl border border-white/10 bg-white/[0.03] p-7 transition hover:border-emerald-400/30'>
				<div className='flex flex-wrap items-start justify-between gap-4'>
					<a
						href={npmPackageUrl}
						target='_blank'
						rel='noopener noreferrer'
						className='font-mono text-base font-semibold text-white transition hover:text-emerald-300'
					>
						{npmPackageName}
					</a>
					<a
						href={npmPackageUrl}
						target='_blank'
						rel='noopener noreferrer'
						className='shrink-0 transition hover:opacity-80'
					>
						<img
							src={npmVersionBadgeUrl}
							alt={`${npmPackageName} on npm`}
							className='h-5'
							loading='lazy'
						/>
					</a>
				</div>
				<p className='mt-3 max-w-2xl text-sm leading-relaxed text-gray-400'>
					The native terminal package: SSH via russh, a durable VT engine via
					alacritty_terminal, and Alacritty’s GPU renderer — all in one native
					library you can drop into your own React Native app.
				</p>
				<div className='mt-5 flex items-center gap-3 overflow-x-auto rounded-xl border border-white/10 bg-[#07090c] px-4 py-3 font-mono text-sm'>
					<span aria-hidden='true' className='select-none text-emerald-400'>
						$
					</span>
					<code className='whitespace-nowrap text-gray-200'>
						bun add {npmPackageName}
					</code>
				</div>
				<div className='mt-5 flex flex-wrap gap-3'>
					<a
						href={npmPackageUrl}
						target='_blank'
						rel='noopener noreferrer'
						className='inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-gray-200 transition hover:border-white/25 hover:bg-white/10'
					>
						<img
							src={npmLogoRed}
							alt=''
							aria-hidden='true'
							className='h-3 w-auto'
						/>
						View on npm
					</a>
					<a
						href={githubPackageUrl}
						target='_blank'
						rel='noopener noreferrer'
						className='inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-gray-200 transition hover:border-white/25 hover:bg-white/10'
					>
						<img
							src={GithubMark}
							alt=''
							aria-hidden='true'
							className='h-4 w-4 invert'
						/>
						Source on GitHub
					</a>
				</div>
			</div>
		</Section>
	);
}

function Section({
	eyebrow,
	title,
	lead,
	children,
}: Readonly<{
	eyebrow: string;
	title: string;
	lead?: string;
	children: ReactNode;
}>) {
	return (
		<section className='border-t border-white/5 py-16 lg:py-20'>
			<p className='font-mono text-xs tracking-[0.25em] text-emerald-400 uppercase'>
				{eyebrow}
			</p>
			<h2 className='mt-3 max-w-2xl text-2xl font-bold tracking-tight text-white sm:text-3xl'>
				{title}
			</h2>
			{lead ? (
				<p className='mt-4 max-w-2xl text-base leading-relaxed text-gray-400'>
					{lead}
				</p>
			) : null}
			<div className='mt-10'>{children}</div>
		</section>
	);
}

function Footer() {
	return (
		<footer className='flex flex-wrap items-center justify-between gap-4 border-t border-white/5 py-10 text-sm text-gray-500'>
			<p className='font-mono text-xs'>
				fressh · powered by{' '}
				<a
					href='https://github.com/alacritty/alacritty'
					target='_blank'
					rel='noopener noreferrer'
					className='text-emerald-400/80 hover:text-emerald-300'
				>
					alacritty
				</a>
			</p>
			<div className='flex items-center gap-6'>
				<Link
					to='/privacy'
					className='underline decoration-dotted underline-offset-4 hover:text-gray-300 hover:decoration-solid'
				>
					Privacy Policy
				</Link>
				<a
					href='https://github.com/EthanShoeDev/fressh'
					target='_blank'
					rel='noopener noreferrer'
					className='underline decoration-dotted underline-offset-4 hover:text-gray-300 hover:decoration-solid'
				>
					GitHub
				</a>
			</div>
			<p className='w-full text-xs leading-relaxed text-gray-600'>
				Google Play and the Google Play logo are trademarks of Google LLC.
				Apple, the Apple logo, and App Store are trademarks of Apple Inc.,
				registered in the U.S. and other countries.
			</p>
		</footer>
	);
}
