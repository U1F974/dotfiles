#!/bin/sh
# Export settings of the extensions listed in extensions.tsv from dconf into
# settings/<path>.ini. Run after changing extension settings, then commit.

set -eu

DIR=$(cd "$(dirname "$0")" && pwd)

# Keys that hold runtime state, not settings
SKIP='^runtime-preview-layout='

grep -v '^#' "$DIR/extensions.tsv" | while IFS='	' read -r uuid source path; do
    [ "$path" = - ] && continue
    out="$DIR/settings/$path.ini"
    dconf dump "/org/gnome/shell/extensions/$path/" | grep -v "$SKIP" > "$out"
    echo "$uuid -> settings/$path.ini"
done
