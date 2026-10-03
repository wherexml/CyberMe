mod chat;
mod dictation;
mod files;
mod ideas;
mod image_http;
mod inbox;
mod perf;
mod persist;
mod runtime;
mod search;
mod settings;
mod shell;
mod sync;
mod tasks;
mod theme;
mod util;

use gpui_kit::component::{Theme, ThemeMode};
use gpui_kit::*;

actions!(opstwin, [Quit, ToggleTheme]);

fn main() {
    // Start the I/O runtime before the UI so the first requests are not delayed.
    let _ = runtime::runtime();
    let client = opstwin_api::Client::from_env();
    eprintln!("[opstwin] api base {}", client.base());
    let store = match opstwin_store::Store::open_default() {
        Ok(s) => s,
        Err(e) => {
            eprintln!(
                "[opstwin] data dir unavailable ({}); using temp dir",
                e.kind()
            );
            opstwin_store::Store::open(std::env::temp_dir().join("OpsTwin")).expect("temp data dir")
        }
    };
    eprintln!("[opstwin] data dir {}", store.dir().display());
    let ui: opstwin_store::UiState = store.load(opstwin_store::UI_FILE);

    gpui_kit::application()
        .with_assets(gpui_kit::assets::AllAssets)
        .with_http_client(image_http::client())
        .run(move |cx| {
            gpui_kit::init(cx);
            shell::bind_keys(cx);
            cx.bind_keys([
                KeyBinding::new("cmd-q", Quit, None),
                KeyBinding::new("cmd-shift-l", ToggleTheme, None),
            ]);
            cx.on_action(|_: &Quit, cx| cx.quit());
            cx.on_action(|_: &ToggleTheme, cx| {
                let mode = if cx.theme_is_dark() {
                    ThemeMode::Light
                } else {
                    ThemeMode::Dark
                };
                Theme::change(mode, None, cx);
                cx.set_window_appearance(Some(if mode == ThemeMode::Dark {
                    WindowAppearance::Dark
                } else {
                    WindowAppearance::Light
                }));
                theme::apply(cx);
            });
            install_menus(cx);
            cx.on_window_closed(|cx, _| {
                if cx.windows().is_empty() {
                    cx.quit();
                }
            })
            .detach();

            let (bounds, maximized) = shell::window_bounds(&ui, cx);
            let options = WindowOptions {
                window_bounds: Some(if maximized {
                    WindowBounds::Maximized(bounds.get_bounds())
                } else {
                    bounds
                }),
                window_min_size: Some(size(px(720.), px(420.))),
                titlebar: Some(TitlebarOptions {
                    title: Some("OpsTwins".into()),
                    appears_transparent: true,
                    traffic_light_position: Some(point(px(12.), px(10.))),
                    ..Default::default()
                }),
                ..Default::default()
            };
            let (client, store, ui) = (client.clone(), store.clone(), ui.clone());
            gpui_kit::open_window(options, cx, move |window, cx| {
                Theme::sync_system_appearance(Some(window), cx);
                theme::apply(cx);
                let preferences: serde_json::Value = store.load("settings-drafts.json");
                if let Some(local) = preferences.get("local") {
                    theme::appearance(
                        local["appearance"].as_str().unwrap_or("system"),
                        local["font"].as_u64().unwrap_or(15) as u32,
                        window,
                        cx,
                    );
                    cx.set_reduce_motion(local["reduced"].as_bool().unwrap_or(false));
                }
                perf::start(window);
                cx.new(|cx| shell::Shell::new(client, store, ui, window, cx))
            })
            .expect("failed to open window");
            cx.activate(true);
        });
}

pub(crate) fn install_menus(cx: &mut App) {
    use crate::settings::t;
    cx.set_menus(vec![
        Menu::new("OpsTwins").items([
            MenuItem::action(t("切换浅色/深色"), ToggleTheme),
            MenuItem::separator(),
            MenuItem::action(t("退出 OpsTwins"), Quit),
        ]),
        Menu::new(t("前往")).items([
            MenuItem::action(t("对话"), shell::ShowChat),
            MenuItem::action(t("收件箱"), shell::ShowInbox),
            MenuItem::action(t("灵感"), shell::ShowIdeas),
            MenuItem::action(t("任务"), shell::ShowTasks),
            MenuItem::action(t("全局搜索"), shell::ShowSearch),
            MenuItem::action(t("设置…"), shell::ShowSettings),
        ]),
    ]);
}

trait ThemeIsDark {
    fn theme_is_dark(&self) -> bool;
}
impl ThemeIsDark for App {
    fn theme_is_dark(&self) -> bool {
        use gpui_kit::component::ActiveTheme as _;
        self.theme().is_dark()
    }
}
