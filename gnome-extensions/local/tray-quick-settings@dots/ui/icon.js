// Renders a TrayItem's icon into an St.Icon.
import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {argbToRgba, iconFileFor, itemId, pickPixmap} from '../logic.js';

// Items whose broken pixmap was already logged.
const warned = new WeakSet();

function scaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scale_factor;
}

// Themed icon lookup that also searches the app's IconThemePath.
function themedIcon(iconName, themePath, size) {
    if (!iconName)
        return null;
    const theme = new St.IconTheme();
    if (themePath)
        theme.append_search_path(themePath);
    const info = theme.lookup_icon(iconName, size, 0);
    if (!info)
        return null;
    // Without an app theme path let St resolve the name itself (scale, theme changes).
    if (!themePath)
        return new Gio.ThemedIcon({name: iconName});
    const file = info.get_filename();
    return file ? Gio.FileIcon.new(Gio.File.new_for_path(file)) : null;
}

function pixmapIcon(pixmaps, size) {
    const pixmap = pickPixmap(pixmaps, size);
    if (!pixmap)
        return null;
    const [width, height, data] = pixmap;
    if (width <= 0 || height <= 0 || !data || data.length < width * height * 4)
        return null;
    const content = St.ImageContent.new_with_preferred_size(width, height);
    const cogl = global.stage.context.get_backend().get_cogl_context();
    content.set_bytes(cogl, new GLib.Bytes(argbToRgba(data)),
        Cogl.PixelFormat.RGBA_8888, width, height, width * 4);
    return content;
}

export function updateIcon(icon, item, size) {
    const pixelSize = size * scaleFactor();
    icon.icon_size = size;

    const file = iconFileFor(item.iconThemePath, item.iconName);
    let gicon = file ? Gio.FileIcon.new(Gio.File.new_for_path(file)) : null;
    gicon ??= themedIcon(item.iconName, item.iconThemePath, pixelSize);
    try {
        gicon ??= pixmapIcon(item.iconPixmap, pixelSize);
    } catch (e) {
        if (!warned.has(item)) {
            warned.add(item);
            console.warn(`tray icon ${itemId(item.busName, item.objectPath)}: ${e.message}`);
        }
    }

    if (gicon)
        icon.gicon = gicon;
    else
        icon.icon_name = 'image-missing';
}
