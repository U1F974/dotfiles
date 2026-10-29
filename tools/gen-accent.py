#!/usr/bin/env python3
"""Set the accent color and generate CSS and icons that use it instead of the
Settings choice.

The accent color (ACCENT below) is the --accent-bg-color in
home/.config/gtk-4.0/gtk.css: GTK 4 apps read it from there. The script also
writes it to the ui.* prefs in firefox/user.js (Firefox and LibreWolf) and
uses it for the generated files.

GNOME Shell takes the accent from the Settings choice (blue, teal, green, ...)
and passes it to the theme and to extension stylesheets as -st-accent-color;
a theme cannot redefine that value, and St has no API to set it. Instead,
this script copies every declaration that uses -st-accent-color, keeps the
selectors and their order, and puts ACCENT in its place:
- from the built-in dark shell theme into accent.css, which MyShell imports
  after the built-in theme;
- from the stylesheets of the extensions listed in
  gnome-extensions/extensions.tsv into the stylesheet of accent@dots. Extension
  stylesheets win over the theme whatever the selector or !important, so only
  another extension stylesheet can override them; between those, !important
  wins.

GTK 3 Adwaita does not follow the accent at all: its dark variant has a fixed
blue (#15539e) and shades of it computed in advance. The script writes a full
copy of that CSS with every shade of the blue moved to the same shade of
ACCENT, as a user theme named Adwaita-dark. GTK 3 looks for themes in
~/.local/share/themes before /usr/share/themes, so the copy replaces the
stock Adwaita-dark (which only imports the built-in CSS) and the gtk-theme
setting stays as it is. A full copy and not only the changed rules: GTK user
CSS beats the theme whatever the selector, so a partial copy in gtk.css would
also beat theme rules for other states (a disabled suggested button would
stay green).

Folder and some app icons follow the accent through the Accent Icons
extension, which only has icon themes for the nine Settings colors. The
script copies its theme for green (Adwaita-Green, made from #3a944a) with
every shade of that green moved to the same shade of ACCENT, as the icon
theme Adwaita-Void. Accent Icons is set to use it for every accent
(gnome-extensions/settings/accent-directories.ini). Icons of apps it does
not cover (APP_ICONS) are recolored from the app's own PNG.

Text on the accent stays white everywhere (the shell, GTK, Firefox), so a
light accent gets a warning about its contrast.

Usage: tools/gen-accent.py '#rrggbb'   # set a new accent and generate
       tools/gen-accent.py             # generate with the current accent, after
                                        # GNOME Shell, extension or GTK 3 updates

Writes in the repo (installed as symlinks):
  home/.config/gtk-4.0/gtk.css, firefox/user.js (the accent value only)
  home/.local/share/themes/MyShell/gnome-shell/accent.css
  gnome-extensions/local/accent@dots/stylesheet.css
  home/.local/share/themes/Adwaita-dark/gtk-3.0/gtk.css
  home/.local/share/icons/Adwaita-Void/
"""

import colorsys
import re
import shutil
import subprocess
import sys
from pathlib import Path

import gi
gi.require_version('GdkPixbuf', '2.0')
from gi.repository import GdkPixbuf, GLib

ACCENT = None                      # read from GTK4_CSS or the command line
REPO = Path(__file__).resolve().parent.parent
THEMES = REPO / 'home' / '.local' / 'share' / 'themes'

# Where the accent value lives, and how many times
GTK4_CSS = REPO / 'home' / '.config' / 'gtk-4.0' / 'gtk.css'
GTK4_ACCENT = re.compile(r'(--accent-bg-color: )(#[0-9a-fA-F]{6})')
FIREFOX_USER_JS = REPO / 'firefox' / 'user.js'
FIREFOX_ACCENT = re.compile(r'(user_pref\("ui\.(?:accentcolor|highlight|selecteditem)", ")'
                            r'(#[0-9a-fA-F]{6})')

SHELL_SOURCE = ('/usr/share/gnome-shell/gnome-shell-theme.gresource',
                '/org/gnome/shell/theme/gnome-shell-dark.css')
