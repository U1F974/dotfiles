# dotfiles

[Русская версия](README.ru.md)

GNOME 48 desktop setup: the MyShell shell theme, GTK 3/4 style overrides and
GNOME Shell extensions with their settings. Dark color scheme.

## Install

```sh
git clone <url> ~/dotfiles
~/dotfiles/install.sh        # everything
~/dotfiles/install.sh -s -g  # shell theme and GTK only
~/dotfiles/install.sh -h     # all options
```

Options: `-s` shell theme, `-g` GTK styles, `-e` extensions (none of them
means all three), `-d DIR` shell theme directory, `-f` also install the
[User Themes fix](#user-themes-fix-gnome-48-only), `-u` uninstall.

`home/` mirrors the home directory, and its files are symlinked into place:

- Shell theme: `~/.local/share/themes/MyShell`, enabled through the User
  Themes extension.
- GTK styles: `~/.config/gtk-3.0` and `~/.config/gtk-4.0`.
- A file already in place is backed up with a timestamp (`*.bak`); a copy
  identical to the repo is replaced without a backup.
- Extensions are downloaded, enabled and get their settings (see below).

Edits in the repo apply right away; run `install.sh` again only after adding
files. Restart GTK apps to see changes; log out and back in for newly
installed extensions. Do not move or delete the repo: the links point into it.

To reload the shell theme by hand (Alt+F2 `r` does not work on Wayland):

```sh
gsettings set org.gnome.shell.extensions.user-theme name '' &&
gsettings set org.gnome.shell.extensions.user-theme name 'MyShell'
```

## Layout

```
home/                                     mirrors ~, symlinked by install.sh
  .local/share/themes/MyShell/gnome-shell/  shell theme
  .config/gtk-4.0/gtk.css                   hand-written GTK 4 overrides
  .config/gtk-4.0/radius.css                generated, imported by gtk.css
  .config/gtk-3.0/gtk.css, radius.css       same for GTK 3
tools/gen-radius.py                       generator for radius.css
gnome-extensions/                         extension list, settings (dconf),
                                          install/dump scripts
extras/user-theme-fix/                    fix for a leak in User Themes (GNOME 48)
```

## MyShell theme and GTK

A compact, square-ish look modeled on the
[Fluent GTK theme](https://github.com/vinceliuice/Fluent-gtk-theme) (standard
corner radii, compact headerbars). It does not replace the GTK theme: the
shell theme imports the stock `gnome-shell-dark.css` and overrides it; the GTK
part is user CSS on top of Adwaita/libadwaita. Every changed value in the CSS
has the stock value in a comment.

GNOME Shell (`home/.local/share/themes/MyShell/gnome-shell/gnome-shell.css`):
- Corner radius 3px almost everywhere: panel buttons, quick settings, menus,
  calendar, notifications, OSD, Alt+Tab. Larger elements follow Fluent:
  dialogs 6px, overview tiles 9px, dash 15px.
- Quick settings about a quarter tighter: grid spacing, toggle height, paddings.
- Calendar days are rounded squares, cells slightly smaller.
- Toggle switches about a quarter smaller.

GTK 4 / libadwaita (`home/.config/gtk-4.0/`) and GTK 3 (`home/.config/gtk-3.0/`):
- Headerbars 36px instead of 47px, buttons and entries 28px.
- Window buttons are 28px rounded squares; hover is gray, close turns red.
- Corner radius 3px for windows, menus, buttons, entries, lists, cards.
  Switches, sliders, avatars and other round shapes stay round.

### radius.css

GTK user CSS has higher priority than the theme. A plain
`button { border-radius: 3px }` would also override the theme rules that
square off inner corners of linked buttons or keep circular buttons round.
`tools/gen-radius.py` instead copies every radius rule from the built-in
libadwaita and GTK 3 Adwaita CSS, keeps selectors and their order, and only
rewrites the values. Regenerate after libadwaita or GTK updates:

```sh
tools/gen-radius.py
```

### App-specific notes

- Nautilus: path bar and search share a stack whose tallest page sets the
  headerbar height; both are fitted into 28px. Its own radii are set to 3px.
- Headerbar + tab bar in one `AdwToolbarView` (Nautilus and others) get a
  `.collapse-spacing` wrapper with 3px padding even when the tab bar is
  hidden; the padding is removed.
- Ptyxis adds 3px above the headerbar when tabs are shown; removed.
- Two-line titles (Text Editor, Ptyxis) use `line-height: 0.8` to fit 28px.
- Chromium in GTK theme mode draws its window buttons from GTK 4 styles.
  Its buttons have no `.image-button` class and its headerbar node has
  `.header-bar`, which real GTK 4 headerbars lack; the rules account for
  both. Button size there is Chromium's own (40px in a 46px tab strip).
- Electron apps with the native titlebar (Vesktop) draw their window buttons
  from GTK 3 styles; `--gtk-version=4` does not switch them. Adwaita paints
  GTK 3 button hover with a gradient `background-image` that hides
  `background-color`, so the title button rules remove it. Their titlebar
  is `headerbar.default-decoration` (37px, 28px buttons); the gap between
  buttons is Chromium's constant 6px plus margins, so a `windowcontrols`
  rule (a node only Chromium has in GTK 3) pulls buttons 3px closer.
- Firefox, VS Code, Telegram draw their own titlebars and are not affected.

## GNOME Shell extensions

| Extension | What for | Changed settings |
|---|---|---|
| [Accent Icons](https://extensions.gnome.org/extension/7535/accent-directories/) | folder icons follow the accent color | defaults |
| [Add to Desktop](https://extensions.gnome.org/extension/3240/add-to-desktop/) | "add to desktop" in the app grid menu | defaults |
| [AppGrid Fit](https://extensions.gnome.org/extension/9933/app-grid-icon-size/) | app grid size | 12 columns x 6 rows, presets off, pages not merged |
| [Caffeine](https://extensions.gnome.org/extension/517/caffeine/) | keep the screen awake | command line toggle on |
| [Clipboard Indicator](https://extensions.gnome.org/extension/779/clipboard-indicator/) | clipboard history | 20 items |
| [Dash in Panel](https://extensions.gnome.org/extension/7855/dash-in-panel/) | app icons in the top panel | Activities button shown; app grid button, dash in overview and overview at start-up off |
| [Gtk4 Desktop Icons NG (DING)](https://extensions.gnome.org/extension/5263/gtk4-desktop-icons-ng-ding/) | desktop icons | defaults |
| [Just Perfection](https://extensions.gnome.org/extension/3843/just-perfection/) | shell tweaks | defaults |
| [Media Controls](https://extensions.gnome.org/extension/4470/media-controls/) | player in the panel | on the right, fixed label width 200px, no previous/next/seek buttons, no track slider |
| [Top Bar Organizer](https://extensions.gnome.org/extension/4356/top-bar-organizer/) | order of panel items | see `settings/top-bar-organizer.ini` |
| [Gradia Capture](https://github.com/AlexanderVanhee/gradia-companion) | screenshots with Gradia | annotation tool colors; installed by the Gradia app, not on extensions.gnome.org |
| [Auto Move Windows](https://gitlab.gnome.org/GNOME/gnome-shell-extensions) | apps to fixed workspaces | defaults |
| [Removable Drive Menu](https://gitlab.gnome.org/GNOME/gnome-shell-extensions) | mounted drives in the panel | defaults |
| [Places Status Indicator](https://gitlab.gnome.org/GNOME/gnome-shell-extensions) | Places menu in the panel | defaults |
| [User Themes](https://gitlab.gnome.org/GNOME/gnome-shell-extensions) | loads the MyShell theme | theme name `MyShell` |

The last four come with the distro package `gnome-shell-extensions`.

- `gnome-extensions/extensions.tsv`: uuid, source (`ego`, `package`, `app`)
  and dconf path of each extension.
- `gnome-extensions/settings/*.ini`: `dconf dump` of changed settings.
- `gnome-extensions/install.sh`: downloads missing `ego` extensions for the
  running GNOME version, loads the settings and adds all listed extensions to
  `enabled-extensions`.
- `gnome-extensions/dump.sh`: exports the current settings back into the
  repo; run it after changing extension settings.

## User Themes fix (GNOME 48 only)

`disable()` in User Themes 48 calls `disconnectObject()` without the tracked
object, so its settings handler is never removed. The shell disables
extensions on screen lock, so every unlock adds a handler and one theme change
reloads the theme N times. `extras/user-theme-fix/install.sh` puts a patched
copy into `~/.local/share/gnome-shell/extensions`; it loads after the next
login.

Remove that copy after upgrading GNOME: it declares shell version 48 only,
and once it stops loading it still shadows the system extension.

## Uninstall

```sh
~/dotfiles/install.sh -u
```

Resets User Themes to the default theme, removes the links to the repo
(shell theme, `gtk.css`/`radius.css` in `~/.config/gtk-*`) and puts back the
newest `*.bak` of each. Files that are not links to the repo are left alone.
Extensions are not removed: `gnome-extensions uninstall <uuid>`.
