//! Inbox page: paged list (`GET /api/inbox/query`) with Pending / All / Done
//! filters and search; detail with source messages and triage; draft editor
//! with conflict-safe save; draft generation; done / dismiss / reopen; send
//! (self-test items only) with a persisted idempotency key; undo.
//! Mirrors web/src/pages/Inbox.tsx semantics.
//!
//! Never logs bodies, drafts or receipts' content; only ids, counts and codes.

use chrono::{Datelike, Local};
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, IconName, Sizable as _,
    button::{Button, ButtonVariants as _},
    checkbox::Checkbox,
    h_flex,
    input::{Input, InputEvent, InputState, Textarea, TextareaState},
    scroll::ScrollableElement as _,
    v_flex,
};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use opstwin_api::inbox_product::InboxProduct;
use opstwin_api::{ApiError, Client, InboxItem, InboxQuery, InboxSummary};
use opstwin_store::{
    InboxEdit, InboxState, SendRecord, SendRecordState, Store, content_hash, now_ms,
};
use serde_json::json;
use std::collections::BTreeMap;

use crate::persist::Saver;
use crate::runtime::{io, sleep};
use crate::sync::{SyncEvent, SyncHub};
use crate::util::snippet;

const PAGE: u32 = 50;
/// Client-filtered views read server pages of this size.
const SCAN_PAGE: u32 = 100;

fn inbox_list_width(window: &Window) -> Pixels {
    px(if window.bounds().size.width <= px(1100.) {
        272.
    } else {
        300.
    })
}

