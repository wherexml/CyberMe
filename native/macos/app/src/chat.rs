//! Chat window: primary conversation history, markdown rendering, composer,
//! send with idempotent retry, and SSE-driven refresh.
//!
//! Never logs message bodies; log lines carry ids, counts and error codes only.

use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, Sizable as _, StyledExt as _,
    bubble::{Bubble, BubbleVariant},
    button::{Button, ButtonVariants as _},
    h_flex,
    input::{InputEvent, Textarea, TextareaState},
    message::{Message, MessageAlignment, MessageContent, MessageFooter},
    message_scroller::{MessageScroller, MessageScrollerState},
    text::TextView,
    v_flex,
};
use gpui_kit::*;
use gpui_kit::prelude::FluentBuilder as _;
use opstwin_api::{ApiError, ChatRequest, Client, Role};

use crate::runtime::{io, sleep};

const PAGE: u32 = 50;
const EARLIER_KEY: &str = "\u{0}earlier";
const MAX_AUTO_RETRIES: u32 = 3;

#[derive(Clone, Debug, PartialEq)]
enum Conn {
    Connecting,
    Live,
    Polling,
    Offline(String),
}

#[derive(Clone, Debug, PartialEq)]
enum SendState {
    /// Request in flight (includes automatic retries with the same requestId).
    Sending { attempt: u32 },
    /// Server says the original request is still running; waiting for a
    /// revision event before re-reading.
    Waiting,
    /// Failed; `retryable` decides whether Retry (same requestId) is offered.
    Failed { message: String, retryable: bool },
}

#[derive(Clone)]
struct Outgoing {
    request_id: String,
    text: SharedString,
    state: SendState,
    /// Increments on every user-initiated retry, so a stale task can tell
    /// it has been superseded.
    generation: u32,
}

#[derive(Clone)]
struct ServerMsg {
    id: SharedString,
    role: Role,
    content: SharedString,
    created_at: String,
    request_id: Option<String>,
}

#[derive(Clone)]
enum Row {
    Earlier { loading: bool, auto: bool },
    Server { msg: ServerMsg, outgoing: Option<Outgoing> },
    Local(Outgoing),
}

impl Row {
    fn key(&self) -> String {
        match self {
            Row::Earlier { .. } => EARLIER_KEY.to_string(),
            Row::Server { msg, .. } => msg.id.to_string(),
            Row::Local(o) => format!("local-{}", o.request_id),
        }
    }
    /// Fingerprint used to decide whether a kept row must be remeasured.
    fn shape(&self) -> (usize, String) {
        match self {
            Row::Earlier { loading, .. } => (0, loading.to_string()),
            Row::Server { msg, outgoing } => (
                msg.content.len(),
                outgoing.as_ref().map(|o| format!("{:?}", o.state)).unwrap_or_default(),
            ),
            Row::Local(o) => (o.text.len(), format!("{:?}", o.state)),
        }
    }
}

pub struct ChatView {
    client: Client,
    conversation_id: Option<String>,
    title: SharedString,
    conn: Conn,
    load_error: Option<String>,
    initial_loading: bool,

    messages: Vec<ServerMsg>,
    known_ids: HashSet<SharedString>,
    has_more: bool,
    next_before: Option<String>,
    loading_earlier: bool,
    earlier_failed: bool,
    use_page_api: bool,

    outgoing: Vec<Outgoing>,
    revision: u64,
    refreshing: bool,
    refresh_again: bool,

    rows: Rc<Vec<Row>>,
    scroller: Entity<MessageScrollerState>,
    input: Entity<TextareaState>,
    _subscriptions: Vec<Subscription>,
    _tasks: Vec<Task<()>>,
}

