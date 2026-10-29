# dotfiles

[рус](README.ru.md)

GNOME 48 desktop setup: the MyShell shell theme, GTK 3/4 style overrides and
GNOME Shell extensions with their settings. Dark color scheme.

## Screenshots

![Headerbars and window buttons in Vesktop, System Monitor, Text Editor, Files and Fractal](screenshots/windows.png)

| Quick settings | Calendar and notifications |
| --- | --- |
| ![Quick settings menu](screenshots/quick-settings.png) | ![Calendar and notifications menu](screenshots/calendar.png) |

| Places menu | Text Editor menu |
| --- | --- |
| ![Places menu in the top bar](screenshots/places-menu.png) | ![Text Editor main menu](screenshots/text-editor-menu.png) |

## Install

Run the following commands in the terminal:

```sh
git clone https://github.com/U1F974/dotfiles.git ~/dotfiles
~/dotfiles/install.sh
```

> Tip: `./install.sh` allows the following options:

```
-s, --shell           Shell theme MyShell, enabled through User Themes

-g, --gtk             GTK 3/4 styles in ~/.config/gtk-{3.0,4.0},
                      GTK 3 theme Adwaita-dark with the accent color
                      in ~/.local/share/themes, icon theme Adwaita-Void
                      in ~/.local/share/icons

-e, --extensions      GNOME Shell extensions and their settings

-F, --firefox         Firefox and LibreWolf window buttons (userChrome.css)
                      and accent color (user.js) in their default profiles

-d, --dest DIR        Directory for the shell theme
                      (Default: ~/.local/share/themes);
                      User Themes also reads ~/.themes and /usr/share/themes

-f, --user-theme-fix  Also install the patched User Themes (GNOME 48 only)

-u, --uninstall       Remove the links to the repo, restore the newest
                      backups (extensions are not removed)

-h, --help            Show help
```