// detail-scroll and its independent actions share the HTML outer-window breakpoints.
// Values are top, symmetric horizontal, bottom, and footer vertical padding.
fn inbox_detail_padding(window: &Window) -> (Pixels, Pixels, Pixels, Pixels) {
    let width = window.bounds().size.width;
    if width <= px(760.) {
        (px(20.), px(16.), px(20.), px(12.))
    } else if width <= px(1100.) {
        (px(24.), px(21.), px(24.), px(12.))
    } else {
        (px(26.), px(28.), px(24.), px(14.))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Filter {
    Pending,
    All,
    Quiet,
}

impl Filter {
    const ALL: [Filter; 3] = [Filter::Pending, Filter::All, Filter::Quiet];
    fn label(self) -> &'static str {
        match self {
            Filter::Pending => "待处理",
            Filter::All => "全部",
            Filter::Quiet => "安静记录",
        }
    }
    /// Pending = server default (needs attention, not done). All/Done read
    /// everything (`includeDone=true`); Done keeps done statuses client-side.
    fn include_done(self) -> bool {
        !matches!(self, Filter::Pending)
    }
    fn keep(self, s: &InboxSummary) -> bool {
        let _ = s;
        true
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Busy {
    Save,
    Generate,
    Status,
    Send,
    Undo,
    Candidate,
    Triage,
}

#[derive(Clone, Debug)]
pub enum InboxEvent {
    Inspiration {
        inbox_id: String,
        title: String,
        body: String,
    },
    OpenConversation {
        conversation_id: String,
    },
}
impl EventEmitter<InboxEvent> for InboxView {}

pub struct InboxView {
    client: Client,
    saver: Saver<InboxState>,
    state: InboxState,
    request_saver: Saver<BTreeMap<String, String>>,
    draft_requests: BTreeMap<String, String>,
    product: Option<InboxProduct>,
    editing: bool,
    show_analysis: bool,
    show_full_messages: bool,
    undo_status: Option<String>,
    auto_saver: Saver<BTreeMap<String, String>>,
    auto_attempted: BTreeMap<String, String>,
    auto_checking: bool,
    auto_visibility_generation: u64,
    auto_preparations: BTreeMap<String, (u64, u64)>,
    source_history: Option<Vec<serde_json::Value>>,
    source_offset: u64,
    source_more: bool,
    source_busy: bool,
    source_error: Option<String>,
    source_generation: u64,
    source_scroll: ScrollHandle,
    source_preview: Option<(String, String, Result<crate::files::SourcePreview, String>)>,
    source_preview_loading: bool,
    source_preview_generation: u64,

    filter: Filter,
    search: Entity<InputState>,
    placeholder_locale: String,
    items: Vec<InboxSummary>,
    list_presentations:
        BTreeMap<String, (Option<String>, Option<serde_json::Value>, Option<String>)>,
    total: u64,
    next_offset: u64,
    has_more: bool,
    loading: bool,
    load_error: Option<String>,
    list_gen: u64,

    selected: Option<String>,
    detail: Option<InboxItem>,
    detail_loading: bool,
    detail_error: Option<String>,
    detail_gen: u64,

    editor: Entity<TextareaState>,
    /// Server draft and version the editor content is based on.
    base_draft: String,
    base_updated_at: Option<String>,
    /// Server changed while local edits are unsaved.
    server_changed: bool,
    conflict: Option<InboxItem>,

    busy: Option<Busy>,
    progress: Option<String>,
    action_error: Option<String>,
    notice: Option<String>,
    /// Draft-generation requestId reused after an unknown outcome.
    draft_request: Option<(String, String)>,
    /// Send preconditions failed with `send_failed`: offer an explicit new key.
    send_needs_new_key: bool,
    sensitive_ok: bool,

    visible: bool,
    stale: bool,
    _subscriptions: Vec<Subscription>,
    _tasks: Vec<Task<()>>,
    _debounce: Option<Task<()>>,
    _search_debounce: Option<Task<()>>,
}

impl InboxView {
    pub fn new(
        client: Client,
        hub: Entity<SyncHub>,
        store: Store,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let state: InboxState = store.load(opstwin_store::INBOX_FILE);
        eprintln!(
            "[opstwin] inbox restore: edits={} sendKeys={}",
            state.edits.len(),
            state.sends.len()
        );
        let draft_requests: BTreeMap<String, String> = store.load("inbox-requests.json");
        let request_saver = Saver::new(store.clone(), "inbox-requests.json");
        let mut auto_attempted: BTreeMap<String, String> = store.load("inbox-auto-attempts.json");
        // A marker without a durable request cannot represent a submitted
        // generation. Recover a quit/crash between preparation and submission.
        auto_attempted.retain(|id, _| draft_requests.contains_key(id));
        let auto_saver = Saver::new(store.clone(), "inbox-auto-attempts.json");
        let saver = Saver::new(store, opstwin_store::INBOX_FILE);
        let search =
            cx.new(|cx| InputState::new(window, cx).placeholder(crate::settings::t("搜索收件箱")));
        let editor = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(4, 16)
                .placeholder(crate::settings::t("回复草稿（保存后才能发送）"))
        });
        let subscriptions = vec![
            cx.subscribe_in(
                &hub,
                window,
                |this, _, ev: &SyncEvent, window, cx| match ev {
                    SyncEvent::Revision
                    | SyncEvent::Connected {
                        was_down: true,
                        first: false,
                        ..
                    } => this.on_server_change(window, cx),
                    _ => {}
                },
            ),
            cx.subscribe_in(&search, window, |this, _, ev: &InputEvent, window, cx| {
                if matches!(ev, InputEvent::Change | InputEvent::PressEnter { .. }) {
                    this._search_debounce = Some(cx.spawn_in(window, async move |this, cx| {
                        sleep(300).await;
                        _ = this.update_in(cx, |this, window, cx| this.reload(window, cx));
                    }));
                }
            }),
            cx.subscribe_in(&editor, window, |this, _, ev: &InputEvent, _, cx| {
                if matches!(ev, InputEvent::Change) {
                    this.on_editor_change(cx);
                }
            }),
        ];
        let mut this = Self {
            client,
            saver,
            state,
            request_saver,
            draft_requests,
            product: None,
            editing: false,
            show_analysis: false,
            show_full_messages: false,
            undo_status: None,
            auto_saver,
            auto_attempted,
            auto_checking: false,
            auto_visibility_generation: 0,
            auto_preparations: BTreeMap::new(),
            source_history: None,
            source_offset: 0,
            source_more: false,
            source_busy: false,
            source_error: None,
            source_generation: 0,
            source_scroll: ScrollHandle::default(),
            source_preview: None,
            source_preview_loading: false,
            source_preview_generation: 0,
            filter: Filter::Pending,
            search,
            placeholder_locale: crate::settings::t("搜索收件箱"),
            items: Vec::new(),
            list_presentations: BTreeMap::new(),
            total: 0,
            next_offset: 0,
            has_more: false,
            loading: false,
            load_error: None,
            list_gen: 0,
            selected: None,
            detail: None,
            detail_loading: false,
            detail_error: None,
            detail_gen: 0,
            editor,
            base_draft: String::new(),
            base_updated_at: None,
            server_changed: false,
            conflict: None,
            busy: None,
            progress: None,
            action_error: None,
            notice: None,
            draft_request: None,
            send_needs_new_key: false,
            sensitive_ok: false,
            visible: false,
            stale: false,
            _subscriptions: subscriptions,
            _tasks: Vec::new(),
            _debounce: None,
            _search_debounce: None,
        };
        this.reload(window, cx);
        this
    }

    pub fn set_visible(&mut self, visible: bool, cx: &mut Context<Self>) {
        if self.visible != visible {
            self.auto_visibility_generation += 1;
            self.auto_checking = false;
            self.stale = true;
            if !visible {
                self.auto_preparations.clear();
                self.auto_attempted
                    .retain(|id, _| self.draft_requests.contains_key(id));
                self.auto_saver.save(self.auto_attempted.clone());
            }
        }
        self.visible = visible;
        if visible && self.stale {
            // No window here; `render` performs the deferred reload.
            cx.notify();
        }
    }

    pub fn persist_blocking(&self) {
        self.saver.save_blocking(&self.state);
        self.request_saver.save_blocking(&self.draft_requests);
        let mut submitted_attempts = self.auto_attempted.clone();
        submitted_attempts.retain(|id, _| self.draft_requests.contains_key(id));
        self.auto_saver.save_blocking(&submitted_attempts);
    }

    fn on_server_change(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.visible {
            self.stale = true;
            return;
        }
        self._debounce = Some(cx.spawn_in(window, async move |this, cx| {
            sleep(400).await;
            _ = this.update_in(cx, |this, window, cx| {
                if !this.visible {
                    this.stale = true;
                    return;
                }
                this.refresh_list(window, cx);
                this.reload_detail(window, cx);
            });
        }));
    }

    // ---------------------------------------------------------------- listing

    fn reload(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.load_from(0, false, window, cx);
    }

    /// Re-read the rows currently shown without resetting the scroll.
    fn refresh_list(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.load_from(0, true, window, cx);
    }

    fn load_from(
        &mut self,
        offset: u64,
        keep_count: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.list_gen += 1;
        let generation = self.list_gen;
        self.loading = true;
        cx.notify();
        let client = self.client.clone();
        let filter = self.filter;
        let query = self.search.read(cx).value().to_string();
        let want = if keep_count {
            self.items.len().clamp(PAGE as usize, 400)
        } else {
            PAGE as usize
        };
        let task = cx.spawn_in(window, async move |this, cx| {
            let result = io(async move {
                // Done is filtered client-side, so scan server pages until
                // enough rows match (bounded).
                let mut rows = Vec::new();
                let mut off = offset;
                let mut last = None;
                for _ in 0..10 {
                    let limit = if filter == Filter::Quiet { SCAN_PAGE } else { (want as u32).min(200) };
                    let page = if filter == Filter::Quiet {
                        client.inbox_quiet_query(&query, off, limit).await?
                    } else { client
                        .inbox_query(&InboxQuery {
                            query: query.clone(),
                            status: None,
                            include_done: filter.include_done(),
                            offset: off,
                            limit,
                        })
                        .await? };
                    rows.extend(page.items.iter().filter(|s| filter.keep(s)).cloned());
                    off = page.next_offset;
                    let more = page.has_more;
                    last = Some(page);
                    if rows.len() >= want || !more {
                        break;
                    }
                }
                let mut presentations = BTreeMap::new();
                for row in &rows {
                    if let Ok(product) = client.inbox_product(&row.id).await {
                        let summary = product.messages.iter().filter(|m| m["type"]!="recalled" && !(m["type"]=="system" && m["text"].as_str().is_none_or(|text|text.trim().is_empty())))
                            .last().and_then(|m|m["text"].as_str()).filter(|text|!text.trim().is_empty()).map(|text|snippet(text,130));
                        presentations.insert(row.id.clone(), (product.avatar_url, product.triage, summary));
                    }
                }
                Ok::<_, ApiError>((rows, last, off, presentations))
            })
            .await;
            _ = this.update_in(cx, |this, window, cx| {
                if this.list_gen != generation {
                    return;
                }
                this.loading = false;
                match result {
                    Ok((rows, last, off, presentations)) => {
                        this.list_presentations.extend(presentations);
                        if offset == 0 {
                            this.items = rows;
                        } else {
                            this.items.extend(rows);
                        }
                        if let Some(p) = last {
                            this.total = p.total;
                            this.has_more = p.has_more;
                        }
                        this.next_offset = off;
                        this.load_error = None;
                        if this.selected.as_ref().is_none_or(|id|!this.items.iter().any(|item|&item.id==id)) {
                            if let Some(id) = this.items.first().map(|item|item.id.clone()) {this.select(id,window,cx);} else {this.selected=None;this.detail=None;this.product=None;}
                        }
                        eprintln!(
                            "[opstwin] inbox loaded {} rows (serverTotal={} hasMore={} filter={:?})",
                            this.items.len(),
                            this.total,
                            this.has_more,
                            filter
                        );
                    }
                    Err(e) => {
                        eprintln!("[opstwin] inbox load failed: {e}");
                        this.load_error = Some(e.user_text());
                    }
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
    }

    fn set_filter(&mut self, f: Filter, window: &mut Window, cx: &mut Context<Self>) {
        if self.busy.is_none() && self.filter != f {
            self.filter = f;
            self.items.clear();
            self.reload(window, cx);
        }
    }

    // ----------------------------------------------------------------- detail

    fn select(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected.as_deref() == Some(id.as_str()) {
            return;
        }
        if self.busy.is_some() {
            self.action_error = Some(crate::settings::t("请等待当前操作完成"));
            cx.notify();
            return;
        }
        self.draft_request = self
            .draft_requests
            .get(&id)
            .cloned()
            .map(|rid| (id.clone(), rid));
        self.selected = Some(id);
        self.source_scroll.set_offset(point(px(0.), px(0.)));
        self.product = None;
        self.auto_checking = false;
        self.source_history = None;
        self.source_more = false;
        self.source_busy = false;
        self.source_error = None;
        self.source_generation += 1;
        self.source_preview = None;
        self.source_preview_loading = false;
        self.source_preview_generation += 1;
        self.editing = false;
        self.show_analysis = false;
        self.show_full_messages = false;
        self.detail = None;
        self.conflict = None;
        self.server_changed = false;
        self.action_error = None;
        self.notice = None;
        self.progress = None;
        self.send_needs_new_key = false;
        self.sensitive_ok = false;
        self.editor.update(cx, |s, cx| s.set_value("", window, cx));
        self.base_draft.clear();
        self.base_updated_at = None;
        self.reload_detail(window, cx);
    }

    fn reload_detail(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.selected.clone() else {
            return;
        };
        self.detail_gen += 1;
        let generation = self.detail_gen;
        self.detail_loading = true;
        self.auto_checking = false;
        cx.notify();
        let client = self.client.clone();
        let task = cx.spawn_in(window, async move |this, cx| {
            let fid = id.clone();
            let result = io(async move { client.inbox_product(&fid).await }).await;
            _ = this.update_in(cx, |this, window, cx| {
                if this.detail_gen != generation || this.selected.as_deref() != Some(id.as_str()) {
                    return;
                }
                this.detail_loading = false;
                match result {
                    Ok(product) => {
                        this.detail_error = None;
                        this.apply_server_item(product.item.clone(), window, cx);
                        this.product = Some(product.clone());
                        if this.source_history.is_none() && !this.source_busy {
                            this.load_source_history(false, window, cx);
                        }
                        this.maybe_auto_draft(product, window, cx);
                    }
                    Err(e) => {
                        eprintln!("[opstwin] inbox item {id} load failed: {e}");
                        this.detail_error = Some(e.user_text());
                    }
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
    }

    fn maybe_auto_draft(
        &mut self,
        product: InboxProduct,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let id = product.item.id.clone();
        if !self.visible
            || self.busy.is_some()
            || self.auto_checking
            || self.is_dirty(cx)
            || self.editing
            || self.auto_attempted.contains_key(&id)
            || self.draft_requests.contains_key(&id)
            || self.state.edits.contains_key(&id)
        {
            return;
        }
        self.auto_checking = true;
        let client = self.client.clone();
        let version = product.item.updated_at.clone();
        let generation = self.detail_gen;
        let visibility_generation = self.auto_visibility_generation;
        self._tasks.push(cx.spawn_in(window, async move |this, cx| {
            let allowed = io(async move { client.inbox_auto_draft_allowed(&product).await }).await;
            let mut durable = None;
            _ = this.update_in(cx, |this, _, cx| {
                if !this.visible
                    || this.auto_visibility_generation != visibility_generation
                    || this.detail_gen != generation
                    || this.selected.as_deref() != Some(id.as_str())
                {
                    return;
                }
                this.auto_checking = false;
                if !matches!(allowed, Ok(true))
                    || this.busy.is_some()
                    || this.is_dirty(cx)
                    || this.editing
                    || this.detail.as_ref().is_none_or(|item| {
                        item.updated_at != version
                            || item.draft.as_ref().is_some_and(|s| !s.trim().is_empty())
                    })
                {
                    return;
                }
                this.auto_attempted
                    .insert(id.clone(), version.clone().unwrap_or_default());
                this.auto_preparations
                    .insert(id.clone(), (generation, visibility_generation));
                durable = Some(this.auto_saver.save_now(this.auto_attempted.clone()));
            });
            let Some(durable) = durable else {
                return;
            };
            let saved = io(durable).await;
            _ = this.update_in(cx, |this, window, cx| {
                if !this.visible
                    || this.auto_visibility_generation != visibility_generation
                    || this.detail_gen != generation
                    || this.selected.as_deref() != Some(id.as_str())
                {
                    if this.discard_unstarted_auto_attempt(
                        &id,
                        &version,
                        generation,
                        visibility_generation,
                    ) && this.visible
                        && this.selected.as_deref() == Some(id.as_str())
                    {
                        this.stale = true;
                        cx.notify();
                    }
                    return;
                }
                if let Err(error) = saved {
                    this.discard_unstarted_auto_attempt(
                        &id,
                        &version,
                        generation,
                        visibility_generation,
                    );
                    this.action_error = Some(
                        crate::settings::t("无法保存自动起草状态，未运行：{error}")
                            .replace("{error}", &error),
                    );
                } else if this.busy.is_none() && !this.is_dirty(cx) && !this.editing {
                    this.auto_preparations.remove(&id);
                    this.generate_draft(window, cx);
                } else {
                    this.discard_unstarted_auto_attempt(
                        &id,
                        &version,
                        generation,
                        visibility_generation,
                    );
                }
                cx.notify();
            });
        }));
    }

    fn discard_unstarted_auto_attempt(
        &mut self,
        id: &str,
        version: &Option<String>,
        generation: u64,
        visibility_generation: u64,
    ) -> bool {
        if self.auto_preparations.get(id) == Some(&(generation, visibility_generation))
            && !self.draft_requests.contains_key(id)
            && self.auto_attempted.get(id).map(String::as_str)
                == Some(version.as_deref().unwrap_or_default())
        {
            self.auto_attempted.remove(id);
            self.auto_preparations.remove(id);
            self.auto_saver.save(self.auto_attempted.clone());
            true
        } else {
            false
        }
    }

    fn load_source_history(&mut self, older: bool, window: &mut Window, cx: &mut Context<Self>) {
        let Some(product) = &self.product else {
            return;
        };
        let Some(source_id) = product
            .source_id
            .clone()
            .filter(|_| product.item.id.starts_with("chat-"))
        else {
            return;
        };
        if self.source_busy {
            return;
        }
        self.source_busy = true;
        self.source_error = None;
        self.source_generation += 1;
        let generation = self.source_generation;
        let selected = self.selected.clone();
        let offset = if older { self.source_offset } else { 0 };
        let limit = if self.show_full_messages { 80 } else { 20 };
        let client = self.client.clone();
        self._tasks.push(cx.spawn_in(window, async move |this, cx| {
            let result =
                io(async move { client.inbox_source_history(&source_id, offset, limit).await })
                    .await;
            _ = this.update_in(cx, |this, _, cx| {
                if this.source_generation != generation || this.selected != selected {
                    return;
                }
                this.source_busy = false;
                match result {
                    Ok(page) => {
                        let mut messages = page.messages;
                        messages.reverse();
                        if older {
                            messages.extend(this.source_history.take().unwrap_or_default());
                        }
                        let mut seen = std::collections::BTreeSet::new();
                        messages.retain(|m| {
                            m["id"]
                                .as_str()
                                .is_none_or(|id| seen.insert(id.to_string()))
                        });
                        this.source_history = Some(messages);
                        this.source_offset = page.next_offset;
                        this.source_more = page.has_more;
                    }
                    Err(error) => this.source_error = Some(error.user_text()),
                }
                cx.notify();
            });
        }));
        cx.notify();
    }

    fn preview_source(
        &mut self,
        title: String,
        url: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.source_preview_generation += 1;
        let generation = self.source_preview_generation;
        self.source_preview_loading = true;
        self.source_preview = Some((
            title.clone(),
            url.clone(),
            Err(crate::settings::t("正在读取预览…")),
        ));
        let client = self.client.clone();
        self._tasks.push(cx.spawn_in(window, async move |this, cx| {
            let request_url = url.clone();
            let result =
                io(async move { crate::files::preview_source(client, request_url).await }).await;
            _ = this.update_in(cx, |this, _, cx| {
                if this.source_preview_generation != generation {
                    return;
                }
                this.source_preview_loading = false;
                this.source_preview = Some((title, url, result));
                cx.notify();
            });
        }));
        cx.notify();
    }

    pub fn open_item(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        self.select(id, window, cx);
    }

    fn apply_candidate(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(product) = self.product.clone() else {
            return;
        };
        let Some(candidate) = product.draft_candidate else {
            return;
        };
        if self.is_dirty(cx) || product.item.send_locked() || !self.begin(Busy::Candidate, cx) {
            return;
        }
        let client = self.client.clone();
        self._tasks.push(cx.spawn_in(window, async move |this, cx| {
            let result = io(async move {
                client
                    .inbox_apply_candidate(
                        &product.item.id,
                        &candidate.request_id,
                        product.item.updated_at.as_deref(),
                    )
                    .await
            })
            .await;
            _ = this.update_in(cx, |this, window, cx| {
                this.busy = None;
                match result {
                    Ok(result) => {
                        this.apply_server_item(result.item, window, cx);
                        this.notice =
                            Some(crate::settings::t("已采用审阅后的候选，发送前请再次确认"));
                    }
                    Err(error) => {
                        this.action_error = Some(if error.is_edit_conflict() {
                            crate::settings::t("草稿再次发生变化，请重新审阅最新候选与草稿")
                        } else {
                            error.user_text()
                        })
                    }
                }
                this.reload_detail(window, cx);
                cx.notify();
            });
        }));
    }

    fn retry_triage(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.selected.clone() else {
            return;
        };
        if !self.begin(Busy::Triage, cx) {
            return;
        }
        let client = self.client.clone();
        self._tasks.push(cx.spawn_in(window, async move |this, cx| {
            let result = io(async move { client.inbox_triage(&id, true).await }).await;
            _ = this.update_in(cx, |this, window, cx| {
                this.busy = None;
                if let Err(error) = result {
                    this.action_error = Some(error.user_text());
                }
                this.reload_detail(window, cx);
                cx.notify();
            });
        }));
    }

    fn reopen_previous(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.undo_status.clone() else {
            return;
        };
        if !self.begin(Busy::Status, cx) {
            return;
        }
        let client = self.client.clone();
        self._tasks.push(cx.spawn_in(window, async move |this, cx| {
            let result = io(async move {
                let latest = client.inbox_item(&id).await?;
                if !matches!(latest.status.as_str(), "done" | "dismissed") {
                    return Err(ApiError::Api {
                        status: 409,
                        code: "changed_status".into(),
                        message: crate::settings::t("状态已改变，请在全部记录中查看"),
                        detail: None,
                    });
                }
                client
                    .inbox_patch(
                        &id,
                        json!({"status":"pending","baseUpdatedAt":latest.updated_at}),
                    )
                    .await
            })
            .await;
            _ = this.update_in(cx, |this, window, cx| {
                this.busy = None;
                match result {
                    Ok(item) => {
                        this.undo_status = None;
                        this.selected = None;
                        this.select(item.id, window, cx);
                        this.refresh_list(window, cx);
                    }
                    Err(error) => this.action_error = Some(error.user_text()),
                }
                cx.notify();
            });
        }));
    }

    fn is_dirty(&self, cx: &App) -> bool {
        self.editor.read(cx).value().as_ref() != self.base_draft
    }

    /// Adopt a fresh server item without clobbering unsaved edits.
    fn apply_server_item(&mut self, item: InboxItem, window: &mut Window, cx: &mut Context<Self>) {
        let server_draft = item.draft.clone().unwrap_or_default();
        let first_load = self
            .detail
            .as_ref()
            .map(|d| d.id != item.id)
            .unwrap_or(true);
        if first_load {
            // Restore a persisted local edit, if any.
            if let Some(edit) = self.state.edits.get(&item.id).cloned() {
                self.base_draft = edit.base_draft.clone();
                self.base_updated_at = edit.base_updated_at.clone();
                self.editor
                    .update(cx, |s, cx| s.set_value(edit.text.clone(), window, cx));
                self.server_changed = edit.base_updated_at != item.updated_at;
                if edit.text == self.base_draft {
                    self.state.edits.remove(&item.id);
                    self.saver.save(self.state.clone());
                }
            } else {
                self.base_draft = server_draft.clone();
                self.base_updated_at = item.updated_at.clone();
                self.editor
                    .update(cx, |s, cx| s.set_value(server_draft.clone(), window, cx));
            }
        } else if self.is_dirty(cx) {
            if item.updated_at != self.base_updated_at {
                self.server_changed = true;
            }
        } else {
            let current = self.editor.read(cx).value().to_string();
            if current != server_draft {
                self.editor
                    .update(cx, |s, cx| s.set_value(server_draft.clone(), window, cx));
            }
            self.base_draft = server_draft;
            self.base_updated_at = item.updated_at.clone();
            self.server_changed = false;
        }
        // Keep the list row in step with the detail.
        if let Some(row) = self.items.iter_mut().find(|r| r.id == item.id) {
            row.status = item.status.clone();
            row.title = item.title.clone();
            row.draft = item.draft.clone();
            row.updated_at = item.updated_at.clone();
        }
        self.detail = Some(item);
    }

    fn on_editor_change(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.detail.as_ref().map(|d| d.id.clone()) else {
            return;
        };
        let text = self.editor.read(cx).value().to_string();
        if text == self.base_draft {
            if self.state.edits.remove(&id).is_some() {
                self.saver.save(self.state.clone());
            }
        } else {
            self.state.edits.insert(
                id,
                InboxEdit {
                    text,
                    base_updated_at: self.base_updated_at.clone(),
                    base_draft: self.base_draft.clone(),
                    saved_at_ms: now_ms(),
                },
            );
            self.saver.save(self.state.clone());
        }
        cx.notify();
    }

    fn discard_edits(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(item) = self.detail.clone() else {
            return;
        };
        self.state.edits.remove(&item.id);
        self.saver.save(self.state.clone());
        let server_draft = item.draft.clone().unwrap_or_default();
        self.editor
            .update(cx, |s, cx| s.set_value(server_draft.clone(), window, cx));
        self.base_draft = server_draft;
        self.base_updated_at = item.updated_at.clone();
        self.server_changed = false;
        self.conflict = None;
        // Re-read so the editor reflects the latest server draft.
        self.reload_detail(window, cx);
    }

    // ---------------------------------------------------------------- actions

    fn begin(&mut self, busy: Busy, cx: &mut Context<Self>) -> bool {
        if self.busy.is_some() {
            return false;
        }
        self.busy = Some(busy);
        self.action_error = None;
        self.notice = None;
        cx.notify();
        true
    }

    fn save_draft(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(item) = self.detail.clone() else {
            return;
        };
        if item.send_locked() {
            self.action_error = Some(crate::settings::t("已外发或结果未知的消息内容已冻结"));
            cx.notify();
            return;
        }
        if !self.begin(Busy::Save, cx) {
            return;
        }
        let text = self.editor.read(cx).value().to_string();
        let base = self.base_updated_at.clone();
        let client = self.client.clone();
        let id = item.id.clone();
        let task = cx.spawn_in(window, async move |this, cx| {
            let sent_text = text.clone();
            let result = io(async move {
                let mut body = json!({ "draft": sent_text, "editedByUser": true });
                if let Some(b) = base {
                    body["baseUpdatedAt"] = json!(b);
                }
                client.inbox_patch(&id, body).await
            })
            .await;
            _ = this.update_in(cx, |this, window, cx| {
                this.busy = None;
                match result {
                    Ok(saved) => {
                        eprintln!("[opstwin] inbox {} draft saved", saved.id);
                        this.state.edits.remove(&saved.id);
                        this.saver.save(this.state.clone());
                        this.conflict = None;
                        this.server_changed = false;
                        let server_draft = saved.draft.clone().unwrap_or_default();
                        this.base_draft = server_draft.clone();
                        this.base_updated_at = saved.updated_at.clone();
                        // Only replace the editor if the user did not type meanwhile.
                        if this.editor.read(cx).value().as_ref() == text {
                            this.editor
                                .update(cx, |s, cx| s.set_value(server_draft, window, cx));
                        }
                        this.detail = Some(saved);
                        this.notice =
                            Some(crate::settings::t("草稿已保存（需重新批准后才能发送）"));
                    }
                    Err(e) if e.is_edit_conflict() => {
                        eprintln!("[opstwin] inbox draft save edit_conflict");
                        this.conflict = e
                            .detail()
                            .and_then(|d| d.get("entity"))
                            .and_then(|v| serde_json::from_value::<InboxItem>(v.clone()).ok());
                        this.action_error = Some(crate::settings::t(
                            "此事项已在其他地方更新，请选择保留哪一版",
                        ));
                        if this.conflict.is_none() {
                            this.reload_detail(window, cx);
                        }
                    }
                    Err(e) => {
                        eprintln!("[opstwin] inbox draft save failed: {e}");
                        this.action_error = Some(
                            crate::settings::t("保存失败：{error}（本地修改已保留）")
                                .replace("{error}", &e.user_text()),
                        );
                    }
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
    }

    fn conflict_keep_mine(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(server) = self.conflict.take() else {
            return;
        };
        self.base_updated_at = server.updated_at.clone();
        self.base_draft = server.draft.clone().unwrap_or_default();
        self.server_changed = false;
        if let Some(edit) = self
            .detail
            .as_ref()
            .and_then(|d| self.state.edits.get_mut(&d.id))
        {
            edit.base_updated_at = self.base_updated_at.clone();
            edit.base_draft = self.base_draft.clone();
        }
        self.detail = Some(server);
        self.save_draft(window, cx);
    }

    fn conflict_take_server(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(server) = self.conflict.take() {
            self.detail = Some(server);
        }
        self.action_error = None;
        self.discard_edits(window, cx);
    }

    fn generate_draft(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(item) = self.detail.clone() else {
            return;
        };
        if self.is_dirty(cx) {
            self.action_error = Some(crate::settings::t("请先保存或放弃本地修改，再生成草稿"));
            cx.notify();
            return;
        }
        if item.send_locked() {
            self.action_error = Some(crate::settings::t("已外发或结果未知的事项不能改写"));
            cx.notify();
            return;
        }
        if !self.begin(Busy::Generate, cx) {
            return;
        }
        // Reuse the request id after an unknown outcome for the same item.
        let request_id = match &self.draft_request {
            Some((iid, rid)) if *iid == item.id => rid.clone(),
            _ => {
                let rid = format!("native-draft-{}", uuid_simple());
                self.draft_request = Some((item.id.clone(), rid.clone()));
                self.draft_requests.insert(item.id.clone(), rid.clone());
                rid
            }
        };
        self.progress = Some(crate::settings::t(
            "正在生成草稿…（模型运行可能需要几分钟）",
        ));
        cx.notify();
        let client = self.client.clone();
        let id = item.id.clone();
        eprintln!("[opstwin] inbox {id} generate draft request={request_id}");
        let durable = self.request_saver.save_now(self.draft_requests.clone());
        let task = cx.spawn_in(window, async move |this, cx| {
            if let Err(e) = io(durable).await {
                _ = this.update_in(cx, |this, _, cx| {
                    this.busy = None;
                    this.progress = None;
                    this.action_error = Some(
                        crate::settings::t("无法保存生成请求，未运行：{error}")
                            .replace("{error}", &e),
                    );
                    cx.notify();
                });
                return;
            }
            let mut waits = 0u32;
            loop {
                let (c, i, r) = (client.clone(), id.clone(), request_id.clone());
                let result = io(async move { c.inbox_generate_draft(&i, &r).await }).await;
                match result {
                    Err(e) if e.is_in_progress() && waits < 400 => {
                        waits += 1;
                        _ = this.update_in(cx, |this, _, cx| {
                            this.progress = Some(
                                crate::settings::t("草稿仍在生成，等待原运行结束…（{seconds}s）")
                                    .replace("{seconds}", &(waits * 3).to_string()),
                            );
                            cx.notify();
                        });
                        sleep(3000).await;
                        continue;
                    }
                    other => {
                        _ = this.update_in(cx, |this, window, cx| {
                            this.busy = None;
                            this.progress = None;
                            match other {
                                Ok(res) => {
                                    eprintln!(
                                        "[opstwin] inbox {} draft generated (replayed={} run={})",
                                        res.item.id,
                                        res.replayed,
                                        res.run.as_ref().map(|r| r.id.as_str()).unwrap_or("-")
                                    );
                                    this.draft_request = None;
                                    this.draft_requests.remove(&res.item.id);
                                    this.request_saver.save(this.draft_requests.clone());
                                    if this.selected.as_deref() == Some(res.item.id.as_str()) {
                                        this.apply_server_item(res.item, window, cx);
                                        this.notice =
                                            Some(crate::settings::t("草稿已生成，请审阅后再发送"));
                                        this.reload_detail(window, cx);
                                    }
                                }
                                Err(e) => {
                                    eprintln!("[opstwin] inbox draft generation failed: {e}");
                                    if !e.outcome_unknown() {
                                        this.draft_request = None;
                                        this.draft_requests.remove(&id);
                                        this.request_saver.save(this.draft_requests.clone());
                                    }
                                    let hint = if e.outcome_unknown() {
                                        crate::settings::t("（重试将沿用原请求，不会重复生成）")
                                    } else {
                                        String::new()
                                    };
                                    this.action_error =
                                        Some(if e.code() == Some("draft_review_required") {
                                            crate::settings::t(
                                                "并发修改已保留。新候选在下方，审阅后可明确采用",
                                            )
                                        } else {
                                            format!(
                                                "{}{}{hint}",
                                                crate::settings::t("生成失败："),
                                                e.user_text()
                                            )
                                        });
                                    this.reload_detail(window, cx);
                                }
                            }
                            cx.notify();
                        });
                        return;
                    }
                }
            }
        });
        self._tasks.push(task);
    }

    fn set_status(&mut self, status: &'static str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(item) = self.detail.clone() else {
            return;
        };
        if item.send_locked() {
            self.action_error = Some(crate::settings::t(
                "已有发送结果的状态只能通过回读或撤回更新",
            ));
            cx.notify();
            return;
        }
        if !self.begin(Busy::Status, cx) {
            return;
        }
        let client = self.client.clone();
        let id = item.id.clone();
        let base = item.updated_at.clone();
        let task = cx.spawn_in(window, async move |this, cx| {
            let result = io(async move {
                let mut body = json!({ "status": status });
                if let Some(b) = base {
                    body["baseUpdatedAt"] = json!(b);
                }
                client.inbox_patch(&id, body).await
            })
            .await;
            _ = this.update_in(cx, |this, window, cx| {
                this.busy = None;
                match result {
                    Ok(saved) => {
                        eprintln!("[opstwin] inbox {} status -> {}", saved.id, saved.status);
                        this.notice = Some(match status {
                            "pending" => crate::settings::t("已放回收件箱"),
                            "dismissed" => crate::settings::t("已忽略，可在「全部」中重新打开"),
                            _ => crate::settings::t("已标记完成"),
                        });
                        let completed_id = saved.id.clone();
                        this.apply_server_item(saved, window, cx);
                        if status == "dismissed" || status == "done" {
                            this.undo_status = Some(completed_id.clone());
                            if this.filter == Filter::Pending {
                                let next = this
                                    .items
                                    .iter()
                                    .position(|i| i.id == completed_id)
                                    .and_then(|pos| {
                                        this.items.get(pos + 1).or_else(|| this.items[..pos].last())
                                    })
                                    .map(|i| i.id.clone());
                                this.items.retain(|i| i.id != completed_id);
                                this.selected = None;
                                this.detail = None;
                                this.product = None;
                                if let Some(next) = next {
                                    this.select(next, window, cx);
                                }
                            }
                        }
                        this.refresh_list(window, cx);
                    }
                    Err(e) => {
                        eprintln!("[opstwin] inbox status change failed: {e}");
                        this.action_error = Some(if e.is_edit_conflict() {
                            crate::settings::t("此事项已在其他地方更新，已重新读取，请确认后再操作")
                        } else {
                            format!("{}{}", crate::settings::t("操作失败："), e.user_text())
                        });
                        this.reload_detail(window, cx);
                    }
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
    }

    /// Choose the idempotency key for sending `draft` of `item`, persisting a
    /// new one when needed. Returns `None` if a fresh key requires explicit
    /// user confirmation.
    fn send_key_for(&mut self, item: &InboxItem, draft: &str, force_new: bool) -> Option<String> {
        let hash = content_hash(draft);
        if let Some(server_key) = item.send_key.clone().filter(|_| item.send_locked()) {
            // Server already holds an outbound intent: always read back with it.
            self.state.sends.insert(
                item.id.clone(),
                SendRecord {
                    key: server_key.clone(),
                    draft_hash: hash,
                    state: SendRecordState::Pending,
                    receipt_ids: vec![],
                    updated_at_ms: now_ms(),
                },
            );
            return Some(server_key);
        }
        if let Some(rec) = self.state.sends.get(&item.id) {
            let reusable = matches!(rec.state, SendRecordState::Pending | SendRecordState::Sent)
                && (rec.draft_hash == hash || item.send_locked());
            if reusable && !force_new {
                return Some(rec.key.clone());
            }
            if rec.state == SendRecordState::Failed && !force_new {
                return None;
            }
        }
        let key = opstwin_api::new_idempotency_key();
        self.state.sends.insert(
            item.id.clone(),
            SendRecord {
                key: key.clone(),
                draft_hash: hash,
                state: SendRecordState::Pending,
                receipt_ids: vec![],
                updated_at_ms: now_ms(),
            },
        );
        Some(key)
    }

    fn send(&mut self, force_new_key: bool, window: &mut Window, cx: &mut Context<Self>) {
        let Some(item) = self.detail.clone() else {
            return;
        };
        if !item.can_send() {
            self.action_error = Some(crate::settings::t(
                "导入的消息只能在这里起草；发送仅限有 OPSADV-QA 标记的本人测试项",
            ));
            cx.notify();
            return;
        }
        if self.is_dirty(cx) {
            self.action_error = Some(crate::settings::t("请先保存或放弃本地修改再发送"));
            cx.notify();
            return;
        }
        let draft = item.draft.clone().unwrap_or_default();
        if draft.trim().is_empty() && !item.send_locked() {
            self.action_error = Some(crate::settings::t("请先生成或填写草稿"));
            cx.notify();
            return;
        }
        if item.sensitive && !self.sensitive_ok && !item.send_locked() {
            self.action_error = Some(crate::settings::t("敏感内容需要先勾选明确批准"));
            cx.notify();
            return;
        }
        let Some(key) = self.send_key_for(&item, &draft, force_new_key) else {
            self.send_needs_new_key = true;
            self.action_error = Some(crate::settings::t(
                "上次发送已被服务器判定失败；确认无回执后可用新幂等键重新发送",
            ));
            cx.notify();
            return;
        };
        if !self.begin(Busy::Send, cx) {
            return;
        }
        self.send_needs_new_key = false;
        self.progress = Some(crate::settings::t("正在保存发送凭据…"));
        let persisted = self.saver.save_now(self.state.clone());
        let client = self.client.clone();
        let id = item.id.clone();
        let sensitive = item.sensitive;
        eprintln!("[opstwin] inbox {id} send begin key={key}");
        let task = cx.spawn_in(window, async move |this, cx| {
            // 1. The key must be durable before any external effect.
            if let Err(e) = io(persisted).await {
                _ = this.update_in(cx, |this, _, cx| {
                    this.busy = None;
                    this.progress = None;
                    this.action_error = Some(
                        crate::settings::t("无法保存发送凭据（{error}），未发送")
                            .replace("{error}", &e),
                    );
                    cx.notify();
                });
                return;
            }
            _ = this.update_in(cx, |this, _, cx| {
                this.progress = Some(crate::settings::t("正在回读最新状态…"));
                cx.notify();
            });
            let (c, i, k, d) = (client.clone(), id.clone(), key.clone(), draft.clone());
            let outcome = io(async move {
                // 2. Re-read before every attempt (also after a lost response).
                let latest = c.inbox_item(&i).await?;
                if matches!(latest.status.as_str(), "sent" | "delivered")
                    && latest.receipt.is_some()
                {
                    return Ok(SendOutcome::AlreadySent(latest));
                }
                if !latest.send_locked() {
                    // Payload changed on the server since we looked: stop.
                    if latest.draft.clone().unwrap_or_default() != d {
                        return Ok(SendOutcome::Changed(latest));
                    }
                    // 3. Approve the exact saved draft (web does the same).
                    if !latest.approved || (sensitive && !latest.sensitive_approved) {
                        c.inbox_patch(
                            &i,
                            json!({ "approved": true, "sensitiveApproved": sensitive }),
                        )
                        .await?;
                    }
                }
                // 4. Send (or read back an existing intent) with the same key.
                let res = c.inbox_send(&i, &d, &k).await?;
                Ok::<_, ApiError>(SendOutcome::Sent(res))
            })
            .await;
            // On an unknown outcome, read back once more before reporting.
            let outcome = match outcome {
                Err(e) if e.outcome_unknown() => {
                    let (c, i) = (client.clone(), id.clone());
                    match io(async move { c.inbox_item(&i).await }).await {
                        Ok(latest)
                            if matches!(latest.status.as_str(), "sent" | "delivered")
                                && latest.receipt.is_some() =>
                        {
                            Ok(SendOutcome::AlreadySent(latest))
                        }
                        _ => Err(e),
                    }
                }
                other => other,
            };
            _ = this.update_in(cx, |this, window, cx| {
                this.busy = None;
                this.progress = None;
                match outcome {
                    Ok(SendOutcome::Sent(res)) => {
                        let ids = receipt_ids(res.receipt.as_ref().or(res.item.receipt.as_ref()));
                        eprintln!(
                            "[opstwin] inbox {id} sent key={key} replayed={} receipts={}",
                            res.replayed,
                            ids.len()
                        );
                        this.mark_send(&id, SendRecordState::Sent, ids.clone());
                        this.notice = Some(format!(
                            "{}{}",
                            crate::settings::t("已发送，回执消息 ID："),
                            ids.join(", ")
                        ));
                        this.apply_server_item(res.item, window, cx);
                        this.refresh_list(window, cx);
                    }
                    Ok(SendOutcome::AlreadySent(latest)) => {
                        let ids = receipt_ids(latest.receipt.as_ref());
                        eprintln!(
                            "[opstwin] inbox {id} already sent (read back) receipts={}",
                            ids.len()
                        );
                        this.mark_send(&id, SendRecordState::Sent, ids.clone());
                        this.notice = Some(format!(
                            "{}{}",
                            crate::settings::t("回读确认已发送，回执消息 ID："),
                            ids.join(", ")
                        ));
                        this.apply_server_item(latest, window, cx);
                    }
                    Ok(SendOutcome::Changed(latest)) => {
                        eprintln!("[opstwin] inbox {id} draft changed before send; stopped");
                        this.action_error = Some(crate::settings::t(
                            "草稿已在其他地方更新，未发送；请审阅最新草稿",
                        ));
                        this.apply_server_item(latest, window, cx);
                    }
                    Err(e) => {
                        eprintln!("[opstwin] inbox {id} send failed: {e}");
                        if e.code() == Some("send_failed") {
                            this.mark_send(&id, SendRecordState::Failed, vec![]);
                            this.send_needs_new_key = true;
                        }
                        let hint = if e.outcome_unknown() {
                            crate::settings::t(
                                "；结果未知，已保留原幂等键，重试会先回读不会重复发送",
                            )
                        } else {
                            String::new()
                        };
                        this.action_error = Some(format!(
                            "{}{}{hint}",
                            crate::settings::t("发送未完成："),
                            e.user_text()
                        ));
                        this.reload_detail(window, cx);
                    }
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
    }

    fn mark_send(&mut self, id: &str, state: SendRecordState, ids: Vec<String>) {
        if let Some(rec) = self.state.sends.get_mut(id) {
            rec.state = state;
            if !ids.is_empty() {
                rec.receipt_ids = ids;
            }
            rec.updated_at_ms = now_ms();
            self.saver.save(self.state.clone());
        }
    }

    fn undo(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(item) = self.detail.clone() else {
            return;
        };
        let key = self
            .state
            .sends
            .get(&item.id)
            .map(|r| r.key.clone())
            .or_else(|| item.send_key.clone());
        let Some(key) = key else {
            self.action_error = Some(crate::settings::t("找不到原发送幂等键，无法撤回"));
            cx.notify();
            return;
        };
        if !self.begin(Busy::Undo, cx) {
            return;
        }
        self.progress = Some(crate::settings::t("正在撤回…"));
        let client = self.client.clone();
        let id = item.id.clone();
        let task = cx.spawn_in(window, async move |this, cx| {
            let (c, i, k) = (client.clone(), id.clone(), key.clone());
            let result = io(async move { c.inbox_undo(&i, &k).await }).await;
            _ = this.update_in(cx, |this, window, cx| {
                this.busy = None;
                this.progress = None;
                match result {
                    Ok(res) => {
                        eprintln!("[opstwin] inbox {id} undo ok status={}", res.item.status);
                        if res.item.status == "recalled" {
                            this.mark_send(&id, SendRecordState::Recalled, vec![]);
                        }
                        this.notice = Some(crate::settings::t("已撤回"));
                        this.apply_server_item(res.item, window, cx);
                        this.refresh_list(window, cx);
                    }
                    Err(e) => {
                        eprintln!("[opstwin] inbox {id} undo failed: {e}");
                        this.action_error = Some(
                            crate::settings::t("撤回未完成：{error}（已重新读取状态）")
                                .replace("{error}", &e.user_text()),
                        );
                        this.reload_detail(window, cx);
                    }
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
    }

    // -------------------------------------------------------------- rendering

    fn render_list(&self, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let mut filters = h_flex().gap(px(3.)).px(px(3.)).mb(px(13.));
        for f in Filter::ALL {
            let label = crate::settings::t(f.label());
            filters = filters.child(
                Button::new(ElementId::Name(
                    format!("inbox-filter-{}", f.label()).into(),
                ))
                .ghost()
                .small()
                .h(px(27.))
                .px(px(8.))
                .rounded(px(6.))
                .accessibility_label(label.clone())
                .disabled(self.busy.is_some())
                .when(self.filter == f, |b| {
                    b.bg(theme.accent).text_color(theme.primary)
                })
                .child(
                    div()
                        .text_size(px(11.))
                        .line_height(relative(1.25))
                        .child(label),
                )
                .on_click(cx.listener(move |this, _, window, cx| this.set_filter(f, window, cx))),
            );
        }
        let header = v_flex()
            .px(px(10.))
            .pt(px(25.))
            .flex_shrink_0()
            .child(filters)
            .child(
                div()
                    .mx(px(7.))
                    .mb(px(17.))
                    .py(px(2.5))
                    .border_1()
                    .border_color(
                        if self.search.read(cx).focus_handle(cx).is_focused(window) {
                            theme.ring
                        } else {
                            theme.input
                        },
                    )
                    .rounded(px(7.))
                    .bg(theme.background)
                    .child(
                        Input::new(&self.search)
                            .small()
                            .appearance(false)
                            .text_size(px(11.))
                            .cleanable(false),
                    ),
            );

        let mut list = v_flex()
            .id("inbox-list")
            .flex_1()
            .min_h_0()
            .px(px(10.))
            .overflow_y_scrollbar();
        if let Some(err) = &self.load_error {
            list = list.child(
                v_flex()
                    .p_3()
                    .gap_2()
                    .child(div().text_sm().text_color(theme.danger).child(format!(
                        "{}{}",
                        crate::settings::t("加载失败："),
                        err
                    )))
                    .child(
                        Button::new("inbox-retry")
                            .xsmall()
                            .outline()
                            .label(crate::settings::t("重试"))
                            .on_click(cx.listener(|this, _, window, cx| this.reload(window, cx))),
                    ),
            );
        }
        if self.items.is_empty() && !self.loading && self.load_error.is_none() {
            list = list.child(
                div()
                    .p_4()
                    .text_color(theme.muted_foreground)
                    .child(crate::settings::t("没有事项")),
            );
        }
        for s in &self.items {
            let selected = self.selected.as_deref() == Some(s.id.as_str());
            let id = s.id.clone();
            let has_edit = self.state.edits.contains_key(&s.id);
            let presentation = self.list_presentations.get(&s.id);
            let triage = presentation.and_then(|p| p.1.as_ref());
            let level = if opstwin_api::is_done_status(&s.status) {
                0
            } else if s.sensitive
                || matches!(s.status.as_str(), "failed" | "send_failed" | "send_unknown")
                || triage
                    .and_then(|t| t["risk"].as_f64())
                    .is_some_and(|p| p >= 0.75)
            {
                4
            } else if triage.is_some_and(|t| t["status"] == "succeeded") {
                match triage.and_then(|t| t["route"].as_str()) {
                    Some("review") => 3,
                    Some("deep_reply") => 2,
                    Some("quick_reply") => 1,
                    _ => 0,
                }
            } else {
                0
            };
            let signal_hint = match level {
                4 => "敏感内容、失败或重要承诺",
                3 => "需要你确认",
                2 => "分析后回复",
                1 => "简单回复",
                _ => "无关注信号或尚未判断",
            };
            let mut signal = h_flex()
                .id(ElementId::Name(format!("inbox-signal-{}", s.id).into()))
                .items_end()
                .gap(px(2.))
                .h(px(15.))
                .tooltip(move |window, cx| {
                    gpui_kit::component::tooltip::Tooltip::new(crate::settings::t(signal_hint))
                        .build(window, cx)
                });
            for n in 1..=4 {
                signal = signal.child(
                    div()
                        .w(px(3.))
                        .h(px((3 + n * 3) as f32))
                        .rounded(px(1.))
                        .bg(if n <= level {
                            if level == 4 {
                                rgb(0xbf8c72).into()
                            } else {
                                rgb(0x8e9fbf).into()
                            }
                        } else {
                            theme.border
                        }),
                );
            }

            let time = s
                .event_at
                .as_deref()
                .map(compact_time)
                .unwrap_or_else(|| crate::settings::t("时间未知"));
            let mut copy = v_flex()
                .flex_1()
                .min_w_0()
                .gap(px(5.))
                .child(
                    h_flex()
                        .items_end()
                        .gap(px(8.))
                        .h(px(18.))
                        .child(
                            div()
                                .id(ElementId::Name(format!("inbox-source-{}", s.id).into()))
                                .flex_1()
                                .min_w_0()
                                .overflow_hidden()
                                .whitespace_nowrap()
                                .text_ellipsis()
                                .text_size(px(12.))
                                .line_height(px(18.))
                                .font_weight(FontWeight::SEMIBOLD)
                                .when(selected, |d| d.text_color(theme.primary))
                                .tooltip({
                                    let source = s.channel.clone();
                                    move |window, cx| {
                                        gpui_kit::component::tooltip::Tooltip::new(source.clone())
                                            .build(window, cx)
                                    }
                                })
                                .child(s.sender.clone()),
                        )
                        .child(
                            div()
                                .flex_shrink_0()
                                .text_size(px(11.))
                                .line_height(px(18.))
                                .text_color(theme.muted_foreground)
                                .child(time),
                        )
                        .child(signal),
                )
                .child(
                    div()
                        .text_size(crate::settings::body_px(12., cx))
                        .line_height(relative(1.7))
                        .text_color(if selected {
                            rgb(0x6e7d98).into()
                        } else {
                            theme.muted_foreground
                        })
                        .line_clamp(2)
                        .child(snippet(&s.body, 130)),
                );
            if has_edit || s.sensitive || opstwin_api::is_done_status(&s.status) {
                copy = copy.child(
                    h_flex()
                        .gap_2()
                        .text_size(px(11.))
                        .text_color(theme.muted_foreground)
                        .when(opstwin_api::is_done_status(&s.status), |d| {
                            d.child(crate::settings::t(status_label(&s.status)))
                        })
                        .when(has_edit, |d| {
                            d.child(
                                div()
                                    .text_color(theme.warning)
                                    .child(crate::settings::t("未保存修改")),
                            )
                        })
                        .when(s.sensitive, |d| {
                            d.child(
                                div()
                                    .text_color(theme.danger)
                                    .child(crate::settings::t("敏感")),
                            )
                        }),
                );
            }
            list = list.child(
                gpui_kit::base::Button::new(ElementId::Name(format!("inbox-row-{}", s.id).into()))
                    .accessibility_label(format!(
                        "{}：{}",
                        crate::settings::t("打开收件事项"),
                        s.sender
                    ))
                    .w_full()
                    .px(px(9.))
                    .py(px(13.))
                    .mb(px(4.))
                    .gap(px(10.))
                    .rounded(px(9.))
                    .cursor_pointer()
                    .when(selected, |d| d.bg(theme.accent))
                    .when(!selected, |d| d.hover(|d| d.bg(theme.secondary)))
                    .on_click(
                        cx.listener(move |this, _, window, cx| this.select(id.clone(), window, cx)),
                    )
                    .child(avatar(
                        presentation.and_then(|p| p.0.clone()),
                        &s.sender,
                        30.,
                        cx,
                    ))
                    .child(copy),
            );
        }
        if self.has_more {
            let next = self.next_offset;
            list = list.child(
                h_flex().w_full().justify_center().py_3().child(
                    Button::new("inbox-more")
                        .small()
                        .outline()
                        .loading(self.loading)
                        .label(crate::settings::t("加载更多"))
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.load_from(next, false, window, cx)
                        })),
                ),
            );
        }
        v_flex()
            .w(inbox_list_width(window))
            .flex_shrink_0()
            .h_full()
            .border_r_1()
            .border_color(theme.border)
            .child(header)
            .child(list)
    }

    fn render_source_preview(&self, cx: &mut Context<Self>) -> AnyElement {
        let Some((title, url, result)) = &self.source_preview else {
            return div().into_any_element();
        };
        let theme = cx.theme();
        let body = match result {
            Ok(crate::files::SourcePreview::Text { text, markdown }) => {
                if *markdown {
                    crate::util::markdown(
                        "inbox-source-preview-markdown",
                        text.replace("![", "\\!["),
                    )
                    .selectable(true)
                    .on_link_click(|url, _, _, cx| {
                        if url.starts_with("https://") || url.starts_with("http://") {
                            cx.open_url(url);
                        }
                    })
                    .into_any_element()
                } else {
                    source_text(text, "inbox-source-preview-text".into(), cx)
                }
            }
            Ok(crate::files::SourcePreview::Image { bytes, mime }) => {
                let format = match mime.as_str() {
                    "image/jpeg" => ImageFormat::Jpeg,
                    "image/gif" => ImageFormat::Gif,
                    "image/webp" => ImageFormat::Webp,
                    _ => ImageFormat::Png,
                };
                img(std::sync::Arc::new(Image::from_bytes(
                    format,
                    bytes.clone(),
                )))
                .w_full()
                .h(px(300.))
                .object_fit(ObjectFit::Contain)
                .with_fallback(|| {
                    div()
                        .child(crate::settings::t("图片暂不可用"))
                        .into_any_element()
                })
                .into_any_element()
            }
            Ok(crate::files::SourcePreview::Unsupported) => div()
                .text_size(px(13.))
                .text_color(theme.muted_foreground)
                .child(crate::settings::t("此格式不支持应用内预览，可打开来源文件"))
                .into_any_element(),
            Err(error) => div()
                .text_size(px(13.))
                .text_color(if self.source_preview_loading {
                    theme.muted_foreground
                } else {
                    theme.danger
                })
                .child(error.clone())
                .into_any_element(),
        };
        let retry_title = title.clone();
        let retry_url = url.clone();
        let external_url = url.clone();
        v_flex()
            .w(px(292.))
            .h_full()
            .flex_shrink_0()
            .border_l_1()
            .border_color(theme.border)
            .bg(theme.muted)
            .px(px(22.))
            .py(px(18.))
            .gap(px(14.))
            .child(
                h_flex()
                    .gap_2()
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_ellipsis()
                            .text_size(px(14.))
                            .child(title.clone()),
                    )
                    .child(
                        Button::new("inbox-source-preview-close")
                            .accessibility_label(crate::settings::t("关闭来源预览"))
                            .ghost()
                            .xsmall()
                            .label(crate::settings::t("关闭"))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.source_preview_generation += 1;
                                this.source_preview = None;
                                this.source_preview_loading = false;
                                cx.notify();
                            })),
                    ),
            )
            .child(
                div()
                    .id("inbox-source-preview-scroll")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scrollbar()
                    .child(body),
            )
            .when(result.is_err() && !self.source_preview_loading, |d| {
                d.child(
                    Button::new("inbox-source-preview-retry")
                        .ghost()
                        .small()
                        .label(crate::settings::t("重试"))
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.preview_source(retry_title.clone(), retry_url.clone(), window, cx)
                        })),
                )
            })
            .child(
                Button::new("inbox-source-preview-open")
                    .ghost()
                    .small()
                    .label(crate::settings::t("打开来源文件"))
                    .on_click(move |_, _, cx| cx.open_url(&external_url)),
            )
            .into_any_element()
    }

    fn render_detail(&self, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let theme = cx.theme().clone();
        let Some(item) = self.detail.as_ref() else {
            let msg = if self.selected.is_none() {
                crate::settings::t("选择一条事项查看详情")
            } else if let Some(e) = &self.detail_error {
                format!("{}{}", crate::settings::t("加载失败："), e)
            } else {
                crate::settings::t("正在加载…")
            };
            return v_flex()
                .flex_1()
                .items_center()
                .justify_center()
                .gap_3()
                .text_color(theme.muted_foreground)
                .child(msg)
                .when(self.detail_error.is_some(), |d| {
                    d.child(
                        Button::new("inbox-detail-retry")
                            .ghost()
                            .small()
                            .label(crate::settings::t("重试"))
                            .on_click(
                                cx.listener(|this, _, window, cx| this.reload_detail(window, cx)),
                            ),
                    )
                })
                .into_any_element();
        };
        let dirty = self.is_dirty(cx);
        let busy = self.busy;
        let locked = item.send_locked();
        let done = item.is_done();
        let (detail_top, detail_horizontal, detail_bottom, footer_vertical) =
            inbox_detail_padding(window);

        let mut body = v_flex()
            .id("inbox-detail")
            .flex_1()
            .min_h_0()
            .px(detail_horizontal)
            .pt(detail_top)
            .pb(detail_bottom)
            .gap_0()
            .overflow_y_scrollbar();

        // Same three-card stack as the HTML, with source dates independent of runs.
        let product = self.product.as_ref();
        let latest = item
            .messages
            .iter()
            .filter(|m| {
                m.kind.as_deref() != Some("recalled")
                    && !(m.kind.as_deref() == Some("system") && m.text.trim().is_empty())
            })
            .filter_map(|m| m.sent_at.as_deref())
            .filter_map(|raw| crate::util::parse_ms(raw).map(|ms| (ms, raw)))
            .max_by_key(|v| v.0)
            .map(|v| crate::chat::time_label(v.1))
            .or_else(|| {
                if item.messages.is_empty() {
                    product
                        .and_then(|p| p.received_at.as_deref().or(p.event_at.as_deref()))
                        .map(crate::chat::time_label)
                } else {
                    None
                }
            })
            .filter(|label| !label.is_empty())
            .unwrap_or_else(|| crate::settings::t("时间未知"));
        body = body.child(
            h_flex()
                .gap(px(10.))
                .mb(px(23.))
                .flex_shrink_0()
                .items_center()
                .child(avatar(
                    product.and_then(|p| p.avatar_url.clone()),
                    &item.sender,
                    34.,
                    cx,
                ))
                .child(
                    v_flex()
                        .flex_1()
                        .min_w_0()
                        .gap(px(3.))
                        .child(
                            div()
                                .text_size(px(15.))
                                .line_height(relative(1.5))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(if item.sender.trim().is_empty() {
                                    item.title.clone()
                                } else {
                                    item.sender.clone()
                                }),
                        )
                        .child(
                            div()
                                .text_size(px(11.))
                                .text_color(theme.muted_foreground)
                                .line_height(relative(1.7))
                                .child(format!(
                                    "{} · {}",
                                    if item.channel == "Feishu" {
                                        crate::settings::t("飞书")
                                    } else {
                                        item.channel.clone()
                                    },
                                    latest
                                )),
                        ),
                )
                .when(!matches!(item.status.as_str(), "pending" | "draft"), |d| {
                    d.child(
                        div()
                            .text_size(px(11.))
                            .text_color(theme.muted_foreground)
                            .child(crate::settings::t(status_label(&item.status))),
                    )
                }),
        );
        if let Some(error) = &self.detail_error {
            body = body.child(
                div()
                    .text_xs()
                    .text_color(theme.danger)
                    .child(error.clone()),
            );
        }

        let triage = product.and_then(|p| p.triage.as_ref());
        let reliable = triage.is_some_and(|t| t["method"] == "jev" && t["status"] == "succeeded");
        let mut meters = h_flex().gap_4();
        for (key, label) in [
            ("needsReply", "需要回复"),
            ("needsOwner", "需要你决策"),
            ("needsDeepThink", "需要深度思考"),
        ] {
            let probability = if reliable {
                triage
                    .and_then(|t| t[key].as_f64())
                    .filter(|p| p.is_finite() && (0.0..=1.0).contains(p))
            } else {
                None
            };
            let hint = probability
                .map(|p| format!("{}：{:.0}%", crate::settings::t(label), p * 100.))
                .unwrap_or_else(|| {
                    format!(
                        "{}：{}",
                        crate::settings::t(label),
                        crate::settings::t("概率未知")
                    )
                });
            let bar = div()
                .id(ElementId::Name(format!("jev-meter-{key}").into()))
                .w_full()
                .h(px(6.))
                .rounded_full()
                .overflow_hidden()
                .bg(theme.secondary)
                .tooltip(move |window, cx| {
                    gpui_kit::component::tooltip::Tooltip::new(hint.clone()).build(window, cx)
                })
                .when_some(probability, |bar, p| {
                    bar.child(div().h_full().w(relative(p as f32)).rounded_full().bg(
                        if p >= 0.75 {
                            theme.primary
                        } else if p <= 0.25 {
                            rgb(0x95a5ba).into()
                        } else {
                            rgb(0x7796d6).into()
                        },
                    ))
                });
            meters = meters.child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .gap(px(10.))
                    .child(
                        div()
                            .text_size(px(11.))
                            .line_height(px(16.))
                            .text_color(theme.muted_foreground)
                            .child(crate::settings::t(label)),
                    )
                    .child(bar),
            );
        }
        let mut judgment = v_flex()
            .px(px(16.))
            .py(px(14.))
            .mb(px(19.))
            .flex_shrink_0()
            .gap(px(17.))
            .border_1()
            .border_color(theme.border)
            .rounded(px(11.))
            .child(
                div()
                    .text_size(px(11.))
                    .font_weight(FontWeight::MEDIUM)
                    .line_height(px(16.))
                    .child(crate::settings::t("Jev 回复判断")),
            )
            .child(meters);
        if !reliable {
            let status = triage
                .and_then(|t| t["status"].as_str())
                .unwrap_or("missing");
            let text = match status {
                "running" => "正在判断",
                "failed" => "判断失败，需人工查看",
                "succeeded" => "规则判断，无模型概率",
                _ => "尚未判断",
            };
            judgment =
                judgment.child(
                    h_flex()
                        .gap_2()
                        .items_center()
                        .child(
                            div()
                                .text_size(px(11.))
                                .text_color(theme.muted_foreground)
                                .child(crate::settings::t(text)),
                        )
                        .when(status != "running", |d| {
                            d.child(
                                Button::new("jev-retry")
                                    .ghost()
                                    .xsmall()
                                    .label(crate::settings::t("重新判断"))
                                    .disabled(busy.is_some())
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.retry_triage(window, cx)
                                    })),
                            )
                        }),
                );
        }
        if reliable {
            let missing = triage
                .and_then(|t| t["missingContext"].as_f64())
                .is_some_and(|p| p >= 0.5);
            let risk = triage
                .and_then(|t| t["risk"].as_f64())
                .is_some_and(|p| p >= 0.75);
            if missing || risk {
                judgment = judgment.child(
                    div()
                        .text_size(px(11.))
                        .line_height(relative(1.7))
                        .text_color(theme.warning)
                        .child(format!(
                            "{}{}",
                            if missing {
                                crate::settings::t("缺少关键材料，请补充后再形成完整答复")
                            } else {
                                String::new()
                            },
                            if risk {
                                crate::settings::t("涉及重要承诺或敏感内容，回复前需要你审核")
                            } else {
                                String::new()
                            }
                        )),
                );
            }
        }
        body = body.child(judgment);

        let raw_messages = self
            .source_history
            .as_deref()
            .unwrap_or_else(|| product.map(|p| p.messages.as_slice()).unwrap_or(&[]));
        let personal = product.is_some_and(|p| {
            p.chat_mode.as_deref() == Some("p2p")
                || (item.id.starts_with("chat-") && p.chat_mode.as_deref() != Some("group"))
        });
        let start = if self.show_full_messages {
            0
        } else {
            raw_messages.len().saturating_sub(20)
        };
        // Keep the height cap on the actual viewport. The component helper
        // also retains max_h on its inner content, hiding the true scroll extent.
        let mut messages = v_flex()
            .id("inbox-source-thread")
            .gap(px(17.))
            .p(px(14.))
            .max_h(px(if self.show_full_messages { 600. } else { 330. }))
            .overflow_y_scroll()
            .track_scroll(&self.source_scroll)
            .restrict_scroll_to_axis()
            .relative()
            .vertical_scrollbar(&self.source_scroll);
        // HTML's 84% is relative to the source row, not intrinsic text width.
        // Resolve it from actual remaining window space before text measurement.
        let source_row_width = (f32::from(window.bounds().size.width)
            - 78.
            - f32::from(inbox_list_width(window))
            - 2. * f32::from(detail_horizontal)
            - 2.
            - 28.
            - if self.source_preview.is_some() {
                292.
            } else {
                0.
            })
        .max(0.);
        let source_main_max = (source_row_width * 0.84).min((source_row_width - 33.).max(0.));
        let mut previous_time: Option<i64> = None;
        if raw_messages.is_empty() {
            messages = messages.child(
                div()
                    .flex_shrink_0()
                    .text_size(px(13.))
                    .line_height(relative(1.8))
                    .child(source_text(&item.body, "inbox-source-plain".into(), cx)),
            );
        }
        if self.source_busy {
            messages = messages.child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(crate::settings::t("正在读取消息…")),
            );
        }
        if let Some(error) = &self.source_error {
            messages = messages.child(
                v_flex()
                    .gap_2()
                    .child(div().text_xs().text_color(theme.danger).child(format!(
                        "{} {}",
                        crate::settings::t("读取失败，已保存内容仍可查看。"),
                        error
                    )))
                    .child(
                        Button::new("source-history-retry")
                            .ghost()
                            .xsmall()
                            .label(crate::settings::t("重试"))
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.load_source_history(this.source_history.is_some(), window, cx)
                            })),
                    ),
            );
        }
        if self.show_full_messages && self.source_more {
            messages = messages.child(
                Button::new("source-history-earlier")
                    .ghost()
                    .xsmall()
                    .label(crate::settings::t("加载更早消息"))
                    .disabled(self.source_busy)
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.load_source_history(true, window, cx)
                    })),
            );
        }
        for (message_index, message) in raw_messages[start..].iter().enumerate() {
            let mine = message["isMine"].as_bool().unwrap_or(false);
            let who = message["senderName"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| crate::settings::t(if mine { "我" } else { "对方" }));
            let kind = message["type"].as_str().unwrap_or("消息");
            let text = message["text"].as_str().unwrap_or("");
            if kind == "recalled"
                || (kind == "system" && text.trim().is_empty())
                || matches!(
                    text.trim().trim_end_matches(['.', '!', '。']),
                    "this message was recalled" | "此消息已撤回" | "消息已撤回" | "该消息已撤回"
                )
            {
                continue;
            }
            let message_key = message["id"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| format!("source-{message_index}"));
            let attachments = indexed_attachments(message, &self.client);
            let image_only = message.get("error").is_none()
                && attachments.iter().any(|(_, _, mime)| is_source_image(mime))
                && matches!(text.trim(), "" | "[image]" | "[图片]");
            let raw_time = message.get("sentAt").map(|v| {
                v.as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| v.to_string())
            });
            let current_time = raw_time.as_deref().and_then(crate::util::parse_ms);
            // Only message groups have the HTML's 17px separation. The time
            // label and its own message have no extra gap between them.
            let mut message_group = v_flex().w_full().flex_shrink_0().gap_0();
            if let Some(time) = current_time {
                let current_date = chrono::DateTime::from_timestamp_millis(time)
                    .map(|t| t.with_timezone(&Local).date_naive());
                let previous_date = previous_time
                    .and_then(chrono::DateTime::from_timestamp_millis)
                    .map(|t| t.with_timezone(&Local).date_naive());
                if previous_time.is_none()
                    || current_date != previous_date
                    || previous_time.is_some_and(|p| time - p >= 15 * 60 * 1000)
                {
                    message_group = message_group.child(
                        div()
                            .w_full()
                            .text_center()
                            .text_size(px(12.))
                            .line_height(relative(1.5))
                            .py(px(10.))
                            .text_color(theme.muted_foreground)
                            .child(
                                raw_time
                                    .as_deref()
                                    .map(crate::chat::time_label)
                                    .unwrap_or_default(),
                            ),
                    );
                }
                previous_time = Some(time);
            }
            if kind == "system" {
                messages = messages.child(
                    message_group.child(
                        div()
                            .text_xs()
                            .text_color(theme.muted_foreground)
                            .text_center()
                            .child(text.to_owned()),
                    ),
                );
                continue;
            }
            let mut content = v_flex().gap(px(7.)).max_w(px(source_main_max)).min_w_0();
            if !personal {
                content = content.child(
                    div()
                        .text_size(px(11.))
                        .text_color(theme.muted_foreground)
                        .line_height(relative(1.25))
                        .child(if mine {
                            crate::settings::t("我")
                        } else {
                            who.to_owned()
                        }),
                );
            }
            if let Some(reference) = message
                .get("quote")
                .or_else(|| message.get("quotedMessage"))
                .or_else(|| message.get("replyTo"))
            {
                let quote = reference
                    .as_str()
                    .or_else(|| reference["text"].as_str())
                    .or_else(|| reference["content"].as_str());
                if let Some(quote) = quote.filter(|s| !s.trim().is_empty()) {
                    content = content.child(
                        div()
                            .border_l_2()
                            .border_color(theme.border)
                            .pl_2()
                            .text_color(theme.muted_foreground)
                            .child(source_text(
                                quote,
                                format!("source-quote-{message_key}").into(),
                                cx,
                            )),
                    );
                }
            }
            if !image_only {
                let shown = if message.get("error").is_some() {
                    crate::settings::t("此消息读取失败")
                } else if text.is_empty() {
                    format!("[{kind}]")
                } else {
                    text.to_owned()
                };
                content = content.child(
                    div()
                        .text_size(crate::settings::body_px(12., cx))
                        .line_height(relative(1.7))
                        .rounded(px(15.))
                        .px_3()
                        .py(px(9.))
                        .bg(if mine {
                            if theme.is_dark() {
                                theme.accent
                            } else {
                                rgb(0xcce5ff).into()
                            }
                        } else if theme.is_dark() {
                            theme.secondary
                        } else {
                            rgb(0xececee).into()
                        })
                        .child(source_text(
                            &shown,
                            format!("source-text-{message_key}").into(),
                            cx,
                        )),
                );
            }
            for (attachment_index, (name, url, mime)) in attachments.into_iter().enumerate() {
                let title = name.clone();
                let asset_url = url.clone();
                if is_source_image(&mime) {
                    let fallback_text = crate::settings::t("图片暂不可用，点击重试预览");
                    let image_url = format!("{url}?native-view={}", self.source_preview_generation);
                    content = content.child(
                        gpui_kit::base::Button::new(ElementId::Name(
                            format!("source-image-{message_key}-{attachment_index}").into(),
                        ))
                        .accessibility_label(format!(
                            "{}：{}",
                            crate::settings::t("预览来源图片"),
                            name
                        ))
                        .w(px(220.))
                        .max_w_full()
                        .h(px(150.))
                        .rounded(px(9.))
                        .overflow_hidden()
                        .cursor_pointer()
                        .tooltip(move |window, cx| {
                            gpui_kit::component::tooltip::Tooltip::new(title.clone())
                                .build(window, cx)
                        })
                        .child(
                            img(image_url)
                                .size_full()
                                .object_fit(ObjectFit::Contain)
                                .with_fallback(move || {
                                    div()
                                        .size_full()
                                        .flex()
                                        .items_center()
                                        .justify_center()
                                        .text_size(px(11.))
                                        .child(fallback_text.clone())
                                        .into_any_element()
                                }),
                        )
                        .on_click(cx.listener(
                            move |this, _, window, cx| {
                                this.preview_source(name.clone(), asset_url.clone(), window, cx)
                            },
                        )),
                    );
                } else {
                    content = content.child(
                        Button::new(ElementId::Name(
                            format!("source-attachment-{message_key}-{attachment_index}").into(),
                        ))
                        .ghost()
                        .xsmall()
                        .label(name.clone())
                        .tooltip(crate::settings::t("预览已索引来源附件"))
                        .on_click(cx.listener(
                            move |this, _, window, cx| {
                                this.preview_source(name.clone(), asset_url.clone(), window, cx)
                            },
                        )),
                    );
                }
            }
            let pic = avatar(
                message["avatarUrl"].as_str().map(str::to_owned),
                &who,
                25.,
                cx,
            );
            let row = if mine {
                h_flex()
                    .w_full()
                    .gap_2()
                    .justify_end()
                    .child(content)
                    .child(div().mt(px(if personal { 0. } else { 16. })).child(pic))
            } else {
                h_flex()
                    .w_full()
                    .gap_2()
                    .child(div().mt(px(if personal { 0. } else { 16. })).child(pic))
                    .child(content)
            };
            messages = messages.child(message_group.child(row));
        }
        if let Some(product) = product {
            for attachment in &product.source_attachments {
                let label = attachment["filename"]
                    .as_str()
                    .or_else(|| attachment["name"].as_str())
                    .unwrap_or("来源附件");
                messages = messages.child(
                    div().text_xs().text_color(theme.muted_foreground).child(
                        crate::settings::t("附件：{name}（仅来源描述，未读取正文）")
                            .replace("{name}", label),
                    ),
                );
            }
        }
        body = body.child(
            v_flex()
                .mb(px(15.))
                .flex_shrink_0()
                .border_1()
                .border_color(theme.border)
                .rounded(px(11.))
                .overflow_hidden()
                .child(
                    h_flex()
                        .px(px(15.))
                        .h(px(42.))
                        .flex_shrink_0()
                        .items_center()
                        .border_b_1()
                        .border_color(theme.border)
                        .child(
                            div()
                                .flex_1()
                                .text_size(px(11.))
                                .text_color(theme.muted_foreground)
                                .child(crate::settings::t("原始消息")),
                        )
                        .child(
                            Button::new("inbox-full-messages")
                                .ghost()
                                .xsmall()
                                .h(px(16.))
                                .px_0()
                                .text_color(theme.primary)
                                .accessibility_label(crate::settings::t(
                                    if self.show_full_messages {
                                        "收起完整消息"
                                    } else {
                                        "查看完整消息"
                                    },
                                ))
                                .child(
                                    h_flex()
                                        .gap(px(4.))
                                        .child(
                                            div()
                                                .text_size(px(11.))
                                                .line_height(relative(1.25))
                                                .child(crate::settings::t(
                                                    if self.show_full_messages {
                                                        "收起完整消息"
                                                    } else {
                                                        "查看完整消息"
                                                    },
                                                )),
                                        )
                                        .child(div().text_size(px(13.)).child("›")),
                                )
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.show_full_messages = !this.show_full_messages;
                                    this.load_source_history(false, window, cx);
                                    cx.notify();
                                })),
                        ),
                )
                .child(messages),
        );

        // Draft editor
        let mut draft = v_flex()
            .flex_shrink_0()
            .gap(px(9.))
            .child(
                h_flex()
                    .h(px(16.))
                    .items_center()
                    .gap(px(12.))
                    .child(
                        div()
                            .flex_1()
                            .text_size(px(11.))
                            .line_height(relative(1.25))
                            .text_color(theme.muted_foreground)
                            .child(crate::settings::t("回复草稿")),
                    )
                    .child(
                        Button::new("inbox-analysis")
                            .ghost()
                            .xsmall()
                            .h(px(16.))
                            .px_0()
                            .text_color(theme.primary)
                            .accessibility_label(crate::settings::t("查看分析过程"))
                            .child(
                                div()
                                    .text_size(px(12.))
                                    .line_height(relative(1.25))
                                    .child(crate::settings::t("查看分析过程")),
                            )
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.show_analysis = !this.show_analysis;
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("inbox-edit")
                            .ghost()
                            .xsmall()
                            .h(px(16.))
                            .px_0()
                            .text_color(theme.primary)
                            .accessibility_label(crate::settings::t(if self.editing {
                                "收起编辑"
                            } else {
                                "编辑"
                            }))
                            .child(div().text_size(px(12.)).line_height(relative(1.25)).child(
                                crate::settings::t(if self.editing {
                                    "收起编辑"
                                } else {
                                    "编辑"
                                }),
                            ))
                            .disabled(locked)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.editing = !this.editing;
                                cx.notify();
                            })),
                    )
                    .when(dirty, |d| {
                        d.child(
                            div()
                                .text_xs()
                                .text_color(theme.warning)
                                .child(crate::settings::t("未保存（已在本机保留）")),
                        )
                    })
                    .when(item.approved && !dirty, |d| {
                        d.child(
                            div()
                                .text_xs()
                                .text_color(theme.success)
                                .child(crate::settings::t("已批准")),
                        )
                    }),
            )
            .when(self.editing || dirty, |d| {
                d.child(Textarea::new(&self.editor).disabled(locked || busy.is_some()))
            })
            .when(!self.editing && !dirty, |d| {
                d.child(
                    div()
                        .px(px(17.))
                        .py(px(15.))
                        .rounded(px(12.))
                        .bg(theme.secondary)
                        .text_size(crate::settings::body_px(13., cx))
                        .line_height(relative(1.85))
                        .child(
                            item.draft
                                .clone()
                                .filter(|s| !s.trim().is_empty())
                                .unwrap_or_else(|| crate::settings::t("尚无回复草稿")),
                        ),
                )
            });
        if self.show_analysis {
            let analysis = triage
                .map(|t| {
                    format!(
                        "判断方法：{}\n状态：{}\n路线：{}\n保存理由：{}\n模型：{}",
                        t["method"].as_str().unwrap_or("未知"),
                        t["status"].as_str().unwrap_or("未知"),
                        t["route"].as_str().unwrap_or("未分类"),
                        t["reason"].as_str().unwrap_or("无保存理由"),
                        t["model"].as_str().unwrap_or("未记录")
                    )
                })
                .unwrap_or_else(|| crate::settings::t("尚无保存的分析记录"));
            draft = draft.child(
                div()
                    .p_3()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(analysis),
            );
        }
        if let Some(candidate) = product.and_then(|p| p.draft_candidate.as_ref()) {
            let candidate_id = candidate.request_id.clone();
            let mut panel = v_flex()
                .p_3()
                .gap_2()
                .border_1()
                .border_color(theme.warning)
                .rounded_lg()
                .child(
                    div()
                        .text_sm()
                        .font_weight(FontWeight::MEDIUM)
                        .child(crate::settings::t("并发修改后的候选草稿")),
                )
                .child(
                    div()
                        .text_size(crate::settings::body_px(13., cx))
                        .line_height(relative(1.8))
                        .child(candidate.text.clone()),
                )
                .child(
                    div().text_xs().text_color(theme.muted_foreground).child(
                        crate::settings::t("当前草稿保持不变 · 候选请求 {request}")
                            .replace("{request}", &candidate_id),
                    ),
                )
                .child(
                    Button::new("inbox-candidate-apply")
                        .primary()
                        .small()
                        .label(crate::settings::t("已审阅，采用候选"))
                        .disabled(busy.is_some() || dirty || locked)
                        .on_click(
                            cx.listener(|this, _, window, cx| this.apply_candidate(window, cx)),
                        ),
                );
            if let Some(cid) = candidate
                .conversation_id
                .clone()
                .or_else(|| product.and_then(|p| p.conversation_id.clone()))
            {
                panel = panel.child(
                    Button::new("candidate-source-conversation")
                        .ghost()
                        .xsmall()
                        .label(crate::settings::t("查看生成来源会话"))
                        .on_click(cx.listener(move |_, _, _, cx| {
                            cx.emit(InboxEvent::OpenConversation {
                                conversation_id: cid.clone(),
                            })
                        })),
                );
            }
            draft = draft.child(panel);
        }
        if let Some(err) = item.draft_error.as_ref().filter(|e| !e.is_empty()) {
            draft = draft.child(div().text_xs().text_color(theme.danger).child(err.clone()));
        }
        if self.server_changed && self.conflict.is_none() {
            draft = draft.child(
                h_flex()
                    .gap_2()
                    .items_center()
                    .child(
                        div()
                            .text_xs()
                            .text_color(theme.warning)
                            .child(crate::settings::t("服务器上的事项已更新，本地修改未被覆盖")),
                    )
                    .child(
                        Button::new("inbox-take-server-hint")
                            .xsmall()
                            .ghost()
                            .label(crate::settings::t("放弃本地修改并载入"))
                            .on_click(
                                cx.listener(|this, _, window, cx| this.discard_edits(window, cx)),
                            ),
                    ),
            );
        }
        if let Some(server) = &self.conflict {
            draft = draft.child(
                v_flex()
                    .gap_1()
                    .p_2()
                    .rounded_md()
                    .border_1()
                    .border_color(theme.warning)
                    .child(
                        div()
                            .text_sm()
                            .font_weight(FontWeight::MEDIUM)
                            .child(crate::settings::t("保存冲突")),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(theme.muted_foreground)
                            .child(crate::settings::t("服务器版本：")),
                    )
                    .child(div().text_xs().child(snippet(
                        server.draft.as_deref().unwrap_or("（无草稿）"),
                        600,
                    )))
                    .child(
                        div()
                            .text_xs()
                            .text_color(theme.muted_foreground)
                            .child(crate::settings::t("我的版本：")),
                    )
                    .child(
                        div()
                            .text_xs()
                            .child(snippet(&self.editor.read(cx).value(), 600)),
                    )
                    .child(
                        h_flex()
                            .gap_2()
                            .child(
                                Button::new("inbox-keep-mine")
                                    .xsmall()
                                    .primary()
                                    .label(crate::settings::t("保留我的并保存"))
                                    .disabled(busy.is_some())
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.conflict_keep_mine(window, cx)
                                    })),
                            )
                            .child(
                                Button::new("inbox-take-server")
                                    .xsmall()
                                    .outline()
                                    .label(crate::settings::t("使用服务器版本"))
                                    .disabled(busy.is_some())
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.conflict_take_server(window, cx)
                                    })),
                            ),
                    ),
            );
        }
        draft = draft.when(
            self.editing
                || dirty
                || item.draft.as_deref().is_none_or(|s| s.trim().is_empty())
                || item.draft_error.is_some(),
            |draft| {
                draft.child(
                    h_flex()
                        .gap_2()
                        .flex_wrap()
                        .child(
                            Button::new("inbox-save")
                                .small()
                                .primary()
                                .label(crate::settings::t("保存草稿"))
                                .loading(busy == Some(Busy::Save))
                                .disabled(
                                    !dirty || locked || busy.is_some() || self.conflict.is_some(),
                                )
                                .on_click(
                                    cx.listener(|this, _, window, cx| this.save_draft(window, cx)),
                                ),
                        )
                        .child(
                            Button::new("inbox-discard")
                                .small()
                                .ghost()
                                .label(crate::settings::t("放弃修改"))
                                .disabled(!dirty || busy.is_some())
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.discard_edits(window, cx)
                                })),
                        )
                        .child(
                            Button::new("inbox-generate")
                                .accessibility_label(crate::settings::t(
                                    if self
                                        .draft_request
                                        .as_ref()
                                        .is_some_and(|(i, _)| *i == item.id)
                                        && busy.is_none()
                                    {
                                        "重试生成"
                                    } else {
                                        "生成草稿"
                                    },
                                ))
                                .small()
                                .outline()
                                .label(crate::settings::t(
                                    if self
                                        .draft_request
                                        .as_ref()
                                        .is_some_and(|(i, _)| *i == item.id)
                                        && busy.is_none()
                                    {
                                        "重试生成"
                                    } else {
                                        "生成草稿"
                                    },
                                ))
                                .loading(busy == Some(Busy::Generate))
                                .disabled(locked || busy.is_some() || dirty)
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.generate_draft(window, cx)
                                })),
                        ),
                )
            },
        );
        body = body.child(draft);

        // Send section
        let can_send = item.can_send();
        let receipt = item
            .receipt
            .as_ref()
            .map(|r| receipt_ids(Some(r)))
            .filter(|v| !v.is_empty());
        let mut send = v_flex().gap_2();
        if can_send && item.sensitive && !locked {
            send = send.child(
                Checkbox::new("inbox-sensitive-ok")
                    .checked(self.sensitive_ok)
                    .label(crate::settings::t("我已审阅并明确批准发送此敏感内容"))
                    .on_click(cx.listener(|this, checked: &bool, _, cx| {
                        this.sensitive_ok = *checked;
                        cx.notify();
                    })),
            );
        }
        if let Some(ids) = &receipt {
            send = send.child(div().text_xs().text_color(theme.success).child(format!(
                "{}{}",
                crate::settings::t("回执消息 ID："),
                ids.join(", ")
            )));
        }
        if let Some(err) = item.send_error.as_ref().filter(|e| !e.is_empty()) {
            send = send.child(div().text_xs().text_color(theme.danger).child(err.clone()));
        }
        let send_label =
            if locked && !matches!(item.status.as_str(), "sent" | "delivered" | "recalled") {
                "回读发送结果"
            } else {
                "发送回复"
            };
        let sent_done = matches!(item.status.as_str(), "sent" | "delivered" | "recalled");
        let inspiration_id = item.id.clone();
        let inspiration_title = item.title.clone();
        let inspiration_body = item.body.clone();
        let mut actions = h_flex()
            .gap(px(8.))
            .items_center()
            .flex_wrap()
            .when(!done, |d| {
                d.child(
                    Button::new("inbox-dismiss")
                        .small()
                        .h(px(32.))
                        .px(px(11.))
                        .rounded(px(7.))
                        .ghost()
                        .accessibility_label(crate::settings::t("忽略"))
                        .child(
                            div()
                                .text_size(px(13.))
                                .line_height(relative(1.25))
                                .child(crate::settings::t("忽略")),
                        )
                        .disabled(locked || busy.is_some())
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.set_status("dismissed", window, cx)
                        })),
                )
                .child(
                    Button::new("inbox-done")
                        .small()
                        .h(px(32.))
                        .px(px(11.))
                        .rounded(px(7.))
                        .ghost()
                        .accessibility_label(crate::settings::t("标记完成"))
                        .child(
                            div()
                                .text_size(px(13.))
                                .line_height(relative(1.25))
                                .child(crate::settings::t("标记完成")),
                        )
                        .loading(busy == Some(Busy::Status))
                        .disabled(locked || busy.is_some())
                        .on_click(
                            cx.listener(|this, _, window, cx| this.set_status("done", window, cx)),
                        ),
                )
            })
            .when(done && !locked, |d| {
                d.child(
                    Button::new("inbox-reopen")
                        .small()
                        .h(px(32.))
                        .px(px(11.))
                        .rounded(px(7.))
                        .ghost()
                        .accessibility_label(crate::settings::t("重新打开"))
                        .child(
                            div()
                                .text_size(px(13.))
                                .line_height(relative(1.25))
                                .child(crate::settings::t("重新打开")),
                        )
                        .disabled(busy.is_some())
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.set_status("pending", window, cx)
                        })),
                )
            })
            .child(
                Button::new("inbox-inspiration")
                    .ghost()
                    .small()
                    .h(px(32.))
                    .px(px(11.))
                    .rounded(px(7.))
                    .accessibility_label(crate::settings::t("AI 灵感"))
                    .child(
                        div()
                            .text_size(px(13.))
                            .line_height(relative(1.25))
                            .child(crate::settings::t("AI 灵感")),
                    )
                    .disabled(busy.is_some())
                    .on_click(cx.listener(move |_, _, _, cx| {
                        cx.emit(InboxEvent::Inspiration {
                            inbox_id: inspiration_id.clone(),
                            title: inspiration_title.clone(),
                            body: inspiration_body.clone(),
                        })
                    })),
            )
            .child(div().flex_1())
            .child(
                Button::new("inbox-send")
                    .small()
                    .h(px(32.))
                    .px(px(11.))
                    .rounded(px(7.))
                    .primary()
                    .accessibility_label(crate::settings::t(send_label))
                    .child(
                        div()
                            .text_size(px(13.))
                            .line_height(relative(1.25))
                            .child(crate::settings::t(send_label)),
                    )
                    .loading(busy == Some(Busy::Send))
                    .disabled(!can_send || sent_done || busy.is_some() || dirty)
                    .tooltip(crate::settings::t(if can_send {
                        "使用保存在本机的幂等键发送给本人"
                    } else {
                        "仅本人 OPSADV-QA 测试项可外发"
                    }))
                    .on_click(cx.listener(|this, _, window, cx| this.send(false, window, cx))),
            );
        if self.send_needs_new_key && can_send && !sent_done {
            actions = actions.child(
                Button::new("inbox-send-new-key")
                    .small()
                    .outline()
                    .label(crate::settings::t("确认无回执，用新幂等键发送"))
                    .disabled(busy.is_some() || dirty)
                    .on_click(cx.listener(|this, _, window, cx| this.send(true, window, cx))),
            );
        }
        if receipt.is_some() && item.status != "recalled" {
            actions = actions.child(
                Button::new("inbox-undo")
                    .small()
                    .outline()
                    .icon(IconName::Undo2)
                    .label(crate::settings::t("撤回"))
                    .loading(busy == Some(Busy::Undo))
                    .disabled(busy.is_some())
                    .on_click(cx.listener(|this, _, window, cx| this.undo(window, cx))),
            );
        }
        send = send.child(actions);

        let footer = v_flex()
            .gap_2()
            .flex_shrink_0()
            .min_h(px(62.))
            .px(detail_horizontal)
            .py(footer_vertical)
            .border_t_1()
            .border_color(theme.border)
            .when_some(self.progress.clone(), |d, p| {
                d.child(div().text_xs().text_color(theme.muted_foreground).child(p))
            })
            .when_some(self.notice.clone(), |d, n| {
                d.child(div().text_xs().text_color(theme.success).child(n))
            })
            .when_some(self.action_error.clone(), |d, e| {
                d.child(div().text_xs().text_color(theme.danger).child(e))
            })
            .child(send);

        v_flex()
            .flex_1()
            .min_w_0()
            .h_full()
            .child(body)
            .child(footer)
            .into_any_element()
    }
}

