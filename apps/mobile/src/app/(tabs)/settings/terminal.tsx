import { ScrollView, View } from 'react-native';
import {
	NativeForm,
	NativeSection,
	NativeSegmentedRow,
	NativeSelectRow,
	NativeStepperRow,
	NativeToggleRow,
} from '@/components/native-controls';
import {
	FieldLabel,
	Section,
	Segmented,
	SelectRow,
	StepperRow,
	ToggleRow,
} from '@/components/settings-controls';
import { TerminalPreview } from '@/components/terminal-preview';
import { ThemedScreen } from '@/components/themed/ThemedScreen';
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
import { useIsNativeTheme } from '@/lib/theme-skin';
import { useBottomTabSpacing } from '@/lib/useBottomTabSpacing';

/** Shared terminal-settings state (prefs + bounds helpers) for both render paths. */
function useTerminalSettingsState() {
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
	return {
		fontSize,
		setFontSize,
		padding,
		setPadding,
		scrollback,
		setScrollback,
		colorScheme,
		setColorScheme,
		cursorStyle,
		setCursorStyle,
		cursorBlink,
		setCursorBlink,
		blinkInterval,
		setBlinkInterval,
		blinkTimeout,
		setBlinkTimeout,
		boldIsBright,
		setBoldIsBright,
	};
}

export default function TerminalSettings() {
	return useIsNativeTheme() ? <NativeTerminal /> : <CustomTerminal />;
}

/** Native theme: the preview (RN) above one full-screen `<Host>` form. */
function NativeTerminal() {
	const s = useTerminalSettingsState();
	return (
		<ThemedScreen edges={[]}>
			<View className='p-4 pb-0'>
				<TerminalPreview />
			</View>
			<NativeForm>
				<NativeSection title='Theme'>
					{COLOR_SCHEMES.map((scheme) => (
						<NativeSelectRow
							key={scheme.id}
							label={scheme.label}
							selected={s.colorScheme === scheme.id}
							onPress={() => {
								s.setColorScheme(scheme.id);
							}}
						/>
					))}
				</NativeSection>

				<NativeSection title='Display'>
					<NativeStepperRow
						label='Font size'
						value={s.fontSize}
						decDisabled={s.fontSize <= TERMINAL_FONT_SIZE.min}
						incDisabled={s.fontSize >= TERMINAL_FONT_SIZE.max}
						onDec={() => {
							s.setFontSize(s.fontSize - TERMINAL_FONT_SIZE.step);
						}}
						onInc={() => {
							s.setFontSize(s.fontSize + TERMINAL_FONT_SIZE.step);
						}}
					/>
					<NativeStepperRow
						label='Padding'
						value={s.padding}
						decDisabled={s.padding <= TERMINAL_PADDING.min}
						incDisabled={s.padding >= TERMINAL_PADDING.max}
						onDec={() => {
							s.setPadding(s.padding - TERMINAL_PADDING.step);
						}}
						onInc={() => {
							s.setPadding(s.padding + TERMINAL_PADDING.step);
						}}
					/>
					<NativeToggleRow
						label='Bold is bright'
						value={s.boldIsBright}
						onChange={s.setBoldIsBright}
					/>
				</NativeSection>

				<NativeSection title='Cursor'>
					<NativeSegmentedRow
						label='Style'
						options={CURSOR_STYLES}
						value={s.cursorStyle}
						onChange={s.setCursorStyle}
					/>
					<NativeSegmentedRow
						label='Blink'
						options={CURSOR_BLINKS}
						value={s.cursorBlink}
						onChange={s.setCursorBlink}
					/>
					{s.cursorBlink !== 'never' ? (
						<>
							<NativeStepperRow
								label='Blink interval (ms)'
								value={s.blinkInterval}
								decDisabled={s.blinkInterval <= TERMINAL_BLINK_INTERVAL.min}
								incDisabled={s.blinkInterval >= TERMINAL_BLINK_INTERVAL.max}
								onDec={() => {
									s.setBlinkInterval(
										s.blinkInterval - TERMINAL_BLINK_INTERVAL.step,
									);
								}}
								onInc={() => {
									s.setBlinkInterval(
										s.blinkInterval + TERMINAL_BLINK_INTERVAL.step,
									);
								}}
							/>
							<NativeStepperRow
								label='Stop blinking after'
								value={s.blinkTimeout === 0 ? 'Never' : `${s.blinkTimeout}s`}
								decDisabled={s.blinkTimeout <= TERMINAL_BLINK_TIMEOUT.min}
								incDisabled={s.blinkTimeout >= TERMINAL_BLINK_TIMEOUT.max}
								onDec={() => {
									s.setBlinkTimeout(
										s.blinkTimeout - TERMINAL_BLINK_TIMEOUT.step,
									);
								}}
								onInc={() => {
									s.setBlinkTimeout(
										s.blinkTimeout + TERMINAL_BLINK_TIMEOUT.step,
									);
								}}
							/>
						</>
					) : null}
				</NativeSection>

				<NativeSection
					title='Buffer'
					footer='Scrollback applies to new shells.'
				>
					<NativeStepperRow
						label='Scrollback'
						value={s.scrollback}
						decDisabled={s.scrollback <= TERMINAL_SCROLLBACK.min}
						incDisabled={s.scrollback >= TERMINAL_SCROLLBACK.max}
						onDec={() => {
							s.setScrollback(s.scrollback - TERMINAL_SCROLLBACK.step);
						}}
						onInc={() => {
							s.setScrollback(s.scrollback + TERMINAL_SCROLLBACK.step);
						}}
					/>
				</NativeSection>
			</NativeForm>
		</ThemedScreen>
	);
}

