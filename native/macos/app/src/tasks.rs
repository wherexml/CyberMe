//! Tasks page: paged list (Active / Completed / Cancelled / All / Deleted),
//! search, create, edit with `baseUpdatedAt` and 409 conflict resolution,
//! complete/reopen, cancel, delete and restore. Mirrors web Tasks.tsx.
//!
//! Server facts: `GET /api/tasks?offset&limit[&deleted=true][&query][&status]`
//! returns the `{items,total,offset,limit,nextOffset,hasMore}` envelope;
//! statuses are active|pending|in_progress|completed|cancelled.

use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, Icon, IconName, Sizable as _,
    button::{Button, ButtonVariants as _},
    h_flex,
    input::{Input, InputEvent, InputState, Textarea, TextareaState},
    menu::{DropdownMenu as _, PopupMenuItem},
    scroll::ScrollableElement as _,
    v_flex,
};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use opstwin_api::{ApiError, Client, Task as TaskItem};
use serde_json::json;

use crate::runtime::io;
use crate::sync::{SyncEvent, SyncHub};
use crate::util::valid_date;

const PAGE: u32 = 50;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Filter {
    Cancelled,
    All,
    Deleted,
}

impl Filter {
    fn label(self) -> &'static str {
        match self {
            Filter::Cancelled => "已取消",
            Filter::All => "全部",
            Filter::Deleted => "回收站",
        }
    }
    /// Server-side `status` filter (exact match; the server normalises
    /// `done` to `completed`). Active spans several statuses so it is
    /// filtered client-side over the unfiltered page.
    fn server_status(self) -> Option<&'static str> {
        match self {
            Filter::Cancelled => Some("cancelled"),
            _ => None,
        }
    }
    fn keep(self, t: &TaskItem) -> bool {
        match self {
            Filter::All => t.status != "cancelled",
            _ => true,
        }
    }
}

/// Edit form state. `base` is the server version the edit started from.
struct Editor {
    task_id: Option<String>,
    create_id: String,
    base_updated_at: Option<String>,
    base: Option<TaskItem>,
    title: Entity<InputState>,
    notes: Entity<TextareaState>,
    due: Entity<InputState>,
    saving: bool,
    error: Option<String>,
    conflict: Option<TaskItem>,
    /// Server changed this task while the form was open.
    server_changed: bool,
}

pub struct TasksView {
    client: Client,
    filter: Filter,
    search: Entity<InputState>,
    items: Vec<TaskItem>,
    total: u64,
    next_offset: u64,
    has_more: bool,
    loading: bool,
    load_error: Option<String>,
    action_error: Option<String>,
    busy: Option<String>,
    editor: Option<Editor>,
    completed_expanded: bool,
    later_expanded: bool,
    visible: bool,
    stale: bool,
    generation: u64,
    _subscriptions: Vec<Subscription>,
    _tasks: Vec<Task<()>>,
    _debounce: Option<Task<()>>,
    editor_saver: Option<crate::persist::Saver<serde_json::Value>>,
    _editor_subscriptions: Vec<Subscription>,
}

impl TasksView {
    pub fn new(
        client: Client,
        hub: Entity<SyncHub>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let group_preferences: serde_json::Value = opstwin_store::Store::open_default()
            .ok()
            .map(|s| s.load("task-groups.json"))
            .unwrap_or_default();
        let search =
            cx.new(|cx| InputState::new(window, cx).placeholder(crate::settings::t("搜索任务")));
        let subscriptions = vec![
            cx.subscribe(&hub, |this: &mut Self, _, ev: &SyncEvent, cx| match ev {
                SyncEvent::Revision
                | SyncEvent::Connected {
                    was_down: true,
                    first: false,
                    ..
                } => this.on_server_change(cx),
                _ => {}
            }),
            cx.subscribe(&search, |this: &mut Self, _, ev: &InputEvent, cx| {
                if matches!(ev, InputEvent::Change | InputEvent::PressEnter { .. }) {
                    this.debounced_reload(cx);
                }
            }),
        ];
        let store = opstwin_store::Store::open_default().ok();
        let recovered: serde_json::Value = store
            .as_ref()
            .map(|s| s.load("task-editor.json"))
            .unwrap_or_default();
        let editor_saver = store.map(|s| crate::persist::Saver::new(s, "task-editor.json"));
        let mut this = Self {
            client,
            filter: Filter::All,
            search,
            items: Vec::new(),
            total: 0,
            next_offset: 0,
            has_more: false,
            loading: false,
            load_error: None,
            action_error: None,
            busy: None,
            editor: None,
            completed_expanded: group_preferences["completedExpanded"]
                .as_bool()
                .unwrap_or(false),
            later_expanded: group_preferences["laterExpanded"]
                .as_bool()
                .unwrap_or(false),
            visible: false,
            stale: false,
            generation: 0,
            _subscriptions: subscriptions,
            _tasks: Vec::new(),
            _debounce: None,
            editor_saver,
            _editor_subscriptions: vec![],
        };
        this.reload(cx);
        if recovered["open"].as_bool() == Some(true) {
            let base = recovered
                .get("base")
                .filter(|v| !v.is_null())
                .and_then(|v| serde_json::from_value::<TaskItem>(v.clone()).ok());
            this.open_editor(base, window, cx);
            if let Some(ed) = this.editor.as_mut() {
                ed.task_id = recovered["taskId"].as_str().map(str::to_owned);
                if let Some(id) = recovered["createId"].as_str() {
                    ed.create_id = id.to_owned();
                }
                ed.base_updated_at = recovered["baseUpdatedAt"].as_str().map(str::to_owned);
                ed.title.update(cx, |v, cx| {
                    v.set_value(recovered["title"].as_str().unwrap_or(""), window, cx)
                });
                ed.notes.update(cx, |v, cx| {
                    v.set_value(recovered["notes"].as_str().unwrap_or(""), window, cx)
                });
                ed.due.update(cx, |v, cx| {
                    v.set_value(recovered["due"].as_str().unwrap_or(""), window, cx)
                });
            }
            this.persist_editor(cx);
        }
        this
    }

