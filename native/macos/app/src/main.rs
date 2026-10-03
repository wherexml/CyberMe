mod chat;
mod runtime;

use gpui_kit::component::{Theme, ThemeMode};
use gpui_kit::*;

actions!(opstwin, [Quit, ToggleTheme]);

fn main() {
    // Start the I/O runtime before the UI so the first requests are not delayed.
    let _ = runtime::runtime();
    let client = opstwin_api::Client::from_env();
    eprintln!("[opstwin] api base {}", client.base());

    gpui_kit::application()
        .with_assets(gpui_kit::assets::Assets)
        .run(move |cx| {
            gpui_kit::init(cx);
            cx.bind_keys([
                KeyBinding::new("cmd-q", Quit, None),
                KeyBinding::new("cmd-shift-l", ToggleTheme, None),
            ]);
            cx.on_action(|_: &Quit, cx| cx.quit());
            cx.on_action(|_: &ToggleTheme, cx| {
                let mode = if cx.theme_is_dark() { ThemeMode::Light } else { ThemeMode::Dark };
                Theme::change(mode, None, cx);
            });
            cx.set_menus(vec![Menu::new("OpsTwin").items([
                MenuItem::action("切换浅色/深色", ToggleTheme),
                MenuItem::separator(),
                MenuItem::action("退出 OpsTwin", Quit),
            ])]);
            cx.on_window_closed(|cx, _| {
                if cx.windows().is_empty() {
                    cx.quit();
                }
            })
            .detach();

            let bounds = Bounds::centered(None, size(px(880.), px(780.)), cx);
            let options = WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                window_min_size: Some(size(px(480.), px(360.))),
                titlebar: Some(TitlebarOptions {
                    title: Some("OpsTwin".into()),
                    ..Default::default()
                }),
                ..Default::default()
            };
            let client = client.clone();
            gpui_kit::open_window(options, cx, move |window, cx| {
                Theme::sync_system_appearance(Some(window), cx);
                cx.new(|cx| chat::ChatView::new(client, window, cx))
            })
            .expect("failed to open window");
            cx.activate(true);
        });
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
