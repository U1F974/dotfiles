#!/bin/sh
# Install the dots: MyShell GNOME Shell theme, GTK 3/4 overrides and GNOME
# Shell extensions with their settings.
#
# home/ mirrors the home directory. Its files are symlinked into place:
# home/.local/share/themes/MyShell goes to ~/.local/share/themes/MyShell
# (enabled through the User Themes extension), home/.config/gtk-* to
# ~/.config/gtk-*: libadwaita apps ignore GTK themes and only read user CSS
# from there. firefox/ mirrors the Firefox profile (found through
# profiles.ini). A file already in place is backed up with a timestamp.
# Edits in the repo apply right away; run this again after adding files.
#
# Run with -h for the options.

set -eu

SRC=$(cd "$(dirname "$0")" && pwd)
HOME_SRC="$SRC/home"
DEST_DEFAULT="${XDG_DATA_HOME:-$HOME/.local/share}/themes"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
STAMP=$(date +%Y%m%d-%H%M%S)
USER_THEME=user-theme@gnome-shell-extensions.gcampax.github.com

usage() {
    cat <<EOF
Usage: $0 [OPTION]...

Without -s, -g, -e or -F all four parts are installed.

OPTIONS:
  -s, --shell           Shell theme MyShell, enabled through User Themes
  -g, --gtk             GTK 3/4 styles in $CONFIG/gtk-{3.0,4.0}
  -e, --extensions      GNOME Shell extensions and their settings
  -F, --firefox         Firefox window buttons (userChrome.css) in the
                        default profile
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

# Print the directory of the Firefox profile in use: the default of the
# installed Firefox ([Install*] Default=), else the profile with Default=1.
# Firefox 147+ keeps new profiles in ~/.config/mozilla, older in ~/.mozilla.
firefox_profile() {
    for dir in "$CONFIG/mozilla/firefox" "$HOME/.mozilla/firefox"; do
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

if [ $DO_FF = 1 ]; then
    FF_PROFILE=$(firefox_profile)
    if [ -z "$FF_PROFILE" ] || [ ! -d "$FF_PROFILE" ]; then
        echo "Firefox profile not found (start Firefox once), skipping Firefox" >&2
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
        [ -d "$THEME_DIR" ] && find "$THEME_DIR" -depth -type d -empty -delete
    fi

    if [ $DO_GTK = 1 ]; then
        for ver in 3.0 4.0; do
            unlink_tree "$HOME_SRC/.config/gtk-$ver" "$CONFIG/gtk-$ver"
        done
    fi

    if [ $DO_FF = 1 ]; then
        unlink_tree "$SRC/firefox" "$FF_PROFILE"
        [ -d "$FF_PROFILE/chrome" ] && find "$FF_PROFILE/chrome" -depth -type d -empty -delete
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
fi

# Firefox reads both files at startup
if [ $DO_FF = 1 ]; then
    link_tree "$SRC/firefox" "$FF_PROFILE"
    echo "firefox: $FF_PROFILE (restart Firefox to apply)"
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
