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

# Add every listed uuid to enabled-extensions (keeping ones enabled already)
# and take them out of disabled-extensions.
uuids=$(grep -v '^#' "$DIR/extensions.tsv" | cut -f1)
python3 - "$uuids" <<'EOF'
import ast, subprocess, sys

def get(key):
    out = subprocess.run(['gsettings', 'get', 'org.gnome.shell', key],
                         check=True, capture_output=True, text=True).stdout
    return ast.literal_eval(out.replace('@as ', ''))

def put(key, value):
    subprocess.run(['gsettings', 'set', 'org.gnome.shell', key, str(value)], check=True)

wanted = sys.argv[1].split()
enabled = get('enabled-extensions')
put('enabled-extensions', enabled + [u for u in wanted if u not in enabled])
put('disabled-extensions', [u for u in get('disabled-extensions') if u not in wanted])
EOF
echo "enabled-extensions updated; log out and back in to load new extensions"
