import * as LucideIcons from 'lucide-react-native';
import type React from 'react';

export type LucideIconComponent = React.ComponentType<{
	color?: string;
	size?: number;
}>;

export function resolveLucideIcon(
	name: string | null,
): LucideIconComponent | null {
	if (!name) return null;
	const iconMap = LucideIcons as unknown as Record<string, LucideIconComponent>;
	const Icon = iconMap[name];
	return Icon ?? null;
}