impl ChatView {
    pub fn new(client: Client, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let scroller = cx.new(|cx| MessageScrollerState::new(0, cx));
        let input = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(1, 8)
                // Plain Enter emits PressEnter instead of inserting "\n";
                // Shift+Enter still inserts a newline.
                .submit_on_enter(true)
                .placeholder("给 OpsTwin 发消息（Enter 发送，Shift+Enter 换行）")
        });

        let subscriptions = vec![
            cx.observe(&scroller, |_, _, cx| cx.notify()),
            cx.subscribe_in(&input, window, Self::on_input_event),
        ];

        let focus = input.focus_handle(cx);
        window.defer(cx, move |window, cx| focus.focus(window, cx));

        let mut this = Self {
            client,
            conversation_id: None,
            title: "OpsTwin".into(),
            conn: Conn::Connecting,
            load_error: None,
            initial_loading: true,
            messages: Vec::new(),
            known_ids: HashSet::new(),
            has_more: false,
            next_before: None,
            loading_earlier: false,
            earlier_failed: false,
            use_page_api: true,
            outgoing: Vec::new(),
            revision: 0,
            refreshing: false,
            refresh_again: false,
            rows: Rc::new(Vec::new()),
            scroller,
            input,
            _subscriptions: subscriptions,
            _tasks: Vec::new(),
        };
        this.start(cx);
        this
    }

    // ---------------------------------------------------------------- loading

    fn start(&mut self, cx: &mut Context<Self>) {
        self.initial_loading = true;
        self.load_error = None;
        self.conn = Conn::Connecting;
        cx.notify();
        let client = self.client.clone();
        let task = cx.spawn(async move |this, cx| {
            let c = client.clone();
            let version = io(async move { c.version().await }).await;
            let (use_page, use_sse) = match &version {
                Ok(Some(v)) => (v.has("messages.page"), v.has("events.sse")),
                Ok(None) => (false, false),
                Err(e) => {
                    eprintln!("[opstwin] version probe failed: {e}");
                    let msg = e.user_text();
                    _ = this.update(cx, |this, cx| {
                        this.initial_loading = false;
                        this.load_error = Some(msg.clone());
                        this.conn = Conn::Offline(msg);
                        cx.notify();
                    });
                    return;
                }
            };
            if let Ok(Some(v)) = &version {
                eprintln!(
                    "[opstwin] server {} apiVersion={} revision={} features={:?}",
                    v.server, v.api_version, v.revision, v.features
                );
            } else {
                eprintln!("[opstwin] /api/native/version missing; falling back to bootstrap polling");
            }

            let c = client.clone();
            let primary = io(async move { c.primary_conversation().await }).await;
            let primary = match primary {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("[opstwin] primary conversation failed: {e}");
                    let msg = e.user_text();
                    _ = this.update(cx, |this, cx| {
                        this.initial_loading = false;
                        this.load_error = Some(msg);
                        cx.notify();
                    });
                    return;
                }
            };
            let conversation_id = primary.conversation_id.clone();
            let title = primary
                .conversation
                .as_ref()
                .and_then(|c| c.title.clone())
                .filter(|t| !t.trim().is_empty());

            let page = match &conversation_id {
                Some(id) => {
                    let (c, id) = (client.clone(), id.clone());
                    let r = io(async move {
                        if use_page {
                            c.messages_page(&id, None, PAGE).await
                        } else {
                            c.messages_from_bootstrap(&id, None, PAGE).await
                        }
                    })
                    .await;
                    Some(r)
                }
                None => None,
            };

            let ok = this
                .update(cx, |this, cx| {
                    this.use_page_api = use_page;
                    this.conversation_id = conversation_id.clone();
                    if let Some(t) = title {
                        this.title = t.into();
                    }
                    this.initial_loading = false;
                    match page {
                        Some(Ok(page)) => {
                            eprintln!(
                                "[opstwin] loaded {} messages (hasMore={})",
                                page.items.len(),
                                page.has_more
                            );
                            this.has_more = page.has_more;
                            this.next_before = page.next_before;
                            this.merge(page.items, cx);
                            this.scroller.update(cx, |s, cx| s.scroll_to_end(cx));
                            true
                        }
                        Some(Err(e)) => {
                            eprintln!("[opstwin] history load failed: {e}");
                            this.load_error = Some(e.user_text());
                            this.rebuild_rows(cx);
                            false
                        }
                        None => {
                            eprintln!("[opstwin] no primary conversation yet");
                            this.rebuild_rows(cx);
                            true
                        }
                    }
                })
                .unwrap_or(false);
            if ok {
                _ = this.update(cx, |this, cx| this.start_events(use_sse, cx));
            }
        });
        self._tasks.push(task);
    }

    /// Change signal: SSE when available, otherwise poll `/api/health`.
    fn start_events(&mut self, use_sse: bool, cx: &mut Context<Self>) {
        enum Signal {
            Connected(u64, bool),
            Revision(u64),
            Down(String),
        }
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Signal>();
        let client = self.client.clone();
        crate::runtime::runtime().spawn(async move {
            let mut last: Option<u64> = None;
            let mut backoff = 1u64;
            loop {
                if tx.is_closed() {
                    return;
                }
                if use_sse {
                    let txc = tx.clone();
                    let mut connected = false;
                    let res = client
                        .events(last, |ev| {
                            let rev = serde_json::from_str::<opstwin_api::RevisionData>(&ev.data)
                                .map(|d| d.revision)
                                .ok();
                            match (ev.event.as_str(), rev) {
                                ("hello", Some(r)) => {
                                    connected = true;
                                    _ = txc.send(Signal::Connected(r, true));
                                }
                                ("revision", Some(r)) => _ = txc.send(Signal::Revision(r)),
                                _ => {}
                            }
                        })
                        .await;
                    match res {
                        Ok(id) => {
                            last = id.or(last);
                            _ = tx.send(Signal::Down("事件流已断开".into()));
                        }
                        Err(e) => {
                            eprintln!("[opstwin] event stream error: {e}");
                            _ = tx.send(Signal::Down(e.user_text()));
                        }
                    }
                    if connected {
                        backoff = 1;
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(backoff)).await;
                    backoff = (backoff * 2).min(15);
                } else {
                    match client.health_revision().await {
                        Ok(r) => {
                            if last.is_none() {
                                _ = tx.send(Signal::Connected(r, false));
                            } else if last != Some(r) {
                                _ = tx.send(Signal::Revision(r));
                            }
                            last = Some(r);
                        }
                        Err(e) => _ = tx.send(Signal::Down(e.user_text())),
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
            }
        });

        let task = cx.spawn(async move |this, cx| {
            while let Some(sig) = rx.recv().await {
                let alive = this
                    .update(cx, |this, cx| {
                        match sig {
                            Signal::Connected(rev, sse) => {
                                let was_down = !matches!(this.conn, Conn::Live | Conn::Polling);
                                this.conn = if sse { Conn::Live } else { Conn::Polling };
                                let changed = rev != this.revision;
                                this.revision = rev;
                                // Re-read after reconnect: we may have missed changes.
                                if was_down && (changed || this.load_error.is_some()) {
                                    this.refresh_newest(cx);
                                }
                            }
                            Signal::Revision(rev) => {
                                this.revision = rev;
                                this.refresh_newest(cx);
                            }
                            Signal::Down(msg) => this.conn = Conn::Offline(msg),
                        }
                        cx.notify();
                    })
                    .is_ok();
                if !alive {
                    break;
                }
            }
        });
        self._tasks.push(task);
    }

    /// Fetch the newest page and merge by id. If the newest page does not
    /// overlap what we hold (more than one page of new messages), walk back
    /// until it does so the list has no gaps.
    fn refresh_newest(&mut self, cx: &mut Context<Self>) {
        let Some(conversation_id) = self.conversation_id.clone() else {
            // A first send may have created the primary conversation.
            if !self.initial_loading {
                self.start(cx);
            }
            return;
        };
        if self.refreshing {
            self.refresh_again = true;
            return;
        }
        self.refreshing = true;
        let client = self.client.clone();
        let use_page = self.use_page_api;
        let known: HashSet<SharedString> = self.known_ids.clone();
        let task = cx.spawn(async move |this, cx| {
            let result = io(async move {
                let mut collected = Vec::new();
                let mut before: Option<String> = None;
                for _ in 0..10 {
                    let page = if use_page {
                        client.messages_page(&conversation_id, before.as_deref(), PAGE).await?
                    } else {
                        client
                            .messages_from_bootstrap(&conversation_id, before.as_deref(), PAGE)
                            .await?
                    };
                    let overlaps =
                        known.is_empty() || page.items.iter().any(|m| known.contains(m.id.as_str()));
                    let more = page.has_more;
                    before = page.next_before.clone();
                    let mut items = page.items;
                    items.extend(collected);
                    collected = items;
                    if overlaps || !more || before.is_none() {
                        break;
                    }
                }
                Ok::<_, ApiError>(collected)
            })
            .await;
            _ = this.update(cx, |this, cx| {
                this.refreshing = false;
                match result {
                    Ok(items) => {
                        if this.load_error.is_some() {
                            this.load_error = None;
                        }
                        this.merge(items, cx);
                    }
                    Err(e) => eprintln!("[opstwin] refresh failed: {e}"),
                }
                if std::mem::take(&mut this.refresh_again) {
                    this.refresh_newest(cx);
                }
            });
        });
        self._tasks.push(task);
    }

    fn load_earlier(&mut self, cx: &mut Context<Self>) {
        if self.loading_earlier || !self.has_more {
            return;
        }
        let Some(conversation_id) = self.conversation_id.clone() else {
            return;
        };
        let before = self
            .next_before
            .clone()
            .or_else(|| self.messages.first().map(|m| m.id.to_string()));
        self.loading_earlier = true;
        self.rebuild_rows(cx);
        let client = self.client.clone();
        let use_page = self.use_page_api;
        let task = cx.spawn(async move |this, cx| {
            let result = io(async move {
                if use_page {
                    client.messages_page(&conversation_id, before.as_deref(), PAGE).await
                } else {
                    client
                        .messages_from_bootstrap(&conversation_id, before.as_deref(), PAGE)
                        .await
                }
            })
            .await;
            _ = this.update(cx, |this, cx| {
                this.loading_earlier = false;
                match result {
                    Ok(page) => {
                        eprintln!(
                            "[opstwin] loaded {} earlier messages (hasMore={})",
                            page.items.len(),
                            page.has_more
                        );
                        this.earlier_failed = false;
                        this.has_more = page.has_more;
                        this.next_before = page.next_before;
                        this.merge(page.items, cx);
                    }
                    Err(e) => {
                        eprintln!("[opstwin] load earlier failed: {e}");
                        // Stop auto-loading on scroll; the button still works.
                        this.earlier_failed = true;
                        this.rebuild_rows(cx);
                    }
                }
            });
        });
        self._tasks.push(task);
    }

    /// Merge server messages by id (update in place, insert new), keep
    /// ascending createdAt order, then rebuild rows.
    fn merge(&mut self, items: Vec<opstwin_api::Message>, cx: &mut Context<Self>) {
        let mut index: HashMap<SharedString, usize> = self
            .messages
            .iter()
            .enumerate()
            .map(|(i, m)| (m.id.clone(), i))
            .collect();
        let mut inserted = false;
        for m in items {
            if !matches!(m.role, Role::User | Role::Assistant) {
                continue;
            }
            let msg = ServerMsg {
                id: m.id.clone().into(),
                role: m.role,
                content: m.content.into(),
                created_at: m.created_at,
                request_id: m.request_id,
            };
            if let Some(&i) = index.get(&msg.id) {
                self.messages[i] = msg;
            } else {
                index.insert(msg.id.clone(), self.messages.len());
                self.known_ids.insert(msg.id.clone());
                self.messages.push(msg);
                inserted = true;
            }
        }
        if inserted {
            // Stable sort keeps server order for equal timestamps.
            self.messages.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        }
        self.rebuild_rows(cx);
    }

    /// Recompute the row list and tell the virtual list exactly which range
    /// changed (common prefix/suffix by key), so prepends keep the reader's
    /// anchor and appends follow the tail.
    fn rebuild_rows(&mut self, cx: &mut Context<Self>) {
        let mut rows = Vec::with_capacity(self.messages.len() + self.outgoing.len() + 1);
        if self.has_more && self.conversation_id.is_some() {
            rows.push(Row::Earlier { loading: self.loading_earlier, auto: !self.earlier_failed });
        }
        let mut on_server: HashSet<&str> = HashSet::new();
        for m in &self.messages {
            let outgoing = m.request_id.as_deref().and_then(|rid| {
                self.outgoing.iter().find(|o| o.request_id == rid).cloned()
            });
            if let Some(rid) = m.request_id.as_deref() {
                on_server.insert(rid);
            }
            rows.push(Row::Server { msg: m.clone(), outgoing });
        }
        for o in &self.outgoing {
            if !on_server.contains(o.request_id.as_str()) {
                rows.push(Row::Local(o.clone()));
            }
        }

        let old = &self.rows;
        let old_keys: Vec<String> = old.iter().map(Row::key).collect();
        let new_keys: Vec<String> = rows.iter().map(Row::key).collect();
        let mut prefix = 0;
        while prefix < old_keys.len()
            && prefix < new_keys.len()
            && old_keys[prefix] == new_keys[prefix]
        {
            prefix += 1;
        }
        let mut suffix = 0;
        while suffix < old_keys.len() - prefix
            && suffix < new_keys.len() - prefix
            && old_keys[old_keys.len() - 1 - suffix] == new_keys[new_keys.len() - 1 - suffix]
        {
            suffix += 1;
        }
        // Kept rows whose content/state changed need remeasuring.
        let mut changed: Vec<usize> = Vec::new();
        for i in (0..prefix).chain(new_keys.len() - suffix..new_keys.len()) {
            let oi = if i < prefix { i } else { i - new_keys.len() + old_keys.len() };
            if old[oi].shape() != rows[i].shape() {
                changed.push(i);
            }
        }
        let old_range = prefix..old_keys.len() - suffix;
        let new_count = new_keys.len() - prefix - suffix;
        self.rows = Rc::new(rows);
        self.scroller.update(cx, |s, cx| {
            if !old_range.is_empty() || new_count > 0 {
                s.splice(old_range, new_count, cx);
            }
            for i in changed {
                s.remeasure_items(i..i + 1, cx);
            }
        });
        cx.notify();
    }

    // ------------------------------------------------------------- composing

    fn on_input_event(
        &mut self,
        input: &Entity<TextareaState>,
        event: &InputEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let InputEvent::PressEnter { shift: false, .. } = event {
            // Belt and braces: on macOS GPUI routes keys to NSTextInputContext
            // while marked text exists, so an IME-confirming Enter never
            // reaches the `Enter` binding. Still refuse to send if a
            // composition is somehow active.
            let composing = input.update(cx, |state, cx| {
                state.marked_text_range(window, cx).is_some()
            });
            if composing {
                return;
            }
            self.send(window, cx);
        }
    }

    fn send(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let composing = self
            .input
            .update(cx, |state, cx| state.marked_text_range(window, cx).is_some());
        if composing {
            return;
        }
        let text = self.input.read(cx).value().trim().to_string();
        if text.is_empty() {
            return;
        }
        if self.initial_loading {
            return;
        }
        self.input.update(cx, |s, cx| s.set_value("", window, cx));
        let outgoing = Outgoing {
            request_id: opstwin_api::new_request_id(),
            text: text.into(),
            state: SendState::Sending { attempt: 1 },
            generation: 0,
        };
        eprintln!("[opstwin] send {}", outgoing.request_id);
        let rid = outgoing.request_id.clone();
        self.outgoing.push(outgoing);
        self.rebuild_rows(cx);
        self.scroller.update(cx, |s, cx| s.scroll_to_end(cx));
        self.run_send(rid, cx);
    }

    fn retry(&mut self, request_id: &str, cx: &mut Context<Self>) {
        let Some(o) = self.outgoing.iter_mut().find(|o| o.request_id == request_id) else {
            return;
        };
        if !matches!(o.state, SendState::Failed { retryable: true, .. }) {
            return;
        }
        o.generation += 1;
        o.state = SendState::Sending { attempt: 1 };
        eprintln!("[opstwin] manual retry {request_id}");
        self.rebuild_rows(cx);
        self.run_send(request_id.to_string(), cx);
    }

    fn dismiss(&mut self, request_id: &str, cx: &mut Context<Self>) {
        self.outgoing.retain(|o| o.request_id != request_id);
        self.rebuild_rows(cx);
    }

    fn set_send_state(&mut self, rid: &str, generation: u32, state: SendState, cx: &mut Context<Self>) -> bool {
        match self.outgoing.iter_mut().find(|o| o.request_id == rid) {
            Some(o) if o.generation == generation => {
                o.state = state;
                self.rebuild_rows(cx);
                true
            }
            _ => false,
        }
    }

    /// Drive one outgoing message to a terminal state. Always reuses the
    /// same requestId so the server can de-duplicate.
    fn run_send(&mut self, rid: String, cx: &mut Context<Self>) {
        let Some(o) = self.outgoing.iter().find(|o| o.request_id == rid) else {
            return;
        };
        let generation = o.generation;
        let req = ChatRequest {
            conversation_id: self.conversation_id.clone(),
            message: o.text.to_string(),
            request_id: rid.clone(),
        };
        let client = self.client.clone();
        let task = cx.spawn(async move |this, cx| {
            let mut attempt = 1u32;
            let mut waits = 0u32;
            loop {
                let (c, r) = (client.clone(), req.clone());
                let result = io(async move { c.chat(&r).await }).await;
                match result {
                    Ok(resp) => {
                        eprintln!(
                            "[opstwin] chat {} ok (replayed={})",
                            rid, resp.replayed
                        );
                        _ = this.update(cx, |this, cx| {
                            if this.conversation_id.is_none() {
                                this.conversation_id = Some(resp.conversation_id.clone());
                            }
                            this.outgoing.retain(|o| o.request_id != rid);
                            let items: Vec<_> = resp
                                .user_message
                                .into_iter()
                                .chain(resp.assistant_message)
                                .collect();
                            this.merge(items, cx);
                            this.refresh_newest(cx);
                        });
                        return;
                    }
                    Err(e) if e.is_in_progress() => {
                        eprintln!("[opstwin] chat {rid} in progress; waiting for revision");
                        let still = this
                            .update(cx, |this, cx| {
                                this.set_send_state(&rid, generation, SendState::Waiting, cx)
                            })
                            .unwrap_or(false);
                        if !still {
                            return;
                        }
                        // Wait for a revision change (or 5 s), re-read, then ask again.
                        let start_rev = this.update(cx, |this, _| this.revision).unwrap_or(0);
                        for _ in 0..10 {
                            sleep(500).await;
                            let rev = this.update(cx, |this, _| this.revision).unwrap_or(0);
                            if rev != start_rev {
                                break;
                            }
                        }
                        _ = this.update(cx, |this, cx| this.refresh_newest(cx));
                        waits += 1;
                        if waits > 720 {
                            _ = this.update(cx, |this, cx| {
                                this.set_send_state(
                                    &rid,
                                    generation,
                                    SendState::Failed {
                                        message: "原运行长时间未结束".into(),
                                        retryable: true,
                                    },
                                    cx,
                                )
                            });
                            return;
                        }
                    }
                    Err(e) if e.is_conflict() => {
                        eprintln!("[opstwin] chat {rid} request_conflict; not retrying");
                        _ = this.update(cx, |this, cx| {
                            this.set_send_state(
                                &rid,
                                generation,
                                SendState::Failed { message: e.user_text(), retryable: false },
                                cx,
                            )
                        });
                        return;
                    }
                    Err(e) if e.is_retryable() && attempt < MAX_AUTO_RETRIES => {
                        eprintln!("[opstwin] chat {rid} attempt {attempt} failed: {e}; retrying");
                        let delay = 1000u64 << (attempt - 1);
                        attempt += 1;
                        let still = this
                            .update(cx, |this, cx| {
                                this.set_send_state(&rid, generation, SendState::Sending { attempt }, cx)
                            })
                            .unwrap_or(false);
                        if !still {
                            return;
                        }
                        sleep(delay).await;
                    }
                    Err(e) => {
                        eprintln!("[opstwin] chat {rid} failed: {e}");
                        let retryable = e.is_retryable();
                        _ = this.update(cx, |this, cx| {
                            this.set_send_state(
                                &rid,
                                generation,
                                SendState::Failed { message: e.user_text(), retryable },
                                cx,
                            );
                            // The user message may have been stored before the failure.
                            this.refresh_newest(cx);
                        });
                        return;
                    }
                }
            }
        });
        self._tasks.push(task);
    }

    // -------------------------------------------------------------- rendering

    fn render_row(row: &Row, ix: usize, view: WeakEntity<Self>, cx: &mut App) -> AnyElement {
        match row {
            Row::Earlier { loading, auto } => {
                if !*loading && *auto {
                    // Reaching the top of the list loads the previous page.
                    let view = view.clone();
                    cx.defer(move |cx| {
                        _ = view.update(cx, |this, cx| this.load_earlier(cx));
                    });
                }
                h_flex()
                    .w_full()
                    .justify_center()
                    .py_2()
                    .child(
                        Button::new("load-earlier")
                            .ghost()
                            .small()
                            .loading(*loading)
                            .label(if *loading { "正在加载更早消息…" } else { "加载更早消息" })
                            .on_click(move |_, _, cx| {
                                _ = view.update(cx, |this, cx| this.load_earlier(cx));
                            }),
                    )
                    .into_any_element()
            }
            Row::Server { msg, outgoing } => Self::render_message(
                &msg.id,
                msg.role == Role::User,
                &msg.content,
                outgoing.as_ref(),
                ix,
                view,
                cx,
            ),
            Row::Local(o) => {
                let id: SharedString = format!("local-{}", o.request_id).into();
                Self::render_message(&id, true, &o.text, Some(o), ix, view, cx)
            }
        }
    }

    fn render_message(
        id: &SharedString,
        is_user: bool,
        content: &SharedString,
        outgoing: Option<&Outgoing>,
        _ix: usize,
        view: WeakEntity<Self>,
        cx: &App,
    ) -> AnyElement {
        let theme = cx.theme();
        let body = TextView::markdown(ElementId::Name(format!("md-{id}").into()), content.clone())
            .selectable(true);
        let bubble = Bubble::new()
            .with_variant(if is_user { BubbleVariant::Muted } else { BubbleVariant::Ghost })
            .child(body);
        let mut message = Message::new()
            .id(ElementId::Name(format!("msg-{id}").into()))
            .alignment(if is_user { MessageAlignment::End } else { MessageAlignment::Start })
            .content(MessageContent::new().bubble(bubble));
        if is_user {
            message = message.with_stack_style(StyleRefinement::default().max_w(relative(0.82)));
        }

        if let Some(o) = outgoing {
            let footer = match &o.state {
                SendState::Sending { attempt } => h_flex().gap_2().child(
                    div().text_xs().text_color(theme.muted_foreground).child(if *attempt > 1 {
                        format!("发送中…（第 {attempt} 次尝试）")
                    } else {
                        "发送中…".to_string()
                    }),
                ),
                SendState::Waiting => h_flex().child(
                    div()
                        .text_xs()
                        .text_color(theme.muted_foreground)
                        .child("原请求仍在运行，等待结果…"),
                ),
                SendState::Failed { message, retryable } => {
                    let rid_retry = o.request_id.clone();
                    let rid_dismiss = o.request_id.clone();
                    let v1 = view.clone();
                    let v2 = view.clone();
                    h_flex()
                        .gap_2()
                        .items_center()
                        .child(
                            div()
                                .text_xs()
                                .text_color(theme.danger)
                                .child(format!("发送失败：{message}")),
                        )
                        .when(*retryable, |this| {
                            this.child(
                                Button::new(ElementId::Name(format!("retry-{rid_retry}").into()))
                                    .xsmall()
                                    .outline()
                                    .label("重试")
                                    .on_click(move |_, _, cx| {
                                        _ = v1.update(cx, |this, cx| this.retry(&rid_retry, cx));
                                    }),
                            )
                        })
                        .child(
                            Button::new(ElementId::Name(format!("dismiss-{rid_dismiss}").into()))
                                .xsmall()
                                .ghost()
                                .label("移除")
                                .on_click(move |_, _, cx| {
                                    _ = v2.update(cx, |this, cx| this.dismiss(&rid_dismiss, cx));
                                }),
                        )
                }
            };
            message = message.footer(MessageFooter::new().child(footer));
        }
        message.into_any_element()
    }

    fn render_header(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let (dot, label) = match &self.conn {
            Conn::Connecting => (theme.muted_foreground, "连接中…".to_string()),
            Conn::Live => (theme.success, "实时同步".to_string()),
            Conn::Polling => (theme.warning, "轮询同步".to_string()),
            Conn::Offline(msg) => (theme.danger, format!("离线：{msg}")),
        };
        h_flex()
            .w_full()
            .px_4()
            .py_2()
            .gap_3()
            .items_center()
            .border_b_1()
            .border_color(theme.border)
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .overflow_hidden()
                    .text_ellipsis()
                    .whitespace_nowrap()
                    .font_semibold()
                    .child(self.title.clone()),
            )
            .child(
                h_flex()
                    .gap_1p5()
                    .items_center()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(div().size_2().rounded_full().bg(dot))
                    .child(label),
            )
    }
}