fn avatar(url: Option<String>, name: &str, size: f32, cx: &App) -> AnyElement {
    let theme = cx.theme();
    let initials = if name.is_empty() {
        "?".to_string()
    } else {
        name.chars()
            .rev()
            .take(2)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<String>()
    };
    let fallback = initials.clone();
    div()
        .size(px(size))
        .flex_shrink_0()
        .rounded_full()
        .overflow_hidden()
        .bg(theme.secondary)
        .border_1()
        .border_color(theme.border)
        .flex()
        .items_center()
        .justify_center()
        .text_size(px(11.))
        .text_color(theme.muted_foreground)
        .when_some(
            url.clone()
                .filter(|u| u.starts_with("https://") || u.starts_with("http://")),
            |d, url| {
                d.child(
                    img(url)
                        .size_full()
                        // GPUI overflow clips to rectangular bounds. The image
                        // sprite needs its own radius for circular avatars.
                        .rounded_full()
                        .object_fit(ObjectFit::Cover)
                        .with_fallback(move || {
                            div()
                                .size_full()
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(fallback.clone())
                                .into_any_element()
                        }),
                )
            },
        )
        .when(
            !url.as_deref()
                .is_some_and(|u| u.starts_with("https://") || u.starts_with("http://")),
            |d| d.child(initials),
        )
        .into_any_element()
}
fn is_source_image(mime: &str) -> bool {
    matches!(
        mime.split(';').next().unwrap_or("").trim(),
        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    )
}
fn indexed_attachments(
    message: &serde_json::Value,
    client: &Client,
) -> Vec<(String, String, String)> {
    let mut attachments = Vec::new();
    if let Some(rows) = message["attachments"].as_array() {
        for row in rows {
            if let Some(url) = row["url"]
                .as_str()
                .and_then(|p| client.indexed_source_url(p))
            {
                attachments.push((
                    row["name"].as_str().unwrap_or("附件").to_string(),
                    url,
                    row["mimeType"].as_str().unwrap_or("").to_string(),
                ));
            }
        }
    }
    if let Some(rows) = message["local_attachments"].as_array() {
        for row in rows {
            if let (Some(mid), Some(key)) = (message["id"].as_str(), row["file_key"].as_str()) {
                if mid.is_empty() || key.is_empty() {
                    continue;
                }
                let url = client.source_asset_url(mid, key);
                if !attachments.iter().any(|(_, u, _)| u == &url) {
                    attachments.push((
                        row["name"].as_str().unwrap_or(key).to_string(),
                        url,
                        row["mime_type"].as_str().unwrap_or("").to_string(),
                    ));
                }
            }
        }
    }
    attachments
}
/// Escape source markdown, then expose only literal HTTP(S) URLs as links.
/// Source content cannot create executable schemes, embedded images or raw HTML.
fn source_text(text: &str, id: SharedString, cx: &App) -> AnyElement {
    let escape = |s: &str| {
        let mut escaped = String::new();
        for c in s.chars() {
            if matches!(
                c,
                '\\' | '[' | ']' | '*' | '_' | '`' | '<' | '>' | '#' | '!' | '|'
            ) {
                escaped.push('\\');
            }
            escaped.push(c);
        }
        escaped
    };
    let mut markdown = String::new();
    for token in text.split_inclusive(char::is_whitespace) {
        let word = token.trim_end_matches(char::is_whitespace);
        let whitespace = &token[word.len()..];
        if word.starts_with("https://") || word.starts_with("http://") {
            let url = word.trim_end_matches([
                ')', ',', '.', ';', ':', '!', '?', ']', '}', '>', '，', '。', '；', '：', '！',
                '？', '）', '】', '》',
            ]);
            let target = url
                .replace('(', "%28")
                .replace(')', "%29")
                .replace('[', "%5B")
                .replace(']', "%5D");
            markdown.push_str(&format!(
                "[{}]({}){}",
                escape(url),
                target,
                escape(&word[url.len()..])
            ));
        } else {
            markdown.push_str(&escape(word));
        }
        markdown.push_str(whitespace);
    }
    crate::util::markdown(ElementId::Name(id), markdown)
        .text_size(crate::settings::body_px(12., cx))
        .selectable(true)
        .on_link_click(|url, _, _, cx| {
            if url.starts_with("https://") || url.starts_with("http://") {
                cx.open_url(url);
            }
        })
        .into_any_element()
}
fn compact_time(raw: &str) -> String {
    let Some(date) = crate::util::parse_ms(raw)
        .and_then(chrono::DateTime::from_timestamp_millis)
        .map(|d| d.with_timezone(&Local))
    else {
        return crate::settings::t("时间未知");
    };
    let today = Local::now().date_naive();
    let day = date.date_naive();
    let yesterday = today.pred_opt();
    if day == today {
        return date.format("%H:%M").to_string();
    }
    if Some(day) == yesterday {
        return format!("{} {}", crate::settings::t("昨天"), date.format("%H:%M"));
    }
    let week_start = today - chrono::Duration::days(today.weekday().num_days_from_monday() as i64);
    if day >= week_start && day < today {
        return crate::settings::t(
            [
                "星期一",
                "星期二",
                "星期三",
                "星期四",
                "星期五",
                "星期六",
                "星期日",
            ][day.weekday().num_days_from_monday() as usize],
        );
    }
    date.format("%m/%d").to_string()
}