    pub fn set_visible(&mut self, visible: bool, cx: &mut Context<Self>) {
        self.visible = visible;
        if visible && std::mem::take(&mut self.stale) {
            self.reload(cx);
        }
    }

    fn on_server_change(&mut self, cx: &mut Context<Self>) {
        if !self.visible {
            self.stale = true;
            return;
        }
        // Debounce bursts of revision events.
        self.debounced_reload(cx);
    }

    fn debounced_reload(&mut self, cx: &mut Context<Self>) {
        self._debounce = Some(cx.spawn(async move |this, cx| {
            crate::runtime::sleep(350).await;
            _ = this.update(cx, |this, cx| this.reload(cx));
        }));
    }

    // ---------------------------------------------------------------- loading

    fn reload(&mut self, cx: &mut Context<Self>) {
        self.load_page(0, cx);
    }

    fn load_page(&mut self, offset: u64, cx: &mut Context<Self>) {
        self.generation += 1;
        let generation = self.generation;
        self.loading = true;
        cx.notify();
        let client = self.client.clone();
        let filter = self.filter;
        let query = self.search.read(cx).value().to_string();
        // Rows already shown stay visible during a reload of the first page;
        // on refresh, re-read as many rows as are shown so far.
        let limit = if offset == 0 {
            (self.items.len() as u32).clamp(PAGE, 200)
        } else {
            PAGE
        };
        let task = cx.spawn(async move |this, cx| {
            let result = io(async move {
                let page = client
                    .tasks(
                        filter == Filter::Deleted,
                        filter.server_status(),
                        &query,
                        offset,
                        limit,
                    )
                    .await?;
                Ok::<_, ApiError>(page)
            })
            .await;
            _ = this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                this.loading = false;
                match result {
                    Ok(page) => {
                        let rows: Vec<TaskItem> =
                            page.items.into_iter().filter(|t| filter.keep(t)).collect();
                        if offset == 0 {
                            this.items = rows;
                        } else {
                            this.items.extend(rows);
                        }
                        this.total = page.total;
                        this.next_offset = page.next_offset;
                        this.has_more = page.has_more;
                        this.load_error = None;
                        eprintln!(
                            "[opstwin] tasks loaded {} rows (total={} hasMore={} filter={:?})",
                            this.items.len(),
                            page.total,
                            page.has_more,
                            filter
                        );
                        this.check_editor_against_server();
                    }
                    Err(e) => {
                        eprintln!("[opstwin] tasks load failed: {e}");
                        this.load_error = Some(e.user_text());
                    }
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
    }

    /// When the open task changed on the server, do not overwrite the form;
    /// flag it so the user can decide.
    fn check_editor_against_server(&mut self) {
        let Some(ed) = self.editor.as_mut() else {
            return;
        };
        let Some(id) = ed.task_id.as_ref() else {
            return;
        };
        if let Some(server) = self.items.iter().find(|t| &t.id == id) {
            if server.updated_at != ed.base_updated_at {
                ed.server_changed = true;
            }
        }
    }

    fn set_filter(&mut self, f: Filter, cx: &mut Context<Self>) {
        if self.filter != f {
            self.filter = f;
            self.items.clear();
            self.action_error = None;
            self.reload(cx);
        }
    }

    // --------------------------------------------------------------- actions

    /// Run one mutation; on success refresh the list. Mutations are never
    /// retried automatically: the user sees the error and the re-read state.
    fn mutate(
        &mut self,
        label: &str,
        id: &str,
        fut: impl std::future::Future<Output = Result<(), ApiError>> + Send + 'static,
        cx: &mut Context<Self>,
    ) {
        if self.busy.is_some() || self.editor.as_ref().is_some_and(|ed| ed.saving) {
            return;
        }
        self.busy = Some(id.to_string());
        self.action_error = None;
        cx.notify();
        let label = label.to_string();
        let id = id.to_string();
        let client = self.client.clone();
        let task = cx.spawn(async move |this, cx| {
            let target = id.clone();
            let result = io(async move {
                fut.await?;
                client.task_get_including_deleted(&target).await
            })
            .await;
            _ = this.update(cx, |this, cx| {
                this.busy = None;
                match result {
                    Ok(server) => {
                        if let Some(ed) = this
                            .editor
                            .as_mut()
                            .filter(|ed| ed.task_id.as_deref() == Some(&id))
                        {
                            let same_fields = ed.base.as_ref().is_some_and(|base| {
                                base.title == server.title
                                    && base.notes == server.notes
                                    && base.due_date == server.due_date
                            });
                            if same_fields {
                                ed.base_updated_at = server.updated_at.clone();
                                ed.base = Some(server);
                                ed.server_changed = false;
                            } else {
                                if let Some(base) = ed.base.as_mut() {
                                    base.deleted = server.deleted;
                                }
                                ed.server_changed = true;
                                ed.conflict = Some(server);
                            }
                        }
                        this.persist_editor(cx);
                    }
                    Err(e) => {
                        eprintln!("[opstwin] task {id} {label} failed: {e}");
                        this.action_error = Some(format!("{label}失败：{}", e.user_text()));
                    }
                }
                this.reload(cx);
            });
        });
        self._tasks.push(task);
    }

    fn set_status(
        &mut self,
        t: &TaskItem,
        status: &'static str,
        label: &str,
        cx: &mut Context<Self>,
    ) {
        let client = self.client.clone();
        let id = t.id.clone();
        let base = t.updated_at.clone();
        self.mutate(
            label,
            &t.id,
            async move {
                let mut body = json!({ "status": status });
                if let Some(b) = base {
                    body["baseUpdatedAt"] = json!(b);
                }
                client.task_patch(&id, body).await.map(|_| ())
            },
            cx,
        );
    }

    fn delete(&mut self, t: &TaskItem, cx: &mut Context<Self>) {
        let client = self.client.clone();
        let id = t.id.clone();
        self.mutate(
            "删除",
            &t.id,
            async move { client.task_delete(&id).await.map(|_| ()) },
            cx,
        );
    }

    fn restore(&mut self, t: &TaskItem, cx: &mut Context<Self>) {
        let client = self.client.clone();
        let id = t.id.clone();
        self.mutate(
            "恢复",
            &t.id,
            async move { client.task_restore(&id).await.map(|_| ()) },
            cx,
        );
    }

    // ---------------------------------------------------------------- editor

    fn open_editor(&mut self, task: Option<TaskItem>, window: &mut Window, cx: &mut Context<Self>) {
        if self.busy.is_some() || self.editor.as_ref().is_some_and(|ed| ed.saving) {
            return;
        }
        if let Some(ed) = &self.editor {
            let dirty = match &ed.base {
                Some(base) => {
                    ed.title.read(cx).value().as_ref() != base.title
                        || ed.notes.read(cx).value().as_ref() != base.notes.as_deref().unwrap_or("")
                        || ed.due.read(cx).value().as_ref()
                            != base.due_date.as_deref().unwrap_or("")
                }
                None => {
                    !ed.title.read(cx).value().is_empty()
                        || !ed.notes.read(cx).value().is_empty()
                        || !ed.due.read(cx).value().is_empty()
                }
            };
            if dirty {
                self.action_error = Some("请先保存或明确关闭当前任务编辑，再打开其他任务".into());
                cx.notify();
                return;
            }
        }
        let (title, notes, due) = match &task {
            Some(t) => (
                t.title.clone(),
                t.notes.clone().unwrap_or_default(),
                t.due_date
                    .clone()
                    .unwrap_or_default()
                    .chars()
                    .take(10)
                    .collect(),
            ),
            None => (String::new(), String::new(), String::new()),
        };
        let title_s = cx.new(|cx| {
            let mut s = InputState::new(window, cx).placeholder(crate::settings::t("任务标题"));
            s.set_value(title, window, cx);
            s
        });
        let notes_s = cx.new(|cx| {
            let mut s = TextareaState::new(window, cx)
                .auto_grow(3, 10)
                .placeholder(crate::settings::t("备注（可选）"));
            s.set_value(notes, window, cx);
            s
        });
        let due_s = cx.new(|cx| {
            let mut s = InputState::new(window, cx)
                .placeholder(crate::settings::t("截止日期 YYYY-MM-DD（可选）"));
            s.set_value(due, window, cx);
            s
        });
        let focus = title_s.focus_handle(cx);
        window.defer(cx, move |window, cx| focus.focus(window, cx));
        self._editor_subscriptions = vec![
            cx.subscribe(&title_s, |this: &mut Self, _, ev: &InputEvent, cx| {
                if matches!(ev, InputEvent::Change) {
                    this.persist_editor(cx);
                }
            }),
            cx.subscribe(&notes_s, |this: &mut Self, _, ev: &InputEvent, cx| {
                if matches!(ev, InputEvent::Change) {
                    this.persist_editor(cx);
                }
            }),
            cx.subscribe(&due_s, |this: &mut Self, _, ev: &InputEvent, cx| {
                if matches!(ev, InputEvent::Change) {
                    this.persist_editor(cx);
                }
            }),
        ];
        self.editor = Some(Editor {
            task_id: task.as_ref().map(|t| t.id.clone()),
            create_id: format!("task-{}", opstwin_api::new_request_id()),
            base_updated_at: task.as_ref().and_then(|t| t.updated_at.clone()),
            base: task,
            title: title_s,
            notes: notes_s,
            due: due_s,
            saving: false,
            error: None,
            conflict: None,
            server_changed: false,
        });
        self.persist_editor(cx);
        cx.notify();
    }

    fn close_editor(&mut self, cx: &mut Context<Self>) {
        if self.busy.is_some() || self.editor.as_ref().is_some_and(|ed| ed.saving) {
            return;
        }
        self.editor = None;
        self._editor_subscriptions.clear();
        self.persist_editor(cx);
        cx.notify();
    }

    fn editor_snapshot(&self, cx: &App) -> serde_json::Value {
        match &self.editor {
            Some(ed) => {
                json!({"open":true,"taskId":ed.task_id,"createId":ed.create_id,"baseUpdatedAt":ed.base_updated_at,"base":ed.base,"title":ed.title.read(cx).value().to_string(),"notes":ed.notes.read(cx).value().to_string(),"due":ed.due.read(cx).value().to_string()})
            }
            None => json!({"open":false}),
        }
    }
    fn persist_editor(&self, cx: &App) {
        if let Some(s) = &self.editor_saver {
            s.save(self.editor_snapshot(cx));
        }
    }
    pub fn persist_blocking(&self, cx: &App) {
        if let Some(s) = &self.editor_saver {
            s.save_blocking(&self.editor_snapshot(cx));
        }
    }

    fn save_editor(&mut self, cx: &mut Context<Self>) {
        let Some(ed) = self.editor.as_mut() else {
            return;
        };
        if ed.saving || self.busy.is_some() {
            return;
        }
        if ed.base.as_ref().is_some_and(|task| task.deleted) {
            ed.error = Some(crate::settings::t("任务已移到回收站，请先恢复"));
            cx.notify();
            return;
        }
        if self.editor_saver.is_none() {
            ed.error = Some("本机任务草稿存储不可用，请恢复后再保存".into());
            cx.notify();
            return;
        }
        let title = ed.title.read(cx).value().trim().to_string();
        let notes = ed.notes.read(cx).value().to_string();
        let due = ed.due.read(cx).value().trim().to_string();
        if title.is_empty() {
            ed.error = Some("标题不能为空".into());
            cx.notify();
            return;
        }
        if !due.is_empty() && !valid_date(&due) {
            ed.error = Some("截止日期使用 YYYY-MM-DD".into());
            cx.notify();
            return;
        }
        ed.saving = true;
        ed.error = None;
        cx.notify();
        let client = self.client.clone();
        let task_id = ed.task_id.clone();
        let base = ed.base_updated_at.clone();
        let create_id = ed.create_id.clone();
        let persist = self
            .editor_saver
            .as_ref()
            .map(|s| s.save_now(self.editor_snapshot(cx)));
        let task = cx.spawn(async move |this, cx| {
            let result = io(async move {
                if let Some(persist)=persist {persist.await.map_err(|_|ApiError::Api{status:500,code:"local_persist_failed".into(),message:"无法保存任务请求，请检查本机存储后重试".into(),detail:None})?;}
                match task_id {
                    Some(id) => {
                        let mut body = json!({ "title": title, "notes": notes, "dueDate": due });
                        if let Some(b) = base {
                            body["baseUpdatedAt"] = json!(b);
                        }
                        client.task_patch(&id, body).await
                    }
                    None => {
                        match client.task_get(&create_id).await {
                            Ok(existing)=>{
                                if existing.title==title && existing.notes.as_deref().unwrap_or("")==notes && existing.due_date.as_deref().unwrap_or("")==due {return Ok(existing);}
                                return Err(ApiError::Api{status:409,code:"request_conflict".into(),message:"任务请求已存在，内容不同；请先审阅原结果".into(),detail:None});
                            }
                            Err(e) if e.status()==Some(404)=>{},
                            Err(e)=>return Err(e),
                        }
                        let mut body =
                            json!({ "id":create_id,"title": title, "notes": notes, "status": "active" });
                        if !due.is_empty() {
                            body["dueDate"] = json!(due);
                        }
                        client.task_create(body).await
                    }
                }
            })
            .await;
            _ = this.update(cx, |this, cx| {
                match result {
                    Ok(t) => {
                        eprintln!("[opstwin] task {} saved", t.id);
                        this.editor = None;
                        this._editor_subscriptions.clear();
                        this.persist_editor(cx);
                        this.reload(cx);
                    }
                    Err(e) if e.is_edit_conflict() => {
                        eprintln!("[opstwin] task save edit_conflict");
                        let server = e
                            .detail()
                            .and_then(|d| d.get("entity"))
                            .and_then(|v| serde_json::from_value::<TaskItem>(v.clone()).ok());
                        if let Some(ed) = this.editor.as_mut() {
                            ed.saving = false;
                            ed.error = Some("此任务已在其他地方更新".into());
                            ed.conflict = server;
                        }
                    }
                    Err(e) => {
                        eprintln!("[opstwin] task save failed: {e}");
                        if let Some(ed) = this.editor.as_mut() {
                            ed.saving = false;
                            ed.error = Some(e.user_text());
                        }
                    }
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
    }

    /// Conflict: keep my edits and save on top of the server version.
    fn conflict_keep_mine(&mut self, cx: &mut Context<Self>) {
        if let Some(ed) = self.editor.as_mut() {
            if let Some(server) = ed.conflict.take() {
                ed.base_updated_at = server.updated_at.clone();
                ed.base = Some(server);
                ed.server_changed = false;
            }
        }
        self.save_editor(cx);
    }

    /// Conflict or server change: discard my edits and load the server version.
    fn take_server(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(ed) = self.editor.as_ref() else {
            return;
        };
        let server = ed.conflict.clone().or_else(|| {
            ed.task_id
                .as_ref()
                .and_then(|id| self.items.iter().find(|t| &t.id == id).cloned())
        });
        match server {
            Some(t) => {
                self.editor = None;
                self.open_editor(Some(t), window, cx);
            }
            None => self.close_editor(cx),
        }
    }

    // -------------------------------------------------------------- rendering

    fn render_row(&self, t: &TaskItem, last: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let done = t.is_completed();
        let deleted = self.filter == Filter::Deleted || t.deleted;
        let busy = self.busy.is_some() || self.editor.is_some();
        let toggle = t.clone();
        let open = t.clone();
        let restore = t.clone();
        h_flex()
            .w_full()
            .py(px(15.))
            .gap_3()
            .items_start()
            .when(!last, |d| d.border_b_1())
            .border_color(theme.border)
            .when(!deleted, |d| {
                d.child(
                    gpui_kit::base::Button::new(ElementId::Name(
                        format!("task-check-{}", t.id).into(),
                    ))
                    .accessibility_label(format!(
                        "{} {}",
                        crate::settings::t(if done { "重新打开" } else { "完成" }),
                        t.title
                    ))
                    .disabled(busy)
                    .mt(px(5.))
                    .size(px(18.))
                    .rounded_full()
                    .border_1()
                    .border_color(if done {
                        theme.primary
                    } else {
                        rgb(0xbdc6d4).into()
                    })
                    .bg(if done { theme.accent } else { theme.background })
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .cursor_pointer()
                    .when(done, |d| {
                        d.child(
                            Icon::new(IconName::Check)
                                .size(px(12.))
                                .text_color(theme.primary),
                        )
                    })
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if !busy {
                            this.set_status(
                                &toggle,
                                if done { "active" } else { "completed" },
                                if done { "重新打开" } else { "完成" },
                                cx,
                            )
                        }
                    })),
                )
            })
            .child(
                gpui_kit::base::Button::new(ElementId::Name(format!("task-open-{}", t.id).into()))
                    .accessibility_label(t.title.clone())
                    .flex_col()
                    .items_start()
                    .justify_start()
                    .line_height(relative(1.5))
                    .cursor_pointer()
                    .flex_1()
                    .min_w_0()
                    .gap(px(7.))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.open_editor(Some(open.clone()), window, cx)
                    }))
                    .child(
                        div()
                            .text_size(crate::settings::body_px(13., cx))
                            .font_weight(FontWeight::MEDIUM)
                            .when(done, |d| {
                                d.line_through().text_color(theme.muted_foreground)
                            })
                            .child(t.title.clone()),
                    )
                    .when_some(t.notes.clone().filter(|n| !n.trim().is_empty()), |d, n| {
                        d.child(
                            div()
                                .text_size(crate::settings::body_px(11., cx))
                                .line_height(relative(1.65))
                                .line_clamp(2)
                                .text_color(theme.muted_foreground)
                                .child(n),
                        )
                    }),
            )
            .when_some(t.due_date.clone().filter(|d| !d.is_empty()), |d, date| {
                d.child(
                    div()
                        .text_size(px(11.))
                        .text_color(theme.muted_foreground)
                        .child(date.chars().take(10).collect::<String>()),
                )
            })
            .when(deleted, |d| {
                d.child(
                    Button::new(ElementId::Name(format!("restore-{}", t.id).into()))
                        .ghost()
                        .xsmall()
                        .label(crate::settings::t("恢复"))
                        .disabled(busy)
                        .on_click(cx.listener(move |this, _, _, cx| this.restore(&restore, cx))),
                )
            })
    }

    fn save_group_preferences(&self, _cx: &App) {
        if let Ok(store) = opstwin_store::Store::open_default() {
            let _ = store.save("task-groups.json", &json!({"completedExpanded":self.completed_expanded,"laterExpanded":self.later_expanded}));
        }
    }

    pub fn open_task(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(task) = self.items.iter().find(|task| task.id == id).cloned() {
            self.open_editor(Some(task), window, cx);
            return;
        }
        let client = self.client.clone();
        self._tasks.push(cx.spawn_in(window, async move |this, cx| {
            let result = io(async move { client.task_lookup(&id).await }).await;
            _ = this.update_in(cx, |this, window, cx| {
                match result {
                    Ok(task) => this.open_editor(Some(task), window, cx),
                    Err(e) => this.action_error = Some(e.user_text()),
                }
                cx.notify();
            });
        }));
    }

    fn render_editor(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let ed = self.editor.as_ref()?;
        let theme = cx.theme();
        let heading = if ed.task_id.is_some() {
            "编辑任务"
        } else {
            "新任务"
        };
        let mut panel = v_flex()
            .w_full()
            .gap_2()
            .p(px(26.))
            .border_l_1()
            .border_color(theme.border)
            .bg(theme.background)
            .child(
                div()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(crate::settings::t(heading)),
            )
            .child(Input::new(&ed.title).disabled(ed.saving || self.busy.is_some()))
            .child(Textarea::new(&ed.notes).disabled(ed.saving || self.busy.is_some()))
            .child(Input::new(&ed.due).disabled(ed.saving || self.busy.is_some()));
        if ed.server_changed && ed.conflict.is_none() {
            panel = panel.child(
                h_flex()
                    .gap_2()
                    .items_center()
                    .child(
                        div()
                            .text_xs()
                            .text_color(theme.warning)
                            .child(crate::settings::t(
                                "服务器上的此任务已更新；保存时会提示冲突",
                            )),
                    )
                    .child(
                        Button::new("take-server-hint")
                            .xsmall()
                            .ghost()
                            .label(crate::settings::t("载入服务器版本"))
                            .disabled(ed.saving || self.busy.is_some())
                            .on_click(
                                cx.listener(|this, _, window, cx| this.take_server(window, cx)),
                            ),
                    ),
            );
        }
        if let Some(server) = &ed.conflict {
            let mine_title = ed.title.read(cx).value().to_string();
            panel = panel.child(
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
                            .child(crate::settings::t("保存冲突：服务器版本与我的修改不同")),
                    )
                    .child(div().text_xs().child(format!(
                        "{}{} · {} · {}",
                        crate::settings::t("服务器："),
                        server.title,
                        status_label(&server.status),
                        server.due_date.clone().unwrap_or_else(|| "无截止".into())
                    )))
                    .when_some(server.notes.clone().filter(|n| !n.is_empty()), |this, n| {
                        this.child(
                            div()
                                .text_xs()
                                .text_color(theme.muted_foreground)
                                .line_clamp(4)
                                .child(n),
                        )
                    })
                    .child(div().text_xs().child(format!(
                        "{}{}",
                        crate::settings::t("我的："),
                        mine_title
                    )))
                    .child(
                        h_flex()
                            .gap_2()
                            .child(
                                Button::new("keep-mine")
                                    .xsmall()
                                    .primary()
                                    .label(crate::settings::t("保留我的修改"))
                                    .on_click(
                                        cx.listener(|this, _, _, cx| this.conflict_keep_mine(cx)),
                                    ),
                            )
                            .child(
                                Button::new("take-server")
                                    .xsmall()
                                    .outline()
                                    .label(crate::settings::t("使用服务器版本"))
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.take_server(window, cx)
                                    })),
                            ),
                    ),
            );
        }
        if let Some(err) = &ed.error {
            panel = panel.child(
                div()
                    .text_xs()
                    .text_color(theme.danger)
                    .child(crate::settings::t(err)),
            );
        }
        if let Some(task) = ed.base.as_ref() {
            let has_changes = ed.title.read(cx).value().as_ref() != task.title
                || ed.notes.read(cx).value().as_ref() != task.notes.as_deref().unwrap_or("")
                || ed.due.read(cx).value().as_ref() != task.due_date.as_deref().unwrap_or("");
            let toggle = task.clone();
            let cancel = task.clone();
            let delete = task.clone();
            panel = panel.child(
                h_flex()
                    .gap_2()
                    .flex_wrap()
                    .pt_4()
                    .child(
                        Button::new("task-detail-toggle")
                            .ghost()
                            .small()
                            .label(crate::settings::t(
                                &(if task.is_completed() {
                                    "重新打开"
                                } else {
                                    "标记完成"
                                }),
                            ))
                            .disabled(
                                ed.saving || self.busy.is_some() || has_changes || task.deleted,
                            )
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.set_status(
                                    &toggle,
                                    if toggle.is_completed() {
                                        "active"
                                    } else {
                                        "completed"
                                    },
                                    "更新状态",
                                    cx,
                                )
                            })),
                    )
                    .child(
                        Button::new("task-detail-cancel")
                            .ghost()
                            .small()
                            .label(crate::settings::t(
                                &(if task.status == "cancelled" {
                                    "恢复进行"
                                } else {
                                    "取消任务"
                                }),
                            ))
                            .disabled(
                                ed.saving || self.busy.is_some() || has_changes || task.deleted,
                            )
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.set_status(
                                    &cancel,
                                    if cancel.status == "cancelled" {
                                        "active"
                                    } else {
                                        "cancelled"
                                    },
                                    "更新状态",
                                    cx,
                                )
                            })),
                    )
                    .child(
                        Button::new("task-detail-delete")
                            .ghost()
                            .small()
                            .icon(if task.deleted {
                                IconName::Undo2
                            } else {
                                IconName::Delete
                            })
                            .tooltip(crate::settings::t(if task.deleted {
                                "恢复"
                            } else {
                                "移到回收站"
                            }))
                            .disabled(
                                ed.saving || self.busy.is_some() || (has_changes && !task.deleted),
                            )
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if delete.deleted {
                                    this.restore(&delete, cx);
                                } else {
                                    this.delete(&delete, cx);
                                }
                            })),
                    ),
            );
        }
        panel = panel.child(
            h_flex()
                .gap_2()
                .justify_end()
                .child(
                    Button::new("editor-cancel")
                        .ghost()
                        .small()
                        .label(crate::settings::t("关闭"))
                        .disabled(ed.saving || self.busy.is_some())
                        .on_click(cx.listener(|this, _, _, cx| this.close_editor(cx))),
                )
                .child(
                    Button::new("editor-save")
                        .primary()
                        .small()
                        .label(crate::settings::t("保存"))
                        .loading(ed.saving)
                        .disabled(
                            ed.saving
                                || self.busy.is_some()
                                || ed.conflict.is_some()
                                || ed.base.as_ref().is_some_and(|task| task.deleted),
                        )
                        .on_click(cx.listener(|this, _, _, cx| this.save_editor(cx))),
                ),
        );
        Some(panel.into_any_element())
    }
}