Without `-s`, `-g`, `-e` or `-F` all four parts are installed. For example,
`./install.sh -s -g` installs the shell theme and GTK styles only. See
[User Themes fix](#user-themes-fix-gnome-48-only) for `-f`.

> For more information, run: `./install.sh --help`

`home/` mirrors the home directory, and its files are symlinked into place:

- Shell theme: `~/.local/share/themes/MyShell`, enabled through the User
  Themes extension.
- GTK styles: `~/.config/gtk-3.0` and `~/.config/gtk-4.0`; GTK 3 Adwaita
  dark with the accent color: `~/.local/share/themes/Adwaita-dark`; icons in
  the accent color: `~/.local/share/icons/Adwaita-Void`.
- Firefox and LibreWolf: `firefox/` mirrors a profile directory and is
  linked into the profile each browser uses (`[Install*] Default=` in
  `profiles.ini`, else the profile with `Default=1`). Profiles are looked up
  in `~/.config/mozilla/firefox` or `~/.mozilla/firefox` and in
  `~/.config/librewolf/librewolf` or `~/.librewolf`.
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
    accent.css                                generated, imported by gnome-shell.css
  .local/share/themes/Adwaita-dark/gtk-3.0/ generated GTK 3 Adwaita dark with the accent
  .local/share/icons/Adwaita-Void/          generated icon theme in the accent color
  .config/gtk-4.0/gtk.css                   hand-written GTK 4 overrides
  .config/gtk-4.0/radius.css                generated, imported by gtk.css
  .config/gtk-3.0/gtk.css, radius.css       same for GTK 3
tools/gen-radius.py                       generator for radius.css
tools/gen-accent.py                       generator for the accent color files
gnome-extensions/                         extension list, settings (dconf),
                                          install/dump scripts
  local/                                    extensions that live in this repo
extras/user-theme-fix/                    fix for a leak in User Themes (GNOME 48)
firefox/                                  mirrors a Firefox/LibreWolf profile:
  chrome/userChrome.css                     window buttons
  user.js                                   makes Firefox read userChrome.css, accent color
screenshots/                              images for this README
```

## MyShell theme and GTK

A compact, square-ish look modeled on the
[Fluent GTK theme](https://github.com/vinceliuice/Fluent-gtk-theme) (standard
corner radii, compact headerbars). It does not replace the GTK theme: the
shell theme imports the stock `gnome-shell-dark.css` and overrides it; the GTK
part is user CSS on top of Adwaita/libadwaita. Every changed value in the CSS
has the stock value in a comment.

Own accent color instead of the nine in Settings, see
[Accent color](#accent-color).

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

### Accent color

Settings offers nine accent colors only. This repo uses its own everywhere
the accent shows, now the green of the Void Linux logo (`#478061`). To change
it:

```sh
tools/gen-accent.py '#rrggbb'
./install.sh -g
gsettings set org.gnome.shell.extensions.user-theme name '' &&
gsettings set org.gnome.shell.extensions.user-theme name 'MyShell'
gnome-extensions disable accent@dots && gnome-extensions enable accent@dots
gsettings set org.gnome.desktop.interface icon-theme 'Adwaita' &&
gsettings set org.gnome.desktop.interface icon-theme 'Adwaita-Void'
```

The script writes the color to `gtk.css` and `firefox/user.js` and generates
the files listed below. `./install.sh -g` links new files; the next lines
reload the shell theme, the stylesheet for extensions and the icons. Then
restart GTK apps, Firefox and LibreWolf. In Settings pick the closest of the
nine: apps that read the accent through the settings portal still get it.
Text on the accent stays white everywhere, so the script warns when the
contrast is below 3:1, lower than any Settings color (light accents).

After GNOME Shell, extension or GTK 3 updates, run `tools/gen-accent.py`
without a color: it regenerates the files with the current one.

Where the accent goes:
- GTK 4 / libadwaita: `--accent-bg-color` in `gtk.css`, the only place the
  color is kept (the script reads it from there). libadwaita derives the
  lighter color for text and links from it.
- Shell: the theme gets the accent as `-st-accent-color` and cannot redefine
  it. The script copies every declaration that uses it from the stock
  `gnome-shell-dark.css` into `accent.css`, with our color in its place.
- Other extensions (running app dots of Dash in Panel and so on): extension
  stylesheets win over the shell theme whatever the selector, only another
  extension stylesheet can override them. The script copies their accent
  rules with `!important` into the stylesheet of the Accent for extensions
  extension (`gnome-extensions/local/accent@dots`).
- GTK 3: built-in Adwaita does not follow the accent, its dark variant has a
  fixed blue (`#15539e`) and shades of it computed in advance. The script
  writes a full copy of that CSS with every shade moved to the same shade of
  our color as the theme `Adwaita-dark` in `~/.local/share/themes`. GTK 3
  looks there before `/usr/share/themes`, so the gtk-theme setting stays
  `Adwaita-dark`. A copy of only the changed rules in `gtk.css` would not
  work: user CSS beats the theme whatever the selector, so it would also
  override other states (a disabled suggested button would keep the accent).
- Firefox and LibreWolf take the accent, text selection and selected items
  from the Settings accent through the settings portal. `ui.accentcolor`,
  `ui.highlight` and `ui.selecteditem` (with their `*text` pairs) in
  `firefox/user.js` replace them.
- Icons: folder and some app icons follow the accent through Accent Icons,
  which only has icon themes for the nine Settings colors. The script copies
  its green theme (made from `#3a944a`) with every shade moved to the same
  shade of our color as the icon theme `Adwaita-Void`. Accent Icons uses it
  for every accent (`gnome-extensions/settings/accent-directories.ini`).
  Apps it does not cover (LibreWolf, Code - OSS; `APP_ICONS` in the script)
  get their own PNG icon recolored: these icons are the main color, white and
  blends of the two, and each blend keeps its ratio with our color.

### App-specific notes

- Nautilus: path bar and search share a stack whose tallest page sets the
  headerbar height; both are fitted into 28px. Its own radii are set to 3px.
- Headerbar + tab bar in one `AdwToolbarView` (Nautilus and others) get a
  `.collapse-spacing` wrapper with 3px padding even when the tab bar is
  hidden; the padding is removed.
- Ptyxis adds 3px above the headerbar when tabs are shown; removed.
- Two-line titles (Text Editor, Ptyxis) use `line-height: 0.8` to fit 28px.
- Avatar buttons (Fractal account switcher) and view switcher tabs (System
  Monitor) were taller than 28px and stretched the headerbar and window
  buttons; both are fitted into 28px.
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
- Firefox and LibreWolf draw their window buttons with their own CSS, not
  with GTK: `firefox/chrome/userChrome.css` makes them the same 28px rounded
  squares. It needs `toolkit.legacyUserProfileCustomizations.stylesheets`,
  set in `firefox/user.js`. Restart the browser after changes.
- Telegram with the system window frame on Wayland gets it from the Qt
  plugin `libadwaita.so`, which draws its own round buttons and reads no CSS;
  left as is. VS Code draws its own titlebar and is not affected. This has
  nothing to do with the tray icons in Quick Settings (see below).

## GNOME Shell extensions

| Extension | What for | Changed settings |
|---|---|---|
| [Accent Icons](https://extensions.gnome.org/extension/7535/accent-directories/) | folder icons follow the accent color | theme `Adwaita-Void` for every accent |
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
| Tray Quick Settings (`gnome-extensions/local`) | app tray icons in Quick Settings | own extension, no settings |
| Accent for extensions (`gnome-extensions/local`) | accent color in other extensions, see [Accent color](#accent-color) | own extension, no settings |

The four before the last two come with the distro package
`gnome-shell-extensions`. The last two are not on extensions.gnome.org: their
sources are in `gnome-extensions/local/` and `install.sh` symlinks them into
`~/.local/share/gnome-shell/extensions`.

**Tray Quick Settings** (`tray-quick-settings@dots`) puts the tray icons of
apps in a row at the bottom of Quick Settings. Left click runs the app's
action, middle click and the wheel go to the app, right click opens the app's
menu over Quick Settings. An app that wants attention shows its icon in the
panel just left of Quick Settings; muted Telegram chats and apps that show
unread only in the picture (Vesktop) do not. The extension hosts the tray
itself, so it cannot run together with AppIndicator (whoever starts first
takes the tray name on the bus). It loads after the next login.

- `gnome-extensions/extensions.tsv`: uuid, source (`ego`, `package`, `app`,
  `local`) and dconf path of each extension.
- `gnome-extensions/settings/*.ini`: `dconf dump` of changed settings.
- `gnome-extensions/install.sh`: downloads missing `ego` extensions for the
  running GNOME version, links `local` extensions from the repo (an existing
  copy is kept as `.bak`), loads the settings and adds all listed extensions
  to `enabled-extensions`.
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
(shell theme, `gtk.css`/`radius.css` in `~/.config/gtk-*`, `userChrome.css`
and `user.js` in Firefox and LibreWolf) and puts back the
newest `*.bak` of each. Files that are not links to the repo are left alone.
Extensions are not removed: `gnome-extensions uninstall <uuid>`.
