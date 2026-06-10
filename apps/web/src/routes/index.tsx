import AppStoreBadge from '@fressh/assets/third-party-brands/apple-app-store/Black_lockup/SVG/Download_on_the_App_Store_Badge_US-UK_RGB_blk_092917.svg';
import GithubMark from '@fressh/assets/third-party-brands/github-mark/github-mark.svg';
import GooglePlayBadge from '@fressh/assets/third-party-brands/google-play/GetItOnGooglePlay_Badge_Web_color_English.svg';
import npmLogoRed from '@fressh/assets/third-party-brands/npm-js/npm-logo-red.png';
import mobileAppIconDark from '@fressh/assets/mobile-app-icon-dark.png';
import serversScreenshot from '@fressh/assets/mobile-screenshots/servers-ios.png';
import keysScreenshot from '@fressh/assets/mobile-screenshots/keys-ios.png';
import { createFileRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';

const title = 'Fressh - Mobile SSH Client';
const description =
	'A clean, powerful open-source mobile SSH client. Built with React Native and powered by Russh (Rust-based SSH).';

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

function HomePage() {
	return (
		<section className='bg-gradient-to-b from-gray-50 via-white to-white dark:from-gray-950 dark:via-gray-950 dark:to-black'>
			<div className='mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center gap-16 px-6 py-24'>
				<div className='grid gap-16 lg:max-w-4xl'>
					<div className='space-y-8'>
						<div className='flex items-start gap-4'>
							<img
								src={mobileAppIconDark}
								alt='Fressh app icon'
								className='h-20 w-20 shrink-0 rounded-3xl border border-white/30 shadow-xl shadow-emerald-500/10 dark:border-white/10'
								loading='eager'
							/>
							<div className='flex flex-col items-start gap-2'>
								<span className='inline-flex items-center gap-2 rounded-full border border-emerald-300/70 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-900 dark:border-emerald-500/50 dark:bg-emerald-500/15 dark:text-emerald-200'>
									<span className='inline-block h-2 w-2 rounded-full bg-emerald-500' />
									Coming soon
								</span>
								<span className='text-sm font-semibold tracking-[0.3em] text-gray-500 uppercase dark:text-gray-400'>
									Mobile SSH Client
								</span>
							</div>
						</div>
						<h1 className='text-4xl font-black tracking-tight text-gray-900 sm:text-5xl lg:text-6xl dark:text-white'>
							Fressh - Mobile SSH Client
						</h1>
						<p className='max-w-xl text-lg leading-relaxed text-gray-600 dark:text-gray-300'>
							A clean, powerful open-source mobile SSH client. Built with React
							Native and powered by Russh (Rust-based SSH).
						</p>
						<div className='flex flex-wrap items-center gap-4'>
							<a
								href='https://github.com/EthanShoeDev/fressh'
								target='_blank'
								rel='noopener noreferrer'
								className='group inline-flex items-center gap-3 rounded-full border border-gray-200 bg-white/70 px-5 py-3 text-sm font-medium text-gray-900 shadow-sm backdrop-blur transition hover:border-gray-300 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:border-white/20 dark:hover:bg-white/10'
							>
								<img
									src={GithubMark}
									alt=''
									className='h-5 w-5'
									aria-hidden='true'
								/>
								<span>View the source on GitHub</span>
							</a>
							<div className='flex flex-col gap-2 text-xs text-gray-500 dark:text-gray-400'>
								<div className='flex items-center gap-6'>
									<div className='flex flex-col items-start gap-2'>
										<img
											src={GooglePlayBadge}
											className='h-12 w-auto select-none'
											alt='Get it on Google Play badge'
										/>
										<span className='inline-flex items-center gap-2 rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-medium tracking-wider text-gray-500 uppercase dark:border-gray-700 dark:text-gray-400'>
											Coming soon
										</span>
									</div>
									<div className='flex flex-col items-start gap-2'>
										<div className='flex h-12 items-center rounded-lg'>
											<img
												src={AppStoreBadge}
												className='h-9 w-auto select-none'
												alt='Download on the App Store badge'
											/>
										</div>
										<span className='inline-flex items-center gap-2 rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-medium tracking-wider text-gray-500 uppercase dark:border-gray-700 dark:text-gray-400'>
											Coming soon
										</span>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>

				<div className='grid gap-6 lg:grid-cols-3'>
					<FeatureCard
						title='Features'
						titleClassName='text-emerald-600 dark:text-emerald-300'
						hoverClassName='hover:border-emerald-200 dark:hover:border-emerald-500/30'
						items={[
							'Securely store previous connections',
							'Generate or import SSH keys',
							'One-tap command presets',
							'Native terminal renderer — no WebView',
							'Configurable themes',
						]}
						marker='check'
						markerClassName='bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
					/>
					<FeatureCard
						title='Coming soon'
						titleClassName='text-amber-600 dark:text-amber-300'
						hoverClassName='hover:border-amber-200 dark:hover:border-amber-400/30'
						items={[
							'On-device LLM for command completion and output summarization',
						]}
						marker='dot'
						markerClassName='bg-amber-500/10 text-amber-600 dark:text-amber-300'
					/>
					<article className='rounded-3xl border border-gray-200/80 bg-white/80 p-8 backdrop-blur-sm transition hover:border-blue-200 dark:border-white/10 dark:bg-white/5 dark:hover:border-blue-400/30'>
						<h2 className='text-sm font-semibold tracking-wider text-blue-600 uppercase dark:text-blue-300'>
							Technical specs
						</h2>
						<ul className='mt-4 space-y-3 text-sm leading-relaxed text-gray-700 dark:text-gray-300'>
							<TechSpec>UI built with React Native</TechSpec>
							<TechSpec>
								SSH core powered by{' '}
								<a
									href='https://github.com/Eugeny/russh'
									target='_blank'
									rel='noopener noreferrer'
									className='text-blue-600 underline decoration-dotted hover:decoration-solid dark:text-blue-400'
								>
									Russh
								</a>{' '}
								(Rust-based SSH library)
							</TechSpec>
							<TechSpec>
								Open source on{' '}
								<a
									href='https://github.com/EthanShoeDev/fressh'
									target='_blank'
									rel='noopener noreferrer'
									className='text-blue-600 underline decoration-dotted hover:decoration-solid dark:text-blue-400'
								>
									GitHub
								</a>
							</TechSpec>
						</ul>
					</article>
				</div>

				<div className='mx-auto grid max-w-xl gap-6'>
					<PackageCard
						href='https://github.com/EthanShoeDev/fressh/tree/main/packages/react-native-terminal'
						title='@fressh/react-native-terminal'
						description='One native package: SSH via russh, a durable VT engine via alacritty_terminal, and a native GLES renderer — all in one .so. Replaces the old uniffi-russh + xterm.js WebView packages.'
						hoverClassName='hover:border-emerald-200 dark:hover:border-emerald-500/30'
						titleHoverClassName='group-hover:text-emerald-600 dark:group-hover:text-emerald-300'
						logo={GithubMark}
						logoAlt='GitHub'
						logoClassName='dark:invert'
					/>
				</div>

				<div className='mt-16'>
					<div className='mx-auto max-w-5xl rounded-[2.5rem] border border-gray-200/70 bg-white/80 px-8 py-12 shadow-xl shadow-emerald-500/5 backdrop-blur dark:border-white/10 dark:bg-white/5 dark:shadow-emerald-500/10'>
						<div className='flex flex-col items-center gap-8 lg:flex-row lg:justify-center'>
							<img
								src={serversScreenshot}
								alt='Servers tab screenshot'
								className='w-full max-w-xs rounded-3xl border border-white/60 shadow-xl ring-1 shadow-emerald-500/15 ring-emerald-500/10 dark:border-white/10 dark:ring-white/10'
								loading='lazy'
							/>
							<img
								src={keysScreenshot}
								alt='Keys tab screenshot'
								className='w-full max-w-xs rounded-3xl border border-white/60 shadow-xl ring-1 shadow-slate-900/10 ring-slate-900/10 dark:border-white/10 dark:ring-white/10'
								loading='lazy'
							/>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

function FeatureCard({
	title,
	titleClassName,
	hoverClassName,
	items,
	marker,
	markerClassName,
}: Readonly<{
	title: string;
	titleClassName: string;
	hoverClassName: string;
	items: ReadonlyArray<string>;
	marker: 'check' | 'dot';
	markerClassName: string;
}>) {
	return (
		<article
			className={`rounded-3xl border border-gray-200/80 bg-white/80 p-8 backdrop-blur-sm transition dark:border-white/10 dark:bg-white/5 ${hoverClassName}`}
		>
			<h2
				className={`text-sm font-semibold tracking-wider uppercase ${titleClassName}`}
			>
				{title}
			</h2>
			<ul className='mt-4 space-y-3 text-sm leading-relaxed text-gray-700 dark:text-gray-300'>
				{items.map((item) => (
					<li className='flex items-start gap-3' key={item}>
						<span
							className={`mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-sm font-semibold ${markerClassName}`}
						>
							{marker === 'check' ? '✓' : '•'}
						</span>
						<span>{item}</span>
					</li>
				))}
			</ul>
		</article>
	);
}

function TechSpec({ children }: Readonly<{ children: ReactNode }>) {
	return (
		<li className='flex items-start gap-3'>
			<span className='mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-500/10 text-sm font-semibold text-blue-600 dark:text-blue-300'>
				•
			</span>
			<span>{children}</span>
		</li>
	);
}

function PackageCard({
	href,
	title,
	description,
	hoverClassName,
	titleHoverClassName,
	logo = npmLogoRed,
	logoAlt = 'npm',
	logoClassName = '',
}: Readonly<{
	href: string;
	title: string;
	description: string;
	hoverClassName: string;
	titleHoverClassName: string;
	logo?: string;
	logoAlt?: string;
	logoClassName?: string;
}>) {
	return (
		<a
			href={href}
			target='_blank'
			rel='noopener noreferrer'
			className={`group relative overflow-hidden rounded-3xl border border-gray-200 bg-white/80 p-8 backdrop-blur-sm transition hover:-translate-y-1 hover:shadow-xl dark:border-white/10 dark:bg-white/5 ${hoverClassName}`}
		>
			<img
				src={logo}
				alt={logoAlt}
				className={`absolute top-5 right-5 h-4 w-auto opacity-80 ${logoClassName}`}
				loading='lazy'
			/>
			<h3
				className={`pr-12 text-lg font-semibold text-gray-900 transition dark:text-gray-100 ${titleHoverClassName}`}
			>
				{title}
			</h3>
			<p className='mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300'>
				{description}
			</p>
		</a>
	);
}
