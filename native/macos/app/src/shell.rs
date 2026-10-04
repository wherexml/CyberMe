//! Application shell: sidebar navigation (Chat / Inbox / Tasks), Cmd+1/2/3,
//! connection badge, and persistence of the last page and window bounds.

use crate::{
    chat::ChatView,
    ideas::{IdeasEvent, IdeasView},
    inbox::{InboxEvent, InboxView},
    persist::Saver,
    search::{SearchEvent, SearchView},
    settings::{SettingsEvent, SettingsView},
    sync::{Conn, SyncHub},
    tasks::TasksView,
};
use gpui_kit::component::{ActiveTheme as _, h_flex, tooltip::Tooltip, v_flex};
use gpui_kit::*;
use opstwin_store::{Store, UiState, WindowRect};
use std::sync::{Arc, OnceLock};
use std::{cell::RefCell, rc::Rc};

actions!(
    opstwin_shell,
    [
        ShowChat,
        ShowInbox,
        ShowIdeas,
        ShowTasks,
        ShowSearch,
        ShowSettings,
        CloseSearch,
        ToggleDictation
    ]
);

fn rail_icon(name: &str, dark: bool) -> Arc<Image> {
    static ICONS: OnceLock<Vec<Arc<Image>>> = OnceLock::new();
    let images = ICONS.get_or_init(|| {
        [
            include_bytes!("../../assets/rail/chat-light.svg").as_slice(),
            include_bytes!("../../assets/rail/chat-dark.svg").as_slice(),
            include_bytes!("../../assets/rail/inbox-light.svg").as_slice(),
            include_bytes!("../../assets/rail/inbox-dark.svg").as_slice(),
            include_bytes!("../../assets/rail/bulb-light.svg").as_slice(),
            include_bytes!("../../assets/rail/bulb-dark.svg").as_slice(),
            include_bytes!("../../assets/rail/tasks-light.svg").as_slice(),
            include_bytes!("../../assets/rail/tasks-dark.svg").as_slice(),
            include_bytes!("../../assets/rail/search-light.svg").as_slice(),
            include_bytes!("../../assets/rail/search-dark.svg").as_slice(),
            include_bytes!("../../assets/rail/settings-light.svg").as_slice(),
            include_bytes!("../../assets/rail/settings-dark.svg").as_slice(),
        ]
        .into_iter()
        .map(|b| Arc::new(Image::from_bytes(ImageFormat::Svg, b.to_vec())))
        .collect()
    });
    let index = match name {
        "chat" => 0,
        "inbox" => 2,
        "ideas" => 4,
        "tasks" => 6,
        "search" => 8,
        _ => 10,
    };
    images[index + usize::from(dark)].clone()
}

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("cmd-1", ShowChat, None),
        KeyBinding::new("cmd-2", ShowInbox, None),
        KeyBinding::new("cmd-3", ShowIdeas, None),
        KeyBinding::new("cmd-4", ShowTasks, None),
        KeyBinding::new("cmd-k", ShowSearch, None),
        KeyBinding::new("cmd-,", ShowSettings, None),
        KeyBinding::new("alt-space", ToggleDictation, Some("OpsTwinShell")),
        KeyBinding::new("escape", CloseSearch, Some("OpsTwinShell")),
    ]);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Page {
    Chat,
    Inbox,
    Ideas,
    Tasks,
}

impl Page {
    pub fn key(self) -> &'static str {
        match self {
            Page::Chat => "chat",
            Page::Inbox => "inbox",
            Page::Tasks => "tasks",
            Page::Ideas => "ideas",
        }
    }
    pub fn from_key(s: &str) -> Option<Self> {
        match s {
            "chat" => Some(Page::Chat),
            "inbox" => Some(Page::Inbox),
            "tasks" => Some(Page::Tasks),
            "ideas" => Some(Page::Ideas),
            _ => None,
        }
    }
}

pub struct Shell {
    page: Page,
    hub: Entity<SyncHub>,
    chat: Entity<ChatView>,
    inbox: Entity<InboxView>,
    tasks: Entity<TasksView>,
    ideas: Entity<IdeasView>,
    search: Entity<SearchView>,
    search_open: bool,
    search_backdrop: Rc<RefCell<crate::backdrop::SearchBackdrop>>,
    settings_window: Option<AnyWindowHandle>,
    client: opstwin_api::Client,
    toast: Option<String>,
    ui: UiState,
    ui_saver: Saver<UiState>,
    focus: FocusHandle,
    _subscriptions: Vec<Subscription>,
    _tasks: Vec<Task<()>>,
}

