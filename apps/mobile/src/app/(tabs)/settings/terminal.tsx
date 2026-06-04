import { Text, View } from 'react-native';
import {
	FieldLabel,
	Section,
	Segmented,
	SelectRow,
	StepperRow,
	ToggleRow,
} from '@/components/settings-controls';
import {
	COLOR_SCHEMES,
	CURSOR_STYLES,
	preferences,
	TERMINAL_FONT_SIZE,
	TERMINAL_PADDING,
	TERMINAL_SCROLLBACK,
} from '@/lib/preferences';

export default function TerminalSettings() {
	const [fontSize, setFontSize] =
		preferences.terminalFontSize.useTerminalFontSizePref();
	const [padding, setPadding] =
		preferences.terminalPadding.useTerminalPaddingPref();
	const [scrollback, setScrollback] =
		preferences.terminalScrollback.useTerminalScrollbackPref();
	const [colorScheme, setColorScheme] =
		preferences.terminalColorScheme.useTerminalColorSchemePref();
	const [cursorStyle, setCursorStyle] =
		preferences.terminalCursorStyle.useTerminalCursorStylePref();
	const [boldIsBright, setBoldIsBright] =
		preferences.terminalBoldIsBright.useTerminalBoldIsBrightPref();

	return (
		<View className='flex-1 bg-background p-4'>
			<Section title='Theme'>
				<View className='gap-2'>
					{COLOR_SCHEMES.map((scheme) => (
						<SelectRow
							key={scheme.id}
							label={scheme.label}
							selected={colorScheme === scheme.id}
							onPress={() => {
								setColorScheme(scheme.id);
							}}
						/>
					))}
				</View>
			</Section>

			<Section title='Display'>
				<View className='gap-2'>
					<StepperRow
						label='Font size'
						value={fontSize}
						decDisabled={fontSize <= TERMINAL_FONT_SIZE.min}
						incDisabled={fontSize >= TERMINAL_FONT_SIZE.max}
						onDec={() => {
							setFontSize(fontSize - TERMINAL_FONT_SIZE.step);
						}}
						onInc={() => {
							setFontSize(fontSize + TERMINAL_FONT_SIZE.step);
						}}
					/>
					<StepperRow
						label='Padding'
						value={padding}
						decDisabled={padding <= TERMINAL_PADDING.min}
						incDisabled={padding >= TERMINAL_PADDING.max}
						onDec={() => {
							setPadding(padding - TERMINAL_PADDING.step);
						}}
						onInc={() => {
							setPadding(padding + TERMINAL_PADDING.step);
						}}
					/>

					<FieldLabel>Cursor</FieldLabel>
					<Segmented
						options={CURSOR_STYLES}
						value={cursorStyle}
						onChange={setCursorStyle}
					/>

					<ToggleRow
						label='Bold is bright'
						value={boldIsBright}
						onChange={setBoldIsBright}
					/>
				</View>
			</Section>

			<Section title='Buffer'>
				<View className='gap-2'>
					<StepperRow
						label='Scrollback'
						value={scrollback}
						decDisabled={scrollback <= TERMINAL_SCROLLBACK.min}
						incDisabled={scrollback >= TERMINAL_SCROLLBACK.max}
						onDec={() => {
							setScrollback(scrollback - TERMINAL_SCROLLBACK.step);
						}}
						onInc={() => {
							setScrollback(scrollback + TERMINAL_SCROLLBACK.step);
						}}
					/>
					<Text className='text-xs text-muted'>
						Scrollback applies to new shells.
					</Text>
				</View>
			</Section>
		</View>
	);
}
