//! Palette projected from the approved local HTML study, in logical pixels.
use gpui_kit::component::{ActiveTheme, Theme, ThemeMode};
use gpui_kit::*;

pub fn apply(cx: &mut App) {
    let dark = cx.theme().is_dark();
    Theme::update(cx, |t| {
        let c = &mut t.colors;
        c.background = rgb(if dark { 0x20232a } else { 0xffffff }).into();
        c.foreground = rgb(if dark { 0xebedf2 } else { 0x252831 }).into();
        c.muted_foreground = rgb(if dark { 0xa1a7b2 } else { 0x626a76 }).into();
        c.border = rgb(if dark { 0x333742 } else { 0xe7e9ee }).into();
        c.muted = rgb(if dark { 0x282c34 } else { 0xf5f6f8 }).into();
        c.secondary = c.muted;
        c.secondary_foreground = c.foreground;
        c.primary = rgb(if dark { 0x8aafff } else { 0x356ee8 }).into();
        c.primary_foreground = rgb(if dark { 0x14223e } else { 0xffffff }).into();
        c.accent = rgb(if dark { 0x2b3c59 } else { 0xe8effd }).into();
        c.accent_foreground = c.primary;
        c.sidebar = rgb(if dark { 0x22252b } else { 0xfcfcfd }).into();
        c.sidebar_foreground = c.foreground;
        c.sidebar_accent = rgb(if dark { 0x3a3f48 } else { 0xedeef1 }).into();
        c.sidebar_accent_foreground = c.foreground;
        c.input = c.border;
        t.font_family = ".SystemUIFont".into();
        t.font_size = px(15.);
        t.radius = px(8.);
        t.radius_lg = px(14.);
    });
}

pub fn appearance(value: &str, font_size: u32, window: &mut Window, cx: &mut App) {
    cx.set_window_appearance(match value {
        "dark" => Some(WindowAppearance::Dark),
        "light" => Some(WindowAppearance::Light),
        _ => None,
    });
    match value {
        "dark" => Theme::change(ThemeMode::Dark, Some(window), cx),
        "light" => Theme::change(ThemeMode::Light, Some(window), cx),
        _ => Theme::sync_system_appearance(Some(window), cx),
    }
    apply(cx);
    Theme::update(cx, |t| t.font_size = px(font_size.clamp(12, 22) as f32));
}
