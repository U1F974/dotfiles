#!/bin/sh
# Install the dots: MyShell GNOME Shell theme, GTK 3/4 overrides and GNOME
# Shell extensions with their settings.
#
# Shell theme goes to ~/.local/share/themes/MyShell and is enabled through
# the User Themes extension. GTK styles go to ~/.config/gtk-3.0 and
# ~/.config/gtk-4.0: libadwaita apps ignore GTK themes and only read user CSS
# from there. Existing gtk.css/radius.css are backed up with a timestamp.
# Files are copied, so run this again after editing the repo.
#
# Usage: ./install.sh                 # everything
#        ./install.sh --no-extensions # theme and GTK only

set -eu

SRC=$(cd "$(dirname "$0")" && pwd)
THEME_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/themes/MyShell"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
STAMP=$(date +%Y%m%d-%H%M%S)
USER_THEME=user-theme@gnome-shell-extensions.gcampax.github.com

mkdir -p "$THEME_DIR/gnome-shell"
cp "$SRC/themes/MyShell/gnome-shell/gnome-shell.css" "$THEME_DIR/gnome-shell/"
echo "shell theme: $THEME_DIR"

for ver in 3.0 4.0; do
    dst="$CONFIG/gtk-$ver"
    mkdir -p "$dst"
    for f in gtk.css radius.css; do
        if [ -f "$dst/$f" ] && ! cmp -s "$SRC/gtk-$ver/$f" "$dst/$f"; then
            mv "$dst/$f" "$dst/$f.$STAMP.bak"
            echo "backup: $dst/$f.$STAMP.bak"
        fi
        cp "$SRC/gtk-$ver/$f" "$dst/"
    done
    echo "gtk $ver: $dst"
done

if [ "${1:-}" != --no-extensions ]; then
    "$SRC/gnome-extensions/install.sh"
fi

# Enable the shell theme. Needs the User Themes extension
# (package gnome-shell-extensions).
if command -v gnome-extensions >/dev/null 2>&1 &&
   gnome-extensions info "$USER_THEME" >/dev/null 2>&1; then
    gnome-extensions enable "$USER_THEME"
    # Reset first: setting the same name again does not reload the theme
    gsettings set org.gnome.shell.extensions.user-theme name ''
    gsettings set org.gnome.shell.extensions.user-theme name 'MyShell'
    echo "shell theme enabled"
else
    echo "User Themes extension not found: install gnome-shell-extensions," >&2
    echo "then run: gsettings set org.gnome.shell.extensions.user-theme name 'MyShell'" >&2
fi

echo "done. Restart GTK apps to apply their styles."