/** Every stylized theme: the custom-drawn terminal settings. */
function CustomTerminal() {
	const s = useTerminalSettingsState();
	const bottomSpace = useBottomTabSpacing();
	return (
		<ThemedScreen edges={[]}>
			{/* Sticky preview pinned above the scrolling settings list so it stays
			    visible while you adjust theme / font / cursor and watch it reflow. */}
			<View className='p-4 pb-0'>
				<TerminalPreview />
			</View>
			<ScrollView
				className='flex-1'
				contentContainerClassName='p-4'
				contentContainerStyle={{ paddingBottom: bottomSpace + 16 }}
				contentInsetAdjustmentBehavior='automatic'
			>
				<Section title='Theme'>
					<View className='gap-2'>
						{COLOR_SCHEMES.map((scheme) => (
							<SelectRow
								key={scheme.id}
								label={scheme.label}
								selected={s.colorScheme === scheme.id}
								onPress={() => {
									s.setColorScheme(scheme.id);
								}}
							/>
						))}
					</View>
				</Section>

				<Section title='Display'>
					<View className='gap-2'>
						<StepperRow
							label='Font size'
							value={s.fontSize}
							decDisabled={s.fontSize <= TERMINAL_FONT_SIZE.min}
							incDisabled={s.fontSize >= TERMINAL_FONT_SIZE.max}
							onDec={() => {
								s.setFontSize(s.fontSize - TERMINAL_FONT_SIZE.step);
							}}
							onInc={() => {
								s.setFontSize(s.fontSize + TERMINAL_FONT_SIZE.step);
							}}
						/>
						<StepperRow
							label='Padding'
							value={s.padding}
							decDisabled={s.padding <= TERMINAL_PADDING.min}
							incDisabled={s.padding >= TERMINAL_PADDING.max}
							onDec={() => {
								s.setPadding(s.padding - TERMINAL_PADDING.step);
							}}
							onInc={() => {
								s.setPadding(s.padding + TERMINAL_PADDING.step);
							}}
						/>

						<FieldLabel>Cursor</FieldLabel>
						<Segmented
							options={CURSOR_STYLES}
							value={s.cursorStyle}
							onChange={s.setCursorStyle}
						/>

						<FieldLabel>Cursor blink</FieldLabel>
						<Segmented
							options={CURSOR_BLINKS}
							value={s.cursorBlink}
							onChange={s.setCursorBlink}
						/>
						{s.cursorBlink !== 'never' && (
							<>
								<StepperRow
									label='Blink interval (ms)'
									value={s.blinkInterval}
									decDisabled={s.blinkInterval <= TERMINAL_BLINK_INTERVAL.min}
									incDisabled={s.blinkInterval >= TERMINAL_BLINK_INTERVAL.max}
									onDec={() => {
										s.setBlinkInterval(
											s.blinkInterval - TERMINAL_BLINK_INTERVAL.step,
										);
									}}
									onInc={() => {
										s.setBlinkInterval(
											s.blinkInterval + TERMINAL_BLINK_INTERVAL.step,
										);
									}}
								/>
								<StepperRow
									label='Stop blinking after'
									value={s.blinkTimeout === 0 ? 'Never' : `${s.blinkTimeout}s`}
									decDisabled={s.blinkTimeout <= TERMINAL_BLINK_TIMEOUT.min}
									incDisabled={s.blinkTimeout >= TERMINAL_BLINK_TIMEOUT.max}
									onDec={() => {
										s.setBlinkTimeout(
											s.blinkTimeout - TERMINAL_BLINK_TIMEOUT.step,
										);
									}}
									onInc={() => {
										s.setBlinkTimeout(
											s.blinkTimeout + TERMINAL_BLINK_TIMEOUT.step,
										);
									}}
								/>
							</>
						)}

						<ToggleRow
							label='Bold is bright'
							value={s.boldIsBright}
							onChange={s.setBoldIsBright}
						/>
					</View>
				</Section>

				<Section title='Buffer'>
					<View className='gap-2'>
						<StepperRow
							label='Scrollback'
							value={s.scrollback}
							decDisabled={s.scrollback <= TERMINAL_SCROLLBACK.min}
							incDisabled={s.scrollback >= TERMINAL_SCROLLBACK.max}
							onDec={() => {
								s.setScrollback(s.scrollback - TERMINAL_SCROLLBACK.step);
							}}
							onInc={() => {
								s.setScrollback(s.scrollback + TERMINAL_SCROLLBACK.step);
							}}
						/>
						<ThemedText className='text-xs text-muted'>
							Scrollback applies to new shells.
						</ThemedText>
					</View>
				</Section>
			</ScrollView>
		</ThemedScreen>
	);
}
