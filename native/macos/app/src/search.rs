//! Workspace search over real records. Samples are intentionally absent.
use crate::settings::t;
use crate::{
    persist::Saver,
    runtime::io,
    sync::{SyncEvent, SyncHub},
};
use gpui_kit::{
    component::{
        ActiveTheme as _, Disableable as _, Icon, Selectable as _, Sizable as _,
        button::{Button, ButtonVariants as _},
        h_flex,
        input::{Input, InputEvent, InputState},
        scroll::ScrollableElement as _,
        v_flex,
    },
    prelude::FluentBuilder as _,
    *,
};
use opstwin_api::Client;
use serde_json::{Value, json};
const KINDS: [(&str, &str); 10] = [
    ("messages", "对话消息"),
    ("conversations", "对话"),
    ("inbox", "收件箱"),
    ("ideas", "灵感"),
    ("tasks", "任务"),
    ("artifacts", "文件"),
    ("projects", "项目"),
    ("memories", "记忆"),
    ("automations", "自动行动"),
    ("activities", "记录"),
];
#[derive(Clone, Debug)]
pub enum SearchEvent {
    Open { kind: String, id: String },
    Close,
}
impl EventEmitter<SearchEvent> for SearchView {}
#[derive(Clone)]
struct Record {
    kind: String,
    id: String,
    target_id: String,
    title: String,
    fallback_title: bool,
    text: String,
    time: i64,
}
pub struct SearchView {
    client: Client,
    query: Entity<InputState>,
    query_placeholder: String,
    records: Vec<Record>,
    remote_records: Vec<Record>,
    remote_total: u64,
    remote_has_more: bool,
    remote_next: u64,
    remote_revision: Option<u64>,
    remote_generation: u64,
    remote_loading: bool,
    remote_error: Option<String>,
    detail_generation: u64,
    detail_loading: bool,
    detail_error: Option<String>,
    filter: String,
    cursor: usize,
    loading: bool,
    error: Option<String>,
    visible: bool,
    stale: bool,
    generation: u64,
    recent: Vec<String>,
    detail: Option<Record>,
    saver: Option<Saver<Value>>,
    _subscriptions: Vec<Subscription>,
    _tasks: Vec<Task<()>>,
}
impl SearchView {
    pub fn new(
        client: Client,
        hub: Entity<SyncHub>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let query =
            cx.new(|cx| InputState::new(window, cx).placeholder(t("搜索对话、收件箱、灵感…")));
        let store = opstwin_store::Store::open_default().ok();
        let saved: Value = store
            .as_ref()
            .map(|s| s.load("search.json"))
            .unwrap_or_default();
        let recent = saved["recent"]
            .as_array()
            .map(|v| {
                v.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let saver = store.map(|s| Saver::new(s, "search.json"));
        let subs = vec![
            cx.subscribe(&query, |this: &mut Self, _, ev: &InputEvent, cx| match ev {
                InputEvent::Change => {
                    this.cursor = 0;
                    this.detail = None;
                    this.search_full(false, cx);
                    cx.notify();
                }
                InputEvent::PressEnter { .. } => this.open_current(cx),
                _ => {}
            }),
            cx.subscribe(&hub, |this: &mut Self, _, ev: &SyncEvent, cx| {
                if matches!(
                    ev,
                    SyncEvent::Revision | SyncEvent::Connected { was_down: true, .. }
                ) {
                    if this.visible {
                        this.reload(cx);
                        this.search_full(false, cx)
                    } else {
                        this.stale = true
                    }
                }
            }),
        ];
        let mut this = Self {
            client,
            query,
            query_placeholder: t("搜索对话、收件箱、灵感…"),
            records: vec![],
            remote_records: vec![],
            remote_total: 0,
            remote_has_more: false,
            remote_next: 0,
            remote_revision: None,
            remote_generation: 0,
            remote_loading: false,
            remote_error: None,
            detail_generation: 0,
            detail_loading: false,
            detail_error: None,
            filter: "all".into(),
            cursor: 0,
            loading: false,
            error: None,
            visible: false,
            stale: false,
            generation: 0,
            recent,
            detail: None,
            saver,
            _subscriptions: subs,
            _tasks: vec![],
        };
        this.reload(cx);
        this
    }
    pub fn focus(&self, window: &mut Window, cx: &mut Context<Self>) {
        self.query.focus_handle(cx).focus(window, cx);
    }
    pub fn set_visible(&mut self, v: bool, cx: &mut Context<Self>) {
        self.visible = v;
        if v && std::mem::take(&mut self.stale) {
            self.reload(cx);
            self.search_full(false, cx)
        }
    }
    fn reload(&mut self, cx: &mut Context<Self>) {
        self.generation += 1;
        let g = self.generation;
        self.loading = true;
        let c = self.client.clone();
        let t = cx.spawn(async move |this, cx| {
            let r = io(async move { c.product_get("/api/bootstrap").await }).await;
            _ = this.update(cx, |this, cx| {
                if this.generation != g {
                    return;
                }
                this.loading = false;
                match r {
                    Ok(v) => {
                        this.records.clear();
                        for (kind, _) in KINDS {
                            for row in v[kind].as_array().into_iter().flatten() {
                                if row["deleted"].as_bool() == Some(true) {
                                    continue;
                                }
                                let Some(id) = row["id"].as_str() else {
                                    continue;
                                };
                                let source_title = ["title", "name", "sender"]
                                    .iter()
                                    .find_map(|k| row[*k].as_str());
                                let fallback_title = source_title.is_none();
                                let title = source_title
                                    .unwrap_or(if kind == "messages" {
                                        "对话消息"
                                    } else {
                                        "未命名记录"
                                    })
                                    .to_string();
                                let text = [
                                    "title",
                                    "name",
                                    "sender",
                                    "body",
                                    "content",
                                    "description",
                                    "notes",
                                    "prompt",
                                ]
                                .iter()
                                .filter_map(|k| row[*k].as_str())
                                .collect::<Vec<_>>()
                                .join("\n");
                                let target_id = if kind == "messages" {
                                    row["conversationId"].as_str().unwrap_or(id)
                                } else {
                                    id
                                };
                                this.records.push(Record {
                                    kind: kind.into(),
                                    id: id.into(),
                                    target_id: target_id.into(),
                                    title,
                                    fallback_title,
                                    text,
                                    time: row["createdAt"]
                                        .as_str()
                                        .or_else(|| row["updatedAt"].as_str())
                                        .and_then(crate::util::parse_ms)
                                        .unwrap_or(0),
                                });
                            }
                        }
                        this.error = None;
                    }
                    Err(e) => this.error = Some(e.user_text()),
                }
                cx.notify();
            });
        });
        self._tasks.push(t);
        cx.notify();
    }
    fn search_full(&mut self, more: bool, cx: &mut Context<Self>) {
        let query = self.query.read(cx).value().trim().to_string();
        if query.is_empty() {
            self.remote_generation += 1;
            self.remote_records.clear();
            self.remote_total = 0;
            self.remote_loading = false;
            self.remote_error = None;
            return;
        }
        if more && (self.remote_loading || !self.remote_has_more) {
            return;
        }
        if !more {
            self.remote_generation += 1;
            self.remote_records.clear();
            self.remote_total = 0;
            self.remote_next = 0;
            self.remote_revision = None;
            self.remote_has_more = false;
        }
        let generation = self.remote_generation;
        let offset = self.remote_next;
        let revision = self.remote_revision;
        let kind = self.filter.clone();
        self.remote_loading = true;
        self.remote_error = None;
        let client = self.client.clone();
        self._tasks.push(cx.spawn(async move |this, cx| {
            if !more {
                crate::runtime::sleep(160).await;
            }
            let alive = this
                .update(cx, |this, cx| {
                    this.remote_generation == generation
                        && this.query.read(cx).value().trim() == query
                        && this.filter == kind
                })
                .unwrap_or(false);
            if !alive {
                return;
            }
            let result = io(async move {
                client
                    .workspace_search(&query, &kind, offset, 50, revision)
                    .await
            })
            .await;
            _ = this.update(cx, |this, cx| {
                if this.remote_generation != generation {
                    return;
                }
                this.remote_loading = false;
                match result {
                    Ok(page) => {
                        for row in page["items"].as_array().into_iter().flatten() {
                            let (Some(id), Some(kind)) = (row["id"].as_str(), row["kind"].as_str())
                            else {
                                continue;
                            };
                            if this
                                .remote_records
                                .iter()
                                .any(|record| record.id == id && record.kind == kind)
                            {
                                continue;
                            }
                            let title = row["title"].as_str().unwrap_or("");
                            this.remote_records.push(Record {
                                id: id.into(),
                                kind: kind.into(),
                                target_id: row["targetId"].as_str().unwrap_or(id).into(),
                                title: if title.is_empty() {
                                    "未命名记录".into()
                                } else {
                                    title.into()
                                },
                                fallback_title: title.is_empty(),
                                text: row["snippet"].as_str().unwrap_or("").into(),
                                time: row["time"]
                                    .as_str()
                                    .and_then(crate::util::parse_ms)
                                    .unwrap_or(0),
                            });
                        }
                        this.remote_total = page["total"]
                            .as_u64()
                            .unwrap_or(this.remote_records.len() as u64);
                        this.remote_has_more = page["hasMore"].as_bool().unwrap_or(false);
                        this.remote_next = page["nextOffset"]
                            .as_u64()
                            .unwrap_or(this.remote_records.len() as u64);
                        this.remote_revision = page["revision"].as_u64();
                    }
                    Err(error) => this.remote_error = Some(error.user_text()),
                }
                cx.notify();
            });
        }));
        cx.notify();
    }

    fn results(&self, cx: &App) -> Vec<Record> {
        let q = self.query.read(cx).value().to_lowercase();
        if !q.trim().is_empty() {
            return self.remote_records.clone();
        }
        let mut rows: Vec<_> = self
            .records
            .iter()
            .filter(|r| self.filter == "all" || self.filter == r.kind)
            .filter(|r| {
                q.split_whitespace().all(|term| {
                    r.text.to_lowercase().contains(term) || r.title.to_lowercase().contains(term)
                })
            })
            .cloned()
            .collect();
        if q.trim().is_empty() {
            let mut recent = Vec::new();
            for key in &self.recent {
                if let Some(record) = self
                    .records
                    .iter()
                    .find(|r| format!("{}:{}", r.kind, r.id) == *key)
                {
                    recent.push(record.clone());
                }
            }
            let mut conversations: Vec<_> = self
                .records
                .iter()
                .filter(|r| r.kind == "conversations")
                .cloned()
                .collect();
            for conversation in &mut conversations {
                if let Some(message) = self
                    .records
                    .iter()
                    .filter(|r| r.kind == "messages" && r.target_id == conversation.id)
                    .max_by_key(|r| r.time)
                {
                    conversation.time = message.time;
                    conversation.text = message.text.clone();
                }
            }
            conversations.sort_by_key(|r| std::cmp::Reverse(r.time));
            for conversation in conversations {
                if recent.len() >= 6 {
                    break;
                }
                if !recent.iter().any(|r| r.target_id == conversation.id) {
                    recent.push(conversation);
                }
            }
            rows = recent;
        }

        rows
    }
    fn open_current(&mut self, cx: &mut Context<Self>) {
        if let Some(r) = self.results(cx).get(self.cursor).cloned() {
            self.open(&r, cx)
        }
    }
    fn open(&mut self, r: &Record, cx: &mut Context<Self>) {
        let key = format!("{}:{}", r.kind, r.id);
        self.recent.retain(|x| x != &key);
        self.recent.insert(0, key);
        self.recent.truncate(8);
        if let Some(s) = &self.saver {
            s.save(json!({"recent":self.recent}));
        }
        if matches!(
            r.kind.as_str(),
            "messages" | "conversations" | "inbox" | "ideas" | "tasks"
        ) {
            cx.emit(SearchEvent::Open {
                kind: r.kind.clone(),
                id: r.target_id.clone(),
            });
        } else {
            self.detail = Some(r.clone());
            self.detail_generation += 1;
            let generation = self.detail_generation;
            self.detail_loading = true;
            self.detail_error = None;
            let client = self.client.clone();
            let row = r.clone();
            self._tasks.push(cx.spawn(async move |this, cx| {
                let encoded = opstwin_api::product::query_value(&row.id).replace('+', "%20");
                let path = format!("/api/{}/{encoded}", row.kind);
                let result = io(async move { client.product_get(&path).await }).await;
                _ = this.update(cx, |this, cx| {
                    if this.detail_generation != generation
                        || !this
                            .detail
                            .as_ref()
                            .is_some_and(|detail| detail.id == row.id && detail.kind == row.kind)
                    {
                        return;
                    }
                    this.detail_loading = false;
                    match result {
                        Ok(entity) => {
                            let title = ["title", "name", "sender"]
                                .iter()
                                .find_map(|key| entity[*key].as_str());
                            this.detail = Some(Record {
                                fallback_title: title.is_none(),
                                title: title.unwrap_or("未命名记录").into(),
                                text: [
                                    "body",
                                    "content",
                                    "description",
                                    "notes",
                                    "prompt",
                                    "summary",
                                ]
                                .iter()
                                .filter_map(|key| entity[*key].as_str())
                                .collect::<Vec<_>>()
                                .join("\n\n"),
                                ..row
                            });
                        }
                        Err(error) => this.detail_error = Some(error.user_text()),
                    }
                    cx.notify();
                });
            }));
            cx.notify();
        }
    }
}
impl Render for SearchView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let placeholder = t("搜索对话、收件箱、灵感…");
        if self.query_placeholder != placeholder {
            self.query_placeholder = placeholder.clone();
            self.query.update(cx, |input, cx| {
                input.set_placeholder(placeholder, _window, cx)
            });
        }
        let theme = cx.theme().clone();
        if let Some(record) = self.detail.clone() {
            let mut body = v_flex()
                .gap_4()
                .p_5()
                .child(
                    Button::new("search-detail-back")
                        .small()
                        .ghost()
                        .label(t("‹ 搜索结果"))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.detail = None;
                            cx.notify();
                        })),
                )
                .child(
                    div()
                        .text_size(px(20.))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(if record.fallback_title {
                            t(&record.title)
                        } else {
                            record.title.clone()
                        }),
                )
                .child(div().max_h(px(450.)).overflow_y_scrollbar().child(
                    crate::util::markdown("search-record", record.text.clone()).selectable(true),
                ));
            if self.detail_loading {
                body = body.child(
                    div()
                        .text_color(theme.muted_foreground)
                        .child(t("正在加载详情…")),
                );
            }
            if let Some(error) = &self.detail_error {
                let row = record.clone();
                body = body.child(
                    h_flex()
                        .gap_2()
                        .child(div().text_color(theme.danger).child(t(error)))
                        .child(
                            Button::new("search-detail-retry")
                                .small()
                                .ghost()
                                .label(t("重试"))
                                .on_click(cx.listener(move |this, _, _, cx| this.open(&row, cx))),
                        ),
                );
            }
            if record.kind == "artifacts" {
                let id = record.id.clone();
                body = body.child(
                    Button::new("search-open-artifact")
                        .small()
                        .outline()
                        .label(t("打开文件"))
                        .on_click(cx.listener(move |_, _, _, cx| {
                            cx.emit(SearchEvent::Open {
                                kind: "artifacts".into(),
                                id: id.clone(),
                            });
                        })),
                );
            }
            return v_flex()
                .w_full()
                .max_w(px(640.))
                .bg(theme.background)
                .rounded(px(14.))
                .border_1()
                .border_color(theme.border)
                .shadow_lg()
                .child(body)
                .into_any_element();
        }
        let results = self.results(cx);
        let mut filters = h_flex().gap_1().flex_wrap().px_4().py_2();
        for (kind, label) in std::iter::once(("all", "全部")).chain(KINDS) {
            filters = filters.child(
                Button::new(ElementId::Name(format!("search-filter-{kind}").into()))
                    .xsmall()
                    .ghost()
                    .label(t(label))
                    .selected(self.filter == kind)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.filter = kind.into();
                        this.cursor = 0;
                        this.search_full(false, cx);
                        cx.notify();
                    })),
            );
        }
        let mut list = v_flex()
            .gap_1()
            .px_2()
            .pb_3()
            .max_h(px(
                (f32::from(_window.bounds().size.height) * 0.8 - 156.).max(100.)
            ))
            .overflow_y_scrollbar();
        let query_active = !self.query.read(cx).value().trim().is_empty();
        let active_error = if query_active {
            &self.remote_error
        } else {
            &self.error
        };
        if let Some(error) = active_error {
            list = list.child(
                h_flex()
                    .p_3()
                    .gap_2()
                    .child(div().flex_1().text_color(theme.danger).child(t(error)))
                    .child(
                        Button::new("search-retry")
                            .small()
                            .ghost()
                            .label(t("重试"))
                            .on_click(cx.listener(|this, _, _, cx| {
                                if !this.query.read(cx).value().trim().is_empty() {
                                    this.search_full(false, cx);
                                } else {
                                    this.reload(cx);
                                }
                            })),
                    ),
            );
        }
        for (i, r) in results.iter().enumerate() {
            let row = r.clone();
            let preview = search_plain(&r.text);
            let preview: String = preview.chars().take(110).collect();
            list = list.child(
                h_flex()
                    .id(ElementId::Name(
                        format!("search-result-{}-{}", r.kind, r.id).into(),
                    ))
                    .w_full()
                    .min_h(px(68.))
                    .p(px(12.))
                    .gap(px(14.))
                    .items_center()
                    .rounded(px(10.))
                    .when(i == self.cursor, |d| d.bg(theme.accent))
                    .hover(|d| d.bg(theme.muted))
                    .cursor_pointer()
                    .child(Icon::new(record_icon(&r.kind)).size(px(19.)).text_color(
                        if i == self.cursor {
                            theme.primary
                        } else {
                            theme.muted_foreground
                        },
                    ))
                    .child(
                        v_flex()
                            .flex_1()
                            .min_w_0()
                            .gap(px(3.))
                            .child(
                                div()
                                    .text_size(crate::settings::body_px(13., cx))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_ellipsis()
                                    .child(if r.fallback_title {
                                        t(&r.title)
                                    } else {
                                        r.title.clone()
                                    }),
                            )
                            .child(
                                div()
                                    .text_size(crate::settings::body_px(11., cx))
                                    .line_height(relative(1.65))
                                    .text_color(theme.muted_foreground)
                                    .text_ellipsis()
                                    .child(preview),
                            ),
                    )
                    .child(
                        div()
                            .text_size(px(11.))
                            .text_color(theme.muted_foreground)
                            .child(t(KINDS
                                .iter()
                                .find(|x| x.0 == r.kind)
                                .map(|x| x.1)
                                .unwrap_or("记录"))),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| this.open(&row, cx))),
            );
        }

        if results.is_empty() {
            list = list.child(div().p_8().text_color(theme.muted_foreground).child(t(
                if self.loading || self.remote_loading {
                    "正在搜索…"
                } else {
                    "没有匹配的记录"
                },
            )));
        }
        if query_active && self.remote_has_more {
            list = list.child(
                Button::new("search-load-more")
                    .small()
                    .ghost()
                    .label(t("加载更多"))
                    .loading(self.remote_loading)
                    .disabled(self.remote_loading)
                    .on_click(cx.listener(|this, _, _, cx| this.search_full(true, cx))),
            );
        }
        v_flex()
            .id("workspace-search")
            .key_context("OpsTwinSearch")
            .w_full()
            .max_w(px(640.))
            .bg(theme.background)
            .rounded(px(22.))
            .px(px(14.))
            .pt(px(12.))
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, _, cx| {
                match event.keystroke.key.as_str() {
                    "down" => {
                        let n = this.results(cx).len();
                        if n > 0 {
                            this.cursor = (this.cursor + 1).min(n - 1);
                            cx.notify();
                        }
                    }
                    "up" => {
                        this.cursor = this.cursor.saturating_sub(1);
                        cx.notify();
                    }
                    "escape" => cx.emit(SearchEvent::Close),
                    _ => {}
                }
            }))
            .child(
                h_flex()
                    .px(px(10.))
                    .pt(px(12.))
                    .pb(px(18.))
                    .gap(px(12.))
                    .border_b_1()
                    .border_color(theme.border)
                    .child(
                        Icon::new(gpui_kit::assets::IconName::Search)
                            .size(px(22.))
                            .text_color(theme.muted_foreground),
                    )
                    .child(
                        div().flex_1().child(
                            Input::new(&self.query)
                                .appearance(false)
                                .bordered(false)
                                .focus_bordered(false)
                                .text_size(px(18.))
                                .font_weight(FontWeight::NORMAL),
                        ),
                    )
                    .child(
                        Button::new("search-close")
                            .xsmall()
                            .ghost()
                            .label("esc")
                            .on_click(cx.listener(|_, _, _, cx| cx.emit(SearchEvent::Close))),
                    ),
            )
            .when(!self.query.read(cx).value().trim().is_empty(), |d| {
                d.child(filters)
            })
            .child(
                div()
                    .px(px(10.))
                    .mt(px(16.))
                    .mb(px(8.))
                    .text_size(px(12.))
                    .text_color(theme.muted_foreground)
                    .child(if self.query.read(cx).value().trim().is_empty() {
                        t("最近")
                    } else {
                        t("{count} 条匹配记录").replace("{count}", &self.remote_total.to_string())
                    }),
            )
            .child(list)
            .child(
                h_flex()
                    .px_4()
                    .py_3()
                    .gap_5()
                    .border_t_1()
                    .border_color(theme.border)
                    .text_size(px(11.))
                    .text_color(theme.muted_foreground)
                    .child(t("↑ ↓ 选择"))
                    .child(t("↵ 打开"))
                    .child(div().flex_1())
                    .child(t("esc 关闭")),
            )
            .into_any_element()
    }
}

fn record_icon(kind: &str) -> gpui_kit::assets::IconName {
    use gpui_kit::assets::IconName as I;
    match kind {
        "messages" | "conversations" => I::MessageCircle,
        "inbox" => I::Inbox,
        "ideas" => I::Lightbulb,
        "tasks" => I::SquareCheck,
        "artifacts" => I::File,
        "memories" => I::Brain,
        "projects" => I::Folder,
        "automations" => I::Zap,
        _ => I::Search,
    }
}
fn search_plain(raw: &str) -> String {
    raw.lines()
        .filter(|line| !line.trim_start().starts_with("```"))
        .map(|line| {
            line.trim_start()
                .trim_start_matches('#')
                .trim_start_matches('>')
                .trim()
        })
        .collect::<Vec<_>>()
        .join(" ")
        .replace("**", "")
        .replace("__", "")
        .replace('`', "")
}
