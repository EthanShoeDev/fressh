import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { resolveLucideIcon } from '@/lib/lucide-utils';
import { useTheme } from '@/lib/theme';
import {
	TMUX_HISTORY_LIVE_LABEL,
	type TmuxHistoryCommandId,
} from '@/lib/tmux-history';

type HistoryButton = {
	commandId: TmuxHistoryCommandId;
	label: string;
	icon: string | null;
	span?: number;
};

const rows: HistoryButton[][] = [
	[
		{ commandId: 'UP', label: 'Up', icon: 'ArrowUp' },
		{ commandId: 'DOWN', label: 'Down', icon: 'ArrowDown' },
		{ commandId: 'PAGE_UP', label: 'Page Up', icon: 'ChevronsUp' },
		{ commandId: 'PAGE_DOWN', label: 'Page Down', icon: 'ChevronsDown' },
	],
	[
		{ commandId: 'TOP', label: 'Top', icon: 'ArrowUpToLine' },
		{
			commandId: 'LIVE',
			label: TMUX_HISTORY_LIVE_LABEL,
			icon: 'ArrowDownToLine',
			span: 2,
		},
		{ commandId: 'CLOSE', label: 'Close', icon: 'X' },
	],
];

export function TmuxHistoryKeyboard({
	onCommand,
}: {
	onCommand: (commandId: TmuxHistoryCommandId) => void;
}) {
	const theme = useTheme();
	const keyHeight = 48;

	return (
		<View
			style={{
				borderTopWidth: 1,
				borderColor: theme.colors.border,
				padding: 6,
			}}
		>
			{rows.map((row) => (
				<View
					key={row.map((button) => button.commandId).join('-')}
					style={{ flexDirection: 'row' }}
				>
					{row.map((button) => {
						const Icon = resolveLucideIcon(button.icon);
						return (
							<Pressable
								key={button.commandId}
								onPress={() => onCommand(button.commandId)}
								style={{
									flex: button.span ?? 1,
									margin: 2,
									height: keyHeight,
									paddingVertical: 6,
									borderRadius: 8,
									borderWidth: 1,
									borderColor: theme.colors.border,
									alignItems: 'center',
									justifyContent: 'center',
								}}
							>
								{Icon ? (
									<Icon color={theme.colors.textPrimary} size={18} />
								) : null}
								<Text
									numberOfLines={1}
									style={{
										color: theme.colors.textPrimary,
										fontSize: 10,
										lineHeight: 12,
										marginTop: Icon ? 2 : 0,
									}}
								>
									{button.label}
								</Text>
							</Pressable>
						);
					})}
				</View>
			))}
		</View>
	);
}
