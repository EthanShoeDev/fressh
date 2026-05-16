#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.env.FRESSH_REPO || process.cwd();
const configPath =
	process.argv[2] || path.join(repoRoot, 'apps/mobile/config/shell-config.json');

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

function describeSlot(slot) {
	if (slot === null) return 'null';
	const base = `${slot.label || slot.type}:${slot.type}`;
	const parts = [base];
	if (slot.span) parts.push(`span=${slot.span}`);
	if (slot.type === 'macro') parts.push(`macro=${slot.macroId}`);
	if (slot.type === 'action') parts.push(`action=${slot.actionId}`);
	if (slot.longPress) {
		parts.push(`longPress=${slot.longPress.options.length}`);
	}
	return parts.join(' ');
}

console.log(`Config: ${path.relative(repoRoot, configPath)}`);
console.log(`Version: ${config.version}`);
console.log(`Updated: ${config.updatedAt}`);
console.log(`Default keyboard: ${config.defaultKeyboardId}`);
console.log(`Active keyboards: ${config.activeKeyboardIds.join(', ')}`);
console.log('');

console.log('Routing:');
for (const [actionId, keyboardId] of Object.entries(
	config.keyboardRouting?.actionTargets || {},
)) {
	console.log(`  ${actionId} -> ${keyboardId}`);
}
for (const [keyboardId, returnKeyboardId] of Object.entries(
	config.keyboardRouting?.oneShotReturnByKeyboardId || {},
)) {
	console.log(`  one-shot ${keyboardId} -> ${returnKeyboardId}`);
}
console.log('');

for (const keyboard of config.keyboards) {
	const macros = config.macrosByKeyboardId?.[keyboard.id] || [];
	const active = config.activeKeyboardIds.includes(keyboard.id)
		? 'active'
		: 'inactive';
	console.log(`Keyboard ${keyboard.id} (${keyboard.name}, ${active})`);
	console.log(`  Macros: ${macros.map((macro) => macro.id).join(', ') || 'none'}`);
	for (const [rowIndex, row] of keyboard.grid.entries()) {
		console.log(`  Row ${rowIndex + 1}: ${row.map(describeSlot).join(' | ')}`);
	}
	console.log('');
}
