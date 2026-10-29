#!/bin/sh
# Install the dots: MyShell GNOME Shell theme, GTK 3/4 overrides and GNOME
# Shell extensions with their settings.
#
# home/ mirrors the home directory. Its files are symlinked into place:
# home/.local/share/themes/MyShell goes to ~/.local/share/themes/MyShell
# (enabled through the User Themes extension), home/.config/gtk-* to
# ~/.config/gtk-*: libadwaita apps ignore GTK themes and only read user CSS
# from there. home/.local/share/themes/Adwaita-dark (GTK 3 Adwaita dark with
# the accent color) goes to ~/.local/share/themes/Adwaita-dark, where GTK 3
# finds it before the stock one, the icon theme Adwaita-Void (icons of Accent
# Icons in the accent color) to ~/.local/share/icons. firefox/ mirrors a Firefox profile and goes to the profiles of
# Firefox and LibreWolf (found through profiles.ini). A file already in place is backed up with a timestamp.
# Edits in the repo apply right away; run this again after adding files.
#
# Run with -h for the options.

set -eu

SRC=$(cd "$(dirname "$0")" && pwd)
HOME_SRC="$SRC/home"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
DEST_DEFAULT="$DATA/themes"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
STAMP=$(date +%Y%m%d-%H%M%S)
USER_THEME=user-theme@gnome-shell-extensions.gcampax.github.com

usage() {
    cat <<EOF
Usage: $0 [OPTION]...

Without -s, -g, -e or -F all four parts are installed.

OPTIONS:
  -s, --shell           Shell theme MyShell, enabled through User Themes
  -g, --gtk             GTK 3/4 styles in $CONFIG/gtk-{3.0,4.0},
                        GTK 3 theme Adwaita-dark with the accent color
                        in $DATA/themes, icon theme Adwaita-Void
                        in $DATA/icons
  -e, --extensions      GNOME Shell extensions and their settings
  -F, --firefox         Firefox and LibreWolf window buttons (userChrome.css)
                        and accent color (user.js) in their default profiles
  -d, --dest DIR        Directory for the shell theme
                        (default: $DEST_DEFAULT);
                        User Themes also reads ~/.themes and /usr/share/themes
  -f, --user-theme-fix  Also install the patched User Themes (GNOME 48 only)
  -u, --uninstall       Remove the links to the repo, restore the newest
                        backups (extensions are not removed)
  -h, --help            Show this help
EOF
}

# Symlink every file under $1 to the same relative path under $2.
link_tree() {
    find "$1" -type f | while IFS= read -r src; do
        dst="$2${src#"$1"}"
        if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
            continue
        fi
        mkdir -p "$(dirname "$dst")"
        if [ -L "$dst" ] || [ -e "$dst" ]; then
            # A copy left by an older install.sh needs no backup
            if [ ! -L "$dst" ] && [ -f "$dst" ] && cmp -s "$src" "$dst"; then
                rm "$dst"
            else
                mv "$dst" "$dst.$STAMP.bak"
                echo "backup: $dst.$STAMP.bak"
            fi
        fi
        ln -s "$src" "$dst"
        echo "link: $dst"
    done
}

# Remove the links made by link_tree and put back the newest backups.
unlink_tree() {
    find "$1" -type f | while IFS= read -r src; do
        dst="$2${src#"$1"}"
        if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
            rm "$dst"
            # Timestamps sort by name, the last one is the newest
            bak=$(ls -1 "$dst".*.bak 2>/dev/null | tail -n 1)
            if [ -n "$bak" ]; then
                mv "$bak" "$dst"
                echo "restored: $dst from $bak"
            else
                echo "removed: $dst"
            fi
        elif [ -L "$dst" ] || [ -e "$dst" ]; then
            echo "skipped: $dst is not a link to the repo" >&2
        fi
    done
}