enum SendOutcome {
    Sent(opstwin_api::SendResult),
    AlreadySent(InboxItem),
    Changed(InboxItem),
}

fn receipt_ids(r: Option<&opstwin_api::Receipt>) -> Vec<String> {
    let Some(r) = r else { return Vec::new() };
    let mut ids = r.message_ids.clone();
    if ids.is_empty() {
        ids.extend(r.message_id.clone());
    }
    ids
}

fn uuid_simple() -> String {
    // Reuse the API crate's v4 generator without adding a dependency here.
    opstwin_api::new_idempotency_key()
        .trim_start_matches("native-")
        .to_string()
}

fn status_label(s: &str) -> &'static str {
    match s {
        "pending" => "待处理",
        "queued" => "排队中",
        "sending" => "发送中",
        "send_unknown" => "发送结果未知",
        "send_failed" => "发送失败",
        "sent" => "已发送",
        "delivered" => "已送达",
        "recalled" => "已撤回",
        "done" => "已完成",
        "dismissed" => "已忽略",
        "cancelled" => "已取消",
        "failed" => "失败",
        _ => "其他",
    }
}

impl Render for InboxView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // Server locale arrives after these persistent inputs are restored.
        // Changing hints must not emit an edit, reload, or generation attempt.
        let placeholder = crate::settings::t("搜索收件箱");
        if self.placeholder_locale != placeholder {
            self.placeholder_locale = placeholder.clone();
            self.search.update(cx, |input, cx| {
                input.set_placeholder(placeholder, window, cx)
            });
            self.editor.update(cx, |input, cx| {
                input.set_placeholder(crate::settings::t("回复草稿（保存后才能发送）"), window, cx)
            });
        }
        if self.visible && std::mem::take(&mut self.stale) {
            let handle = cx.entity().downgrade();
            window.defer(cx, move |window, cx| {
                _ = handle.update(cx, |this, cx| {
                    if !this.visible {
                        this.stale = true;
                        return;
                    }
                    this.refresh_list(window, cx);
                    this.reload_detail(window, cx);
                });
            });
        }
        let theme = cx.theme().clone();
        h_flex()
            .size_full()
            .bg(theme.background)
            .text_color(theme.foreground)
            .child(self.render_list(window, cx))
            .child(
                v_flex()
                    .h_full()
                    .flex_1()
                    .min_w_0()
                    .when(self.undo_status.is_some(), |d| {
                        d.child(
                            h_flex()
                                .px_4()
                                .py_2()
                                .gap_3()
                                .text_xs()
                                .bg(theme.secondary)
                                .child(crate::settings::t("已处理上一条事项"))
                                .child(
                                    Button::new("inbox-undo-status")
                                        .ghost()
                                        .xsmall()
                                        .label(crate::settings::t("撤销"))
                                        .disabled(self.busy.is_some())
                                        .on_click(cx.listener(|this, _, window, cx| {
                                            this.reopen_previous(window, cx)
                                        })),
                                ),
                        )
                    })
                    .child(self.render_detail(window, cx)),
            )
            .when(self.source_preview.is_some(), |d| {
                d.child(self.render_source_preview(cx))
            })
    }
}
