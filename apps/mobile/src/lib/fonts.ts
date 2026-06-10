import { Archivo_700Bold, Archivo_900Black } from '@expo-google-fonts/archivo';
import {
	InterTight_400Regular,
	InterTight_700Bold,
	InterTight_800ExtraBold,
} from '@expo-google-fonts/inter-tight';
import {
	JetBrainsMono_400Regular,
	JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import {
	SpaceGrotesk_400Regular,
	SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import {
	SpaceMono_400Regular,
	SpaceMono_700Bold,
} from '@expo-google-fonts/space-mono';

/**
 * The design doc's typefaces, loaded at runtime via `expo-font`'s `useFonts`
 * (no native rebuild — `expo-font` is already in the dev client). Each key
 * becomes the `fontFamily` string used by `theme-skin.ts`:
 *   - Archivo       → Monolith display titles
 *   - Inter Tight   → Graphite body/titles
 *   - JetBrains Mono→ Phosphor (all) + host/mono bits everywhere
 *   - Space Grotesk → Aurora body/titles
 *   - Space Mono    → Monolith data/labels
 */
export const appFonts = {
	Archivo_700Bold,
	Archivo_900Black,
	InterTight_400Regular,
	InterTight_700Bold,
	InterTight_800ExtraBold,
	JetBrainsMono_400Regular,
	JetBrainsMono_700Bold,
	SpaceGrotesk_400Regular,
	SpaceGrotesk_700Bold,
	SpaceMono_400Regular,
	SpaceMono_700Bold,
};