SHELL_TARGET = THEMES / 'MyShell' / 'gnome-shell' / 'accent.css'
EXTENSIONS_TSV = REPO / 'gnome-extensions' / 'extensions.tsv'
EXTENSIONS_UUID = 'accent@dots'
EXTENSIONS_TARGET = REPO / 'gnome-extensions' / 'local' / EXTENSIONS_UUID / 'stylesheet.css'
EXTENSION_DIRS = (REPO / 'gnome-extensions' / 'local',
                  Path.home() / '.local' / 'share' / 'gnome-shell' / 'extensions',
                  Path('/usr/share/gnome-shell/extensions'))

GTK3_SOURCE = ('/usr/lib/libgtk-3.so.0', '/org/gtk/libgtk/theme/Adwaita/gtk-contained-dark.css')
GTK3_TARGET = THEMES / 'Adwaita-dark' / 'gtk-3.0' / 'gtk.css'
GTK3_BLUE = '#15539e'              # selected_bg_color of GTK 3 Adwaita dark

ICONS_UUID = 'accent-directories@taiwbi.com'    # Accent Icons
ICONS_SOURCE = 'Adwaita-Green'     # its icon theme for the green accent
ICONS_GREEN = '#3a944a'            # the green accent, base of that theme
ICONS_TARGET = REPO / 'home' / '.local' / 'share' / 'icons' / 'Adwaita-Void'

# Icons Accent Icons does not have: name, source PNG ({size} for one file per
# size, else one big file scaled down) and its main color. They consist of
# the main color, white and blends of the two (edges, lighter shades).
APP_ICONS = (
    ('librewolf', '/usr/share/icons/hicolor/{size}x{size}/apps/librewolf.png', '#00acff'),
    ('code-oss', '/usr/lib/code-oss/resources/app/resources/linux/code.png', '#167abf'),
)
APP_ICON_SIZES = (16, 32, 48, 64, 128, 256)
ICON_CONTEXTS = {'apps': 'Applications', 'mimetypes': 'MimeTypes',
                 'places': 'Places', 'status': 'Status'}

# The shell and extension CSS is flat: no @media or other blocks with nested
# rules.
RULE = re.compile(r'([^{}]+)\{([^{}]*)\}')

COLOR = re.compile(r'#([0-9a-fA-F]{6})\b|rgba\((\d+), (\d+), (\d+), ([\d.]+)\)')


def extract(resource, path):
    return subprocess.run(['gresource', 'extract', resource, path],
                          check=True, capture_output=True, text=True).stdout


def accent_rules(css, important=False):
    """Yield the rules of css that use -st-accent-color, with ACCENT instead."""
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    for selector, body in RULE.findall(css):
        # Only declarations with the accent itself: -st-accent-fg-color
        # (text on the accent) stays the system one, white for every accent.
        decls = [' '.join(d.split()) for d in body.split(';') if '-st-accent-color' in d]
        if not decls:
            continue
        lines = []
        for d in decls:
            d = d.replace('-st-accent-color', ACCENT)
            if important and not d.endswith('!important'):
                d += ' !important'
            lines.append(f'  {d};')
        selectors = ',\n'.join(' '.join(s.split()) for s in selector.split(','))
        yield selectors + ' {\n' + '\n'.join(lines) + '\n}'


def extension_stylesheets():
    """Yield (uuid, path) of the stylesheet the shell loads for each listed
    extension: stylesheet-dark.css if there is one, else stylesheet.css."""
    for line in EXTENSIONS_TSV.read_text().splitlines():
        if not line or line.startswith('#'):
            continue
        uuid = line.split('\t')[0]
        if uuid == EXTENSIONS_UUID:
            continue
        found = [d / uuid for d in EXTENSION_DIRS if (d / uuid).is_dir()]
        if not found:
            print('not installed, skipped:', uuid, file=sys.stderr)
            continue
        for name in ('stylesheet-dark.css', 'stylesheet.css'):
            if (found[0] / name).is_file():
                yield uuid, found[0] / name
                break


def generate_shell():
    out = ['/* Generated by gen-accent.py from built-in GNOME Shell theme CSS.',
           '   Do not edit by hand: change the script and run it again. */', '']
    out += accent_rules(extract(*SHELL_SOURCE))
    return '\n'.join(out) + '\n'


