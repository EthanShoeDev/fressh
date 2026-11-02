import { Link, createFileRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';

export const Route = createFileRoute('/privacy')({
	head: () => ({
		meta: [
			{ title: 'Privacy Policy | Fressh' },
			{
				name: 'description',
				content: 'Privacy policy for Fressh, an open-source mobile SSH client.',
			},
		],
	}),
	component: PrivacyPage,
});

function PrivacyPage() {
	return (
		<main className='mx-auto max-w-3xl px-6 py-16 text-gray-800 dark:text-gray-100'>
			<Link
				to='/'
				className='text-sm text-gray-500 underline decoration-dotted hover:decoration-solid dark:text-gray-400'
			>
				← Back to home
			</Link>
			<h1 className='mt-6 text-4xl font-bold tracking-tight'>Privacy Policy</h1>
			<p className='mt-3 text-sm text-gray-500 dark:text-gray-400'>
				Effective date: October 9, 2025
			</p>

			<div className='mt-10 space-y-8 text-base leading-7'>
				<p>
					Fressh ("the App") is provided by an individual developer ("we",
					"us"). This policy explains how the App handles information.
				</p>

				<PolicySection title='Summary'>
					<ul className='list-disc space-y-2 pl-6'>
						<li>We do not collect any personal information or analytics.</li>
						<li>
							The App has no backend servers; your data remains on your device.
						</li>
						<li>No ads and no third-party tracking SDKs.</li>
					</ul>
				</PolicySection>

				<PolicySection title='Data the App handles'>
					<p>
						The App allows you to store SSH connection details (e.g., hostnames,
						usernames, ports, and optional private keys). This information is
						stored locally on your device and is only transmitted to the servers
						you choose when you initiate an SSH session.
					</p>
					<h3 className='mt-6 text-xl font-semibold text-gray-900 dark:text-white'>
						Sensitive credentials
					</h3>
					<p className='mt-3'>
						Private keys, passwords, and session data never leave your device
						except as required to establish and maintain the SSH connection that
						you request. We do not upload this information to any server we
						control.
					</p>
				</PolicySection>

				<PolicySection title='Permissions'>
					<ul className='list-disc space-y-2 pl-6'>
						<li>
							<strong>Network access</strong>: required to connect to SSH
							servers you choose.
						</li>
						<li>
							<strong>Local storage</strong>: used to save SSH profiles/keys if
							you opt to store them.
						</li>
						<li>
							<strong>Clipboard</strong> (optional): used only when you
							copy/paste text during a session.
						</li>
					</ul>
				</PolicySection>

				<PolicySection title='Collection, sharing, and retention'>
					<ul className='list-disc space-y-2 pl-6'>
						<li>
							<strong>Collection</strong>: We do not collect or process personal
							data.
						</li>
						<li>
							<strong>Sharing</strong>: We do not sell or share data with third
							parties.
						</li>
						<li>
							<strong>Retention</strong>: Data you save remains on your device
							until you delete it or uninstall the App.
						</li>
					</ul>
				</PolicySection>

				<PolicySection title="Children's privacy">
					<p>
						The App is not directed to children. We do not knowingly collect
						personal information from children under 13. If you believe a child
						has provided information, please contact us so we can delete it.
					</p>
				</PolicySection>

				<PolicySection title='Security'>
					<p>
						We rely on the security features of your device's operating system
						and the SSH protocol. Protect your device with a strong passcode and
						keep your operating system up to date.
					</p>
				</PolicySection>

				<PolicySection title='Third-party services'>
					<p>
						The App does not use advertising, analytics, or social media SDKs.
					</p>
				</PolicySection>

				<PolicySection title='Changes to this policy'>
					<p>
						We may update this policy from time to time. Changes will be posted
						on this page with an updated effective date.
					</p>
				</PolicySection>

				<PolicySection title='Contact'>
					<p>
						If you have questions about this policy, contact us at{' '}
						<a
							href='mailto:ethanshumate@gmail.com'
							className='text-blue-600 underline decoration-dotted hover:decoration-solid dark:text-blue-400'
						>
							ethanshumate@gmail.com
						</a>
						.
					</p>
				</PolicySection>
			</div>
		</main>
	);
}

function PolicySection({
	title,
	children,
}: Readonly<{ title: string; children: ReactNode }>) {
	return (
		<section>
			<h2 className='text-2xl font-semibold tracking-tight text-gray-950 dark:text-white'>
				{title}
			</h2>
			<div className='mt-3 text-gray-700 dark:text-gray-300'>{children}</div>
		</section>
	);
}