impl Shell {
    pub fn new(
        client: opstwin_api::Client,
        store: Store,
        ui: UiState,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let hub = cx.new(|cx| SyncHub::new(client.clone(), cx));
        let page = ui
            .last_page
            .as_deref()
            .and_then(Page::from_key)
            .unwrap_or(Page::Chat);
        let chat =
            cx.new(|cx| ChatView::new(client.clone(), hub.clone(), store.clone(), window, cx));
        let inbox =
            cx.new(|cx| InboxView::new(client.clone(), hub.clone(), store.clone(), window, cx));
        let tasks = cx.new(|cx| TasksView::new(client.clone(), hub.clone(), window, cx));

        let ideas = cx.new(|cx| IdeasView::new(client.clone(), hub.clone(), window, cx));
        let search = cx.new(|cx| SearchView::new(client.clone(), hub.clone(), window, cx));
        let subscriptions = vec![
            cx.observe_window_bounds(window, |this, window, _| this.remember_bounds(window)),
            cx.observe(&hub, |_, _, cx| cx.notify()),
            cx.subscribe_in(&ideas, window, |this, _, event, window, cx| match event {
                IdeasEvent::OpenConversation { conversation_id } => {
                    this.show(Page::Chat, window, cx);
                    this.chat.update(cx, |v, cx| {
                        v.open_conversation(conversation_id.clone(), window, cx)
                    });
                }
            }),
            cx.subscribe_in(&inbox, window, |this, _, event, window, cx| match event {
                InboxEvent::Inspiration {
                    inbox_id,
                    title,
                    body,
                } => {
                    this.show(Page::Chat, window, cx);
                    this.chat.update(cx, |v, cx| {
                        v.send_source_prompt(
                            inbox_id.clone(),
                            format!(
                                "请根据以下来源做深入思考，给出可审阅的建议；不要外发。\n{}\n{}",
                                title, body
                            ),
                            window,
                            cx,
                        )
                    });
                }
                InboxEvent::OpenConversation { conversation_id } => {
                    this.show(Page::Chat, window, cx);
                    this.chat.update(cx, |v, cx| {
                        v.open_conversation(conversation_id.clone(), window, cx)
                    });
                }
            }),
            cx.subscribe_in(&search, window, |this, _, event, window, cx| match event {
                SearchEvent::Close => this.close_search(window, cx),
                SearchEvent::Open { kind, id } => {
                    this.close_search(window, cx);
                    match kind.as_str() {
                        "inbox" => {
                            this.show(Page::Inbox, window, cx);
                            this.inbox
                                .update(cx, |v, cx| v.open_item(id.clone(), window, cx));
                        }
                        "tasks" | "task" => {
                            this.show(Page::Tasks, window, cx);
                            this.tasks
                                .update(cx, |v, cx| v.open_task(id.clone(), window, cx));
                        }
                        "ideas" | "idea" => {
                            this.show(Page::Ideas, window, cx);
                            this.ideas.update(cx, |v, cx| v.open_idea(id, window, cx));
                        }
                        "artifacts" => {
                            this.show(Page::Chat, window, cx);
                            this.chat
                                .update(cx, |v, cx| v.open_attachment(id.clone(), cx));
                        }
                        _ => {
                            this.show(Page::Chat, window, cx);
                            this.chat
                                .update(cx, |v, cx| v.open_conversation(id.clone(), window, cx));
                        }
                    }
                }
            }),
            cx.on_app_quit(|this, cx| {
                this.persist_all(cx);
                async {}
            }),
        ];
        let ui_saver = Saver::new(store, opstwin_store::UI_FILE);
        let mut this = Self {
            page,
            hub,
            chat,
            inbox,
            tasks,
            ideas,
            search,
            search_open: false,
            search_backdrop: Default::default(),
            settings_window: None,
            client,
            toast: None,
            ui,
            ui_saver,
            focus: cx.focus_handle(),
            _subscriptions: subscriptions,
            _tasks: Vec::new(),
        };
        this.load_language(cx);
        this.apply_visibility(cx);
        // Keyboard focus must sit inside the shell so Cmd+1/2/3 and the
        // "前往" menu dispatch through it. Chat focuses its composer itself.
        if page != Page::Chat {
            let focus = this.focus.clone();
            window.defer(cx, move |window, cx| focus.focus(window, cx));
        }
        this
    }

