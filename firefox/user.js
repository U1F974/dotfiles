// Read chrome/userChrome.css (window buttons styled like GTK 4 headerbars)
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);

// Accent color #478061 (see tools/gen-accent.py): Firefox takes the accent,
// text selection and selected items from the Settings accent through the
// settings portal, these prefs replace it
user_pref("ui.accentcolor", "#478061");
user_pref("ui.accentcolortext", "#ffffff");
user_pref("ui.highlight", "#478061");
user_pref("ui.highlighttext", "#ffffff");
user_pref("ui.selecteditem", "#478061");
user_pref("ui.selecteditemtext", "#ffffff");