def generate_extensions():
    out = ['/* Generated by gen-accent.py from extension stylesheets.',
           '   Do not edit by hand: change the script and run it again. */']
    for uuid, path in extension_stylesheets():
        rules = list(accent_rules(path.read_text(), important=True))
        if rules:
            out += ['', f'/* {uuid} */'] + rules
    return '\n'.join(out) + '\n'


def hls(hex_color):
    return colorsys.rgb_to_hls(*(b / 255 for b in bytes.fromhex(hex_color[1:])))


def recolor(text, base):
    """Move every shade of base in text to the same shade of ACCENT.

    Sass darken()/lighten() (and the shades in the icon themes) change the
    HSL lightness and keep hue and saturation, so a shade keeps its lightness
    offset from base. Mixes with gray have lower saturation; it is scaled in
    proportion.
    """
    bh, bl, bs = hls(base)
    ah, al, as_ = hls(ACCENT)

    def move(rgb):
        h, l, s = colorsys.rgb_to_hls(*(v / 255 for v in rgb))
        if s <= 0.15 or abs(h - bh) > 0.03:
            return None                    # not a shade of base
        h = (h - bh + ah) % 1
        l = min(1, max(0, l - bl + al))
        s = min(1, s * as_ / bs)
        return [round(v * 255) for v in colorsys.hls_to_rgb(h, l, s)]

    def replace(m):
        if m.group(1):
            new = move(bytes.fromhex(m.group(1)))
            return '#%02x%02x%02x' % tuple(new) if new else m.group(0)
        new = move([int(m.group(i)) for i in (2, 3, 4)])
        return f'rgba({new[0]}, {new[1]}, {new[2]}, {m.group(5)})' if new else m.group(0)

    return COLOR.sub(replace, text)


def generate_gtk3(css):
    # Images (check marks, scale marks) are relative to the built-in CSS and
    # would be looked up next to the copy.
    assets = 'resource://' + GTK3_SOURCE[1].rsplit('/', 1)[0] + '/assets/'
    css = css.replace('url("assets/', f'url("{assets}')

    header = ['/* Generated by gen-accent.py from built-in GTK 3 Adwaita dark CSS,',
              f'   {GTK3_BLUE} and its shades moved to {ACCENT}. Do not edit by hand:',
              '   change the script and run it again. */', '']
    return '\n'.join(header) + recolor(css, GTK3_BLUE)


def generate_icons():
    sources = [d / ICONS_UUID / 'icons' / ICONS_SOURCE for d in EXTENSION_DIRS]
    src = next((d for d in sources if d.is_dir()), None)
    if src is None:
        print('not installed, icons skipped:', ICONS_UUID, file=sys.stderr)
        return
    if ICONS_TARGET.exists():
        shutil.rmtree(ICONS_TARGET)
    for f in sorted(src.rglob('*')):
        # version: marker of Accent Icons for its own copies
        if not f.is_file() or f.name == 'version':
            continue
        text = f.read_text()
        if f.suffix == '.svg':
            text = recolor(text, ICONS_GREEN)
        elif f.name == 'index.theme':
            text = text.replace(f'Name={ICONS_SOURCE}', f'Name={ICONS_TARGET.name}')
        dst = ICONS_TARGET / f.relative_to(src)
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(text)
    generate_app_icons()
    write_icon_index()
    print('wrote', ICONS_TARGET)


def recolor_pixbuf(pixbuf, base):
    """Move pixels that are base blended with white to the same blend of ACCENT."""
    b = bytes.fromhex(base[1:])
    a = bytes.fromhex(ACCENT[1:])
    c = max(range(3), key=lambda i: 255 - b[i])    # channel farthest from white
    n, stride = pixbuf.get_n_channels(), pixbuf.get_rowstride()
    px = bytearray(pixbuf.get_pixels())
    for y in range(pixbuf.get_height()):
        for o in range(y * stride, y * stride + pixbuf.get_width() * n, n):
            t = min(1, (255 - px[o + c]) / (255 - b[c]))
            if all(abs(255 - t * (255 - b[i]) - px[o + i]) <= 6 for i in range(3)):
                px[o:o + 3] = bytes(round(255 - t * (255 - a[i])) for i in range(3))
    return GdkPixbuf.Pixbuf.new_from_bytes(
        GLib.Bytes.new(bytes(px)), pixbuf.get_colorspace(), pixbuf.get_has_alpha(),
        pixbuf.get_bits_per_sample(), pixbuf.get_width(), pixbuf.get_height(), stride)