    fn remember_bounds(&mut self, window: &mut Window) {
        let maximized = window.is_maximized() || window.is_fullscreen();
        let b = window.window_bounds().get_bounds();
        let rect = WindowRect {
            x: f32::from(b.origin.x),
            y: f32::from(b.origin.y),
            width: f32::from(b.size.width),
            height: f32::from(b.size.height),
            maximized,
        };
        if self.ui.window != Some(rect) {
            self.ui.window = Some(rect);
            self.ui_saver.save(self.ui.clone());
        }
    }

    fn persist_all(&mut self, cx: &mut Context<Self>) {
        self.ui_saver.save_blocking(&self.ui);
        self.chat.read(cx).persist_blocking(cx);
        self.inbox.read(cx).persist_blocking();
        self.tasks.read(cx).persist_blocking(cx);
    }

    pub fn show(&mut self, page: Page, window: &mut Window, cx: &mut Context<Self>) {
        if self.search_open {
            self.search_open = false;
            self.search_backdrop.borrow_mut().clear();
            self.search
                .update(cx, |view, cx| view.set_visible(false, cx));
        }
        if page == Page::Ideas {
            let target = self.chat.read(cx).selected_conversation_id();
            self.ideas
                .update(cx, |ideas, _| ideas.set_target_conversation(target));
        }
        if self.page != page {
            self.page = page;
            self.ui.last_page = Some(page.key().to_string());
            self.ui_saver.save(self.ui.clone());
            self.apply_visibility(cx);
        }
        match page {
            Page::Chat => {
                let focus = self.chat.read(cx).composer_focus(cx);
                focus.focus(window, cx);
            }
            _ => self.focus.focus(window, cx),
        }
        cx.notify();
    }

    fn apply_visibility(&mut self, cx: &mut Context<Self>) {
        let page = self.page;
        self.chat
            .update(cx, |v, cx| v.set_visible(page == Page::Chat, cx));
        self.inbox
            .update(cx, |v, cx| v.set_visible(page == Page::Inbox, cx));
        self.tasks
            .update(cx, |v, cx| v.set_visible(page == Page::Tasks, cx));
        self.ideas
            .update(cx, |v, cx| v.set_visible(page == Page::Ideas, cx));
    }

    fn load_language(&mut self, cx: &mut Context<Self>) {
        let client = self.client.clone();
        self._tasks.push(cx.spawn(async move |this, cx| {
            let settings =
                crate::runtime::io(async move { client.product_get("/api/settings").await }).await;
            if let Ok(settings) = settings {
                _ = this.update(cx, |_, cx| {
                    crate::settings::set_language(
                        settings["identity"]["language"].as_str().unwrap_or("zh-CN"),
                        cx,
                    )
                });
            }
        }));
    }

    fn show_search(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.chat.update(cx, |v, cx| v.cancel_dictation(cx));
        self.search_open = true;
        self.search.update(cx, |v, cx| v.set_visible(true, cx));
        cx.notify();
        let search = self.search.clone();
        window.defer(cx, move |window, cx| {
            search.update(cx, |v, cx| v.focus(window, cx))
        });
    }

    fn close_search(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.chat.update(cx, |v, cx| v.cancel_dictation(cx));
        self.search_open = false;
        self.search_backdrop.borrow_mut().clear();
        self.search.update(cx, |v, cx| v.set_visible(false, cx));
        self.show(self.page, window, cx);
    }