impl Render for ChatView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let rows = self.rows.clone();
        let view = cx.entity().downgrade();
        let sending_blocked = self.initial_loading;

        let body: AnyElement = if self.initial_loading {
            div()
                .flex_1()
                .flex()
                .items_center()
                .justify_center()
                .text_color(theme.muted_foreground)
                .child("正在加载对话…")
                .into_any_element()
        } else if let (Some(err), true) = (&self.load_error, self.rows.is_empty()) {
            v_flex()
                .flex_1()
                .items_center()
                .justify_center()
                .gap_3()
                .child(div().text_color(theme.danger).child(format!("加载失败：{err}")))
                .child(
                    Button::new("reload")
                        .outline()
                        .label("重新加载")
                        .on_click(cx.listener(|this, _, _, cx| this.start(cx))),
                )
                .into_any_element()
        } else if self.rows.is_empty() {
            div()
                .flex_1()
                .flex()
                .items_center()
                .justify_center()
                .text_color(theme.muted_foreground)
                .child("还没有消息，发送第一条吧")
                .into_any_element()
        } else {
            div()
                .flex_1()
                .min_h_0()
                .w_full()
                .child(
                    MessageScroller::new("chat-messages", self.scroller.clone(), move |ix, _, cx| {
                        match rows.get(ix) {
                            Some(row) => Self::render_row(row, ix, view.clone(), cx),
                            None => div().into_any_element(),
                        }
                    })
                    .with_jump_button_label("回到最新")
                    .with_list_style(StyleRefinement::default().px_4().py_3())
                    .with_bottom_fade(theme.background),
                )
                .into_any_element()
        };

        v_flex()
            .size_full()
            .bg(theme.background)
            .text_color(theme.foreground)
            .child(self.render_header(cx))
            .when_some(
                self.load_error.clone().filter(|_| !self.rows.is_empty()),
                |this, err| {
                    this.child(
                        div()
                            .px_4()
                            .py_1()
                            .text_xs()
                            .text_color(theme.danger)
                            .child(format!("刷新失败：{err}")),
                    )
                },
            )
            .child(body)
            .child(
                h_flex()
                    .w_full()
                    .gap_2()
                    .p_3()
                    .items_end()
                    .border_t_1()
                    .border_color(theme.border)
                    .child(div().flex_1().min_w_0().child(Textarea::new(&self.input)))
                    .child(
                        Button::new("send")
                            .primary()
                            .label("发送")
                            .disabled(sending_blocked)
                            .on_click(cx.listener(|this, _, window, cx| this.send(window, cx))),
                    ),
            )
    }
}
