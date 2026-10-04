//! Chat page: primary conversation history, markdown rendering, composer with
//! file attachments, idempotent send/retry, local persistence of the unsent
//! draft and outgoing messages, and revision-driven refresh.
//!
//! Never logs message bodies; log lines carry ids, counts and error codes only.

use crate::settings::t;
use chrono::{Datelike as _, TimeZone as _};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;
use std::rc::Rc;

use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, Icon, IconName, Sizable as _, WindowExt as _,
    bubble::{Bubble, BubbleContent, BubbleVariant},
    button::{Button, ButtonVariants as _},
    dialog::DialogButtonProps,
    h_flex,
    input::{Input, InputEvent, InputState, Textarea, TextareaState},
    menu::{DropdownMenu as _, PopupMenuItem},
    message::{Message, MessageAlignment, MessageContent, MessageFooter},
    message_scroller::{MessageScroller, MessageScrollerState},
    v_flex,
};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use opstwin_api::{ApiError, Artifact, ChatRequest, Client, Role};
use opstwin_store::{AttachmentRef, ChatState, OutgoingRecord, OutgoingState};

use crate::persist::Saver;
use crate::runtime::{io, sleep};
use crate::sync::{SyncEvent, SyncHub};

const PAGE: u32 = 50;
const EARLIER_KEY: &str = "\u{0}earlier";
use gpui_kit::assets::IconName as ProductIcon;
use opstwin_api::chat_product::{Continuation, RecoveryIntent, SessionState};
use opstwin_store::{ConversationDraft, ConversationState};

#[derive(Clone, Debug, PartialEq)]
enum SendState {
    /// Request in flight (includes automatic retries with the same requestId).
    Sending { attempt: u32 },
    /// Original request confirmed running by a read-only receipt poll.
    Waiting,
    /// POST remains in flight, but its receipt could not be confirmed.
    Checking,
    /// Failed; `retryable` decides whether Retry (same requestId) is offered.
    Failed { message: String, retryable: bool },
}

#[derive(Clone)]
struct Outgoing {
    context_ids: Vec<String>,
    conversation_id: Option<String>,
    delivery: Option<String>,
    request_id: String,
    text: SharedString,
    attachments: Vec<AttachmentRef>,
    state: SendState,
    /// Increments on every user-initiated retry, so a stale task can tell
    /// it has been superseded.
    generation: u32,
    created_at_ms: u64,
}

impl Outgoing {
    fn to_record(&self) -> OutgoingRecord {
        let (state, error, retryable) = match &self.state {
            SendState::Sending { .. } => (OutgoingState::Pending, None, true),
            SendState::Waiting | SendState::Checking => (OutgoingState::Waiting, None, true),
            SendState::Failed { message, retryable } => {
                (OutgoingState::Failed, Some(message.clone()), *retryable)
            }
        };
        OutgoingRecord {
            context_ids: self.context_ids.clone(),
            conversation_id: self.conversation_id.clone(),
            delivery: self.delivery.clone(),
            request_id: self.request_id.clone(),
            text: self.text.to_string(),
            attachments: self.attachments.clone(),
            state,
            error,
            retryable,
            generation: self.generation,
            created_at_ms: self.created_at_ms,
        }
    }

    /// Restored records never resume automatically: the outcome of the
    /// previous run is unknown, so the user retries with the same requestId.
    fn from_record(r: OutgoingRecord) -> Self {
        let state = match r.state {
            OutgoingState::Failed => SendState::Failed {
                message: r.error.unwrap_or_else(|| "发送失败".into()),
                retryable: r.retryable,
            },
            OutgoingState::Pending | OutgoingState::Waiting => SendState::Failed {
                message: "上次退出时尚未确认，先检查原请求结果".into(),
                retryable: true,
            },
        };
        Self {
            context_ids: r.context_ids,
            conversation_id: r.conversation_id,
            delivery: r.delivery,
            request_id: r.request_id,
            text: r.text.into(),
            attachments: r.attachments,
            state,
            generation: r.generation,
            created_at_ms: r.created_at_ms,
        }
    }
}

#[derive(Clone)]
struct ServerMsg {
    id: SharedString,
    role: Role,
    content: SharedString,
    created_at: String,
    request_id: Option<String>,
    attachments: Vec<String>,
}

#[derive(Clone)]
enum Row {
    Time {
        id: SharedString,
        raw: String,
    },
    Earlier {
        loading: bool,
        auto: bool,
    },
    Server {
        msg: ServerMsg,
        outgoing: Option<Outgoing>,
    },
    Local(Outgoing),
    Processing(String),
}

impl Row {
    fn key(&self) -> String {
        match self {
            Row::Time { id, .. } => format!("time-{id}"),
            Row::Earlier { .. } => EARLIER_KEY.to_string(),
            Row::Server { msg, .. } => msg.id.to_string(),
            Row::Local(o) => format!("local-{}", o.request_id),
            Row::Processing(rid) => format!("processing-{rid}"),
        }
    }
    /// Fingerprint used to decide whether a kept row must be remeasured.
    fn shape(&self) -> (usize, String) {
        match self {
            Row::Time { raw, .. } => (raw.len(), raw.clone()),
            Row::Earlier { loading, .. } => (0, loading.to_string()),
            Row::Server { msg, outgoing } => (
                msg.content.len() + msg.attachments.len() * 7919,
                outgoing
                    .as_ref()
                    .map(|o| format!("{:?}", o.state))
                    .unwrap_or_default(),
            ),
            Row::Local(o) => (o.text.len(), format!("{:?}", o.state)),
            Row::Processing(_) => (0, "processing".into()),
        }
    }
}

/// Download/open state per artifact id, shared with row renderers.
#[derive(Clone, Debug, PartialEq)]
enum FileState {
    Opening,
    Failed(String),
}

#[derive(Clone)]
enum InlineImageState {
    Loading,
    Ready {
        image: std::sync::Arc<Image>,
        bytes: usize,
        used: u64,
    },
    Failed(String),
}

pub struct ChatView {
    client: Client,
    hub: Entity<SyncHub>,
    saver: Saver<ChatState>,
    conversation_id: Option<String>,
    primary_id: Option<String>,
    conversations: BTreeMap<String, ConversationState>,
    drafts: BTreeMap<String, ConversationDraft>,
    panel_open: bool,
    switching: bool,
    placeholder_locale: String,
    copied_messages: HashMap<String, std::time::Instant>,
    keep_panel_visible: bool,
    show_archived: bool,
    last_deleted: Option<String>,
    session_query: Entity<InputState>,
    continuation: Continuation,
    continuation_generation: u64,
    session_states: HashMap<String, SessionState>,
    session_states_ready: bool,
    session_state_generation: u64,
    // Server recovery is RAM-only metadata, never a synthetic retryable Outgoing.
    recovery_items: Vec<RecoveryIntent>,
    recovery_total: u64,
    recovery_partial_count: u64,
    recovery_next_before: Option<String>,
    recovery_revision: Option<u64>,
    recovery_loading: bool,
    recovery_error: Option<String>,
    recovery_generation: u64,
    recovery_refresh_again: bool,
    record_owner_generation: u64,
    keyboard_menu: Option<(
        Entity<gpui_kit::component::menu::PopupMenu>,
        Point<Pixels>,
        Anchor,
    )>,
    keyboard_menu_previous: Option<FocusHandle>,
    keyboard_menu_subscription: Option<Subscription>,
    session_row_focus: Rc<std::cell::RefCell<HashMap<String, FocusHandle>>>,
    dictation_focus: FocusHandle,
    session_row_bounds: Rc<std::cell::RefCell<HashMap<String, Bounds<Pixels>>>>,
    capture: Option<crate::dictation::Capture>,
    dictation_generation: u64,
    dictation_processing: bool,
    dictation_audio: Option<Vec<u8>>,
    pending_sessions: Option<BTreeMap<String, ConversationState>>,
    dictation_send: bool,
    dictation_levels: Vec<f32>,
    dictation_seconds: f32,
    dictation_height: f32,
    title: SharedString,
    load_error: Option<String>,
    initial_loading: bool,
    visible: bool,
    stale: bool,

    messages: Vec<ServerMsg>,
    known_ids: HashSet<SharedString>,
    has_more: bool,
    next_before: Option<String>,
    loading_earlier: bool,
    earlier_failed: bool,
    use_page_api: bool,

    outgoing: Vec<Outgoing>,
    refreshing: bool,
    refresh_again: bool,

    /// Attachments uploaded and waiting to go out with the next message.
    pending_files: Vec<AttachmentRef>,
    uploading: usize,
    upload_error: Option<String>,
    /// Artifact metadata learned from uploads, chat responses or lookups.
    artifacts: HashMap<String, Artifact>,
    file_states: HashMap<String, FileState>,
    inline_images: HashMap<String, InlineImageState>,
    image_generation: u64,
    image_usage: u64,
    file_preview: Option<(String, crate::files::FilePreview)>,
    composer_height: std::sync::Arc<std::sync::Mutex<f32>>,

    rows: Rc<Vec<Row>>,
    scroller: Entity<MessageScrollerState>,
    input: Entity<TextareaState>,
    _subscriptions: Vec<Subscription>,
    _tasks: Vec<Task<()>>,
}

impl ChatView {
    pub fn new(
        client: Client,
        hub: Entity<SyncHub>,
        store: opstwin_store::Store,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let saved: ChatState = store.load(opstwin_store::CHAT_FILE);
        let saver = Saver::new(store, opstwin_store::CHAT_FILE);
        eprintln!(
            "[opstwin] chat restore: draft={} attachments={} outgoing={}",
            !saved.draft.is_empty(),
            saved.draft_attachments.len(),
            saved.outgoing.len()
        );

        let scroller = cx.new(|cx| MessageScrollerState::new(0, cx));
        let draft = saved.draft.clone();
        let input = cx.new(|cx| {
            let mut s = TextareaState::new(window, cx)
                .auto_grow(1, 8)
                .wrapping_indent(gpui_kit::component::input::WrappingIndent::None)
                // Plain Enter emits PressEnter instead of inserting "\n";
                // Shift+Enter still inserts a newline.
                .submit_on_enter(true)
                .placeholder(t("输入消息…"));
            if !draft.is_empty() {
                s.set_value(draft, window, cx);
            }
            s
        });

        let session_query = cx.new(|cx| InputState::new(window, cx).placeholder(t("搜索会话")));
        let subscriptions = vec![
            cx.observe(&session_query, |_, _, cx| cx.notify()),
            cx.observe(&scroller, |_, _, cx| cx.notify()),
            cx.subscribe_in(&input, window, Self::on_input_event),
            cx.subscribe(&hub, Self::on_sync),
            cx.observe(&hub, |_, _, cx| cx.notify()),
        ];

        let focus = input.focus_handle(cx);
        window.defer(cx, move |window, cx| focus.focus(window, cx));

        let mut artifacts = HashMap::new();
        for a in saved
            .draft_attachments
            .iter()
            .chain(saved.outgoing.iter().flat_map(|o| o.attachments.iter()))
        {
            artifacts.insert(a.id.clone(), artifact_from_ref(a));
        }

        let mut this = Self {
            client,
            hub,
            saver,
            conversation_id: saved.selected_conversation.clone(),
            primary_id: None,
            conversations: saved.conversations,
            drafts: saved.drafts,
            panel_open: saved.keep_panel_visible,
            switching: false,
            placeholder_locale: t("输入消息…"),
            copied_messages: HashMap::new(),
            keep_panel_visible: saved.keep_panel_visible,
            show_archived: false,
            last_deleted: None,
            session_query,
            continuation: Continuation::default(),
            continuation_generation: 0,
            session_states: HashMap::new(),
            session_states_ready: false,
            session_state_generation: 0,
            recovery_items: Vec::new(),
            recovery_total: 0,
            recovery_partial_count: 0,
            recovery_next_before: None,
            recovery_revision: None,
            recovery_loading: false,
            recovery_error: None,
            recovery_generation: 0,
            recovery_refresh_again: false,
            record_owner_generation: 0,
            keyboard_menu: None,
            keyboard_menu_previous: None,
            keyboard_menu_subscription: None,
            session_row_focus: Default::default(),
            dictation_focus: cx.focus_handle(),
            session_row_bounds: Rc::new(std::cell::RefCell::new(HashMap::new())),
            capture: None,
            dictation_generation: 0,
            dictation_processing: false,
            dictation_audio: None,
            pending_sessions: None,
            dictation_send: false,
            dictation_levels: Vec::new(),
            dictation_seconds: 0.0,
            dictation_height: 60.0,
            title: "OpsTwins".into(),
            load_error: None,
            initial_loading: true,
            visible: true,
            stale: false,
            messages: Vec::new(),
            known_ids: HashSet::new(),
            has_more: false,
            next_before: None,
            loading_earlier: false,
            earlier_failed: false,
            use_page_api: true,
            outgoing: saved
                .outgoing
                .into_iter()
                .map(Outgoing::from_record)
                .collect(),
            refreshing: false,
            refresh_again: false,
            pending_files: saved.draft_attachments,
            uploading: 0,
            upload_error: None,
            artifacts,
            file_states: HashMap::new(),
            inline_images: HashMap::new(),
            image_generation: 0,
            image_usage: 0,
            file_preview: None,
            composer_height: std::sync::Arc::new(std::sync::Mutex::new(60.)),
            rows: Rc::new(Vec::new()),
            scroller,
            input,
            _subscriptions: subscriptions,
            _tasks: Vec::new(),
        };
        this.start(cx);
        let timer = cx.spawn(async move |this, cx| {
            loop {
                sleep(60_000).await;
                if this.update(cx, |_, cx| cx.notify()).is_err() {
                    break;
                }
            }
        });
        this._tasks.push(timer);
        this
    }

    pub(crate) fn selected_conversation_id(&self) -> Option<String> {
        self.conversation_id.clone()
    }

    pub fn composer_focus(&self, cx: &App) -> FocusHandle {
        self.input.focus_handle(cx)
    }

    pub fn set_visible(&mut self, visible: bool, cx: &mut Context<Self>) {
        self.visible = visible;
        if !visible {
            self.record_owner_generation += 1;
            self.recovery_generation += 1;
            self.recovery_loading = false;
            self.recovery_refresh_again = false;
            self.keyboard_menu = None;
            self.keyboard_menu_previous = None;
            self.keyboard_menu_subscription = None;
            self.cancel_dictation(cx);
        }
        if visible && std::mem::take(&mut self.stale) {
            self.refresh_newest(cx);
        }
        if visible { self.refresh_recovery(false, cx); }
    }

    // ------------------------------------------------------------ persistence

    fn snapshot(&self, cx: &App) -> ChatState {
        let mut drafts = self.drafts.clone();
        if let Some(id) = &self.conversation_id {
            drafts.insert(
                id.clone(),
                ConversationDraft {
                    text: self.input.read(cx).value().to_string(),
                    attachments: self.pending_files.clone(),
                },
            );
        }
        ChatState {
            selected_conversation: self.conversation_id.clone(),
            keep_panel_visible: self.keep_panel_visible,
            conversations: self
                .pending_sessions
                .clone()
                .unwrap_or_else(|| self.conversations.clone()),
            drafts,
            draft: self.input.read(cx).value().to_string(),
            draft_attachments: self.pending_files.clone(),
            outgoing: self.outgoing.iter().map(Outgoing::to_record).collect(),
        }
    }

    fn persist(&self, cx: &App) {
        self.saver.save(self.snapshot(cx));
    }

    /// Final synchronous write on quit.
    pub fn persist_blocking(&self, cx: &App) {
        self.saver.save_blocking(&self.snapshot(cx));
    }

    // ---------------------------------------------------------------- loading

    fn on_sync(&mut self, _: Entity<SyncHub>, ev: &SyncEvent, cx: &mut Context<Self>) {
        let wants = match ev {
            SyncEvent::Connected {
                was_down, changed, ..
            } => *was_down && (*changed || self.load_error.is_some()),
            SyncEvent::Revision => true,
            SyncEvent::Down => false,
        };
        if !wants {
            return;
        }
        self.refresh_continuation(cx);
        self.refresh_session_states(cx);
        self.refresh_recovery(false, cx);
        if self.load_error.is_some() && self.messages.is_empty() && !self.initial_loading {
            self.start(cx);
        } else if self.visible || !self.outgoing.is_empty() {
            self.refresh_newest(cx);
        } else {
            self.stale = true;
        }
    }

