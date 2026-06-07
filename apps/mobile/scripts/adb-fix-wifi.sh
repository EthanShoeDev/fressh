#!/usr/bin/env bash
#
# adb-fix-wifi — make wireless-debugging devices usable by Expo.
#
# When you pair a device over wireless debugging (QR code), adb's mDNS
# auto-connect registers it under its service name, e.g.
#   "adb-xxxxxx-bhK5tr (2)._adb-tls-connect._tcp"
# That serial contains spaces. Expo's device detection splits `adb devices`
# output on whitespace, grabs only the first token, then runs
#   adb -s adb-xxxxxx-bhK5tr shell getprop ...
# against a serial that doesn't exist -> "device '...' not found", build fails.
#
# This script finds any space-containing serial, reconnects the device using a
# clean ip:port serial (which Expo parses fine), and drops the spaced entry.
#
# Best-effort: it never fails the build (always exits 0). No-op on USB.

set -uo pipefail

command -v adb >/dev/null 2>&1 || exit 0

# Serials with whitespace are the unparseable mDNS auto-connect entries.
# Strip the trailing tab-delimited state field, keep serials containing a space.
mapfile -t bad < <(
	adb devices 2>/dev/null | tail -n +2 | sed -E 's/\t[^\t]*$//' | grep ' ' || true
)

[ "${#bad[@]}" -eq 0 ] && exit 0

echo "adb-fix-wifi: ${#bad[@]} wireless serial(s) Expo can't parse; reconnecting via ip:port..."

# Discover clean tls endpoints and connect one per device IP (avoid duplicates).
declare -A connected
while IFS=$'\t' read -r _name service addr; do
	[ "$service" = "_adb-tls-connect._tcp" ] || continue
	ip="${addr%%:*}"
	[ -n "${connected[$ip]:-}" ] && continue
	if adb connect "$addr" 2>&1 | grep -qi connected; then
		connected[$ip]="$addr"
		echo "adb-fix-wifi: connected $addr"
	fi
done < <(adb mdns services 2>/dev/null | tail -n +2)

# Remove the spaced serials now that clean ip:port ones exist.
for serial in "${bad[@]}"; do
	adb disconnect "$serial" >/dev/null 2>&1 || true
done

exit 0
