#!/bin/sh
# Install and enable the GNOME Shell extensions listed in extensions.tsv and
# load their settings from settings/*.ini.
#
# - ego: downloaded from extensions.gnome.org for the running shell version
#   and installed with `gnome-extensions install`, unless already installed.
# - package: come with the distro package gnome-shell-extensions.
# - app: installed by their application (Gradia), only enabled here.
#
# Newly installed extensions load after the next login (Wayland cannot
# restart the shell); they are added to enabled-extensions right away.

set -eu

DIR=$(cd "$(dirname "$0")" && pwd)
EGO=https://extensions.gnome.org
SHELL_VERSION=$(gnome-shell --version | sed 's/[^0-9]*\([0-9]*\).*/\1/')
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

installed() {
    [ -d "$HOME/.local/share/gnome-shell/extensions/$1" ] ||
    [ -d "/usr/share/gnome-shell/extensions/$1" ]
}

grep -v '^#' "$DIR/extensions.tsv" | while IFS='	' read -r uuid source path; do
    if installed "$uuid"; then
        echo "ok        $uuid"
    elif [ "$source" = ego ]; then
        url=$(curl -fsS "$EGO/extension-info/?uuid=$uuid&shell_version=$SHELL_VERSION" |
              sed -n 's/.*"download_url": *"\([^"]*\)".*/\1/p')
        if [ -z "$url" ]; then
            echo "no build  $uuid (not available for GNOME $SHELL_VERSION)" >&2
            continue
        fi
        curl -fsSL -o "$TMP/$uuid.zip" "$EGO$url"
        gnome-extensions install --force "$TMP/$uuid.zip"
        echo "installed $uuid"
    elif [ "$source" = package ]; then
        echo "missing   $uuid (install the gnome-shell-extensions package)" >&2
    else
        echo "missing   $uuid (installed by its application)" >&2
    fi

    if [ "$path" != - ] && [ -f "$DIR/settings/$path.ini" ]; then
        dconf load "/org/gnome/shell/extensions/$path/" < "$DIR/settings/$path.ini"
    fi
done

# gsettings prints a GVariant string list: ['a', 'b'], or @as [] when empty.
# uuids have no quotes, commas or spaces, so strip those and split on commas.
get_list() {
    gsettings get org.gnome.shell "$1" |
        sed "s/^@as //; s/[][' ]//g" | tr ',' '\n' | sed '/^$/d'
}

# Read uuids from stdin, one per line, and write them back as ['a', 'b'].
put_list() {
    gsettings set org.gnome.shell "$1" \
        "[$(sed "s/.*/'&'/" | paste -sd , - | sed 's/,/, /g')]"
}

# Add every listed uuid to enabled-extensions (keeping ones enabled already,
# awk drops duplicates and keeps the order) and take them out of
# disabled-extensions. `gnome-extensions enable` cannot do this: it only knows
# extensions the running shell has loaded, and new ones load after the next
# login.
uuids=$(grep -v '^#' "$DIR/extensions.tsv" | cut -f1)
{ get_list enabled-extensions; printf '%s\n' "$uuids"; } |
    awk '!seen[$0]++' | put_list enabled-extensions
get_list disabled-extensions | grep -vxF "$uuids" | put_list disabled-extensions
echo "enabled-extensions updated; log out and back in to load new extensions"