def generate_app_icons():
    for name, pattern, base in APP_ICONS:
        found = False
        for size in APP_ICON_SIZES:
            path = Path(pattern.format(size=size))
            if not path.is_file():
                continue
            if '{size}' in pattern:
                pixbuf = GdkPixbuf.Pixbuf.new_from_file(str(path))
            else:
                pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(str(path), size, size)
            dst = ICONS_TARGET / f'{size}x{size}' / 'apps' / f'{name}.png'
            dst.parent.mkdir(parents=True, exist_ok=True)
            recolor_pixbuf(pixbuf, base).savev(str(dst), 'png', [], [])
            found = True
        if not found:
            print('not installed, icon skipped:', name, file=sys.stderr)


def write_icon_index():
    """List every icon directory in index.theme (Accent Icons lists only
    scalable/places), with a section for each."""
    index = ICONS_TARGET / 'index.theme'
    text = index.read_text()
    dirs = sorted(str(d.relative_to(ICONS_TARGET)) for d in ICONS_TARGET.glob('*/*') if d.is_dir())
    text = re.sub(r'^Directories=.*$', 'Directories=' + ','.join(dirs), text, flags=re.M)
    for d in dirs:
        if f'[{d}]' in text:
            continue
        size, context = d.split('/')
        lines = [f'[{d}]', f'Context={ICON_CONTEXTS[context]}']
        if size == 'scalable':
            lines += ['Size=128', 'MinSize=8', 'MaxSize=512', 'Type=Scalable']
        else:
            lines += [f'Size={size.split("x")[0]}', 'Type=Threshold']
        text = text.rstrip('\n') + '\n\n' + '\n'.join(lines) + '\n'
    index.write_text(text)


def read_accent():
    m = GTK4_ACCENT.search(GTK4_CSS.read_text())
    if not m:
        sys.exit(f'no --accent-bg-color: #rrggbb in {GTK4_CSS}')
    return m.group(2).lower()


def write_accent():
    for path, pattern, count in ((GTK4_CSS, GTK4_ACCENT, 1), (FIREFOX_USER_JS, FIREFOX_ACCENT, 3)):
        text, n = pattern.subn(rf'\g<1>{ACCENT}', path.read_text())
        if n != count:
            sys.exit(f'{path}: expected {count} accent values, found {n}')
        path.write_text(text)
        print('wrote', path)


def contrast_with_white(color):
    """WCAG contrast ratio of white text on color."""
    def linear(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (linear(v) for v in bytes.fromhex(color[1:]))
    return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05)


def main():
    global ACCENT
    if len(sys.argv) > 2 or (len(sys.argv) == 2 and
                             not re.fullmatch(r'#[0-9a-fA-F]{6}', sys.argv[1])):
        sys.exit("usage: tools/gen-accent.py ['#rrggbb']")
    if len(sys.argv) == 2:
        ACCENT = sys.argv[1].lower()
        write_accent()
    else:
        ACCENT = read_accent()
    print('accent', ACCENT)
    SHELL_TARGET.write_text(generate_shell())
    print('wrote', SHELL_TARGET)
    EXTENSIONS_TARGET.write_text(generate_extensions())
    print('wrote', EXTENSIONS_TARGET)
    GTK3_TARGET.parent.mkdir(parents=True, exist_ok=True)
    GTK3_TARGET.write_text(generate_gtk3(extract(*GTK3_SOURCE)))
    print('wrote', GTK3_TARGET)
    generate_icons()

    # 3:1 is the WCAG minimum for large text and controls; the Settings
    # colors range from 3.0:1 (yellow) to 5.9:1 (purple)
    contrast = contrast_with_white(ACCENT)
    if contrast < 3:
        print(f'warning: white text on {ACCENT} has contrast {contrast:.1f}:1, '
              'below 3:1 (hard to read)', file=sys.stderr)


if __name__ == '__main__':
    main()