    fn show_settings(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        self.chat.update(cx, |v, cx| v.cancel_dictation(cx));
        if let Some(handle) = self.settings_window {
            if handle
                .update(cx, |_, window, _| {
                    window.set_window_title(&crate::settings::t("设置"));
                    window.activate_window();
                })
                .is_ok()
            {
                return;
            }
        }
        let client = self.client.clone();
        let hub = self.hub.clone();
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                None,
                size(px(920.), px(680.)),
                cx,
            ))),
            window_min_size: Some(size(px(660.), px(420.))),
            is_minimizable: false,
            titlebar: Some(TitlebarOptions {
                title: Some(crate::settings::t("设置").into()),
                ..Default::default()
            }),
            ..Default::default()
        };
        match gpui_kit::open_window(options, cx, move |window, cx| {
            cx.new(|cx| SettingsView::new(client, hub, window, cx))
        }) {
            Ok((handle, view)) => {
                self.settings_window = Some(handle);
                self._subscriptions
                    .push(cx.subscribe(&view, move |_, view, event, cx| match event {
                        SettingsEvent::Close => {
                            view.update(cx, |v, cx| v.set_visible(false, cx));
                            _ = handle.update(cx, |_, window, _| window.remove_window());
                        }
                        SettingsEvent::Appearance {
                            appearance,
                            font_size,
                            reduced_motion,
                        } => {
                            cx.set_reduce_motion(*reduced_motion);
                            _ = handle.update(cx, |_, window, cx| {
                                crate::theme::appearance(appearance, *font_size, window, cx)
                            });
                        }
                    }));
            }
            Err(_) => self.toast = Some("无法打开设置，请重试".into()),
        }
        cx.notify();
    }

    fn rail_button(
        &self,
        key: &'static str,
        label: &'static str,
        active: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = cx.theme().clone();
        let dark = theme.is_dark();
        let hover = theme.sidebar_accent;
        gpui_kit::base::Button::new(key)
            .accessibility_label(crate::settings::t(
                label.split(" · ").next().unwrap_or(label),
            ))
            .aria_keyshortcuts(label.split(" · ").nth(1).unwrap_or(""))
            .size(px(44.))
            .flex_none()
            .rounded_full()
            .flex()
            .items_center()
            .justify_center()
            .cursor_pointer()
            .bg(if active {
                theme.sidebar_accent
            } else {
                transparent_black()
            })
            .hover(move |s| s.bg(hover))
            .focus_visible(move |s| s.bg(hover))
            .tooltip(move |window, cx| {
                let mut parts = label.split(" · ");
                let title = crate::settings::t(parts.next().unwrap_or(label));
                Tooltip::new(format!("{} · {}", title, parts.next().unwrap_or("")))
                    .build(window, cx)
            })
            .child(img(rail_icon(key, dark)).size(px(24.)))
            .on_click(cx.listener(move |this, _, window, cx| match key {
                "search" => this.show_search(window, cx),
                "settings" => this.show_settings(window, cx),
                "chat" if this.page == Page::Chat => {
                    this.chat.update(cx, |v, cx| v.toggle_conversations(cx))
                }
                _ => {
                    if let Some(page) = Page::from_key(key) {
                        this.show(page, window, cx)
                    }
                }
            }))
    }
}

pub fn conn_badge(conn: &Conn, cx: &App) -> impl IntoElement {
    let theme = cx.theme();
    let (dot, label) = match conn {
        Conn::Connecting => (theme.muted_foreground, "连接中…".to_string()),
        Conn::Live => (theme.success, "实时同步".to_string()),
        Conn::Polling => (theme.warning, "轮询同步".to_string()),
        Conn::Offline(msg) => (theme.danger, format!("离线：{msg}")),
    };
    h_flex()
        .gap_1p5()
        .items_center()
        .text_xs()
        .text_color(theme.muted_foreground)
        .child(div().size_2().rounded_full().bg(dot))
        .child(crate::settings::t(&label))
}