fn status_label(s: &str) -> &'static str {
    match s {
        "completed" | "done" => "已完成",
        "cancelled" => "已取消",
        "in_progress" => "进行中",
        "pending" => "待办",
        "active" => "进行中",
        _ => "未知状态",
    }
}

impl Render for TasksView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let header =
            h_flex()
                .group("task-heading")
                .w_full()
                .mb(px(26.))
                .items_center()
                .child(
                    div()
                        .flex_1()
                        .text_size(px(23.))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(crate::settings::t("任务")),
                )
                .child(
                    div()
                        .id("task-heading-create")
                        .opacity(0.)
                        .group_hover("task-heading", |s| s.opacity(1.))
                        .child(
                            Button::new("new-task")
                                .accessibility_label(crate::settings::t("新任务"))
                                .ghost()
                                .small()
                                .icon(IconName::Plus)
                                .tooltip(crate::settings::t("新任务"))
                                .disabled(self.editor.is_some())
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.open_editor(None, window, cx)
                                })),
                        ),
                )
                .child(
                    div()
                        .id("task-heading-actions")
                        .opacity(0.)
                        .group_hover("task-heading", |s| s.opacity(1.))
                        .child(
                            Button::new("task-options")
                                .accessibility_label(crate::settings::t("任务选项"))
                                .ghost()
                                .small()
                                .icon(IconName::Ellipsis)
                                .dropdown_menu({
                                    let view = cx.entity().downgrade();
                                    move |menu, _, _| {
                                        let v = view.clone();
                                        let v2 = view.clone();
                                        let v3 = view.clone();
                                        let v4 = view.clone();
                                        menu.item(
                                            PopupMenuItem::new(crate::settings::t("刷新"))
                                                .on_click(move |_, _, cx| {
                                                    _ = v.update(cx, |this, cx| this.reload(cx));
                                                }),
                                        )
                                        .item(
                                            PopupMenuItem::new(crate::settings::t("全部"))
                                                .on_click(move |_, _, cx| {
                                                    _ = v2.update(cx, |this, cx| {
                                                        this.set_filter(Filter::All, cx)
                                                    });
                                                }),
                                        )
                                        .item(
                                            PopupMenuItem::new(crate::settings::t("已取消"))
                                                .on_click(move |_, _, cx| {
                                                    _ = v3.update(cx, |this, cx| {
                                                        this.set_filter(Filter::Cancelled, cx)
                                                    });
                                                }),
                                        )
                                        .item(
                                            PopupMenuItem::new(crate::settings::t("回收站"))
                                                .on_click(move |_, _, cx| {
                                                    _ = v4.update(cx, |this, cx| {
                                                        this.set_filter(Filter::Deleted, cx)
                                                    });
                                                }),
                                        )
                                    }
                                }),
                        ),
                );

        let mut list = v_flex()
            .id("task-list")
            .flex_1()
            .min_h_0()
            .w_full()
            .max_w(px(800.))
            .px(px(36.))
            .pt(px(32.))
            .pb(px(32.))
            .overflow_y_scrollbar()
            .child(header);
        if let Some(err) = &self.action_error {
            list = list.child(
                div()
                    .px_4()
                    .py_2()
                    .text_sm()
                    .text_color(theme.danger)
                    .child(crate::settings::t(err)),
            );
        }
        if let Some(err) = &self.load_error {
            list = list.child(
                h_flex()
                    .px_4()
                    .py_2()
                    .gap_2()
                    .items_center()
                    .child(
                        div()
                            .text_sm()
                            .text_color(theme.danger)
                            .child(crate::settings::t(&format!("加载失败：{err}"))),
                    )
                    .child(
                        Button::new("retry-tasks")
                            .xsmall()
                            .outline()
                            .label(crate::settings::t("重试"))
                            .on_click(cx.listener(|this, _, _, cx| this.reload(cx))),
                    ),
            );
        }
        if self.items.is_empty()
            && !self.loading
            && self.load_error.is_none()
            && self.filter != Filter::All
        {
            list = list.child(div().p_6().text_color(theme.muted_foreground).child(
                if self.filter == Filter::Deleted {
                    "回收站为空"
                } else {
                    "没有任务"
                },
            ));
        }
        if self.filter != Filter::Deleted && self.filter != Filter::Cancelled {
            let today = chrono::Local::now().format("%Y-%m-%d").to_string();
            let active: Vec<TaskItem> = self
                .items
                .iter()
                .filter(|t| !t.is_completed() && t.status != "cancelled")
                .cloned()
                .collect();
            let todays: Vec<TaskItem> = active
                .iter()
                .filter(|t| {
                    t.due_date
                        .as_deref()
                        .is_none_or(|d| d.get(..10).is_none_or(|d| d <= today.as_str()))
                })
                .cloned()
                .collect();
            let later: Vec<TaskItem> = active
                .iter()
                .filter(|t| !todays.iter().any(|x| x.id == t.id))
                .cloned()
                .collect();
            let completed: Vec<TaskItem> = self
                .items
                .iter()
                .filter(|t| t.is_completed())
                .cloned()
                .collect();
            list = list.child(
                h_flex()
                    .gap_2()
                    .items_center()
                    .h(px(24.))
                    .mb(px(12.))
                    .text_size(px(13.))
                    .child(
                        div()
                            .font_weight(FontWeight::MEDIUM)
                            .child(crate::settings::t("今天")),
                    )
                    .child(
                        div()
                            .min_w(px(23.))
                            .px(px(6.))
                            .py(px(2.))
                            .rounded(px(6.))
                            .bg(theme.muted)
                            .text_size(px(11.))
                            .text_center()
                            .text_color(theme.muted_foreground)
                            .child(format!("{}", todays.len())),
                    )
                    .child(div().flex_1())
                    .child(div().text_xs().text_color(theme.muted_foreground).child({
                        let today = chrono::Local::now();
                        use chrono::Datelike;
                        let weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
                        format!(
                            "{} {}",
                            today.format("%-m月%-d日"),
                            crate::settings::t(
                                weekdays[today.weekday().num_days_from_monday() as usize]
                            )
                        )
                    })),
            );
            if todays.is_empty() {
                list = list.child(
                    h_flex()
                        .h(px(92.))
                        .w_full()
                        .rounded(px(12.))
                        .border_1()
                        .border_color(theme.border)
                        .bg(theme.muted)
                        .gap(px(12.))
                        .items_center()
                        .justify_center()
                        .child(
                            div()
                                .size(px(34.))
                                .rounded_full()
                                .bg(theme.background)
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(
                                    Icon::new(IconName::Check)
                                        .size(px(17.))
                                        .text_color(rgb(0x839789)),
                                ),
                        )
                        .child(
                            div()
                                .text_size(px(13.))
                                .text_color(theme.muted_foreground)
                                .child(crate::settings::t("今天没有待办")),
                        ),
                );
            }
            for (index, task) in todays.iter().enumerate() {
                list = list.child(self.render_row(task, index + 1 == todays.len(), cx));
            }
            let later_open = self.later_expanded;
            let completed_open = self.completed_expanded;
            list = list.child(div().mt(px(24.)));
            list = list.child(
                h_flex()
                    .id("tasks-later-group")
                    .w_full()
                    .min_h(px(52.))
                    .px(px(2.))
                    .py(px(14.))
                    .gap(px(9.))
                    .border_t_1()
                    .border_color(theme.border)
                    .cursor_pointer()
                    .child(
                        Icon::new(gpui_kit::assets::IconName::SquareCheck)
                            .size(px(16.))
                            .text_color(theme.muted_foreground),
                    )
                    .child(
                        div()
                            .text_size(px(13.))
                            .font_weight(FontWeight::MEDIUM)
                            .child(crate::settings::t("之后")),
                    )
                    .child(div().flex_1())
                    .child(
                        div()
                            .text_size(px(11.))
                            .text_color(theme.muted_foreground)
                            .child(if later.is_empty() {
                                crate::settings::t("暂无安排")
                            } else {
                                later.len().to_string()
                            }),
                    )
                    .child(
                        Icon::new(if later_open {
                            IconName::ChevronDown
                        } else {
                            IconName::ChevronRight
                        })
                        .size(px(13.))
                        .text_color(theme.muted_foreground),
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.later_expanded = !this.later_expanded;
                        this.save_group_preferences(cx);
                        cx.notify();
                    })),
            );
            if later_open {
                for (index, task) in later.iter().enumerate() {
                    list = list.child(self.render_row(task, index + 1 == later.len(), cx));
                }
            }
            list = list.child(
                h_flex()
                    .id("tasks-completed-group")
                    .w_full()
                    .min_h(px(52.))
                    .px(px(2.))
                    .py(px(14.))
                    .gap(px(9.))
                    .border_t_1()
                    .border_color(theme.border)
                    .cursor_pointer()
                    .child(
                        Icon::new(IconName::Check)
                            .size(px(16.))
                            .text_color(theme.muted_foreground),
                    )
                    .child(
                        div()
                            .text_size(px(13.))
                            .font_weight(FontWeight::MEDIUM)
                            .child(crate::settings::t("已完成")),
                    )
                    .child(div().flex_1())
                    .child(
                        div()
                            .text_size(px(11.))
                            .text_color(theme.muted_foreground)
                            .child(if completed.is_empty() {
                                crate::settings::t("暂无记录")
                            } else {
                                completed.len().to_string()
                            }),
                    )
                    .child(
                        Icon::new(if completed_open {
                            IconName::ChevronDown
                        } else {
                            IconName::ChevronRight
                        })
                        .size(px(13.))
                        .text_color(theme.muted_foreground),
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.completed_expanded = !this.completed_expanded;
                        this.save_group_preferences(cx);
                        cx.notify();
                    })),
            );
            if completed_open {
                for (index, task) in completed.iter().enumerate() {
                    list = list.child(self.render_row(task, index + 1 == completed.len(), cx));
                }
            }
        } else {
            for (index, task) in self.items.iter().enumerate() {
                list = list.child(self.render_row(task, index + 1 == self.items.len(), cx));
            }
        }
        if self.has_more {
            let next = self.next_offset;
            list = list.child(
                h_flex().w_full().justify_center().py_3().child(
                    Button::new("more-tasks")
                        .small()
                        .outline()
                        .loading(self.loading)
                        .label(format!(
                            "加载更多（已显示 {} / {}）",
                            self.items.len(),
                            self.total
                        ))
                        .on_click(cx.listener(move |this, _, _, cx| this.load_page(next, cx))),
                ),
            );
        }

        let narrow = window.bounds().size.width < px(900.);
        let editor = self.render_editor(cx);
        v_flex()
            .size_full()
            .bg(theme.background)
            .text_color(theme.foreground)
            .child(
                h_flex()
                    .flex_1()
                    .min_h_0()
                    .w_full()
                    .items_start()
                    .when(!narrow || editor.is_none(), |d| {
                        d.child(
                            h_flex()
                                .flex_1()
                                .min_w_0()
                                .h_full()
                                .justify_center()
                                .child(list),
                        )
                    })
                    .when_some(editor, |d, ed| {
                        d.child(
                            div()
                                .w(if narrow {
                                    window.bounds().size.width - px(78.)
                                } else {
                                    px(390.)
                                })
                                .h_full()
                                .overflow_y_scrollbar()
                                .id("task-detail-editor")
                                .child(ed),
                        )
                    }),
            )
    }
}
