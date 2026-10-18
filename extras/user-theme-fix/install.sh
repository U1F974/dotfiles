#!/bin/sh
# Install a fixed copy of the User Themes extension (GNOME Shell 48).
#
# Its disable() calls disconnectObject() without the tracked object, so the
# settings handler is never removed. The shell disables extensions on screen
# lock and enables them again on unlock, so every unlock adds one more handler
# and one theme change reloads the theme N times.
#
# The copy in ~/.local/share shadows the system one (same uuid). Remove it
# after upgrading GNOME: it declares shell-version 48 only, and once it stops
# loading the system copy stays shadowed and the theme is gone.
# Takes effect after the next login.

set -eu

UUID=user-theme@gnome-shell-extensions.gcampax.github.com
SYS=/usr/share/gnome-shell/extensions/$UUID
DST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
PATCH=$(cd "$(dirname "$0")" && pwd)/disconnect.patch

if ! grep -q '"48"' "$SYS/metadata.json"; then
    echo "system User Themes is not the GNOME 48 version, not installing" >&2
    exit 1
fi
if ! grep -q 'disconnectObject();' "$SYS/extension.js"; then
    echo "system User Themes is already fixed, nothing to do" >&2
    exit 0
fi

rm -rf "$DST"
cp -r "$SYS" "$DST"
patch -s -d "$DST" -p1 < "$PATCH"
echo "installed: $DST (log out and back in to load it)"