    fn start(&mut self, cx: &mut Context<Self>) {
        self.initial_loading = true;
        self.load_error = None;
        cx.notify();
        let client = self.client.clone();
        let task = cx.spawn(async move |this, cx| {
            let c = client.clone();
            let version = io(async move { c.version().await }).await;
            let use_page = match &version {
                Ok(Some(v)) => v.has("messages.page"),
                Ok(None) => false,
                Err(e) => {
                    eprintln!("[opstwin] version probe failed: {e}");
                    let msg = e.user_text();
                    _ = this.update(cx, |this, cx| {
                        this.initial_loading = false;
                        this.load_error = Some(msg);
                        this.rebuild_rows(cx);
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
                eprintln!("[opstwin] /api/native/version missing; falling back to bootstrap");
            }

            let c = client.clone();
            let primary = match io(async move { c.primary_conversation().await }).await {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("[opstwin] primary conversation failed: {e}");
                    let msg = e.user_text();
                    _ = this.update(cx, |this, cx| {
                        this.initial_loading = false;
                        this.load_error = Some(msg);
                        this.rebuild_rows(cx);
                    });
                    return;
                }
            };
            let all = {
                let c = client.clone();
                io(async move { c.chat_conversations().await }).await
            };
            let selected = this
                .update(cx, |this, _| this.conversation_id.clone())
                .ok()
                .flatten();
            let conversation_id = selected.or_else(|| primary.conversation_id.clone());
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

            _ = this.update(cx, |this, cx| {
                if this.conversation_id.is_some() && this.conversation_id != conversation_id {
                    return;
                }
                this.primary_id = primary.conversation_id.clone();
                if let Ok(all) = all {
                    for c in all {
                        this.conversations.entry(c.id).or_insert(ConversationState {
                            title: c.title.unwrap_or_else(|| "未命名会话".into()),
                            ..Default::default()
                        });
                    }
                }
                this.use_page_api = use_page;
                this.conversation_id = conversation_id.clone();
                if let Some(t) = title {
                    this.title = t.into();
                }
                this.initial_loading = false;
                this.refresh_continuation(cx);
                this.refresh_session_states(cx);
                this.refresh_recovery(false, cx);
                match page {
                    Some(Ok(page)) => {
                        eprintln!(
                            "[opstwin] chat loaded {} messages (hasMore={})",
                            page.items.len(),
                            page.has_more
                        );
                        this.has_more = page.has_more;
                        this.next_before = page.next_before;
                        this.merge(page.items, cx);
                        this.scroller.update(cx, |s, cx| s.scroll_to_end(cx));
                    }
                    Some(Err(e)) => {
                        eprintln!("[opstwin] history load failed: {e}");
                        this.load_error = Some(e.user_text());
                        this.rebuild_rows(cx);
                    }
                    None => {
                        eprintln!("[opstwin] no primary conversation yet");
                        this.rebuild_rows(cx);
                    }
                }
            });
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
            let requested_id = conversation_id.clone();
            let result = io(async move {
                let mut collected = Vec::new();
                let mut before: Option<String> = None;
                for _ in 0..10 {
                    let page = if use_page {
                        client
                            .messages_page(&conversation_id, before.as_deref(), PAGE)
                            .await?
                    } else {
                        client
                            .messages_from_bootstrap(&conversation_id, before.as_deref(), PAGE)
                            .await?
                    };
                    let overlaps = known.is_empty()
                        || page.items.iter().any(|m| known.contains(m.id.as_str()));
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
                if this.conversation_id.as_ref() != Some(&requested_id) {
                    return;
                }
                match result {
                    Ok(items) => {
                        this.load_error = None;
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
        let requested_id = conversation_id.clone();
        let task = cx.spawn(async move |this, cx| {
            let result = io(async move {
                if use_page {
                    client
                        .messages_page(&conversation_id, before.as_deref(), PAGE)
                        .await
                } else {
                    client
                        .messages_from_bootstrap(&conversation_id, before.as_deref(), PAGE)
                        .await
                }
            })
            .await;
            _ = this.update(cx, |this, cx| {
                this.loading_earlier = false;
                if this.conversation_id.as_ref() != Some(&requested_id) {
                    return;
                }
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
    /// ascending createdAt order, drop outgoing entries the server has
    /// confirmed, then rebuild rows.
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
                attachments: m.attachments,
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
            self.messages
                .sort_by(|a, b| a.created_at.cmp(&b.created_at));
        }
        // Only GET request-status or a POST receipt confirms terminal completion.
        // A later assistant message cannot erase a partial or unknown request.
        self.rebuild_rows(cx);
    }

    /// Recompute the row list and tell the virtual list exactly which range
    /// changed (common prefix/suffix by key), so prepends keep the reader's
    /// anchor and appends follow the tail.
    fn rebuild_rows(&mut self, cx: &mut Context<Self>) {
        let mut rows = Vec::with_capacity(self.messages.len() + self.outgoing.len() + 1);
        if self.has_more && self.conversation_id.is_some() {
            rows.push(Row::Earlier {
                loading: self.loading_earlier,
                auto: !self.earlier_failed,
            });
        }
        let mut on_server: HashSet<&str> = HashSet::new();
        let mut previous: Option<&str> = None;
        for m in &self.messages {
            if shows_time(&m.created_at, previous) {
                rows.push(Row::Time {
                    id: m.id.clone(),
                    raw: m.created_at.clone(),
                });
            }
            previous = Some(&m.created_at);
            let outgoing = m
                .request_id
                .as_deref()
                .and_then(|rid| self.outgoing.iter().find(|o| o.request_id == rid).cloned());
            if let Some(rid) = m.request_id.as_deref() {
                on_server.insert(rid);
            }
            rows.push(Row::Server {
                msg: m.clone(),
                outgoing,
            });
        }
        for o in &self.outgoing {
            if o.conversation_id != self.conversation_id {
                continue;
            }
            if !on_server.contains(o.request_id.as_str()) {
                rows.push(Row::Local(o.clone()));
            }
        }

        if let Some(o) = self.outgoing.iter().rev().find(|o| {
            o.conversation_id == self.conversation_id && o.state == SendState::Waiting
        }) {
            rows.push(Row::Processing(o.request_id.clone()));
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
        let mut changed: Vec<usize> = Vec::new();
        for i in (0..prefix).chain(new_keys.len() - suffix..new_keys.len()) {
            let oi = if i < prefix {
                i
            } else {
                i - new_keys.len() + old_keys.len()
            };
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

    /// Re-measure every row (attachment metadata arrived or file state changed).
    fn remeasure_all(&mut self, cx: &mut Context<Self>) {
        let n = self.rows.len();
        if n > 0 {
            self.scroller
                .update(cx, |s, cx| s.remeasure_items(0..n, cx));
        }
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
        match event {
            InputEvent::PressEnter { shift: false, .. } => {
                // macOS routes keys to NSTextInputContext while marked text
                // exists, so an IME-confirming Enter never reaches here. Still
                // refuse to send if a composition is somehow active.
                let composing = input.update(cx, |state, cx| {
                    state.marked_text_range(window, cx).is_some()
                });
                if !composing {
                    self.send(window, cx);
                }
            }
            InputEvent::Change => self.persist(cx),
            _ => {}
        }
    }

    fn send(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let composing = self.input.update(cx, |state, cx| {
            state.marked_text_range(window, cx).is_some()
        });
        if composing || self.initial_loading || self.uploading > 0 || self.switching {
            return;
        }
        let text = self.input.read(cx).value().trim().to_string();
        if text.is_empty() {
            if !self.pending_files.is_empty() {
                self.upload_error = Some("请输入消息再发送附件".into());
                cx.notify();
            }
            return;
        }
        self.input.update(cx, |s, cx| s.set_value("", window, cx));
        let outgoing = Outgoing {
            context_ids: Vec::new(),
            conversation_id: self.conversation_id.clone(),
            delivery: None,
            request_id: opstwin_api::new_request_id(),
            text: text.into(),
            attachments: std::mem::take(&mut self.pending_files),
            state: SendState::Sending { attempt: 1 },
            generation: 0,
            created_at_ms: opstwin_store::now_ms(),
        };
        self.upload_error = None;
        eprintln!(
            "[opstwin] send {} attachments={}",
            outgoing.request_id,
            outgoing.attachments.len()
        );
        let rid = outgoing.request_id.clone();
        self.outgoing.push(outgoing);
        self.persist(cx);
        self.rebuild_rows(cx);
        self.scroller.update(cx, |s, cx| s.scroll_to_end(cx));
        self.run_send(rid, window, cx);
    }

    fn retry(&mut self, request_id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(o) = self
            .outgoing
            .iter_mut()
            .find(|o| o.request_id == request_id)
        else {
            return;
        };
        if !matches!(
            o.state,
            SendState::Failed {
                retryable: true,
                ..
            }
        ) {
            return;
        }
        o.generation += 1;
        o.state = SendState::Sending { attempt: 1 };
        eprintln!("[opstwin] manual retry {request_id}");
        self.persist(cx);
        self.rebuild_rows(cx);
        self.run_send(request_id.to_string(), window, cx);
    }

    fn dismiss_confirmed(&mut self, rid: String, window: &mut Window, cx: &mut Context<Self>) {
        let Some(generation) = self
            .outgoing
            .iter()
            .find(|item| item.request_id == rid)
            .filter(|item| matches!(item.state, SendState::Failed { .. }))
            .map(|item| item.generation)
        else {
            return;
        };
        let client = self.client.clone();
        let task = cx.spawn_in(window, async move |this, cx| {
            let id = rid.clone();
            let result = io(async move {
                match client.chat_request_status(&id).await {
                    Ok(state) => Ok(["failed", "succeeded"].contains(&state.status.as_str())),
                    Err(error) if error.status() == Some(404) => {
                        match client.chat_continuation_receipt(&id).await {
                            Err(error) if error.status() == Some(404) => Ok(true),
                            Ok(_) => Ok(false),
                            Err(error) => Err(error),
                        }
                    }
                    Err(error) => Err(error),
                }
            })
            .await;
            _ = this.update(cx, |this, cx| {
                if !this.outgoing.iter().any(|item| {
                    item.request_id == rid
                        && item.generation == generation
                        && matches!(item.state, SendState::Failed { .. })
                }) {
                    return;
                }
                match result {
                    Ok(true) => {
                        this.outgoing.retain(|item| item.request_id != rid);
                        this.persist(cx);
                        this.rebuild_rows(cx);
                        this.refresh_newest(cx);
                    }
                    Ok(false) => {
                        this.upload_error = Some(t("原请求未确认或已有部分写入，保留执行记录"))
                    }
                    Err(error) => this.upload_error = Some(error.user_text()),
                }
                this.refresh_session_states(cx);
                cx.notify();
            });
        });
        self._tasks.push(task);
    }

    fn set_send_state(
        &mut self,
        rid: &str,
        generation: u32,
        state: SendState,
        cx: &mut Context<Self>,
    ) -> bool {
        match self.outgoing.iter_mut().find(|o| o.request_id == rid) {
            Some(o) if o.generation == generation => {
                if o.state == state { return true; }
                o.state = state;
                self.persist(cx);
                self.rebuild_rows(cx);
                true
            }
            _ => false,
        }
    }

    /// Persist first; every unknown outcome is recovered through GET before
    /// another POST is even considered. Partial writes remain locked.
    fn run_send(&mut self, rid: String, window: &mut Window, cx: &mut Context<Self>) {
        let Some(o) = self.outgoing.iter().find(|o| o.request_id == rid) else {
            return;
        };
        let generation = o.generation;
        let delivery = o.delivery.clone();
        let context_ids = o.context_ids.clone();
        let mut req = ChatRequest {
            conversation_id: o.conversation_id.clone(),
            message: o.text.to_string(),
            request_id: rid.clone(),
            attachment_ids: o.attachments.iter().map(|a| a.id.clone()).collect(),
        };
        let save = self.saver.save_now(self.snapshot(cx));
        let client = self.client.clone();
        let task = cx.spawn_in(window, async move |this, cx| {
            if save.await.is_err() {
                _ = this.update_in(cx, |this, window, cx| {
                    if this.conversation_id == req.conversation_id
                        && this.input.read(cx).value().trim().is_empty()
                    {
                        this.input
                            .update(cx, |s, cx| s.set_value(req.message.clone(), window, cx));
                        if let Some(o) = this.outgoing.iter().find(|o| o.request_id == rid) {
                            this.pending_files = o.attachments.clone();
                        }
                    }
                    this.set_send_state(
                        &rid,
                        generation,
                        SendState::Failed {
                            message: "无法保存原请求，尚未发送。原草稿已保留".into(),
                            retryable: true,
                        },
                        cx,
                    );
                });
                return;
            }
            if req.conversation_id.is_none() {
                // A cross-page source action may arrive before initial history
                // loading. Resolve the actual primary before binding its ID.
                let c = client.clone();
                match io(async move { c.primary_conversation().await }).await {
                    Ok(primary) => {
                        if let Some(id) = primary.conversation_id {
                            req.conversation_id = Some(id.clone());
                            let save = this.update(cx, |this, cx| {
                                if let Some(item) = this.outgoing.iter_mut().find(|item| {
                                    item.request_id == rid && item.generation == generation
                                }) {
                                    item.conversation_id = Some(id.clone());
                                }
                                if this.conversation_id.is_none() {
                                    this.conversation_id = Some(id);
                                }
                                this.saver.save_now(this.snapshot(cx))
                            });
                            if let Ok(save) = save {
                                if save.await.is_err() {
                                    _ = this.update(cx, |this, cx| {
                                        this.set_send_state(
                                            &rid,
                                            generation,
                                            SendState::Failed {
                                                message: t("执行会话未保存，未开始运行"),
                                                retryable: true,
                                            },
                                            cx,
                                        );
                                    });
                                    return;
                                }
                            } else {
                                return;
                            }
                        }
                    }
                    Err(error) => {
                        _ = this.update(cx, |this, cx| {
                            this.set_send_state(
                                &rid,
                                generation,
                                SendState::Failed {
                                    message: error.user_text(),
                                    retryable: true,
                                },
                                cx,
                            );
                        });
                        return;
                    }
                }
            }
            if let Some(delivery) = delivery {
                // Read the durable queue receipt before any write. Terminal
                // rows are not in the active continuation list.
                let (c, r, context) = (client.clone(), req.clone(), context_ids.clone());
                let result = io(async move {
                    match c.chat_continuation_receipt(&r.request_id).await {
                        Ok(receipt) => Ok(receipt),
                        Err(e) if e.status() == Some(404) => {
                            match c.chat_continue_context(&r, &delivery, &context).await {
                                Ok(receipt) => Ok(receipt),
                                Err(e) if e.outcome_unknown() || e.is_in_progress() => {
                                    // Do not reinsert a steer after a lost reply.
                                    c.chat_continuation_receipt(&r.request_id).await
                                }
                                Err(e) => Err(e),
                            }
                        }
                        Err(e) => Err(e),
                    }
                })
                .await;
                _ = this.update(cx, |this, cx| match result {
                    Ok(value) => {
                        let status = value
                            .get("status")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown");
                        if [
                            "queued",
                            "inserted",
                            "succeeded",
                            "running",
                            "inserting",
                            "cancelled",
                        ]
                        .contains(&status)
                        {
                            this.outgoing.retain(|o| o.request_id != rid);
                            this.persist(cx);
                        } else {
                            this.set_send_state(
                                &rid,
                                generation,
                                SendState::Failed {
                                    message: format!("补充消息状态：{status}，请检查原记录"),
                                    retryable: false,
                                },
                                cx,
                            );
                        }
                        this.refresh_continuation(cx);
                        this.refresh_newest(cx);
                    }
                    Err(e) => {
                        this.set_send_state(
                            &rid,
                            generation,
                            SendState::Failed {
                                message: format!("补充请求未确认：{}；先回查原请求", e.user_text()),
                                // Retry re-enters the receipt GET; it never writes
                                // when that GET is unavailable or finds a row.
                                retryable: e.outcome_unknown() || e.status() == Some(404),
                            },
                            cx,
                        );
                        this.refresh_continuation(cx);
                    }
                });
                return;
            }
            let mut posted = false;
            for _ in 0..1440 {
                let (c, id) = (client.clone(), rid.clone());
                let recovered = io(async move { c.chat_request_status(&id).await }).await;
                let should_post = match recovered {
                    Ok(status) if status.status == "succeeded" => {
                        if let Some(response) = status.result {
                            _ = this
                                .update(cx, |this, cx| this.accept_response(&rid, response, cx));
                        } else {
                            _ = this.update(cx, |this, cx| {
                                this.outgoing.retain(|o| o.request_id != rid);
                                this.persist(cx);
                                this.refresh_newest(cx);
                            });
                        }
                        return;
                    }
                    Ok(status) if status.status == "partial" => {
                        _ = this.update(cx, |this, cx| {
                            this.set_send_state(
                                &rid,
                                generation,
                                SendState::Failed {
                                    message: "原运行已有部分写入，请查看执行记录后继续".into(),
                                    retryable: false,
                                },
                                cx,
                            );
                            this.refresh_newest(cx);
                        });
                        return;
                    }
                    Ok(status) if status.status == "running" => {
                        _ = this.update(cx, |this, cx| {
                            this.set_send_state(&rid, generation, SendState::Waiting, cx);
                            this.refresh_newest(cx);
                        });
                        sleep(1000).await;
                        continue;
                    }
                    Ok(status) if status.status == "failed" => !posted,
                    Err(e) if e.status() == Some(404) => !posted,
                    Err(e) => {
                        _ = this.update(cx, |this, cx| {
                            this.set_send_state(
                                &rid,
                                generation,
                                SendState::Failed {
                                    message: format!("结果尚未确认：{}；先检查结果", e.user_text()),
                                    retryable: true,
                                },
                                cx,
                            );
                        });
                        return;
                    }
                    _ => false,
                };
                if !should_post {
                    _ = this.update(cx, |this, cx| {
                        this.set_send_state(
                            &rid,
                            generation,
                            SendState::Failed {
                                message: "原请求已失败，请检查结果后用原请求重试".into(),
                                retryable: true,
                            },
                            cx,
                        );
                        this.refresh_newest(cx);
                    });
                    return;
                }
                // Original request GET must precede every side-conversation write.
                // Existing/unknown/running/partial requests return above without writes.
                let local_side = this
                    .update(cx, |this, _| {
                        req.conversation_id.as_ref().and_then(|id| {
                            this.conversations
                                .get(id)
                                .filter(|conversation| conversation.created_locally)
                                .map(|conversation| (id.clone(), conversation.title.clone()))
                        })
                    })
                    .ok()
                    .flatten();
                if let Some((side_id, title)) = local_side {
                    let (c, target) = (client.clone(), side_id.clone());
                    if let Err(error) =
                        io(async move { c.chat_create_side(&target, &title).await }).await
                    {
                        _ = this.update(cx, |this, cx| {
                            this.set_send_state(
                                &rid,
                                generation,
                                SendState::Failed {
                                    message: error.user_text(),
                                    retryable: error.outcome_unknown(),
                                },
                                cx,
                            );
                        });
                        return;
                    }
                    _ = this.update(cx, |this, cx| {
                        if let Some(conversation) = this.conversations.get_mut(&side_id) {
                            conversation.created_locally = false;
                        }
                        this.persist(cx);
                    });
                }
                posted = true;
                let (c, r, context) = (client.clone(), req.clone(), context_ids.clone());
                // Keep the original POST alive while reading its durable receipt.
                // A slow/lost POST response must not hide running or terminal state.
                let mut post = Box::pin(io(async move {
                    c.chat_product_interrupt_context(&r, &context).await
                }));
                let post_result = loop {
                    let (c, id) = (client.clone(), rid.clone());
                    let poll = Box::pin(async move {
                        sleep(1000).await;
                        io(async move {
                            tokio::time::timeout(std::time::Duration::from_secs(5),
                                c.chat_request_status(&id)).await
                                .unwrap_or_else(|_| Err(ApiError::Network("status_read_timeout".into())))
                        }).await
                    });
                    match futures_util::future::select(post, poll).await {
                        futures_util::future::Either::Left((result, _)) => break result,
                        futures_util::future::Either::Right((status, pending_post)) => {
                            post = pending_post;
                            let current = this.update(cx, |this, _| {
                                this.outgoing.iter().any(|o| o.request_id == rid
                                    && o.generation == generation
                                    && o.conversation_id == req.conversation_id)
                            }).unwrap_or(false);
                            if !current { return; }
                            match status {
                                Ok(status) if status.request_id == rid
                                    && status.conversation_id == req.conversation_id => {
                                    match status.status.as_str() {
                                        "succeeded" => {
                                            if let Some(response) = status.result {
                                                _ = this.update(cx, |this, cx| this.accept_response(&rid, response, cx));
                                                return;
                                            }
                                            _ = this.update(cx, |this, cx| {
                                                this.set_send_state(&rid, generation, SendState::Checking, cx);
                                            });
                                        }
                                        "running" => {
                                            _ = this.update(cx, |this, cx| {
                                                this.set_send_state(&rid, generation, SendState::Waiting, cx);
                                            });
                                        }
                                        "partial" | "failed" => {
                                            _ = this.update(cx, |this, cx| {
                                                this.set_send_state(&rid, generation, SendState::Failed {
                                                    message: if status.status == "partial" {
                                                        "原运行已有部分写入，请查看执行记录后继续".into()
                                                    } else { "原请求已失败，请查看执行记录".into() },
                                                    retryable: false,
                                                }, cx);
                                                this.refresh_newest(cx);
                                            });
                                            // Briefly allow the POST's precise interruption/error detail;
                                            // a lost terminal response must not keep polling forever.
                                            match futures_util::future::select(post, Box::pin(sleep(1000))).await {
                                                futures_util::future::Either::Left((result, _)) => break result,
                                                futures_util::future::Either::Right(_) => return,
                                            }
                                        }
                                        _ => { _ = this.update(cx, |this, cx| {
                                            this.set_send_state(&rid, generation, SendState::Checking, cx);
                                        }); }
                                    }
                                }
                                _ => { _ = this.update(cx, |this, cx| {
                                    this.set_send_state(&rid, generation, SendState::Checking, cx);
                                }); }
                            }
                        }
                    }
                };
                match post_result {
                    Ok(response) => {
                        _ = this.update(cx, |this, cx| this.accept_response(&rid, response, cx));
                        return;
                    }
                    Err(e)
                        if e.is_conflict() || e.code() == Some("partial_run_requires_review") =>
                    {
                        _ = this.update(cx, |this, cx| {
                            this.set_send_state(
                                &rid,
                                generation,
                                SendState::Failed {
                                    message: e.user_text(),
                                    retryable: false,
                                },
                                cx,
                            );
                            this.refresh_newest(cx);
                        });
                        return;
                    }
                    Err(e) if e.is_in_progress() || e.outcome_unknown() => {
                        _ = this.update(cx, |this, cx| {
                            this.set_send_state(&rid, generation, SendState::Checking, cx);
                        });
                        sleep(1000).await;
                    }
                    Err(e) => {
                        _ = this.update(cx, |this, cx| {
                            this.set_send_state(
                                &rid,
                                generation,
                                SendState::Failed {
                                    message: e.user_text(),
                                    retryable: false,
                                },
                                cx,
                            );
                        });
                        return;
                    }
                }
            }
            _ = this.update(cx, |this, cx| {
                this.set_send_state(
                    &rid,
                    generation,
                    SendState::Failed {
                        message: "运行长时间未确认，先检查结果".into(),
                        retryable: true,
                    },
                    cx,
                );
            });
        });
        self._tasks.push(task);
    }

    fn accept_response(
        &mut self,
        rid: &str,
        response: opstwin_api::ChatResponse,
        cx: &mut Context<Self>,
    ) {
        let selected = self.conversation_id.is_none()
            || self.conversation_id.as_ref() == Some(&response.conversation_id);
        if self.conversation_id.is_none() {
            self.conversation_id = Some(response.conversation_id.clone());
        }
        for a in response.artifacts {
            self.artifacts.insert(a.id.clone(), a);
        }
        self.outgoing.retain(|o| o.request_id != rid);
        self.persist(cx);
        if selected {
            self.merge(
                response
                    .user_message
                    .into_iter()
                    .chain(response.assistant_message)
                    .collect(),
                cx,
            );
            self.refresh_newest(cx);
            self.refresh_continuation(cx);
        } else {
            self.rebuild_rows(cx);
        }
    }

    pub fn send_prompt(&mut self, prompt: String, window: &mut Window, cx: &mut Context<Self>) {
        self.send_context_prompt(Vec::new(), prompt, window, cx);
    }

    pub fn send_source_prompt(
        &mut self,
        source_id: String,
        prompt: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.send_context_prompt(vec![source_id], prompt, window, cx);
    }

    fn send_context_prompt(
        &mut self,
        context_ids: Vec<String>,
        prompt: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if prompt.trim().is_empty() {
            return;
        }
        let rid = opstwin_api::new_request_id();
        self.outgoing.push(Outgoing {
            context_ids,
            conversation_id: self.conversation_id.clone(),
            delivery: None,
            request_id: rid.clone(),
            text: prompt.into(),
            attachments: Vec::new(),
            state: SendState::Sending { attempt: 1 },
            generation: 0,
            created_at_ms: opstwin_store::now_ms(),
        });
        self.rebuild_rows(cx);
        self.run_send(rid, window, cx);
    }

    pub fn toggle_conversations(&mut self, cx: &mut Context<Self>) {
        self.panel_open = !self.panel_open;
        if self.panel_open {
            self.refresh_session_states(cx);
        }
        cx.notify();
    }

    pub fn open_conversation(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        if self.conversation_id.as_ref() == Some(&id) || self.switching {
            return;
        }
        self.switching = true;
        self.cancel_dictation(cx);
        let snapshot = self.snapshot(cx);
        let new_side_title = self
            .conversations
            .get(&id)
            .filter(|item| item.created_locally)
            .map(|item| item.title.clone());
        let client = self.client.clone();
        let save = self.saver.save_now(snapshot.clone());
        let task = cx.spawn_in(window, async move |this, cx| {
            let saved = match save.await {
                Err(_) => Err("无法保存当前草稿，切换已取消".to_string()),
                Ok(()) => {
                    if let Some(title) = new_side_title {
                        let target = id.clone();
                        io(async move { client.chat_create_side(&target, &title).await })
                            .await
                            .map(|_| ())
                            .map_err(|e| format!("无法创建会话：{}；当前草稿保留", e.user_text()))
                    } else {
                        Ok(())
                    }
                }
            };
            _ = this.update_in(cx, |this, window, cx| {
                this.switching = false;
                if let Err(error) = saved {
                    this.upload_error = Some(error);
                    cx.notify();
                    return;
                }
                if this.input.read(cx).value().as_ref() != snapshot.draft
                    || this.pending_files != snapshot.draft_attachments
                {
                    this.open_conversation(id.clone(), window, cx);
                    return;
                }
                this.cancel_dictation(cx);
                this.continuation_generation += 1;
                this.drafts = snapshot.drafts;
                if let Some(item) = this.conversations.get_mut(&id) {
                    item.created_locally = false;
                }
                this.conversation_id = Some(id.clone());
                this.clear_recovery();
                this.file_preview = None;
                let draft = this.drafts.get(&id).cloned().unwrap_or_default();
                this.input
                    .update(cx, |s, cx| s.set_value(draft.text, window, cx));
                this.pending_files = draft.attachments;
                this.image_generation += 1;
                this.inline_images.clear();
                this.messages.clear();
                this.known_ids.clear();
                this.has_more = false;
                this.next_before = None;
                this.refreshing = false;
                this.refresh_again = false;
                this.title = this
                    .conversations
                    .get(&id)
                    .map(|c| c.title.clone())
                    .unwrap_or_else(|| "主会话".into())
                    .into();
                this.continuation = Continuation::default();
                if !this.keep_panel_visible {
                    this.panel_open = false;
                }
                this.rebuild_rows(cx);
                this.start(cx);
                this.persist(cx);
            });
        });
        self._tasks.push(task);
    }

    fn create_conversation(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.pending_sessions.is_some() || self.switching {
            self.upload_error = Some(t("正在保存会话，请稍候"));
            cx.notify();
            return;
        }
        let id = format!(
            "ui-side-{}",
            opstwin_api::new_request_id().trim_start_matches("native-")
        );
        self.conversations.insert(
            id.clone(),
            ConversationState {
                title: t("新会话"),
                created_locally: true,
                ..Default::default()
            },
        );
        self.open_conversation(id, window, cx);
    }


    fn session_locked(&self, id: &str) -> bool {
        self.primary_id.as_deref() == Some(id)
            || !self.session_states_ready
            || self.session_states.get(id).is_none_or(|state| state.locked)
            || self
                .outgoing
                .iter()
                .any(|o| o.conversation_id.as_deref() == Some(id))
            || self.conversation_id.as_deref() == Some(id)
                && (self.continuation.running || !self.continuation.items.is_empty())
    }

    fn clear_recovery(&mut self) {
        self.record_owner_generation += 1;
        self.recovery_generation += 1;
        self.recovery_items.clear();
        self.recovery_total = 0;
        self.recovery_partial_count = 0;
        self.recovery_next_before = None;
        self.recovery_revision = None;
        self.recovery_loading = false;
        self.recovery_error = None;
        self.recovery_refresh_again = false;
    }

    /// Bounded GET pages discover server-only intents even when their user
    /// message is missing or outside the loaded history. No draft/Outgoing writes.
    fn refresh_recovery(&mut self, more: bool, cx: &mut Context<Self>) {
        if !self.visible { return; }
        let Some(cid) = self.conversation_id.clone() else { return; };
        if self.recovery_loading {
            if !more { self.recovery_refresh_again = true; }
            return;
        }
        let before = if more { self.recovery_next_before.clone() } else { None };
        if more && before.is_none() { return; }
        let revision = if more { self.recovery_revision } else { None };
        // Refresh all already-expanded metadata pages, preserving access to old
        // intents; additional pages remain reachable through explicit Load More.
        let refresh_count = self.recovery_items.len().max(100);
        self.recovery_generation += 1;
        let generation = self.recovery_generation;
        self.recovery_loading = true;
        self.recovery_error = None;
        let client = self.client.clone();
        cx.notify();
        let task = cx.spawn(async move |this, cx| {
            let mut cursor = before;
            let mut version = revision;
            let mut collected = Vec::new();
            let mut seen = HashSet::new();
            let result = loop {
                let (c, target, anchor) = (client.clone(), cid.clone(), cursor.clone());
                let result = io(async move { c.chat_unresolved_intents(&target, anchor.as_deref(), version).await }).await;
                let valid = this.update(cx, |this, _| this.visible && this.recovery_generation == generation && this.conversation_id.as_ref() == Some(&cid)).unwrap_or(false);
                if !valid { return; }
                match result {
                    Err(error) => break Err(error),
                    Ok(page) => {
                        if version.is_some_and(|v| v != page.revision) { break Err(ApiError::Decode("运行回查版本不一致".into())); }
                        version = Some(page.revision);
                        let mut duplicate = false;
                        for item in page.items.iter().cloned() {
                            if !seen.insert(item.request_id.clone()) { duplicate = true; break; }
                            collected.push(item);
                        }
                        if duplicate { break Err(ApiError::Decode("运行回查请求重复".into())); }
                        if more || collected.len() >= refresh_count || !page.has_more {
                            break Ok((collected, page));
                        }
                        let next = page.next_before.clone();
                        if next == cursor { break Err(ApiError::Decode("运行回查游标没有前进".into())); }
                        cursor = next;
                    }
                }
            };
            _ = this.update(cx, |this, cx| {
                if !this.visible || this.recovery_generation != generation || this.conversation_id.as_ref() != Some(&cid) { return; }
                this.recovery_loading = false;
                match result {
                    Ok((items, page)) => {
                        if more {
                            let mut known: HashSet<String> = this.recovery_items.iter().map(|v| v.request_id.clone()).collect();
                            this.recovery_items.extend(items.into_iter().filter(|v| known.insert(v.request_id.clone())));
                        } else { this.recovery_items = items; }
                        this.recovery_total = page.total;
                        this.recovery_partial_count = page.partial_count;
                        this.recovery_revision = Some(page.revision);
                        this.recovery_next_before = if page.has_more { page.next_before } else { None };
                        this.recovery_error = None;
                    }
                    Err(error) => {
                        // Keep cached unresolved evidence and all drafts. A failed
                        // read cannot establish success or make a retry safe.
                        this.recovery_error = Some(error.user_text());
                    }
                }
                if std::mem::take(&mut this.recovery_refresh_again) { this.refresh_recovery(false, cx); }
                cx.notify();
            });
        });
        self._tasks.push(task);
    }

    fn refresh_session_states(&mut self, cx: &mut Context<Self>) {
        let ids: Vec<String> = self.conversations.keys().cloned().collect();
        if ids.is_empty() {
            self.session_states_ready = true;
            return;
        }
        self.session_state_generation += 1;
        let generation = self.session_state_generation;
        self.session_states_ready = false;
        let client = self.client.clone();
        let task = cx.spawn(async move |this, cx| {
            let result = io(async move {
                let mut states = Vec::with_capacity(ids.len());
                for batch in ids.chunks(200) {
                    states.extend(client.chat_session_states(batch).await?);
                }
                Ok::<_, opstwin_api::ApiError>(states)
            })
            .await;
            _ = this.update(cx, |this, cx| {
                if this.session_state_generation != generation {
                    return;
                }
                if let Ok(states) = result {
                    this.session_states = states
                        .into_iter()
                        .map(|state| (state.id.clone(), state))
                        .collect();
                    this.session_states_ready = true;
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
    }

    fn mutate_session(&mut self, id: &str, action: &str, cx: &mut Context<Self>) {
        if self.primary_id.as_deref() == Some(id) {
            return;
        }
        if self.pending_sessions.is_some() {
            self.upload_error = Some(t("正在保存会话，请稍候"));
            cx.notify();
            return;
        }
        if ["archive", "delete"].contains(&action) && self.session_locked(id) {
            self.upload_error = Some("运行、未知或部分结果尚未确认，不能隐藏会话".into());
            cx.notify();
            return;
        }
        if ["archive", "delete"].contains(&action) {
            let (id, action, client) = (id.to_string(), action.to_string(), self.client.clone());
            let task = cx.spawn(async move |this, cx| {
                let target = id.clone();
                let result = io(async move { client.chat_session_states(&[target]).await }).await;
                _ = this.update(cx, |this, cx| match result {
                    Ok(states) if states.iter().any(|state| state.id == id && !state.locked) => {
                        this.commit_session_mutation(&id, &action, cx);
                    }
                    _ => {
                        this.upload_error = Some(t("会话结果尚未确认，不能隐藏"));
                        cx.notify();
                    }
                });
            });
            self._tasks.push(task);
            return;
        }
        self.commit_session_mutation(id, action, cx);
    }

    fn commit_session_mutation(&mut self, id: &str, action: &str, cx: &mut Context<Self>) {
        if self.pending_sessions.is_some() {
            return;
        }
        if ["archive", "delete"].contains(&action) && self.session_locked(id) {
            return;
        }
        let mut state = self.snapshot(cx);
        let Some(item) = state.conversations.get_mut(id) else {
            return;
        };
        match action {
            "pin" => item.pinned = !item.pinned,
            "archive" => item.archived = !item.archived,
            "delete" => item.deleted = true,
            "restore" => item.deleted = false,
            _ => return,
        }
        self.pending_sessions = Some(state.conversations.clone());
        let save = self.saver.save_now(state.clone());
        let id = id.to_string();
        let action = action.to_string();
        let task = cx.spawn(async move |this, cx| {
            let result = save.await;
            _ = this.update(cx, |this, cx| {
                this.pending_sessions = None;
                if result.is_err() {
                    this.upload_error = Some(t("会话管理保存失败，原状态保留"));
                    this.persist(cx);
                } else {
                    this.conversations = state.conversations;
                    if action == "delete" {
                        this.last_deleted = Some(id);
                    }
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
    }

    fn rename_session(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        let title = self
            .conversations
            .get(&id)
            .map(|s| s.title.clone())
            .unwrap_or_default();
        let input = cx.new(|cx| InputState::new(window, cx).default_value(title));
        let focus = input.focus_handle(cx);
        let view = cx.entity().downgrade();
        let pending = Rc::new(std::cell::Cell::new(false));
        let error = Rc::new(std::cell::RefCell::new(None::<String>));
        window.open_dialog(cx, move |dialog, _, _| {
            let (read, view, id) = (input.clone(), view.clone(), id.clone());
            let (pending, error) = (pending.clone(), error.clone());
            let cancel = pending.clone();
            let error_text = error.borrow().clone();
            dialog
                .title(t("重命名会话"))
                .child(Input::new(&input).disabled(pending.get()))
                .when_some(error_text, |this, e| {
                    this.child(div().text_size(px(12.)).text_color(rgb(0xd52a40)).child(e))
                })
                .when(pending.get(), |this| {
                    this.child(div().text_size(px(12.)).child(t("正在保存…")))
                })
                .keyboard(!pending.get())
                .overlay_closable(!pending.get())
                .close_button(!pending.get())
                .button_props(
                    DialogButtonProps::default()
                        .show_cancel(true)
                        .ok_text(t("保存"))
                        .cancel_text(t("取消")),
                )
                .on_cancel(move |_, _, _| !cancel.get())
                .on_ok(move |_, window, cx| {
                    if pending.get() {
                        return false;
                    }
                    let title = read.read(cx).value().trim().to_string();
                    if title.is_empty() || title.chars().count() > 120 {
                        *error.borrow_mut() = Some(t("标题不能为空且最多120字"));
                        window.refresh();
                        return false;
                    }
                    let (pending, error) = (pending.clone(), error.clone());
                    _ = view.update(cx, |this, cx| {
                        if this.pending_sessions.is_some() {
                            *error.borrow_mut() = Some(t("正在保存会话，请稍候"));
                            window.refresh();
                            return;
                        }
                        let mut state = this.snapshot(cx);
                        if let Some(item) = state.conversations.get_mut(&id) {
                            item.title = title.clone();
                        } else {
                            return;
                        }
                        this.pending_sessions = Some(state.conversations.clone());
                        pending.set(true);
                        *error.borrow_mut() = None;
                        let save = this.saver.save_now(state.clone());
                        let task = cx.spawn_in(window, async move |this, cx| {
                            let result = save.await;
                            _ = this.update_in(cx, |this, window, cx| {
                                pending.set(false);
                                this.pending_sessions = None;
                                if result.is_ok() {
                                    this.conversations = state.conversations;
                                    window.close_dialog(cx);
                                } else {
                                    *error.borrow_mut() = Some(t("重命名保存失败，输入已保留"));
                                    this.persist(cx);
                                }
                                window.refresh();
                                cx.notify();
                            });
                        });
                        this._tasks.push(task);
                    });
                    window.refresh();
                    false
                })
        });
        window.defer(cx, move |window, cx| focus.focus(window, cx));
    }

    fn delete_session(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        if self.session_locked(&id) {
            return;
        }
        let view = cx.entity().downgrade();
        window.open_dialog(cx, move |dialog, _, _| {
            let id = id.clone();
            let view = view.clone();
            dialog
                .title(t("删除会话？"))
                .child(t("删除后可通过会话面板撤销，原服务器记录保留"))
                .button_props(
                    DialogButtonProps::default()
                        .show_cancel(true)
                        .ok_text("删除")
                        .cancel_text("取消"),
                )
                .on_ok(move |_, _, cx| {
                    _ = view.update(cx, |this, cx| this.mutate_session(&id, "delete", cx));
                    true
                })
        });
    }

    fn refresh_continuation(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.conversation_id.clone() else {
            return;
        };
        self.continuation_generation += 1;
        let generation = self.continuation_generation;
        let client = self.client.clone();
        let task = cx.spawn(async move |this, cx| {
            let request = id.clone();
            let result = io(async move { client.chat_continuation(&request).await }).await;
            _ = this.update(cx, |this, cx| {
                if this.conversation_id.as_ref() == Some(&id)
                    && this.continuation_generation == generation
                {
                    if let Ok(value) = result {
                        this.continuation = value;
                        cx.notify();
                    }
                }
            });
        });
        self._tasks.push(task);
    }

    fn queue_action(
        &mut self,
        item: serde_json::Value,
        action: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(id) = item.get("id").and_then(|v| v.as_str()).map(str::to_string) else {
            return;
        };
        if action == "edit" {
            let input = cx.new(|cx| {
                InputState::new(window, cx).default_value(
                    item.get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                )
            });
            let focus = input.focus_handle(cx);
            let view = cx.entity().downgrade();
            let pending = Rc::new(std::cell::Cell::new(false));
            let error = Rc::new(std::cell::RefCell::new(None::<String>));
            let conversation = self.conversation_id.clone();
            window.open_dialog(cx,move |dialog,_,_|{
                let (read,view,id,item,conversation)=(input.clone(),view.clone(),id.clone(),item.clone(),conversation.clone());
                let (pending,error)=(pending.clone(),error.clone());let cancel=pending.clone();
                let error_text=error.borrow().clone();
                dialog.title(t("编辑待发消息")).child(Input::new(&input).disabled(pending.get()))
                    .when_some(error_text,|this,e|this.child(div().text_size(px(12.)).text_color(rgb(0xd52a40)).child(e)))
                    .when(pending.get(),|this|this.child(div().text_size(px(12.)).child(t("正在保存…"))))
                    .keyboard(!pending.get()).overlay_closable(!pending.get()).close_button(!pending.get())
                    .button_props(DialogButtonProps::default().show_cancel(true).ok_text(t("保存")).cancel_text(t("取消")))
                    .on_cancel(move |_,_,_|!cancel.get())
                    .on_ok(move |_,window,cx|{
                        if pending.get(){return false;}
                        let text=read.read(cx).value().trim().to_string();
                        if text.is_empty(){*error.borrow_mut()=Some(t("消息不能为空"));window.refresh();return false;}
                        let (id,at,pending,error,conversation)=(id.clone(),item.get("updatedAt").cloned(),pending.clone(),error.clone(),conversation.clone());
                        _=view.update(cx,|this,cx|{
                            pending.set(true);*error.borrow_mut()=None;let client=this.client.clone();
                            let task=cx.spawn_in(window,async move |this,cx|{
                                let result=io(async move {
                                    match client.chat_queue_action(&id,serde_json::json!({"action":"edit","message":text,"updatedAt":at})).await {
                                        Ok(value)=>Ok(value),
                                        Err(e) if e.outcome_unknown()=>{
                                            if let Some(conversation)=conversation {
                                                let state=client.chat_continuation(&conversation).await?;
                                                if let Some(value)=state.items.into_iter().find(|v|v.get("id").and_then(|v|v.as_str())==Some(id.as_str())&&v.get("message").and_then(|v|v.as_str())==Some(text.as_str())) {return Ok(value);}
                                            }
                                            Err(e)
                                        }
                                        Err(e)=>Err(e),
                                    }
                                }).await;
                                _=this.update_in(cx,|this,window,cx|{
                                    pending.set(false);
                                    if result.is_ok(){window.close_dialog(cx);}else if let Err(e)=result{*error.borrow_mut()=Some(format!("{}：{}",t("保存失败，输入已保留"),e.user_text()));}
                                    this.refresh_continuation(cx);window.refresh();cx.notify();
                                });
                            });this._tasks.push(task);
                        });window.refresh();false
                    })
            });
            window.defer(cx, move |window, cx| focus.focus(window, cx));
            return;
        }
        self.apply_queue(
            id,
            serde_json::json!({"action":"insert","updatedAt":item.get("updatedAt")}),
            action == "cancel",
            cx,
        );
    }

    fn apply_queue(
        &mut self,
        id: String,
        body: serde_json::Value,
        cancel: bool,
        cx: &mut Context<Self>,
    ) {
        let client = self.client.clone();
        let task = cx.spawn(async move |this, cx| {
            let result = io(async move {
                if cancel {
                    client.chat_queue_cancel_verified(&id).await
                } else {
                    client.chat_queue_action(&id, body).await
                }
            })
            .await;
            _ = this.update(cx, |this, cx| {
                if let Err(e) = result {
                    this.upload_error = Some(e.user_text());
                }
                this.refresh_continuation(cx);
                cx.notify();
            });
        });
        self._tasks.push(task);
    }

    /// App action calls this only on the visible Chat page. The setting is
    /// read at invocation time so changing Settings needs no restart.
    pub fn toggle_handsfree(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.visible {
            return;
        }
        let local = opstwin_store::Store::open_default()
            .ok()
            .map(|store| store.load::<serde_json::Value>("settings-drafts.json"))
            .unwrap_or_default();
        let enabled = local
            .pointer("/local/dictation/handsfree")
            .or_else(|| {
                local
                    .get("local")
                    .and_then(|v| v.get("dictation.handsfree"))
            })
            .and_then(|value| value.as_str())
            == Some("option-space");
        if !enabled || self.dictation_processing {
            return;
        }
        if self.capture.is_some() {
            self.stop_dictation(false, cx);
        } else {
            self.start_dictation(window, cx);
        }
    }

    pub fn escape_dictation(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        if self.capture.is_some() || self.dictation_processing {
            self.cancel_dictation(cx);
            self.restore_dictation_input(window, cx);
            true
        } else {
            false
        }
    }

    fn restore_dictation_input(&self, window: &Window, cx: &Context<Self>) {
        let previous = window.focused(cx);
        let generation = self.dictation_generation;
        let conversation = self.conversation_id.clone();
        let view = cx.entity().downgrade();
        window.on_next_frame(move |window, cx| {
            _ = view.update(cx, |this, cx| {
                if this.visible
                    && this.dictation_generation == generation
                    && this.conversation_id == conversation
                    && this.capture.is_none()
                    && !this.dictation_processing
                    && (window.focused(cx).is_none() || window.focused(cx) == previous)
                {
                    this.input.focus_handle(cx).focus(window, cx);
                }
            });
        });
    }

    pub fn cancel_dictation(&mut self, cx: &mut Context<Self>) {
        self.dictation_generation += 1;
        if let Some(capture) = self.capture.take() {
            capture.cancel();
        }
        self.dictation_audio = None;
        self.dictation_send = false;
        self.dictation_processing = false;
        self.dictation_levels.clear();
        self.dictation_seconds = 0.;
        cx.notify();
    }

    fn start_dictation(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.capture.is_some()
            || self.dictation_processing
            || self.initial_loading
            || self.switching
            || !self.visible
        {
            return;
        }
        self.upload_error = None;
        self.dictation_audio = None;
        self.dictation_levels.clear();
        self.dictation_generation += 1;
        self.dictation_send = false;
        play_dictation_cue();
        self.dictation_height = self
            .composer_height
            .lock()
            .map(|h| *h)
            .unwrap_or(60.)
            .max(60.);
        let capture = match crate::dictation::Capture::start() {
            Ok(c) => c,
            Err(e) => {
                self.upload_error = Some(e);
                cx.notify();
                return;
            }
        };
        let state = capture.state.clone();
        let generation = self.dictation_generation;
        self.capture = Some(capture);
        let view = cx.entity().downgrade();
        window.on_next_frame(move |window, cx| {
            _ = view.update(cx, |this, cx| {
                if this.visible && this.dictation_generation == generation && this.capture.is_some()
                {
                    this.dictation_focus.focus(window, cx);
                }
            });
        });
        cx.notify();
        let task = cx.spawn_in(window, async move |this, cx| {
            loop {
                sleep(100).await;
                let data = {
                    let Ok(mut s) = state.lock() else { return };
                    (s.level, s.seconds, s.result.take())
                };
                let alive = this
                    .update_in(cx, |this, window, cx| {
                        if this.dictation_generation != generation {
                            return false;
                        }
                        this.dictation_levels.push(data.0);
                        if this.dictation_levels.len() > 38 {
                            this.dictation_levels.remove(0);
                        }
                        this.dictation_seconds = data.1;
                        cx.notify();
                        if let Some(result) = data.2 {
                            this.finish_dictation(result, generation, window, cx);
                            return false;
                        }
                        true
                    })
                    .unwrap_or(false);
                if !alive {
                    return;
                }
            }
        });
        self._tasks.push(task);
    }

    fn stop_dictation(&mut self, send: bool, cx: &mut Context<Self>) {
        let local = opstwin_store::Store::open_default()
            .ok()
            .map(|s| s.load::<serde_json::Value>("settings-drafts.json"))
            .unwrap_or_default();
        self.dictation_send = send
            || local
                .pointer("/local/dictation/autoSend")
                .or_else(|| local.get("local").and_then(|s| s.get("dictation.autoSend")))
                .and_then(|s| s.as_bool())
                .unwrap_or(false);
        self.dictation_processing = true;
        if let Some(capture) = &self.capture {
            capture.stop();
        }
        cx.notify();
    }

    fn finish_dictation(
        &mut self,
        result: Result<Vec<u8>, String>,
        generation: u64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.capture.take();
        let bytes = match result {
            Ok(bytes) => bytes,
            Err(error) => {
                self.dictation_processing = false;
                self.upload_error = Some(error);
                self.restore_dictation_input(window, cx);
                cx.notify();
                return;
            }
        };
        self.dictation_audio = Some(bytes.clone());
        self.upload_error = None;
        self.dictation_processing = true;
        let client = self.client.clone();
        let conversation = self.conversation_id.clone();
        let task = cx.spawn_in(window, async move |this, cx| {
            let result = io(async move { client.transcribe_microphone(bytes).await }).await;
            _ = this.update_in(cx, |this, window, cx| {
                if this.dictation_generation != generation || this.conversation_id != conversation {
                    return;
                }
                this.dictation_processing = false;
                match result {
                    Ok(text) => {
                        this.dictation_audio = None;
                        play_dictation_cue();
                        let draft = this.input.read(cx).value().to_string();
                        let joined = if draft.trim().is_empty() {
                            text
                        } else {
                            format!("{draft} {text}")
                        };
                        this.input
                            .update(cx, |s, cx| s.set_value(joined, window, cx));
                        this.persist(cx);
                        if this.dictation_send {
                            this.send(window, cx);
                        }
                    }
                    Err(e) => {
                        this.upload_error = Some(format!("听写失败：{}；原草稿保留", e.user_text()))
                    }
                }
                this.dictation_send = false;
                this.restore_dictation_input(window, cx);
                cx.notify();
            });
        });
        self._tasks.push(task);
    }

    fn show_request_record(&mut self, rid: String, window: &mut Window, cx: &mut Context<Self>) {
        let client = self.client.clone();
        let target = self.conversation_id.clone();
        let owner = self.record_owner_generation;
        let task = cx.spawn_in(window, async move |this, cx| {
            let result = io(async move {
                match client.chat_request_status(&rid).await {
                    Ok(status) => match status.run_id.as_deref() {
                        Some(id) => {
                            match client.chat_run(id).await {
                                Ok(run) => Ok(serde_json::json!({"request":status.record_metadata(),"run":run})),
                                Err(error) => Ok(serde_json::json!({"request":status.record_metadata(),"runReadError":error.user_text()})),
                            }
                        }
                        None => Ok(serde_json::json!({"request":status.record_metadata()})),
                    },
                    Err(e) if e.status() == Some(404) => {
                        let receipt = client.chat_continuation_receipt(&rid).await?;
                        match receipt.get("runId").and_then(|v| v.as_str()) {
                            Some(id) => client.chat_run(id).await,
                            None => Ok(receipt),
                        }
                    }
                    Err(e) => Err(e),
                }
            })
            .await;
            _ = this.update_in(cx, |this, window, cx| {
                if !this.visible || this.conversation_id != target || this.record_owner_generation != owner { return; }
                let text = match result {
                    Ok(v) => crate::chat_presentation::record(&v),
                    Err(e) => e.user_text(),
                };
                window.open_dialog(cx, move |dialog, _, _| {
                    dialog.title(t("执行记录")).w(px(660.)).child(
                        div()
                            .id("chat-request-record")
                            .max_h(px(520.))
                            .overflow_y_scroll()
                            .child(crate::util::markdown(
                                "chat-request-record-body",
                                text.clone(),
                            )),
                    )
                })
            });
        });
        self._tasks.push(task);
    }

    fn show_record(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        let client = self.client.clone();
        let target = self.conversation_id.clone();
        let owner = self.record_owner_generation;
        let task = cx.spawn_in(window, async move |this, cx| {
            let result = io(async move { client.chat_record(&id).await }).await;
            _ = this.update_in(cx, |this, window, cx| {
                if !this.visible || this.conversation_id != target || this.record_owner_generation != owner { return; }
                let text = match result {
                    Ok(v) => crate::chat_presentation::record(&v),
                    Err(e) => format!("执行记录读取失败：{}", e.user_text()),
                };
                window.open_dialog(cx, move |dialog, _, _| {
                    dialog.title(t("执行记录")).w(px(660.)).child(
                        div()
                            .id("chat-run-record-scroll")
                            .max_h(px(520.))
                            .overflow_y_scroll()
                            .child(crate::util::markdown(
                                "chat-record",
                                text.clone(),
                            )),
                    )
                })
            });
        });
        self._tasks.push(task);
    }

    // ----------------------------------------------------------- attachments

    fn pick_files(&mut self, cx: &mut Context<Self>) {
        let rx = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: true,
            prompt: Some("添加附件".into()),
        });
        let task = cx.spawn(async move |this, cx| {
            let paths: Vec<PathBuf> = match rx.await {
                Ok(Ok(Some(p))) => p,
                Ok(Err(e)) => {
                    eprintln!("[opstwin] file picker failed: {e}");
                    _ = this.update(cx, |this, cx| {
                        this.upload_error = Some("无法打开文件选择器".into());
                        cx.notify();
                    });
                    return;
                }
                _ => return,
            };
            for path in paths {
                _ = this.update(cx, |this, cx| this.upload_path(path, cx));
            }
        });
        self._tasks.push(task);
    }

    fn upload_path(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        self.uploading += 1;
        self.upload_error = None;
        cx.notify();
        let client = self.client.clone();
        let conversation_id = self.conversation_id.clone();
        let upload_target = conversation_id.clone();
        let task = cx.spawn(async move |this, cx| {
            let result = io(async move {
                let f = crate::files::read_upload(path).await?;
                client
                    .upload_file(f.name, f.mime, f.bytes, conversation_id)
                    .await
                    .map_err(|e| e.user_text())
            })
            .await;
            _ = this.update(cx, |this, cx| {
                this.uploading -= 1;
                match result {
                    Ok(a) => {
                        eprintln!("[opstwin] uploaded artifact {} size={}", a.id, a.size);
                        let attachment = AttachmentRef {
                            id: a.id.clone(),
                            name: a.name.clone(),
                            size: a.size,
                            mime: a.mime.clone(),
                        };
                        if this.conversation_id == upload_target {
                            this.pending_files.push(attachment);
                        } else if let Some(target) = &upload_target {
                            this.drafts
                                .entry(target.clone())
                                .or_default()
                                .attachments
                                .push(attachment);
                        }
                        this.artifacts.insert(a.id.clone(), a);
                        this.persist(cx);
                    }
                    Err(msg) => {
                        eprintln!("[opstwin] upload failed");
                        this.upload_error = Some(msg);
                    }
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
    }

    fn remove_pending_file(&mut self, id: &str, cx: &mut Context<Self>) {
        self.pending_files.retain(|a| a.id != id);
        self.persist(cx);
        cx.notify();
    }

    /// Fill in names/sizes for attachment ids we have not seen yet.
    fn ensure_artifact_meta(&mut self, cx: &mut Context<Self>) {
        let missing: Vec<String> = self
            .messages
            .iter()
            .flat_map(|m| m.attachments.iter())
            .filter(|id| !self.artifacts.contains_key(*id) && !self.file_states.contains_key(*id))
            .cloned()
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        if missing.is_empty() {
            return;
        }
        for id in &missing {
            // Mark as in-flight so render does not re-request.
            self.file_states.insert(id.clone(), FileState::Opening);
        }
        let client = self.client.clone();
        let task = cx.spawn(async move |this, cx| {
            let ids = missing.clone();
            let result = io(async move { crate::files::lookup_artifacts(client, ids).await }).await;
            _ = this.update(cx, |this, cx| {
                for id in &missing {
                    this.file_states.remove(id);
                }
                match result {
                    Ok(list) => {
                        for a in list {
                            this.artifacts.insert(a.id.clone(), a);
                        }
                        for id in &missing {
                            if !this.artifacts.contains_key(id) {
                                this.file_states
                                    .insert(id.clone(), FileState::Failed("附件记录不存在".into()));
                            }
                        }
                    }
                    Err(msg) => {
                        for id in &missing {
                            this.file_states
                                .insert(id.clone(), FileState::Failed(msg.clone()));
                        }
                    }
                }
                this.remeasure_all(cx);
            });
        });
        self._tasks.push(task);
    }

    fn load_inline_image(&mut self, id: String, retry: bool, cx: &mut Context<Self>) {
        if retry
            && matches!(
                self.inline_images.get(&id),
                Some(InlineImageState::Failed(_))
            )
        {
            self.inline_images.remove(&id);
        }
        if let Some(InlineImageState::Ready { used, .. }) = self.inline_images.get_mut(&id) {
            self.image_usage += 1;
            *used = self.image_usage;
            return;
        }
        if self.inline_images.contains_key(&id)
            || !self.visible
            || self
                .inline_images
                .values()
                .filter(|state| matches!(state, InlineImageState::Loading))
                .count()
                >= 4
        {
            return;
        }
        let Some(artifact) = self.artifacts.get(&id).cloned() else {
            return;
        };
        let format = match artifact.mime.split(';').next().unwrap_or("").trim() {
            "image/png" => ImageFormat::Png,
            "image/jpeg" => ImageFormat::Jpeg,
            "image/gif" => ImageFormat::Gif,
            "image/webp" => ImageFormat::Webp,
            _ => return,
        };
        let generation = self.image_generation;
        self.inline_images
            .insert(id.clone(), InlineImageState::Loading);
        let client = self.client.clone();
        let task = cx.spawn(async move |this, cx| {
            let result = io(async move {
                if artifact.size > 8 * 1024 * 1024 {
                    return Err("图片超过直接显示上限，请打开附件预览".to_string());
                }
                let path = crate::files::fetch_verified(client, artifact).await?;
                crate::files::validate_file_access(&path).await?;
                let bytes = tokio::fs::read(&path)
                    .await
                    .map_err(|_| "图片读取失败".to_string())?;
                if bytes.len() > 8 * 1024 * 1024 {
                    return Err("图片超过直接显示上限，请打开附件预览".to_string());
                }
                Ok((format, bytes))
            })
            .await;
            _ = this.update(cx, |this, cx| {
                if this.image_generation != generation {
                    return;
                }
                let state = match result {
                    Ok((format, bytes)) => {
                        let used: usize = this
                            .inline_images
                            .values()
                            .filter_map(|state| {
                                if let InlineImageState::Ready { bytes, .. } = state {
                                    Some(*bytes)
                                } else {
                                    None
                                }
                            })
                            .sum();
                        let mut remaining = used;
                        let mut old: Vec<_> = this
                            .inline_images
                            .iter()
                            .filter_map(|(id, state)| {
                                if let InlineImageState::Ready { bytes, used, .. } = state {
                                    Some((id.clone(), *bytes, *used))
                                } else {
                                    None
                                }
                            })
                            .collect();
                        old.sort_by_key(|row| row.2);
                        for (old_id, old_bytes, _) in old {
                            if remaining + bytes.len() <= 64 * 1024 * 1024 {
                                break;
                            }
                            this.inline_images.remove(&old_id);
                            remaining = remaining.saturating_sub(old_bytes);
                        }
                        this.image_usage += 1;
                        InlineImageState::Ready {
                            bytes: bytes.len(),
                            used: this.image_usage,
                            image: std::sync::Arc::new(Image::from_bytes(format, bytes)),
                        }
                    }
                    Err(error) => InlineImageState::Failed(error),
                };
                this.inline_images.insert(id, state);
                this.remeasure_all(cx);
            });
        });
        self._tasks.push(task);
    }

    pub(crate) fn open_attachment(&mut self, id: String, cx: &mut Context<Self>) {
        if self.file_states.get(&id) == Some(&FileState::Opening) {
            return;
        }
        let origin_conversation = self.conversation_id.clone();
        let known = self.artifacts.get(&id).cloned();
        self.file_states.insert(id.clone(), FileState::Opening);
        self.remeasure_all(cx);
        let client = self.client.clone();
        let task = cx.spawn(async move |this, cx| {
            let fetch_id = id.clone();
            let result = io(async move {
                let art = match known {
                    Some(a) => a,
                    None => crate::files::lookup_artifacts(client.clone(), vec![fetch_id.clone()])
                        .await?
                        .into_iter()
                        .next()
                        .ok_or_else(|| "附件记录不存在".to_string())?,
                };
                let title = art.name.clone();
                crate::files::preview_verified(client, art)
                    .await
                    .map(|preview| (title, preview))
            })
            .await;
            _ = this.update(cx, |this, cx| {
                match result {
                    Ok(preview) => {
                        eprintln!("[opstwin] previewed attachment {id}");
                        this.file_states.remove(&id);
                        if this.conversation_id == origin_conversation && this.visible {
                            this.file_preview = Some(preview);
                        }
                    }
                    Err(msg) => {
                        eprintln!("[opstwin] attachment {id} failed");
                        this.upload_error = Some(t(&msg));
                        this.file_states.insert(id.clone(), FileState::Failed(msg));
                    }
                }
                this.remeasure_all(cx);
            });
        });
        self._tasks.push(task);
    }

    // -------------------------------------------------------------- rendering

    fn render_row(
        row: &Row,
        ix: usize,
        view: WeakEntity<Self>,
        files: &Rc<FileCtx>,
        cx: &mut App,
    ) -> AnyElement {
        match row {
            Row::Time { raw, .. } => div()
                .w_full()
                .text_center()
                .text_size(px(12.))
                .line_height(relative(1.5))
                .py(px(10.))
                .text_color(cx.theme().muted_foreground)
                .child(time_label(raw))
                .into_any_element(),
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
                            .label(if *loading {
                                "正在加载更早消息…"
                            } else {
                                "加载更早消息"
                            })
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
                &msg.attachments,
                msg.request_id.as_deref(),
                outgoing.as_ref(),
                ix,
                view,
                files,
                cx,
            ),
            Row::Processing(rid) => h_flex().w_full().mb(px(22.)).child(
                h_flex().id(ElementId::Name(format!("typing-{rid}").into()))
                    .role(gpui_kit::Role::Status)
                    .aria_label(if crate::settings::is_english() { "AI is processing" } else { "AI 正在处理" })
                    .gap(px(5.)).px(px(18.)).h(px(44.)).rounded(px(22.))
                    .bg(cx.theme().muted)
                    .children((0..3).map(|index| {
                        div().size(px(7.)).rounded_full().bg(cx.theme().muted_foreground)
                            .with_animation(ElementId::Name(format!("typing-{rid}-{index}").into()),
                                Animation::new(std::time::Duration::from_millis(1200)).repeat(),
                                move |dot, delta| {
                                    let wave = ((delta * std::f32::consts::TAU
                                        - index as f32 * 0.8).sin() + 1.) / 2.;
                                    dot.opacity(0.3 + 0.7 * wave)
                                })
                    }))
            ).into_any_element(),
            Row::Local(o) => {
                let id: SharedString = format!("local-{}", o.request_id).into();
                let ids: Vec<String> = o.attachments.iter().map(|a| a.id.clone()).collect();
                Self::render_message(&id, true, &o.text, &ids, Some(&o.request_id), Some(o), ix, view, files, cx)
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn render_message(
        id: &SharedString,
        is_user: bool,
        content: &SharedString,
        attachments: &[String],
        request_id: Option<&str>,
        outgoing: Option<&Outgoing>,
        _ix: usize,
        view: WeakEntity<Self>,
        files: &Rc<FileCtx>,
        cx: &mut App,
    ) -> AnyElement {
        let content: SharedString = if is_user { content.clone() } else { crate::chat_presentation::reply(content.as_ref()).into() };
        let theme = cx.theme().clone();
        // Match macos-markdown.css rather than the component facade's
        // documentation-sized headings and default 1rem paragraph gap.
        let body_scale = f32::from(crate::settings::body_px(15., cx)) / 15.;
        let markdown_style = gpui_kit::base::text::TextViewStyle::default()
            .with_foreground(theme.foreground)
            .with_muted_foreground(theme.muted_foreground)
            .with_link(theme.link)
            .with_selection(theme.selection)
            .with_border(theme.border)
            .with_code_background(theme.muted)
            .with_dark(theme.is_dark())
            .with_paragraph_gap(rems(10. / 16. * body_scale))
            .with_list_prefix_width(crate::settings::body_px(22., cx))
            .with_list_item_gap(crate::settings::body_px(4., cx))
            .with_list_block_gap(rems(8. / 16. * body_scale))
            .with_first_heading_flush(true)
            .with_strong_weight(FontWeight::SEMIBOLD)
            .with_heading(move |level| {
                StyleRefinement::default()
                    .text_size(px(body_scale
                        * match level {
                            1 => 18.,
                            2 => 16.,
                            _ => 15.,
                        }))
                    .font_weight(FontWeight::SEMIBOLD)
                    .mt(px(14. * body_scale))
                    .mb(px(6. * body_scale))
                    .pb_0()
            })
            .with_code_block(
                StyleRefinement::default()
                    .text_size(crate::settings::body_px(12.5, cx))
                    .line_height(relative(1.55))
                    .px(px(14.))
                    .py(px(12.))
                    .rounded(px(5.)),
            )
            .with_table({
                let mut table =
                    StyleRefinement::default().text_size(crate::settings::body_px(13., cx));
                table.overflow.x = Some(Overflow::Scroll);
                table
            })
            .with_table_cell(StyleRefinement::default().px(px(10.)).py(px(6.)));
        let body =
            crate::util::markdown(ElementId::Name(format!("md-{id}").into()), content.clone())
                .style(markdown_style)
                .text_size(crate::settings::body_px(15., cx))
                .font_weight(FontWeight::NORMAL)
                .selectable(true);
        let mut inner = v_flex().gap_2().child(body);
        if !attachments.is_empty() {
            let mut chips = h_flex().flex_wrap().gap_1p5();
            for aid in attachments {
                let meta = files.artifacts.get(aid);
                let state = files.states.get(aid);
                if meta.is_some_and(|artifact| {
                    matches!(
                        artifact.mime.split(';').next().unwrap_or("").trim(),
                        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
                    )
                }) {
                    match files.images.get(aid) {
                        Some(InlineImageState::Ready { image, .. }) => {
                            let touch_view = view.clone();
                            let touch_id = aid.clone();
                            cx.defer(move |cx| {
                                _ = touch_view.update(cx, |this, cx| {
                                    this.load_inline_image(touch_id, false, cx)
                                });
                            });

                            let v = view.clone();
                            let image_id = aid.clone();
                            inner = inner.child(
                                gpui_kit::base::Button::new(ElementId::Name(
                                    format!("chat-image-{id}-{aid}").into(),
                                ))
                                .accessibility_label(format!(
                                    "{} · {}",
                                    t("预览图片"),
                                    meta.map(|artifact| artifact.name.as_str()).unwrap_or("")
                                ))
                                .child(
                                    img(image.clone())
                                        .max_w(px(280.))
                                        .max_h(px(240.))
                                        .object_fit(ObjectFit::Contain)
                                        .rounded(px(10.))
                                        .with_fallback(|| {
                                            div().child(t("图片暂不可用")).into_any_element()
                                        }),
                                )
                                .on_click(move |_, _, cx| {
                                    _ = v.update(cx, |this, cx| {
                                        this.open_attachment(image_id.clone(), cx)
                                    });
                                }),
                            );
                        }
                        Some(InlineImageState::Failed(error)) => {
                            let v = view.clone();
                            let image_id = aid.clone();
                            inner = inner.child(
                                Button::new(ElementId::Name(
                                    format!("chat-image-retry-{id}-{aid}").into(),
                                ))
                                .xsmall()
                                .ghost()
                                .label(t("图片暂不可用，点击重试预览"))
                                .tooltip(t(error))
                                .on_click(move |_, _, cx| {
                                    _ = v.update(cx, |this, cx| {
                                        this.load_inline_image(image_id.clone(), true, cx)
                                    });
                                }),
                            );
                        }
                        state => {
                            if state.is_none() {
                                let v = view.clone();
                                let image_id = aid.clone();
                                cx.defer(move |cx| {
                                    _ = v.update(cx, |this, cx| {
                                        this.load_inline_image(image_id, false, cx)
                                    });
                                });
                            }
                            inner = inner.child(
                                div()
                                    .text_xs()
                                    .text_color(theme.muted_foreground)
                                    .child(t("正在加载图片…")),
                            );
                        }
                    }
                }
                let label = match meta {
                    Some(a) => format!("{} · {}", a.name, crate::util::human_size(a.size)),
                    None => format!("附件 {}", short_id(aid)),
                };
                let v = view.clone();
                let open_id = aid.clone();
                let opening = state == Some(&FileState::Opening) && meta.is_some();
                chips = chips.child(
                    Button::new(ElementId::Name(format!("att-{id}-{aid}").into()))
                        .xsmall()
                        .outline()
                        .icon(IconName::File)
                        .loading(opening)
                        .label(label.clone())
                        .tooltip(t("下载并用默认应用打开"))
                        .accessibility_label(format!("{} · {}", t("下载并用默认应用打开"), label))
                        .on_click(move |_, _, cx| {
                            let open_id = open_id.clone();
                            _ = v.update(cx, |this, cx| this.open_attachment(open_id, cx));
                        }),
                );
                if let Some(FileState::Failed(msg)) = state {
                    chips = chips.child(
                        div()
                            .text_xs()
                            .text_color(theme.danger)
                            .child(t(&format!("打开失败：{msg}"))),
                    );
                }
            }
            inner = inner.child(chips);
        }
        let bubble = Bubble::new()
            .with_variant(BubbleVariant::Muted)
            .max_w_full()
            .content(
                BubbleContent::new()
                    .rounded(px(22.))
                    .px(px(20.))
                    .py(px(14.))
                    .text_size(crate::settings::body_px(15., cx))
                    .line_height(relative(1.65))
                    .bg(rgb(if theme.is_dark() {
                        if is_user { 0x2d4b6e } else { 0x30343d }
                    } else if is_user {
                        0xcce5ff
                    } else {
                        0xececee
                    }))
                    .child(inner),
            );
        let text = content.to_string();
        let copy_id = id.to_string();
        let copy_view = view.clone();
        let copied = view.upgrade().is_some_and(|view| {
            view.read(cx).copied_messages.contains_key(copy_id.as_str())
        });
        let record = id.to_string();
        let record_view = view.clone();
        let record_request = outgoing.map(|o| o.request_id.clone());
        let stopped = outgoing.is_some_and(|o| matches!(&o.state, SendState::Failed { message, retryable: false } if message == "已被新消息打断"));
        let actions = h_flex()
            .absolute()
            .bottom(px(1.))
            .h(px(20.))
            .left(px(16.))
            .gap(px(6.))
            .child(
                Button::new(ElementId::Name(format!("chat-copy-{id}").into()))
                    .ghost()
                    .xsmall()
                    .icon(Icon::new(if copied { ProductIcon::Check } else { ProductIcon::Copy })
                        .when(copied, |icon| icon.text_color(theme.success)))
                    .opacity(if copied { 1. } else { 0. })
                    .group_hover("chat-message", |this| this.opacity(1.))
                    .focus_visible(|this| this.opacity(1.))
                    .tooltip(t(if copied { if crate::settings::is_english() { "Copied" } else { "已复制" } } else { "复制消息" }))
                    .accessibility_label(t(if copied { if crate::settings::is_english() { "Copied" } else { "已复制" } } else { "复制消息" }))
                    .on_click(move |_, _, cx| {
                        cx.write_to_clipboard(ClipboardItem::new_string(text.clone()));
                        _ = copy_view.update(cx, |this, cx| {
                            let stamp = std::time::Instant::now();
                            let id = copy_id.clone();
                            this.copied_messages.insert(id.clone(), stamp);
                            cx.notify();
                            cx.spawn(async move |this, cx| {
                                sleep(2000).await;
                                _ = this.update(cx, |this, cx| {
                                    // Repeated clicks restart feedback; an older timer cannot clear it.
                                    if this.copied_messages.get(&id) == Some(&stamp) {
                                        this.copied_messages.remove(&id);
                                        cx.notify();
                                    }
                                });
                            }).detach();
                        });
                    }),
            )
            .when(!is_user || request_id.is_some(), |this| {
                this.child(
                    Button::new(ElementId::Name(format!("chat-record-{id}").into()))
                        .ghost()
                        .xsmall()
                        .icon(ProductIcon::FileText)
                        .opacity(0.)
                        .group_hover("chat-message", |this| this.opacity(1.))
                        .focus_visible(|this| this.opacity(1.))
                        .tooltip(t("查看执行记录"))
                        .accessibility_label(t("查看执行记录"))
                        .on_click(move |_, window, cx| {
                            _ = record_view.update(cx, |this, cx| {
                                if let Some(request) = record_request.clone() {
                                    this.show_request_record(request, window, cx);
                                } else {
                                    this.show_record(record.clone(), window, cx);
                                }
                            });
                        }),
                )
            });
        // Padding keeps the bubble-to-actions path inside the same hover owner.
        // Anchor to the bubble itself so both roles follow the text inset.
        let bubble_with_actions = div()
            .group("chat-message")
            .relative()
            .max_w(relative(0.88))
            .when(outgoing.is_none() || stopped, |this| this.pb(px(22.)))
            .child(bubble)
            .when(outgoing.is_none() || stopped, |this| this.child(actions));
        let mut message = Message::new()
            .id(ElementId::Name(format!("msg-{id}").into()))
            .alignment(if is_user {
                MessageAlignment::End
            } else {
                MessageAlignment::Start
            })
            .content(MessageContent::new().child(bubble_with_actions));
        message = message.with_stack_style(StyleRefinement::default().max_w_full());
        if let Some(o) = outgoing {
            let footer = match &o.state {
                SendState::Sending { attempt } => h_flex().gap_2().child(
                    div()
                        .text_xs()
                        .text_color(theme.muted_foreground)
                        .child(if *attempt > 1 {
                            t("发送中…（第 {attempt} 次尝试）")
                                .replace("{attempt}", &attempt.to_string())
                        } else {
                            t("发送中…")
                        }),
                ),
                SendState::Waiting => h_flex(),
                SendState::Checking => h_flex().child(
                    div().text_xs().text_color(theme.muted_foreground)
                        .child(if crate::settings::is_english() {
                            "Confirming request status…"
                        } else { "正在确认请求状态…" }),
                ),
                SendState::Failed { message, retryable: false } if message == "已被新消息打断" => h_flex().child(
                    div().text_xs().text_color(theme.muted_foreground).child(t("已停止")),
                ),
                SendState::Failed { message, retryable } => {
                    let rid_retry = o.request_id.clone();
                    let rid_dismiss = o.request_id.clone();
                    let rid_clear = o.request_id.clone();
                    let v1 = view.clone();
                    let v2 = view.clone();
                    let v3 = view.clone();
                    h_flex()
                        .gap_2()
                        .items_center()
                        .child(div().text_xs().text_color(theme.danger).child(format!("{}{}", t("发送失败："), t(message))))
                        .when(*retryable, |this| {
                            this.child(
                                Button::new(ElementId::Name(format!("retry-{rid_retry}").into()))
                                    .xsmall()
                                    .outline()
                                    .label(t("重试"))
                                    .on_click(move |_, window, cx| {
                                        _ = v1.update(cx, |this, cx| {
                                            this.retry(&rid_retry, window, cx)
                                        });
                                    }),
                            )
                        })
                        .child(
                            Button::new(ElementId::Name(format!("dismiss-{rid_dismiss}").into()))
                                .xsmall()
                                .ghost()
                                .label(t("查看执行记录"))
                                .on_click(move |_, window, cx| {
                                    _ = v2.update(cx, |this, cx| {
                                        this.show_request_record(rid_dismiss.clone(), window, cx)
                                    });
                                }),
                        )
                        .child(
                            Button::new(ElementId::Name(
                                format!("chat-confirmed-clear-{rid_clear}").into(),
                            ))
                            .xsmall()
                            .ghost()
                            .label(t("移除已确认请求"))
                            .on_click(move |_, window, cx| {
                                _ = v3.update(cx, |this, cx| {
                                    this.dismiss_confirmed(rid_clear.clone(), window, cx)
                                });
                            }),
                        )
                }
            };
            message = message.footer(MessageFooter::new().child(footer));
        }
        div()
            .when(outgoing.is_some() && !stopped, |this| this.mb(px(22.)))
            .child(message)
            .into_any_element()
    }

    fn keyboard_session_menu(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        let Some(item) = self.conversations.get(&id) else {
            return;
        };
        let (pinned, archived, locked) = (item.pinned, item.archived, self.session_locked(&id));
        let bounds = self
            .session_row_bounds
            .borrow()
            .get(&id)
            .copied()
            .unwrap_or(Bounds::new(
                point(px(16.), px(80.)),
                size(px(216.), px(36.)),
            ));
        let lower_edge = window.bounds().size.height - self.composer_clearance();
        let above = bounds.origin.y + bounds.size.height + px(220.) > lower_edge;
        let anchor = if above {
            Anchor::BottomRight
        } else {
            Anchor::TopRight
        };
        let position = point(
            bounds.origin.x + bounds.size.width,
            if above {
                bounds.origin.y
            } else {
                bounds.origin.y + bounds.size.height
            },
        );
        let previous = self
            .session_row_focus
            .borrow()
            .get(&id)
            .cloned()
            .or_else(|| self.keyboard_menu_previous.clone())
            .or_else(|| window.focused(cx));
        self.keyboard_menu_subscription = None;
        self.keyboard_menu = None;
        self.keyboard_menu_previous = previous.clone();
        let focus = previous.clone();
        let view = cx.entity().downgrade();
        let menu = gpui_kit::component::menu::PopupMenu::build(window, cx, move |menu, _, _| {
            let menu = menu.min_w(px(224.)).max_w(px(224.)).max_h(px(320.));
            let menu = if let Some(focus) = focus {
                menu.action_context(focus)
            } else {
                menu
            };
            Self::session_menu(menu, view, id, locked, pinned, archived)
        });
        let subscription = cx.subscribe_in(
            &menu,
            window,
            move |this, dismissed, _: &DismissEvent, window, cx| {
                if this
                    .keyboard_menu
                    .as_ref()
                    .is_none_or(|(current, _, _)| current.entity_id() != dismissed.entity_id())
                {
                    return;
                }
                let restore_focus = window.focused(cx).is_none()
                    || dismissed
                        .read(cx)
                        .focus_handle(cx)
                        .contains_focused(window, cx);
                this.keyboard_menu = None;
                this.keyboard_menu_previous = None;
                this.keyboard_menu_subscription = None;
                if restore_focus {
                    if let Some(focus) = &previous {
                        focus.focus(window, cx);
                    }
                }
                cx.notify();
            },
        );
        self.keyboard_menu_subscription = Some(subscription);
        menu.read(cx).focus_handle(cx).focus(window, cx);
        self.keyboard_menu = Some((menu, position, anchor));
        cx.notify();
    }

    fn session_menu(
        menu: gpui_kit::component::menu::PopupMenu,
        view: WeakEntity<Self>,
        id: String,
        locked: bool,
        pinned: bool,
        archived: bool,
    ) -> gpui_kit::component::menu::PopupMenu {
        let (v1, v2, v3, v4) = (view.clone(), view.clone(), view.clone(), view.clone());
        let (i1, i2, i3, i4) = (id.clone(), id.clone(), id.clone(), id.clone());
        menu.item(
            PopupMenuItem::new(t(if pinned { "取消置顶" } else { "置顶" })).on_click(
                move |_, _, cx| {
                    _ = v1.update(cx, |this, cx| this.mutate_session(&i1, "pin", cx));
                },
            ),
        )
        .item(
            PopupMenuItem::new(t("重命名")).on_click(move |_, window, cx| {
                _ = v2.update(cx, |this, cx| this.rename_session(i2.clone(), window, cx));
            }),
        )
        .separator()
        .item(
            PopupMenuItem::new(t(if archived { "恢复归档" } else { "归档" }))
                .disabled(locked)
                .on_click(move |_, _, cx| {
                    _ = v3.update(cx, |this, cx| this.mutate_session(&i3, "archive", cx));
                }),
        )
        .item(
            PopupMenuItem::new(t("删除"))
                .disabled(locked)
                .on_click(move |_, window, cx| {
                    _ = v4.update(cx, |this, cx| this.delete_session(i4.clone(), window, cx));
                }),
        )
    }

    fn render_header(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let current = self
            .conversation_id
            .as_ref()
            .filter(|id| Some(*id) != self.primary_id.as_ref())
            .and_then(|id| self.conversations.get(id))
            .map(|s| s.title.clone())
            .unwrap_or_default();
        h_flex()
            .w_full()
            .h(px(58.))
            .px(px(13.))
            .gap(px(16.))
            .when(!self.panel_open, |this| {
                this.child(
                    Button::new("chat-sessions-toggle")
                        .accessibility_label(t("会话"))
                        .ghost()
                        .child(
                            h_flex()
                                .gap(px(8.))
                                .child(Icon::new(ProductIcon::Menu).size(px(16.)))
                                .child(div().text_size(px(15.)).child(t("会话"))),
                        )
                        .h(px(36.))
                        .rounded(px(22.))
                        .pl(px(14.))
                        .pr(px(16.))
                        .bg(cx.theme().background)
                        .shadow(vec![BoxShadow {
                            inset: false,
                            color: rgba(if cx.theme().is_dark() {
                                0x00000055
                            } else {
                                0x17223514
                            })
                            .into(),
                            offset: point(px(0.), px(4.)),
                            blur_radius: px(16.),
                            spread_radius: px(0.),
                        }])
                        .on_click(cx.listener(|this, _, _, cx| this.toggle_conversations(cx))),
                )
            })
            .when(!current.is_empty(), |this| {
                this.child(
                    div()
                        .text_size(px(13.))
                        .text_color(cx.theme().muted_foreground)
                        .child(current),
                )
            })
    }

    fn render_panel_options(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let view = cx.entity().downgrade();
        let keep = self.keep_panel_visible;
        let archive = self.show_archived;
        Button::new("chat-panel-options")
            .accessibility_label(t("更多选项"))
            .ghost()
            .child(Icon::new(ProductIcon::Ellipsis).size(px(22.)))
            .p_0()
            .w(px(28.))
            .h(px(30.))
            .dropdown_menu(move |menu, _, _| {
                let v1 = view.clone();
                let v2 = view.clone();
                let v3 = view.clone();
                menu.item(
                    PopupMenuItem::new(t(if keep {
                        "取消保持可见"
                    } else {
                        "保持面板可见"
                    }))
                    .on_click(move |_, _, cx| {
                        _ = v1.update(cx, |this, cx| {
                            this.keep_panel_visible = !this.keep_panel_visible;
                            this.persist(cx);
                            cx.notify();
                        });
                    }),
                )
                .item(
                    PopupMenuItem::new(t(if archive {
                        "显示活跃会话"
                    } else {
                        "查看归档会话"
                    }))
                    .on_click(move |_, _, cx| {
                        _ = v2.update(cx, |this, cx| {
                            this.show_archived = !this.show_archived;
                            cx.notify();
                        });
                    }),
                )
                .separator()
                .item(PopupMenuItem::new(t("收起面板")).on_click(move |_, _, cx| {
                    _ = v3.update(cx, |this, cx| {
                        this.panel_open = false;
                        cx.notify();
                    });
                }))
            })
    }

    fn composer_clearance(&self) -> Pixels {
        // Same as session syncBounds: 20px bottom inset and 12px space
        // above the actual composer, including multiline/voice height.
        px(self
            .composer_height
            .lock()
            .map(|height| *height)
            .unwrap_or(60.)
            .max(60.)
            + 32.)
    }

    fn render_sessions(&self, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let theme = cx.theme().clone();
        let query = self.session_query.read(cx).value().to_lowercase();
        let mut side: Vec<_> = self
            .conversations
            .iter()
            .filter(|(id, s)| {
                Some(*id) != self.primary_id.as_ref()
                    && !s.deleted
                    && s.archived == self.show_archived
                    && (query.is_empty() || s.title.to_lowercase().contains(&query))
            })
            .collect();
        side.sort_by(|a, b| b.1.pinned.cmp(&a.1.pinned).then(a.1.title.cmp(&b.1.title)));
        let empty = side.is_empty();
        let mut rows = v_flex().w_full();
        if empty {
            rows = rows.child(
                div()
                    .px(px(10.))
                    .py(px(14.))
                    .text_size(px(12.))
                    .text_color(theme.muted_foreground)
                    .child(t(if !query.is_empty() {
                        "没有匹配会话"
                    } else if self.show_archived {
                        "暂无归档会话"
                    } else {
                        "还没有侧会话"
                    })),
            );
        }
        for (id, s) in side {
            let selected = self.conversation_id.as_ref() == Some(id);
            let id = id.clone();
            let menu_id = id.clone();
            let context_id = id.clone();
            let keyboard_id = id.clone();
            let bounds_id = id.clone();
            let row_bounds = self.session_row_bounds.clone();
            let pinned = s.pinned;
            let row_focus = self
                .session_row_focus
                .borrow_mut()
                .entry(id.clone())
                .or_insert_with(|| cx.focus_handle())
                .clone();
            rows = rows.child(
                h_flex()
                    .id(ElementId::Name(format!("chat-session-{id}").into()))
                    .track_focus(&row_focus)
                    .h(px(36.))
                    .w_full()
                    .rounded(px(10.))
                    .relative()
                    .on_key_down(cx.listener(move |this, event: &KeyDownEvent, window, cx| {
                        if event.keystroke.key == "f10" && event.keystroke.modifiers.shift {
                            cx.stop_propagation();
                            this.keyboard_session_menu(keyboard_id.clone(), window, cx);
                        }
                    }))
                    .when(selected, |this| this.bg(theme.muted))
                    .hover(|this| this.bg(theme.muted))
                    .child(
                        Button::new(ElementId::Name(format!("chat-session-open-{id}").into()))
                            .accessibility_label(s.title.clone())
                            .ghost()
                            .h(px(36.))
                            .flex_1()
                            .min_w_0()
                            .px(px(10.))
                            .font_weight(FontWeight::NORMAL)
                            .child(
                                h_flex()
                                    .w_full()
                                    .gap(px(7.))
                                    .child(
                                        div()
                                            .flex_1()
                                            .min_w_0()
                                            .truncate()
                                            .text_size(px(14.))
                                            .child(s.title.clone()),
                                    )
                                    .when(pinned, |this| {
                                        this.child(
                                            Icon::new(ProductIcon::Pin)
                                                .size(px(13.))
                                                .text_color(theme.muted_foreground),
                                        )
                                    }),
                            )
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.open_conversation(id.clone(), window, cx)
                            })),
                    )
                    .child(
                        Button::new(ElementId::Name(
                            format!("chat-session-menu-{menu_id}").into(),
                        ))
                        .accessibility_label(format!("{} · {}", t("更多选项"), s.title))
                        .ghost()
                        .icon(ProductIcon::Ellipsis)
                        .w(px(28.))
                        .h(px(30.))
                        .on_click(cx.listener(
                            move |this, _, window, cx| {
                                this.keyboard_session_menu(menu_id.clone(), window, cx)
                            },
                        )),
                    )
                    .child(
                        canvas(
                            move |bounds, _, _| {
                                row_bounds.borrow_mut().insert(bounds_id.clone(), bounds);
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full(),
                    )
                    .on_mouse_down(
                        MouseButton::Right,
                        cx.listener(move |this, _, window, cx| {
                            cx.stop_propagation();
                            this.keyboard_session_menu(context_id.clone(), window, cx);
                        }),
                    ),
            );
        }
        let primary = self.primary_id.clone();
        let selected = self.conversation_id == primary;
        v_flex()
            .relative()
            .h_full()
            .flex_shrink_0()
            .w(px(240.))
            .px(px(12.))
            .py(px(16.))
            .bg(theme.background)
            .shadow(vec![BoxShadow {
                inset: false,
                color: rgba(if theme.is_dark() {
                    0x00000055
                } else {
                    0x17223514
                })
                .into(),
                offset: point(px(8.), px(0.)),
                blur_radius: px(22.),
                spread_radius: px(0.),
            }])
            .occlude()
            .child(
                h_flex()
                    .gap(px(6.))
                    .mb(px(12.))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .py(px(2.))
                            .border_1()
                            .border_color(
                                if self
                                    .session_query
                                    .read(cx)
                                    .focus_handle(cx)
                                    .is_focused(window)
                                {
                                    theme.ring
                                } else {
                                    theme.input
                                },
                            )
                            .rounded(px(24.))
                            .bg(theme.background)
                            .child(
                                Input::new(&self.session_query)
                                    .appearance(false)
                                    .prefix(Icon::new(ProductIcon::Search).size(px(18.)))
                                    .text_size(px(13.)),
                            ),
                    )
                    .child(self.render_panel_options(cx)),
            )
            .child(
                Button::new("chat-main-conversation")
                    .accessibility_label(t("主会话"))
                    .ghost()
                    .h(px(36.))
                    .w_full()
                    .px(px(10.))
                    .font_weight(FontWeight::NORMAL)
                    .child(div().w_full().text_size(px(14.)).child(t("主会话")))
                    .when(selected, |this| this.bg(theme.muted))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        if let Some(id) = primary.clone() {
                            this.open_conversation(id, window, cx);
                        }
                    })),
            )
            .child(
                h_flex()
                    .h(px(40.))
                    .px(px(9.))
                    .justify_between()
                    .child(
                        div()
                            .text_size(px(13.))
                            .text_color(theme.muted_foreground)
                            .child(t(if self.show_archived {
                                "已归档会话"
                            } else {
                                "其他会话"
                            })),
                    )
                    .when(!self.show_archived, |this| {
                        this.child(
                            Button::new("chat-new-conversation")
                                .accessibility_label(t("新建会话"))
                                .ghost()
                                .icon(ProductIcon::Plus)
                                .w(px(28.))
                                .h(px(30.))
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.create_conversation(window, cx)
                                })),
                        )
                    }),
            )
            .child(
                div()
                    .id("chat-session-list")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .child(rows),
            )
            .when_some(self.last_deleted.clone(), |this, id| {
                this.child(
                    Button::new("chat-undo-delete")
                        .ghost()
                        .label(t("撤销删除"))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.mutate_session(&id, "restore", cx)
                        })),
                )
            })
            .into_any_element()
    }

    fn render_preview(&self, cx: &mut Context<Self>) -> AnyElement {
        let Some((title, preview)) = &self.file_preview else {
            return div().into_any_element();
        };
        let theme = cx.theme();
        let (path, body) = match preview {
            crate::files::FilePreview::Text {
                text,
                path,
                markdown,
            } => {
                let body = if *markdown {
                    crate::util::markdown("chat-file-preview-markdown", text.clone())
                        .selectable(true)
                        .into_any_element()
                } else {
                    div()
                        .text_size(px(13.))
                        .child(text.clone())
                        .into_any_element()
                };
                (path.clone(), body)
            }
            crate::files::FilePreview::Image { path } => (
                path.clone(),
                img(path.clone())
                    .w_full()
                    .object_fit(ObjectFit::Contain)
                    .into_any_element(),
            ),
            crate::files::FilePreview::Unsupported { path } => (
                path.clone(),
                div()
                    .text_size(px(13.))
                    .text_color(theme.muted_foreground)
                    .child(t("此文件可用系统应用打开"))
                    .into_any_element(),
            ),
        };
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
                    .gap(px(8.))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .overflow_hidden()
                            .text_ellipsis()
                            .text_size(px(14.))
                            .child(title.clone()),
                    )
                    .child(
                        Button::new("chat-preview-close")
                            .ghost()
                            .xsmall()
                            .icon(ProductIcon::X)
                            .tooltip(t("关闭文件预览"))
                            .accessibility_label(t("关闭文件预览"))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.file_preview = None;
                                cx.notify();
                            })),
                    ),
            )
            .child(
                div()
                    .id("chat-preview-body")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .child(body),
            )
            .child(
                Button::new("chat-preview-system-open")
                    .ghost()
                    .small()
                    .icon(ProductIcon::ExternalLink)
                    .label(t("在系统应用打开"))
                    .on_click(move |_, _, cx| cx.open_with_system(&path)),
            )
            .into_any_element()
    }

    fn recovery_item_visible(&self, item: &RecoveryIntent) -> bool {
        // Local outgoing rows already own their live/failed state and record.
        // Never duplicate ordinary sending as an earlier-run warning. Partial
        // evidence must remain visible even when a local request also exists.
        item.status == "partial" || !self.outgoing.iter().any(|outgoing|
            outgoing.request_id == item.request_id
                && outgoing.conversation_id.as_deref() == Some(item.conversation_id.as_str()))
    }

    fn recovery_visible(&self) -> bool {
        let known_partial = self.conversation_id.as_ref().and_then(|id| self.session_states.get(id)).is_some_and(|v| v.partial);
        self.recovery_items.iter().any(|item| self.recovery_item_visible(item))
            || self.recovery_next_before.is_some() || known_partial || self.recovery_error.is_some()
    }

    fn render_recovery(&self, cx: &mut Context<Self>) -> AnyElement {
        let known_partial = self.conversation_id.as_ref().and_then(|id| self.session_states.get(id)).is_some_and(|v| v.partial);
        if !self.recovery_visible() {
            return div().into_any_element();
        }
        let english = crate::settings::is_english();
        let label = |zh: &str, en: &str| if english { en.to_string() } else { zh.to_string() };
        let theme = cx.theme();
        let title = if self.recovery_partial_count > 0 || known_partial {
            label("原运行部分完成，请查看执行记录；原请求不会重发", "An earlier run completed partially. Review its record; it will not be resent.")
        } else { label("原运行结果待检查", "Review earlier run outcomes") };
        let mut panel = v_flex().id("chat-server-recovery").gap(px(6.)).text_size(px(12.));
        panel = panel.child(h_flex().gap(px(8.)).items_center().child(div().flex_1().text_color(theme.danger).child(title)).child(
            Button::new("chat-recovery-refresh").ghost().xsmall()
                .label(label("重新回查", "Refresh status"))
                .accessibility_label(label("重新回查未确认运行", "Refresh unresolved runs"))
                .loading(self.recovery_loading).disabled(self.recovery_loading)
                .on_click(cx.listener(|this, _, _, cx| this.refresh_recovery(false, cx))),
        ));
        if let Some(error) = &self.recovery_error {
            panel = panel.child(div().text_color(theme.danger).child(format!("{}: {}", label("回查失败，原记录与草稿保留", "Status lookup failed; records and drafts are preserved"), error)));
        }
        let mut rows = v_flex().id("chat-recovery-items").gap(px(5.)).max_h(px(180.)).overflow_y_scroll();
        for item in self.recovery_items.iter().filter(|item| self.recovery_item_visible(item)) {
            let count = item.completed_write_count.map(|n| n.to_string()).unwrap_or_else(|| label("未知", "unknown"));
            let status = match item.status.as_str() {
                "partial" => format!("{} · {}: {}", label("部分完成", "Partial"), label("已完成写入", "Completed writes"), count),
                "running" => label("原请求仍在运行，等待结果…", "The original request is still running…"),
                _ => label("原运行失败，请检查结果", "The original run failed; review its outcome"),
            };
            let rid = item.request_id.clone();
            rows = rows.child(h_flex().gap(px(8.)).items_center()
                .child(div().flex_1().child(format!("{} · {}", time_label(&item.updated_at), status)))
                .child(Button::new(ElementId::Name(format!("chat-recovery-record-{}", item.request_id).into()))
                    .ghost().xsmall().label(t("查看执行记录")).accessibility_label(t("查看执行记录"))
                    .on_click(cx.listener(move |this, _, window, cx| this.show_request_record(rid.clone(), window, cx)))));
        }
        panel = panel.child(rows);
        if self.recovery_next_before.is_some() {
            panel = panel.child(Button::new("chat-recovery-more").ghost().xsmall()
                .label(label("加载更多原运行记录", "Load more earlier run records"))
                .accessibility_label(label("加载更多原运行记录", "Load more earlier run records"))
                .disabled(self.recovery_loading)
                .on_click(cx.listener(|this, _, _, cx| this.refresh_recovery(true, cx))));
        }
        panel.into_any_element()
    }

    fn render_composer(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let blocked = self.initial_loading || self.uploading > 0 || self.switching;
        let voice = self.capture.is_some() || self.dictation_processing;
        let send_disabled =
            blocked || self.switching || self.input.read(cx).value().trim().is_empty();
        let measured_height = self.composer_height.clone();
        let mut chips = h_flex().flex_wrap().gap_1p5();
        for a in &self.pending_files {
            let id = a.id.clone();
            chips = chips.child(
                Button::new(ElementId::Name(format!("pending-{}", a.id).into()))
                    .accessibility_label(format!("{} · {}", t("移除"), a.name))
                    .xsmall()
                    .ghost()
                    .icon(IconName::Close)
                    .label(format!("{} · {}", a.name, crate::util::human_size(a.size)))
                    .on_click(cx.listener(move |this, _, _, cx| this.remove_pending_file(&id, cx))),
            );
        }
        let mut pending = v_flex().gap(px(5.));
        for item in &self.continuation.items {
            let text = item.get("message").and_then(|v| v.as_str()).unwrap_or("");
            let status = item
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let mut row = h_flex().gap(px(8.)).text_size(px(12.)).child(
                div()
                    .flex_1()
                    .min_w_0()
                    .overflow_hidden()
                    .text_ellipsis()
                    .whitespace_nowrap()
                    .child(text.to_string()),
            );
            let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");
            if status == "queued" {
                for (action, label) in [("insert", "插入"), ("edit", "编辑"), ("cancel", "移除")]
                {
                    let item = item.clone();
                    let action = action.to_string();
                    row = row.child(
                        Button::new(ElementId::Name(format!("chat-queue-{id}-{action}").into()))
                            .xsmall()
                            .ghost()
                            .label(t(label))
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.queue_action(item.clone(), &action, window, cx)
                            })),
                    );
                }
            } else {
                row = row.child(
                    div()
                        .text_color(theme.muted_foreground)
                        .child(t(match status {
                            "running" => "处理中",
                            "inserting" => "插入中",
                            "interrupted" => "已中断，请检查结果",
                            "failed" => "失败，请检查结果",
                            _ => "结果未确认",
                        })),
                );
            }
            if status != "queued" {
                let record = id.to_string();
                row = row.child(
                    Button::new(ElementId::Name(format!("chat-queue-record-{id}").into()))
                        .xsmall()
                        .ghost()
                        .label(t("查看执行记录"))
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.show_request_record(record.clone(), window, cx)
                        })),
                );
                if ["failed", "interrupted"].contains(&status) {
                    let value = item.clone();
                    row = row.child(
                        Button::new(ElementId::Name(
                            format!("chat-queue-remove-terminal-{id}").into(),
                        ))
                        .xsmall()
                        .ghost()
                        .label(t("移除已确认请求"))
                        .on_click(cx.listener(
                            move |this, _, window, cx| {
                                this.queue_action(value.clone(), "cancel", window, cx)
                            },
                        )),
                    );
                }
            }
            pending = pending.child(row);
        }
        let mut waveform = h_flex()
            .flex_1()
            .h(px(34.))
            .items_center()
            .justify_center()
            .gap(px(3.));
        for i in 0usize..38 {
            let padding = 38usize.saturating_sub(self.dictation_levels.len());
            let scale = i
                .checked_sub(padding)
                .and_then(|i| self.dictation_levels.get(i))
                .copied()
                .unwrap_or(0.);
            waveform = waveform.child(
                div()
                    .w(px(2.))
                    .h(px(3. + scale * 25.))
                    .rounded(px(2.))
                    .bg(theme.foreground),
            );
        }
        v_flex()
            .w_full()
            .max_w(px(680.))
            .gap(px(8.))
            .pb(px(20.))
            .when(self.recovery_visible(), |this| this.child(self.render_recovery(cx)))
            .when(!self.continuation.items.is_empty(), |this| {
                this.child(pending)
            })
            .when(!self.pending_files.is_empty(), |this| this.child(chips))
            .when(self.uploading > 0, |this| {
                this.child(
                    div()
                        .text_size(px(12.))
                        .text_color(theme.muted_foreground)
                        .child(
                            t("正在上传 {count} 个文件…")
                                .replace("{count}", &self.uploading.to_string()),
                        ),
                )
            })
            .when_some(self.upload_error.clone(), |this, error| {
                this.child(
                    h_flex()
                        .gap(px(8.))
                        .child(
                            div()
                                .flex_1()
                                .text_size(px(12.))
                                .text_color(theme.danger)
                                .child(t(&error)),
                        )
                        .when(
                            self.dictation_audio.is_some() && !self.dictation_processing,
                            |this| {
                                this.child(
                                    Button::new("chat-dictation-retry")
                                        .ghost()
                                        .xsmall()
                                        .label(t("重试转写"))
                                        .on_click(cx.listener(|this, _, window, cx| {
                                            if let Some(bytes) = this.dictation_audio.clone() {
                                                this.dictation_send = false;
                                                this.finish_dictation(
                                                    Ok(bytes),
                                                    this.dictation_generation,
                                                    window,
                                                    cx,
                                                );
                                            }
                                        })),
                                )
                            },
                        ),
                )
            })
            .child(
                h_flex()
                    .track_focus(&self.dictation_focus)
                    .relative()
                    .w_full()
                    .min_h(px(if voice { self.dictation_height } else { 60. }))
                    .gap(px(10.))
                    .items_end()
                    .px(px(16.))
                    .py(px(12.))
                    .rounded(px(if self.input.read(cx).value().contains('\n') {
                        26.
                    } else {
                        34.
                    }))
                    .border_1()
                    .border_color(rgba(if theme.is_dark() {
                        0xffffff09
                    } else {
                        0xe9edf155
                    }))
                    .bg(theme.background)
                    .shadow(if theme.is_dark() {
                        vec![BoxShadow {
                            inset: false,
                            color: rgba(0x00000026).into(),
                            offset: point(px(0.), px(5.)),
                            blur_radius: px(24.),
                            spread_radius: px(0.),
                        }]
                    } else {
                        vec![
                            BoxShadow {
                                inset: false,
                                color: rgba(0x1722350e).into(),
                                offset: point(px(0.), px(5.)),
                                blur_radius: px(24.),
                                spread_radius: px(0.),
                            },
                            BoxShadow {
                                inset: false,
                                color: rgba(0x17223506).into(),
                                offset: point(px(0.), px(1.)),
                                blur_radius: px(6.),
                                spread_radius: px(0.),
                            },
                        ]
                    })
                    .when(!voice, |this| {
                        this.child(
                            Button::new("attach")
                                .ghost()
                                .child(Icon::new(ProductIcon::Plus).size(px(22.)))
                                .p_0()
                                .w(px(34.))
                                .h(px(34.))
                                .rounded_full()
                                .tooltip(t("添加附件（≤25 MB）"))
                                .accessibility_label(t("添加附件（≤25 MB）"))
                                .disabled(self.initial_loading)
                                .on_click(cx.listener(|this, _, _, cx| this.pick_files(cx))),
                        )
                        .child(
                            div().flex_1().min_w_0().child(
                                Textarea::new(&self.input)
                                    // The component otherwise adds 8px per side inside
                                    // its state as well as our 5px frame padding.
                                    .xsmall()
                                    .appearance(false)
                                    .bordered(false)
                                    .disabled(self.switching)
                                    .text_size(crate::settings::body_px(15., cx))
                                    .line_height(relative(1.6))
                                    .max_h(px(160.))
                                    .px(px(1.))
                                    .py(px(5.)),
                            ),
                        )
                        .child(
                            Button::new("chat-dictation")
                                .ghost()
                                .child(Icon::new(ProductIcon::Mic).size(px(22.)))
                                .p_0()
                                .w(px(34.))
                                .h(px(34.))
                                .rounded_full()
                                .tooltip(t("开始听写"))
                                .accessibility_label(t("开始听写"))
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.start_dictation(window, cx)
                                })),
                        )
                        .child(
                            Button::new("send")
                                .ghost()
                                .child(Icon::new(ProductIcon::ArrowUp).size(px(22.)))
                                .p_0()
                                .w(px(34.))
                                .h(px(34.))
                                .rounded_full()
                                .bg(rgb(match (theme.is_dark(), send_disabled) {
                                    (true, true) => 0x293746,
                                    (true, false) => 0x385a82,
                                    (false, true) => 0xedf5ff,
                                    (false, false) => 0xcce5ff,
                                }))
                                .text_color(rgb(match (theme.is_dark(), send_disabled) {
                                    (true, true) => 0x8b95a2,
                                    (true, false) => 0xcce1ff,
                                    (false, true) => 0x9ca4af,
                                    (false, false) => 0x356ee8,
                                }))
                                .disabled(send_disabled)
                                .tooltip(t("发送消息"))
                                .accessibility_label(t("发送消息"))
                                .on_click(cx.listener(|this, _, window, cx| this.send(window, cx))),
                        )
                    })
                    .when(voice, |this| {
                        this.child(
                            Button::new("chat-dictation-cancel")
                                .ghost()
                                .child(Icon::new(ProductIcon::X).size(px(22.)))
                                .p_0()
                                .w(px(34.))
                                .h(px(34.))
                                .rounded_full()
                                .tooltip(t("取消听写"))
                                .accessibility_label(t("取消听写"))
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.cancel_dictation(cx);
                                    this.restore_dictation_input(window, cx);
                                })),
                        )
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .when(self.dictation_processing, |this| {
                                    this.child(
                                        div()
                                            .text_color(theme.muted_foreground)
                                            .text_size(px(13.))
                                            .child(t("正在转写…")),
                                    )
                                })
                                .when(!self.dictation_processing, |this| this.child(waveform)),
                        )
                        .child(
                            Button::new("chat-dictation-stop")
                                .ghost()
                                .child(Icon::new(ProductIcon::Square).size(px(22.)))
                                .p_0()
                                .w(px(34.))
                                .h(px(34.))
                                .rounded_full()
                                .disabled(self.dictation_processing)
                                .tooltip(t("停止听写，填入草稿"))
                                .accessibility_label(t("停止听写，填入草稿"))
                                .on_click(
                                    cx.listener(|this, _, _, cx| this.stop_dictation(false, cx)),
                                ),
                        )
                        .child(
                            Button::new("chat-dictation-send")
                                .ghost()
                                .child(Icon::new(ProductIcon::ArrowUp).size(px(22.)))
                                .p_0()
                                .w(px(34.))
                                .h(px(34.))
                                .rounded_full()
                                .bg(rgb(if theme.is_dark() { 0x385a82 } else { 0xcce5ff }))
                                .text_color(rgb(if theme.is_dark() { 0xcce1ff } else { 0x356ee8 }))
                                .disabled(self.dictation_processing)
                                .tooltip(t("转写并发送"))
                                .accessibility_label(t("转写并发送"))
                                .on_click(
                                    cx.listener(|this, _, _, cx| this.stop_dictation(true, cx)),
                                ),
                        )
                    })
                    .child(
                        canvas(
                            move |bounds, _, _| {
                                if let Ok(mut height) = measured_height.lock() {
                                    // This absolute canvas fills the frame inside its
                                    // 1pt border. min_h sizes the outer border box, so
                                    // retain both borders when replacing the textarea.
                                    *height = f32::from(bounds.size.height) + 2.;
                                }
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full(),
                    ),
            )
    }
}

fn play_dictation_cue() {
    let preferences = opstwin_store::Store::open_default()
        .ok()
        .map(|s| s.load::<serde_json::Value>("settings-drafts.json"))
        .unwrap_or_default();
    if preferences
        .pointer("/local/dictation/cues")
        .and_then(serde_json::Value::as_bool)
        == Some(true)
    {
        let _ = std::process::Command::new("/usr/bin/afplay")
            .arg("/System/Library/Sounds/Tink.aiff")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
    }
}

fn local_date(raw: &str) -> Option<chrono::DateTime<chrono::Local>> {
    chrono::Local
        .timestamp_millis_opt(crate::util::parse_ms(raw)?)
        .single()
}
fn shows_time(raw: &str, previous: Option<&str>) -> bool {
    let Some(now) = local_date(raw) else {
        return false;
    };
    let Some(previous) = previous.and_then(local_date) else {
        return true;
    };
    now.date_naive() != previous.date_naive()
        || now.signed_duration_since(previous).num_seconds() >= 900
}
pub(crate) fn time_label(raw: &str) -> String {
    let Some(date) = local_date(raw) else {
        return String::new();
    };
    let now = chrono::Local::now();
    let hm = date.format("%H:%M").to_string();
    if date.date_naive() == now.date_naive() {
        return hm;
    }
    let english = t("通用") == "General";
    if date.date_naive() == now.date_naive() - chrono::Duration::days(1) {
        return format!("{} {hm}", if english { "Yesterday" } else { "昨天" });
    }
    let monday =
        now.date_naive() - chrono::Duration::days(i64::from(now.weekday().num_days_from_monday()));
    if date.date_naive() < now.date_naive() && date.date_naive() >= monday {
        if english {
            return date.format("%a %H:%M").to_string();
        }
        return format!(
            "星期{} {hm}",
            ["一", "二", "三", "四", "五", "六", "日"]
                [date.weekday().num_days_from_monday() as usize]
        );
    }
    if english {
        return date
            .format(if date.year() == now.year() {
                "%b %-d %H:%M"
            } else {
                "%Y %b %-d %H:%M"
            })
            .to_string();
    }
    format!(
        "{}{} 月 {} 日 {hm}",
        if date.year() == now.year() {
            String::new()
        } else {
            format!("{} 年 ", date.year())
        },
        date.month(),
        date.day()
    )
}

/// Snapshot of attachment state passed to the virtual-list row renderer.
struct FileCtx {
    artifacts: HashMap<String, Artifact>,
    states: HashMap<String, FileState>,
    images: HashMap<String, InlineImageState>,
}

fn artifact_from_ref(a: &AttachmentRef) -> Artifact {
    Artifact {
        id: a.id.clone(),
        name: a.name.clone(),
        mime: a.mime.clone(),
        size: a.size,
        ..Default::default()
    }
}

fn short_id(id: &str) -> &str {
    let n = id.len();
    &id[n.saturating_sub(6)..]
}

impl Render for ChatView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let placeholder = t("输入消息…");
        if self.placeholder_locale != placeholder {
            self.placeholder_locale = placeholder.clone();
            self.input
                .update(cx, |s, cx| s.set_placeholder(placeholder, _window, cx));
            self.session_query
                .update(cx, |s, cx| s.set_placeholder(t("搜索会话"), _window, cx));
        }
        self.ensure_artifact_meta(cx);
        let theme = cx.theme().clone();
        let rows = self.rows.clone();
        let view = cx.entity().downgrade();
        let files = Rc::new(FileCtx {
            artifacts: self.artifacts.clone(),
            states: self.file_states.clone(),
            images: self.inline_images.clone(),
        });

        let body: AnyElement = if self.initial_loading && self.rows.is_empty() {
            div()
                .flex_1()
                .flex()
                .items_center()
                .justify_center()
                .text_color(theme.muted_foreground)
                .child(t("正在加载对话…"))
                .into_any_element()
        } else if let (Some(err), true) = (&self.load_error, self.rows.is_empty()) {
            v_flex()
                .flex_1()
                .items_center()
                .justify_center()
                .gap_3()
                .child(
                    div()
                        .text_color(theme.danger)
                        .child(format!("加载失败：{err}")),
                )
                .child(
                    Button::new("reload")
                        .outline()
                        .label(t("重新加载"))
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
                .child(t("还没有消息，发送第一条吧"))
                .into_any_element()
        } else {
            div()
                .flex_1()
                .min_h_0()
                .w_full()
                .child(
                    MessageScroller::new(
                        "chat-messages",
                        self.scroller.clone(),
                        move |ix, _, cx| match rows.get(ix) {
                            Some(row) => Self::render_row(row, ix, view.clone(), &files, cx),
                            None => div().into_any_element(),
                        },
                    )
                    .scrollbar(false)
                    .with_jump_button_label(t("回到最新"))
                    .with_list_style(StyleRefinement::default().px_0().pt(px(24.)).pb(px(12.)))
                    .with_row_style(StyleRefinement::default().px_0().pb_0())
                    .with_bottom_fade(theme.background),
                )
                .into_any_element()
        };

        let column = v_flex()
            .flex_1()
            .min_w_0()
            .h_full()
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
            .child(
                h_flex()
                    .flex_1()
                    .min_h_0()
                    .w_full()
                    .child(
                        v_flex()
                            .flex_1()
                            .min_h_0()
                            .min_w_0()
                            .h_full()
                            .px(px(28.))
                            .items_center()
                            .child(
                                v_flex()
                                    .flex_1()
                                    .min_h_0()
                                    .w_full()
                                    .max_w(px(680.))
                                    .child(body),
                            )
                            .child(self.render_composer(cx)),
                    )
                    .when(self.file_preview.is_some(), |this| {
                        this.child(self.render_preview(cx))
                    }),
            );
        div()
            .relative()
            .size_full()
            .bg(theme.background)
            .child(
                h_flex()
                    .size_full()
                    .when(self.panel_open, |this| {
                        this.child(self.render_sessions(_window, cx))
                    })
                    .child(column),
            )
            .when_some(
                self.keyboard_menu.clone(),
                |this, (menu, position, anchor)| {
                    this.child(
                        deferred(
                            anchored()
                                .position(position)
                                .anchor(anchor)
                                .snap_to_window_with_margin(px(8.))
                                .child(menu),
                        )
                        .with_priority(gpui_kit::base::POPUP_PRIORITY),
                    )
                },
            )
    }
}