impl Render for Shell {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let content: AnyElement = match self.page {
            Page::Chat => self.chat.clone().into_any_element(),
            Page::Inbox => self.inbox.clone().into_any_element(),
            Page::Ideas => self.ideas.clone().into_any_element(),
            Page::Tasks => self.tasks.clone().into_any_element(),
        };
        let short = window.bounds().size.height < px(560.);
        let sidebar = v_flex()
            .w(px(78.))
            .h_full()
            .flex_none()
            .relative()
            .bg(theme.sidebar)
            .border_r_1()
            .border_color(theme.border)
            .child(div().h(px(if short { 58. } else { 98. })).flex_none())
            .child(
                v_flex()
                    .flex_1()
                    .min_h_0()
                    .justify_center()
                    .items_center()
                    .gap(px(12.))
                    .child(self.rail_button("chat", "对话 · ⌘1", self.page == Page::Chat, cx))
                    .child(self.rail_button("inbox", "收件箱 · ⌘2", self.page == Page::Inbox, cx))
                    .child(self.rail_button("ideas", "灵感 · ⌘3", self.page == Page::Ideas, cx))
                    .child(self.rail_button("tasks", "任务 · ⌘4", self.page == Page::Tasks, cx)),
            )
            .child(
                v_flex()
                    .h(px(if short { 106. } else { 122. }))
                    .flex_none()
                    .justify_end()
                    .items_center()
                    .gap(px(12.))
                    .pb(px(10.))
                    .child(self.rail_button("search", "全局搜索 · ⌘K", self.search_open, cx))
                    .child(self.rail_button("settings", "设置 · ⌘,", false, cx)),
            );
        let mut root = h_flex()
            .id("shell")
            .key_context("OpsTwinShell")
            .track_focus(&self.focus)
            .size_full()
            .relative()
            .bg(theme.background)
            .text_color(theme.foreground)
            .text_size(theme.font_size)
            .on_action(
                cx.listener(|this, _: &ShowChat, window, cx| this.show(Page::Chat, window, cx)),
            )
            .on_action(
                cx.listener(|this, _: &ShowInbox, window, cx| this.show(Page::Inbox, window, cx)),
            )
            .on_action(
                cx.listener(|this, _: &ShowIdeas, window, cx| this.show(Page::Ideas, window, cx)),
            )
            .on_action(
                cx.listener(|this, _: &ShowTasks, window, cx| this.show(Page::Tasks, window, cx)),
            )
            .on_action(cx.listener(|this, _: &ShowSearch, window, cx| this.show_search(window, cx)))
            .on_action(
                cx.listener(|this, _: &ShowSettings, window, cx| this.show_settings(window, cx)),
            )
            .on_action(cx.listener(|this, _: &ToggleDictation, window, cx| {
                if this.page == Page::Chat && !this.search_open {
                    this.chat.update(cx, |v, cx| v.toggle_handsfree(window, cx));
                }
            }))
            .on_action(cx.listener(|this, _: &CloseSearch, window, cx| {
                if this.search_open {
                    this.close_search(window, cx);
                } else if !this
                    .chat
                    .update(cx, |chat, cx| chat.escape_dictation(window, cx))
                {
                    cx.propagate();
                }
            }))
            .child(sidebar)
            .child(div().flex_1().min_w_0().h_full().child(content));
        if !self.search_open {
            self.search_backdrop.borrow_mut().clear();
        }
        if self.search_open {
            let backdrop = self.search_backdrop.clone();
            root = root.child(
                div()
                    .absolute()
                    .inset_0()
                    .bg(rgb(0x172235).opacity(0.16))
                    .flex()
                    // Center in the content below the 24px traffic-light area,
                    // matching the source dialog's application viewport.
                    .pt(px(24.))
                    .items_center()
                    .justify_center()
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|this, _, window, cx| this.close_search(window, cx)),
                    )
                    .child(
                        div()
                            .relative()
                            .w(px(640.))
                            .max_w(relative(0.92))
                            .max_h(relative(0.76))
                            .rounded(px(22.))
                            .bg(theme.background)
                            .border_1()
                            .border_color(theme.border)
                            .shadow_lg()
                            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                            .child(self.search.clone())
                            .child(
                                canvas(
                                    move |bounds, window, _| {
                                        backdrop.borrow_mut().update(window, bounds);
                                    },
                                    |_, _, _, _| {},
                                )
                                .absolute()
                                .inset_0()
                                .size_full(),
                            ),
                    ),
            );
        }
        if let Some(message) = self.toast.clone() {
            root = root.child(
                div()
                    .absolute()
                    .bottom(px(24.))
                    .right(px(24.))
                    .p_3()
                    .rounded_lg()
                    .bg(theme.foreground)
                    .text_color(theme.background)
                    .text_sm()
                    .child(crate::settings::t(&message)),
            );
        }
        root
    }
}

/// Initial window options from persisted bounds, clamped to a visible display.
pub fn window_bounds(ui: &UiState, cx: &App) -> (WindowBounds, bool) {
    let default = || WindowBounds::Windowed(Bounds::centered(None, size(px(1280.), px(820.)), cx));
    let Some(r) = ui.window else {
        return (default(), false);
    };
    if r.width < 480.0 || r.height < 360.0 {
        return (default(), false);
    }
    let b = Bounds::new(point(px(r.x), px(r.y)), size(px(r.width), px(r.height)));
    let visible = cx.displays().iter().any(|d| d.bounds().intersects(&b));
    if !visible {
        return (default(), false);
    }
    (WindowBounds::Windowed(b), r.maximized)
}