# Print the directory of the profile in use of a Firefox-based browser whose
# profiles.ini is in one of the given directories (the first one found): the
# default of the installed browser ([Install*] Default=), else the profile
# with Default=1.
browser_profile() {
    for dir in "$@"; do
        [ -f "$dir/profiles.ini" ] || continue
        path=$(awk -F= '
            /^\[/ { sec = $0; next }
            sec ~ /^\[Install/ && $1 == "Default" { inst = $2 }
            sec ~ /^\[Profile/ && $1 == "Path" { path[sec] = $2 }
            sec ~ /^\[Profile/ && $1 == "Default" && $2 == "1" { def = sec }
            END { if (inst != "") print inst; else if (def != "") print path[def] }
        ' "$dir/profiles.ini")
        [ -n "$path" ] || continue
        case $path in
            /*) echo "$path" ;;
            *) echo "$dir/$path" ;;
        esac
        return
    done
}

# Profiles of Firefox and LibreWolf, one per line. Both moved to XDG
# directories (Firefox 147+: ~/.config/mozilla), older ones use ~/.mozilla
# and ~/.librewolf.
firefox_profiles() {
    for p in "$(browser_profile "$CONFIG/mozilla/firefox" "$HOME/.mozilla/firefox")" \
             "$(browser_profile "$CONFIG/librewolf/librewolf" "$HOME/.librewolf")"; do
        if [ -n "$p" ] && [ -d "$p" ]; then
            echo "$p"
        fi
    done
}

DEST=$DEST_DEFAULT
DO_SHELL=0
DO_GTK=0
DO_EXT=0
DO_FF=0
DO_FIX=0
UNINSTALL=0

while [ $# -gt 0 ]; do
    case $1 in
        -s|--shell) DO_SHELL=1 ;;
        -g|--gtk) DO_GTK=1 ;;
        -e|--extensions) DO_EXT=1 ;;
        -F|--firefox) DO_FF=1 ;;
        -d|--dest)
            if [ $# -lt 2 ]; then
                echo "$1 needs a directory" >&2
                exit 1
            fi
            DEST=$2
            shift
            ;;
        -f|--user-theme-fix) DO_FIX=1 ;;
        -u|--uninstall) UNINSTALL=1 ;;
        -h|--help) usage; exit 0 ;;
        *)
            echo "unknown option: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
    shift
done

if [ $DO_SHELL = 0 ] && [ $DO_GTK = 0 ] && [ $DO_EXT = 0 ] && [ $DO_FF = 0 ]; then
    DO_SHELL=1
    DO_GTK=1
    DO_EXT=1
    DO_FF=1
fi
THEME_SRC="$HOME_SRC/.local/share/themes/MyShell"
THEME_DIR="$DEST/MyShell"
GTK3_THEME_SRC="$HOME_SRC/.local/share/themes/Adwaita-dark"
GTK3_THEME_DIR="$DATA/themes/Adwaita-dark"
ICONS_SRC="$HOME_SRC/.local/share/icons/Adwaita-Void"
ICONS_DIR="$DATA/icons/Adwaita-Void"

if [ $DO_FF = 1 ]; then
    FF_PROFILES=$(firefox_profiles)
    if [ -z "$FF_PROFILES" ]; then
        echo "no Firefox or LibreWolf profile found (start the browser once), skipping" >&2
        DO_FF=0
    fi
fi

if [ $UNINSTALL = 1 ]; then
    if [ $DO_SHELL = 1 ]; then
        if [ "$(gsettings get org.gnome.shell.extensions.user-theme name 2>/dev/null)" = "'MyShell'" ]; then
            gsettings reset org.gnome.shell.extensions.user-theme name
            echo "shell theme reset to default"
        fi
        unlink_tree "$THEME_SRC" "$THEME_DIR"
        if [ -d "$THEME_DIR" ]; then
            find "$THEME_DIR" -depth -type d -empty -delete
        fi
    fi

    if [ $DO_GTK = 1 ]; then
        for ver in 3.0 4.0; do
            unlink_tree "$HOME_SRC/.config/gtk-$ver" "$CONFIG/gtk-$ver"
        done
        unlink_tree "$GTK3_THEME_SRC" "$GTK3_THEME_DIR"
        unlink_tree "$ICONS_SRC" "$ICONS_DIR"
        for dir in "$GTK3_THEME_DIR" "$ICONS_DIR"; do
            if [ -d "$dir" ]; then
                find "$dir" -depth -type d -empty -delete
            fi
        done
    fi

    if [ $DO_FF = 1 ]; then
        printf '%s\n' "$FF_PROFILES" | while IFS= read -r p; do
            unlink_tree "$SRC/firefox" "$p"
            if [ -d "$p/chrome" ]; then
                find "$p/chrome" -depth -type d -empty -delete
            fi
        done
    fi

    if [ $DO_EXT = 1 ]; then
        echo "extensions are not removed: gnome-extensions uninstall <uuid>" >&2
    fi
    if [ $DO_FIX = 1 ]; then
        echo "User Themes fix is not removed: rm -r ~/.local/share/gnome-shell/extensions/$USER_THEME" >&2
    fi
    echo "done. Restart GTK apps to apply their styles."
    exit 0
fi

if [ $DO_SHELL = 1 ]; then
    link_tree "$THEME_SRC" "$THEME_DIR"
fi

if [ $DO_GTK = 1 ]; then
    for ver in 3.0 4.0; do
        link_tree "$HOME_SRC/.config/gtk-$ver" "$CONFIG/gtk-$ver"
    done
    link_tree "$GTK3_THEME_SRC" "$GTK3_THEME_DIR"
    link_tree "$ICONS_SRC" "$ICONS_DIR"
fi

# The browser reads both files at startup
if [ $DO_FF = 1 ]; then
    printf '%s\n' "$FF_PROFILES" | while IFS= read -r p; do
        link_tree "$SRC/firefox" "$p"
        echo "browser profile: $p (restart the browser to apply)"
    done
fi

if [ $DO_EXT = 1 ]; then
    "$SRC/gnome-extensions/install.sh"
fi

# Enable the shell theme. Needs the User Themes extension
# (package gnome-shell-extensions).
if [ $DO_SHELL = 1 ]; then
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
fi

# Last: it exits with an error on other GNOME versions
if [ $DO_FIX = 1 ]; then
    "$SRC/extras/user-theme-fix/install.sh"
fi

echo "done. Restart GTK apps to apply their styles."
