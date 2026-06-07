import { ScrollView, View } from 'react-native';
import {
	FieldLabel,
	Section,
	Segmented,
	SelectRow,
	StepperRow,
	ToggleRow,
} from '@/components/settings-controls';
import { TerminalPreview } from '@/components/terminal-preview';
import { ThemedText } from '@/components/themed/ThemedText';
import {
	COLOR_SCHEMES,
	CURSOR_BLINKS,
	CURSOR_STYLES,
	preferences,
	TERMINAL_BLINK_INTERVAL,
	TERMINAL_BLINK_TIMEOUT,
	TERMINAL_FONT_SIZE,
	TERMINAL_PADDING,
	TERMINAL_SCROLLBACK,
} from '@/lib/preferences';

export default function TerminalSettings() {
	const [fontSize, setFontSize] = preferences.terminalFontSize.useValue();
	const [padding, setPadding] = preferences.terminalPadding.useValue();
	const [scrollback, setScrollback] = preferences.terminalScrollback.useValue();
	const [colorScheme, setColorScheme] =
		preferences.terminalColorScheme.useValue();
	const [cursorStyle, setCursorStyle] =
		preferences.terminalCursorStyle.useValue();
	const [cursorBlink, setCursorBlink] =
		preferences.terminalCursorBlink.useValue();
	const [blinkInterval, setBlinkInterval] =
		preferences.terminalBlinkInterval.useValue();
	const [blinkTimeout, setBlinkTimeout] =
		preferences.terminalBlinkTimeout.useValue();
	const [boldIsBright, setBoldIsBright] =
		preferences.terminalBoldIsBright.useValue();

	return (
		<View className='flex-1 bg-background'>
			{/* Sticky preview pinned above the scrolling settings list so it stays
			    visible while you adjust theme / font / cursor and watch it reflow. */}
			<View className='p-4 pb-0'>
				<TerminalPreview />
			</View>
			<ScrollView
				className='flex-1'
				contentContainerClassName='p-4'
				contentInsetAdjustmentBehavior='automatic'
			>
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

						<FieldLabel>Cursor blink</FieldLabel>
						<Segmented
							options={CURSOR_BLINKS}
							value={cursorBlink}
							onChange={setCursorBlink}
						/>
						{cursorBlink !== 'never' && (
							<>
								<StepperRow
									label='Blink interval (ms)'
									value={blinkInterval}
									decDisabled={blinkInterval <= TERMINAL_BLINK_INTERVAL.min}
									incDisabled={blinkInterval >= TERMINAL_BLINK_INTERVAL.max}
									onDec={() => {
										setBlinkInterval(
											blinkInterval - TERMINAL_BLINK_INTERVAL.step,
										);
									}}
									onInc={() => {
										setBlinkInterval(
											blinkInterval + TERMINAL_BLINK_INTERVAL.step,
										);
									}}
								/>
								<StepperRow
									label='Stop blinking after'
									value={blinkTimeout === 0 ? 'Never' : `${blinkTimeout}s`}
									decDisabled={blinkTimeout <= TERMINAL_BLINK_TIMEOUT.min}
									incDisabled={blinkTimeout >= TERMINAL_BLINK_TIMEOUT.max}
									onDec={() => {
										setBlinkTimeout(blinkTimeout - TERMINAL_BLINK_TIMEOUT.step);
									}}
									onInc={() => {
										setBlinkTimeout(blinkTimeout + TERMINAL_BLINK_TIMEOUT.step);
									}}
								/>
							</>
						)}

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
						<ThemedText className='text-xs text-muted'>
							Scrollback applies to new shells.
						</ThemedText>
					</View>
				</Section>
			</ScrollView>
		</View>
	);
}
