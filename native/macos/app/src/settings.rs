//! Non-modal native preferences, sharing the existing Web business contracts.
//! Drafts survive navigation/restart; a failed save never discards an editor.
use crate::{
    persist::Saver,
    runtime::io,
    sync::{SyncEvent, SyncHub},
};
use gpui_kit::{
    component::{
        ActiveTheme as _, Disableable as _, Selectable as _, Sizable as _,
        button::{Button, ButtonVariants as _},
        checkbox::Checkbox,
        h_flex,
        input::{Input, InputEvent, InputState, Textarea, TextareaState},
        menu::{DropdownMenu as _, PopupMenuItem},
        radio::Radio,
        scroll::ScrollableElement as _,
        switch::Switch,
        v_flex,
    },
    prelude::FluentBuilder as _,
    *,
};
use opstwin_api::Client;
use serde_json::{Value, json};
use std::collections::BTreeMap;

const SECTIONS: [(&str, &str, &str); 12] = [
    ("general", "通用", "应用"),
    ("models", "模型", ""),
    ("connections", "连接", ""),
    ("filesystem", "文件访问", "电脑"),
    ("dictation", "听写", ""),
    ("identity", "身份与记忆", "分身"),
    ("autonomy", "自主权限", ""),
    ("channels", "消息渠道", ""),
    ("devices", "设备", "设备"),
    ("help", "帮助", "支持"),
    ("legal", "隐私与条款", ""),
    ("about", "关于", ""),
];
#[derive(Clone, Debug)]
pub enum SettingsEvent {
    Close,
    Appearance {
        appearance: String,
        font_size: u32,
        reduced_motion: bool,
    },
}
impl EventEmitter<SettingsEvent> for SettingsView {}
#[derive(Clone)]
enum Field {
    Line(Entity<InputState>),
    Multi(Entity<TextareaState>),
}
impl Field {
    fn value(&self, cx: &App) -> String {
        match self {
            Self::Line(s) => s.read(cx).value().to_string(),
            Self::Multi(s) => s.read(cx).value().to_string(),
        }
    }
}
#[derive(Clone, PartialEq)]
struct WechatReaderConnection {
    id: String,
    updated_at: Value,
    status: String,
    readable: bool,
}

pub struct SettingsView {
    client: Client,
    section: String,
    detail: Option<String>,
    data: Value,
    models: Value,
    sync: Value,
    binding: Value,
    permissions: Value,
    qr: Option<(String, std::sync::Arc<Image>)>,
    local: Value,
    drafts: Value,
    fields: BTreeMap<String, Field>,
    // Secrets deliberately have no path in fields/drafts/local or Saver snapshots.
    connection_secret: Option<(String, Entity<InputState>)>,
    connection_secret_subscription: Option<Subscription>,
    connection_secret_revision: u64,
    saver: Option<Saver<Value>>,
    model_probe: Value,
    model_probe_retry: bool,
    model_probe_status: Option<String>,
    model_probe_saver: Option<Saver<Value>>,
    loading: bool,
    busy: bool,
    error: Option<String>,
    notice: Option<String>,
    visible: bool,
    stale: bool,
    generation: u64,
    pending_fields: bool,
    history: Option<(String, Value)>,
    memory_edit: Option<String>,
    delete_confirm: bool,
    identity_edit: bool,
    memory_manage: bool,
    soul_details: bool,
    memory_details: bool,
    model_add: bool,
    // Private reader state stays in RAM, outside fields/drafts/Saver.
    wechat_query: Entity<InputState>,
    wechat_applied_query: String,
    wechat_exact: Option<Value>,
    wechat_image: Option<std::sync::Arc<Image>>,
    wechat_capabilities: Value,
    wechat_media: Option<std::sync::Arc<crate::wechat_media::Media>>,
    wechat_saved: Option<crate::wechat_media::Saved>,
    wechat_save_busy: bool,
    wechat_save_cancel: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
    wechat_page: Value,
    wechat_chat: Option<(String, String)>,
    wechat_messages: Value,
    wechat_loading: bool,
    wechat_generation: u64,
    wechat_selected_message: Option<String>,
    wechat_query_needs_reset: bool,
    wechat_chat_cursors: Vec<String>,
    wechat_message_cursors: Vec<String>,
    sync_scope: String,
    sync_offset: usize,
    record_kind: String,
    record_offset: usize,
    sync_records: Value,
    sync_loading: bool,
    records_loading: bool,
    sync_generation: u64,
    records_generation: u64,
    expanded: std::collections::BTreeSet<String>,
    _subscriptions: Vec<Subscription>,
    _tasks: Vec<Task<()>>,
}
impl SettingsView {
    pub fn new(
        client: Client,
        hub: Entity<SyncHub>,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let store = opstwin_store::Store::open_default().ok();
        let persisted: Value = store
            .as_ref()
            .map(|s| s.load("settings-drafts.json"))
            .unwrap_or_default();
        let model_probe = store.as_ref().map(|s| s.load("model-probe.json")).unwrap_or_default();
        let model_probe_saver = store.as_ref().map(|s| Saver::new(s.clone(), "model-probe.json"));
        let saver = store.map(|s| Saver::new(s, "settings-drafts.json"));
        let closing_view = cx.weak_entity();
        _window.on_window_should_close(cx, move |_, cx| {
            _ = closing_view.update(cx, |this, cx| this.set_visible(false, cx));
            true
        });
        let subs = vec![
            cx.observe_window_owner_visibility(_window, |this, visible, _, cx| {
                this.set_visible(visible, cx);
                cx.notify();
            }),
            cx.subscribe(&hub, |this: &mut Self, _, ev: &SyncEvent, cx| {
                if matches!(
                    ev,
                    SyncEvent::Revision | SyncEvent::Connected { was_down: true, .. }
                ) {
                    if this.visible {
                        this.reload(cx)
                    } else {
                        this.stale = true
                    }
                }
            }),
        ];
        let wechat_query = cx.new(|cx| InputState::new(_window, cx).placeholder(t("查找联系人或当前会话消息")));
        let mut this=Self{client,section:"general".into(),detail:None,data:json!({}),models:json!({}),sync:json!({}),binding:json!({}),permissions:json!({}),qr:None,local:persisted.get("local").cloned().unwrap_or(json!({"appearance":"system","font":15,"reduced":false,"dictation":{"autoSend":false,"cues":true},"filesystem":{"blocked":[]}})),drafts:persisted.get("drafts").cloned().unwrap_or(json!({})),fields:BTreeMap::new(),connection_secret:None,connection_secret_subscription:None,connection_secret_revision:0,saver,model_probe,model_probe_retry:false,model_probe_status:None,model_probe_saver,loading:false,busy:false,error:None,notice:None,visible:true,stale:false,generation:0,pending_fields:true,history:None,memory_edit:None,delete_confirm:false,identity_edit:false,memory_manage:false,soul_details:false,memory_details:false,model_add:false,wechat_query,wechat_applied_query:String::new(),wechat_exact:None,wechat_image:None,wechat_capabilities:json!({}),wechat_media:None,wechat_saved:None,wechat_save_busy:false,wechat_save_cancel:None,wechat_page:json!({}),wechat_chat:None,wechat_messages:json!({}),wechat_loading:false,wechat_generation:0,wechat_selected_message:None,wechat_query_needs_reset:false,wechat_chat_cursors:vec![],wechat_message_cursors:vec![],sync_scope:"all".into(),sync_offset:0,record_kind:"chats".into(),record_offset:0,sync_records:json!({}),sync_loading:false,records_loading:false,sync_generation:0,records_generation:0,expanded:Default::default(),_subscriptions:subs,_tasks:vec![]};
        this.visible = _window.is_owner_visible();
        this.reload(cx);
        if this.model_probe["requestId"].is_string() { this.test_model("standard", true, cx); }
        this
    }
    pub fn set_visible(&mut self, v: bool, cx: &mut Context<Self>) {
        if std::env::var("OPSTWIN_QA_OWNER_TRACE").as_deref() == Ok("1") {
            eprintln!("ops_settings_owner visible={v} changed={} generation={}", self.visible != v, self.wechat_generation);
        }
        self.visible = v;
        if !v {
            self.drop_connection_secret();
            self.invalidate_wechat_reader(false, true);
            // Reopen refreshes canonical connection scope, never auto-reads private history.
            self.stale = true;
        }
        if v && std::mem::take(&mut self.stale) {
            self.reload(cx)
        }
    }
    pub fn section(&mut self, name: &str, cx: &mut Context<Self>) {
        if SECTIONS.iter().any(|x| x.0 == name) {
            self.drop_connection_secret();
            self.invalidate_wechat_reader(true, true);
            self.section = name.into();
            self.detail = None;
            self.delete_confirm = false;
            self.fields.clear();
            self.pending_fields = true;
            self.history = None;
            self.error = None;
            self.notice = None;
            cx.notify();
        }
    }
    fn persist(&self) {
        if let Some(s) = &self.saver {
            s.save(json!({"local":self.local,"drafts":self.drafts}));
        }
    }
    fn drop_connection_secret(&mut self) {
        self.connection_secret_subscription = None;
        self.connection_secret = None;
        self.connection_secret_revision = self.connection_secret_revision.wrapping_add(1);
    }
    fn secret_value(&self, cx: &App) -> String {
        self.connection_secret
            .as_ref()
            .filter(|(key, _)| *key == self.group_key())
            .map(|(_, state)| state.read(cx).value().to_string())
            .unwrap_or_default()
    }
    fn setup_connection_secret(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let key = self.group_key();
        let wanted = (self.section == "models" && self.detail.is_some()) || self.section == "connections"
            && self.detail.as_deref().is_some_and(|id| id != "request")
            && self.draft()["config"]["authMethod"] == "api-key";
        if self
            .connection_secret
            .as_ref()
            .is_some_and(|(old, _)| *old != key || !wanted)
        {
            if let Some((_, old)) = self.connection_secret.as_ref() {
                old.update(cx, |state, cx| state.set_value("", window, cx));
            }
            self.drop_connection_secret();
        }
        if wanted && self.connection_secret.is_none() {
            let state = cx.new(|cx| {
                InputState::new(window, cx)
                    .masked(true)
                    .placeholder(t("输入 API Key（仅内存保存）"))
            });
            self.connection_secret_subscription = Some(cx.subscribe(
                &state,
                |this: &mut Self, _, event: &InputEvent, cx| {
                    if matches!(event, InputEvent::Change) {
                        this.connection_secret_revision =
                            this.connection_secret_revision.wrapping_add(1);
                        this.error = None;
                        this.notice = None;
                        cx.notify();
                    }
                },
            ));
            self.connection_secret = Some((key, state));
        }
    }
    fn is_custom_connection(&self, value: &Value) -> bool {
        self.detail.as_deref() == Some("new")
            || (!matches!(
                value["provider"]
                    .as_str()
                    .unwrap_or("")
                    .to_ascii_lowercase()
                    .as_str(),
                "feishu" | "lark" | "飞书" | "wechat" | "wechat-sync" | "gmail" | "google-calendar"
            ) && matches!(
                value["type"]
                    .as_str()
                    .unwrap_or("mcp")
                    .to_ascii_lowercase()
                    .as_str(),
                "mcp" | "rest" | "webhook" | "skill"
            ))
    }
    fn reload(&mut self, cx: &mut Context<Self>) {
        self.generation += 1;
        let g = self.generation;
        self.loading = true;
        let c = self.client.clone();
        let sync_offset = self.sync_offset;
        let record_kind = self.record_kind.clone();
        let record_offset = self.record_offset;
        let sync_generation = self.sync_generation;
        let records_generation = self.records_generation;
        let t = cx.spawn(async move |this, cx| {
            let result = io(async move {
                let mut boot = c.product_get("/api/bootstrap").await?;
                if let Some(memories) = boot["memories"].as_array_mut() {
                    for item in memories {
                        if let Some(id) = item["id"].as_str().map(str::to_string) {
                            match c.product_get(&format!("/api/memories/{id}")).await {
                                Ok(mut full) => {
                                    full["_nativeFull"] = json!(true);
                                    *item = full;
                                }
                                Err(_) => {
                                    item["_nativeFull"] = json!(false);
                                }
                            }
                        }
                    }
                }
                let models = c.product_get("/api/settings/models").await;
                let sync = c
                    .product_get(&format!("/api/feishu/sync?offset={sync_offset}"))
                    .await;
                let records = c
                    .product_get(&format!(
                        "/api/feishu/sync/records?kind={record_kind}&offset={record_offset}"
                    ))
                    .await;
                let binding = c.product_get("/api/feishu/binding").await;
                let permissions = probe_permissions().await;
                Ok::<_, opstwin_api::ApiError>((boot, models, sync, binding, permissions, records))
            })
            .await;
            _ = this.update(cx, |this, cx| {
                if this.generation != g {
                    return;
                }
                this.loading = false;
                match result {
                    Ok((b, m, s, f, permissions, records)) => {
                        let previous_wechat = this.wechat_reader_connection();
                        this.data = b;
                        if previous_wechat != this.wechat_reader_connection() {
                            this.invalidate_wechat_reader(true, true);
                        }
                        set_language(
                            this.data["settings"]["identity"]["language"]
                                .as_str()
                                .unwrap_or("zh-CN"),
                            cx,
                        );
                        if let Ok(models)=m {
                            this.models=models;
                            if let Some(drafts)=this.drafts.as_object_mut() {
                                for (key,draft) in drafts.iter_mut() {
                                    if key.starts_with("model-provider:") && draft["_rebase"]==true {
                                        draft["_version"]=this.models["version"].clone();
                                        draft.as_object_mut().map(|v|v.remove("_rebase"));
                                    }
                                }
                            }
                        }
                        if this.sync_generation == sync_generation {
                            if let Ok(sync) = s {
                                this.sync = sync;
                            }
                        }
                        this.binding = f.unwrap_or(json!({}));
                        this.permissions = permissions;
                        if this.records_generation == records_generation {
                            if let Ok(records) = records {
                                this.sync_records = records;
                            }
                        }
                        this.refresh_qr();
                        this.error = None;
                        this.pending_fields = true;
                    }
                    Err(e) => this.error = Some(e.user_text()),
                }
                cx.notify();
            });
        });
        self._tasks.push(t);
        cx.notify();
    }
    fn refresh_qr(&mut self) {
        let qr = self.binding["qr"].as_str();
        if self.binding["status"] != "pending"
            || !self.binding["url"]
                .as_str()
                .is_some_and(opstwin_api::product::valid_binding_url)
        {
            self.qr = None;
        } else if let Some(qr) = qr {
            if self.qr.as_ref().is_none_or(|old| old.0 != qr) {
                self.qr = opstwin_api::product::binding_qr_png(qr).map(|png| {
                    (
                        qr.to_string(),
                        std::sync::Arc::new(Image::from_bytes(ImageFormat::Png, png)),
                    )
                });
            }
        } else {
            self.qr = None;
        }
    }
    fn group_key(&self) -> String {
        if self.section == "models" { return self.detail.as_ref().map(|id|format!("model-provider:{id}")).unwrap_or("models".into()); }
        self.detail
            .as_ref()
            .map(|s| format!("connection:{s}"))
            .unwrap_or_else(|| self.section.clone())
    }
    fn base(&self) -> Value {
        match self.section.as_str(){"general"=>self.data["settings"]["identity"].clone(),"models"=>if let Some(id)=&self.detail { self.models["providers"].as_array().and_then(|a|a.iter().find(|p|p["id"].as_str()==Some(id))).cloned().unwrap_or(json!({"id":id,"name":"新供应商","baseUrl":"","api":"anthropic-messages","enabled":true,"definitions":[]})) } else {json!({"standard":self.models["standard"],"deep":self.models["deep"]})},"connections"=>self.detail.as_ref().and_then(|id|self.connections().into_iter().find(|x|x["id"].as_str()==Some(id))).cloned().unwrap_or(json!({"name":"","type":"mcp","endpoint":"","permissions":["read"],"config":{"authMethod":"none"}})),"identity"=>self.data["settings"]["identity"].clone(),"autonomy"=>self.data["settings"]["autonomy"].clone(),_=>json!({})}
    }
    fn draft(&self) -> Value {
        self.drafts
            .get(self.group_key())
            .cloned()
            .unwrap_or_else(|| self.base())
    }
    fn change(&mut self, path: &str, value: Value, cx: &mut Context<Self>) {
        if let Some(path) = path.strip_prefix("sync.") {
            let mut v = self
                .drafts
                .get("feishuSync")
                .cloned()
                .unwrap_or_else(|| self.sync["settings"].clone());
            set_path(&mut v, path, value);
            self.drafts["feishuSync"] = v;
            self.persist();
            cx.notify();
            return;
        }
        if let Some(path) = path.strip_prefix("memory.") {
            if let Some(id) = &self.memory_edit {
                let key = format!("memory:{id}");
                let mut v = self.drafts[&key].clone();
                set_path(&mut v, path, value);
                self.drafts[&key] = v;
                self.persist();
                cx.notify();
            }
            return;
        }
        let key = self.group_key();
        let mut v = self.draft();
        if self.section=="models" && self.detail.is_some() && v["_version"].is_null() {v["_version"]=self.models["version"].clone();}
        set_path(&mut v, path, value);
        if self.section == "models" && self.detail.is_none() && path.starts_with("standard.") {
            v["deep"] = v["standard"].clone();
        }
        if self.section=="models" && path=="api" && v["api"]!="anthropic-messages" {v["compatibility"]=json!("");}
        self.drafts[&key] = v;
        if self.section == "connections" && path == "type" {
            // Update the existing editor's hint without recreating it or clearing its value.
            self.pending_fields = true;
        }
        self.notice = None;
        self.persist();
        cx.notify();
    }
    fn setup_fields(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.pending_fields {
            return;
        }
        self.pending_fields = false;
        let d = self.draft();
        let mut specs: Vec<(&str, &str, bool)> = match self.section.as_str() {
            "identity" => vec![
                ("name", "姓名", false),
                ("role", "角色", false),
                ("about", "关于你", true),
                ("instructions", "指令（Markdown）", true),
            ],
            "models" => vec![
                ("standard.model", "模型 ID", false),
                ("deep.model", "模型 ID", false),
                ("catalog.model", "模型 ID", false),
                ("name", "供应商名称", false),
                ("baseUrl", "https://api.example.com/v1", false),
                ("catalog.contextWindow", "200000", false),
                ("catalog.maxTokens", "7000", false),
            ],
            "autonomy" => vec![
                ("quietFrom", "开始 HH:mm", false),
                ("quietUntil", "结束 HH:mm", false),
            ],
            "connections" if self.detail.is_some() => vec![
                ("name", "应用名称", false),
                (
                    "endpoint",
                    if d["type"]
                        .as_str()
                        .is_some_and(|v| v.eq_ignore_ascii_case("skill"))
                    {
                        "/path/to/SKILL.md"
                    } else {
                        "https://"
                    },
                    false,
                ),
                ("config.workFrom", "开始 HH:mm", false),
                ("config.workUntil", "结束 HH:mm", false),
                ("config.timezone", "时区", false),
                ("config.filter", "消息过滤", false),
                ("add.scopeName", "频道或范围名称", false),
                ("add.personName", "姓名", false),
                ("add.urgentWord", "关键词或短语", false),
            ],
            _ => vec![],
        };
        if self.section == "connections" && self.detail.as_deref() == Some("feishu-local") {
            specs.extend([
                ("sync.chatIntervalMinutes", "聊天同步间隔（分钟）", false),
                ("sync.analysisDelayMinutes", "延迟分析（分钟）", false),
                ("sync.meetingIntervalMinutes", "纪要同步间隔（分钟）", false),
                ("sync.mailIntervalMinutes", "邮箱同步间隔（分钟）", false),
                ("sync.sourceChatName", "纪要助手名称", false),
                ("sync.chatLimit", "会话数", false),
                ("sync.messagesPerChat", "每会话消息数", false),
                ("sync.minutesLimit", "纪要文档数", false),
                ("sync.minutesMessageLimit", "助手消息数", false),
                ("sync.mailLimit", "邮件数", false),
            ]);
        }
        if self.section == "connections" && self.detail.as_deref() == Some("request") {
            specs = vec![
                ("name", "应用名称", false),
                ("reason", "希望用它完成什么？", true),
            ];
        }
        if self.memory_edit.is_some() {
            specs.extend([
                ("memory.category", "记忆分类", false),
                ("memory.content", "记忆内容", true),
            ]);
        }
        for (path, placeholder, multi) in specs {
            if let Some(field) = self.fields.get(path).cloned() {
                match field {
                    Field::Line(s) => {
                        s.update(cx, |s, cx| s.set_placeholder(t(placeholder), window, cx))
                    }
                    Field::Multi(s) => {
                        s.update(cx, |s, cx| s.set_placeholder(t(placeholder), window, cx))
                    }
                };
                continue;
            }
            let field_data = if path.starts_with("sync.") {
                self.drafts
                    .get("feishuSync")
                    .cloned()
                    .unwrap_or_else(|| self.sync["settings"].clone())
            } else if path.starts_with("memory.") {
                self.memory_edit
                    .as_ref()
                    .map(|id| self.drafts[format!("memory:{id}")].clone())
                    .unwrap_or(json!({}))
            } else {
                d.clone()
            };
            let clean_path = path
                .strip_prefix("sync.")
                .or_else(|| path.strip_prefix("memory."))
                .unwrap_or(path);
            let raw = at(&field_data, clean_path);
            let value = raw.as_str().map(str::to_string).unwrap_or_else(|| {
                if raw.is_null() {
                    String::new()
                } else {
                    raw.to_string()
                }
            });
            let p = path.to_string();
            if multi {
                let s = cx.new(|cx| {
                    let mut s = TextareaState::new(window, cx)
                        .auto_grow(3, 12)
                        .placeholder(t(placeholder));
                    s.set_value(value, window, cx);
                    s
                });
                let state = s.clone();
                self._subscriptions.push(cx.subscribe(
                    &s,
                    move |this: &mut Self, _, ev: &InputEvent, cx| {
                        if matches!(ev, InputEvent::Change) {
                            let value = state.read(cx).value().to_string();
                            this.change(&p, json!(value), cx);
                        }
                    },
                ));
                self.fields.insert(path.into(), Field::Multi(s));
            } else {
                let s = cx.new(|cx| {
                    let mut s = InputState::new(window, cx).placeholder(t(placeholder));
                    s.set_value(value, window, cx);
                    s
                });
                let state = s.clone();
                self._subscriptions.push(cx.subscribe(
                    &s,
                    move |this: &mut Self, _, ev: &InputEvent, cx| {
                        if matches!(ev, InputEvent::Change) {
                            let value = state.read(cx).value().to_string();
                            this.change(&p, json!(value), cx);
                        }
                    },
                ));
                self.fields.insert(path.into(), Field::Line(s));
            }
        }
    }
    fn test_model(&mut self, role: &str, recovery_only: bool, cx: &mut Context<Self>) {
        if self.busy { return; }
        let recovering = self.model_probe["requestId"].is_string();
        if !recovering {
            if recovery_only { return; }
            self.model_probe = json!({"requestId":opstwin_api::new_request_id(),"role":role,"version":self.models["version"]});
        }
        let resubmit = recovering && self.model_probe_retry && !recovery_only;
        self.model_probe_retry = false;
        self.model_probe_status = None;
        let request = self.model_probe.clone();
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        let saver = self.model_probe_saver.clone();
        let c = self.client.clone();
        self.busy = true;
        self.error = None;
        self.notice = None;
        let task = cx.spawn(async move |this, cx| {
            // Fresh requests must reach durable local storage before network I/O.
            if !recovering {
                let saved = if let Some(s) = saver { s.save_now(request.clone()).await }
                    else { Err("Local storage is unavailable".into()) };
                if let Err(e) = saved {
                    _ = this.update(cx, |this, cx| {
                        if this.model_probe["requestId"] != id { return; }
                        this.busy = false;
                        this.model_probe = Value::Null;
                        this.error = Some(format!("Unable to persist test; nothing submitted: {e}"));
                        cx.notify();
                    });
                    return;
                }
            }
            let network_id = id.clone();
            let result = io(async move {
                if recovering && !resubmit { c.product_get(&format!("/api/settings/models/tests/{network_id}")).await }
                else { c.product_post("/api/settings/models/test",request).await }
            }).await;
            _ = this.update(cx, |this, cx| {
                if this.model_probe["requestId"] != id { return; }
                this.busy = false;
                match result {
                    Ok(v) => {
                        let status = v["status"].as_str().unwrap_or("unknown");
                        match status {
                            "succeeded" => { this.model_probe_status = Some(t("模型实际调用成功")); this.model_probe = Value::Null; }
                            "failed" => { this.model_probe_status = Some(t("模型测试失败")); this.error = Some(t("模型测试失败")); this.model_probe = Value::Null; }
                            "running" => { this.model_probe_status = Some(t("测试仍在运行，请回查原请求")); }
                            _ => { this.model_probe_status = Some(t("测试结果未知，请回查原请求")); this.error = Some(t("测试结果未知，请回查原请求")); }
                        }
                    }
                    Err(e) => {
                        // GET 404 can race a delayed original POST. Preserve its ID;
                        // the next explicit click may submit that exact payload/ID.
                        if recovering && !resubmit && e.status() == Some(404) {
                            this.model_probe_retry = true;
                            this.model_probe_status = Some(t("未收到测试请求，可重试原测试"));
                        } else if (!recovering || resubmit) && matches!(e.status(),Some(400 | 409)) {
                            this.model_probe = Value::Null;
                        }
                        this.error = Some(e.user_text());
                    }
                }
                if let Some(s) = &this.model_probe_saver { s.save(this.model_probe.clone()); }
                cx.notify();
            });
        });
        self._tasks.push(task);
        cx.notify();
    }
    fn mutate(&mut self, method: &str, path: String, body: Value, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        self.busy = true;
        if path.contains("wechat-sync-local") && path.ends_with("/disconnect") {
            self.invalidate_wechat_reader(true, true);
        }
        self.error = None;
        let c = self.client.clone();
        let method = method.to_string();
        let t = cx.spawn(async move |this, cx| {
            let result = io(async move {
                match method.as_str() {
                    "PATCH" => c.product_patch(&path, body).await,
                    "DELETE" => c.product_delete(&path).await,
                    _ => c.product_post(&path, body).await,
                }
            })
            .await;
            _ = this.update(cx, |this, cx| {
                this.busy = false;
                match result {
                    Ok(v) => {
                        this.notice = Some(if v["ok"].as_bool() == Some(false) {
                            v["message"].as_str().unwrap_or("操作需要处理").to_string()
                        } else {
                            "操作已完成".into()
                        });
                        if v["status"].is_string()
                            && (v["url"].is_string() || v["status"] == "bound")
                        {
                            this.binding = v;
                            this.refresh_qr();
                        }
                        this.reload(cx)
                    }
                    Err(e) => {
                        this.error = Some(e.user_text());
                    }
                }
                cx.notify();
            });
        });
        self._tasks.push(t);
        cx.notify();
    }
    fn save(&mut self, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        let key = self.group_key();
        let mut draft = self.draft();
        if self.section == "connections"
            && draft["config"]["authMethod"] == "api-key"
            && !matches!(
                draft["type"]
                    .as_str()
                    .unwrap_or("mcp")
                    .to_ascii_lowercase()
                    .as_str(),
                "rest" | "mcp"
            )
        {
            self.error = Some(t(
                "API Key 当前仅支持 REST/MCP；Skill 请选择无需认证，Webhook 尚无检测适配器。",
            ));
            cx.notify();
            return;
        }
        let secret = if self.section == "connections" && draft["config"]["authMethod"] == "api-key"
        {
            self.secret_value(cx)
        } else {
            String::new()
        };
        let has_secret = !secret.is_empty();
        let submitted_secret = self
            .connection_secret
            .as_ref()
            .map(|(_, state)| (state.entity_id(), self.connection_secret_revision));
        if self.section == "connections"
            && draft["config"]["authMethod"] == "api-key"
            && !has_secret
            && draft["config"]["credentialReady"] != true
        {
            self.error = Some(t("请输入 API Key；服务端尚未确认此连接的已有密钥"));
            cx.notify();
            return;
        }
        if self.section == "connections" && self.detail.as_deref() == Some("new") {
            // Older local drafts predate the selector; preserve their original MCP behavior.
            if !draft["type"].is_string() {
                draft["type"] = json!("mcp");
            }
            if !draft["config"]["authMethod"].is_string() {
                draft["config"]["authMethod"] = json!("none");
            }
            self.drafts[&key] = draft.clone();
        }
        if self.detail.as_deref() == Some("new") && !draft["createId"].is_string() {
            draft["createId"] = json!(format!("connection-{}", opstwin_api::new_request_id()));
            self.drafts[&key] = draft.clone();
        }
        if self.detail.as_deref() == Some("request") && !draft["requestId"].is_string() {
            draft["requestId"] = json!(opstwin_api::new_request_id());
            self.drafts[&key] = draft.clone();
            self.persist();
        }
        let (path, body) = match self.section.as_str() {
            "general" | "identity" => ("/api/settings".into(), json!({"identity":draft})),
            "autonomy" => {
                draft["levels"]["commit"] = json!("draft");
                draft["levels"]["boss"] = json!("draft");
                draft["levels"]["sensitive"] = json!("observe");
                ("/api/settings".into(), json!({"autonomy":draft}))
            }
            "models" => (
                "/api/settings/models".into(),
                json!({"version":self.models["version"],"standard":draft["standard"],"deep":draft["standard"]}),
            ),
            "connections" => {
                let Some(id) = self.detail.as_ref() else {
                    return;
                };
                if id == "request" {
                    if draft["name"].as_str().unwrap_or("").trim().is_empty()
                        || draft["reason"].as_str().unwrap_or("").trim().is_empty()
                    {
                        self.error = Some(t("请填写应用名称与用途"));
                        cx.notify();
                        return;
                    }
                    (
                        "/api/tasks".into(),
                        json!({"id":draft["requestId"],"title":format!("Request app: {}",draft["name"].as_str().unwrap_or("").trim()),"notes":draft["reason"],"status":"pending","source":"settings-app-request","category":"integration"}),
                    )
                } else if id == "new" {
                    ("/api/connections/test".into(), draft)
                } else {
                    (
                        format!("/api/connections/{id}"),
                        json!({"name":draft["name"],"type":draft["type"],"endpoint":draft["endpoint"],"permissions":draft["permissions"],"config":draft["config"],"baseUpdatedAt":draft["updatedAt"]}),
                    )
                }
            }
            _ => return,
        };
        let request = self.detail.as_deref() == Some("request");
        let create = self.detail.as_deref() == Some("new") || request;
        let saved_section = self.section.clone();
        let submitted_draft = self.drafts.get(&key).cloned();
        let secret_connection = self.section == "connections"
            && self
                .detail
                .as_deref()
                .is_some_and(|id| id != "new" && id != "request")
            && has_secret;
        self.busy = true;
        self.error = None;
        let c = self.client.clone();
        let saver = self.saver.clone();
        let snapshot = json!({"local":self.local,"drafts":self.drafts});
        let t = cx.spawn(async move |this, cx| {
            if request || create {
                let saved = if let Some(saver) = saver {saver.save_now(snapshot).await}else{Err("Local storage is unavailable".to_string())};
                if let Err(e)=saved {_=this.update(cx,|this,cx|{this.busy=false;this.error=Some(format!("Unable to persist request; nothing was submitted: {e}"));cx.notify();});return;}
            }
            let result = io(async move {
                if request {
                    let id=body["id"].as_str().unwrap_or("");
                    match c.product_get(&format!("/api/tasks/{id}")).await {
                        Ok(existing) => {
                            if ["title","notes","source","category"].iter().all(|k|existing[*k]==body[*k]) {Ok(existing)}else{Err(opstwin_api::ApiError::Api{status:409,code:"request_already_saved".into(),message:"This application request was already saved with different content. Review it in Tasks.".into(),detail:None})}
                        }
                        Err(e) if e.status()==Some(404) => c.product_post(&path,body).await,
                        Err(e) => Err(e),
                    }
                } else if create {
                    let id=body["createId"].as_str().ok_or_else(||opstwin_api::ApiError::Decode("Missing durable connection ID".into()))?.to_string();
                    let mut input=body.clone();input["id"]=json!(id);
                    if let Some(m)=input.as_object_mut(){m.remove("createId");}
                    let saved = match c.product_get(&format!("/api/connections/{id}")).await {
                        Ok(saved) => {
                            if !connection_public_matches(&input, &saved) {
                                return Err(opstwin_api::ApiError::Api{status:409,code:"connection_create_changed".into(),message:t("原连接已创建，请读取原连接后继续编辑；不会创建重复连接"),detail:None});
                            }
                            if saved["status"]=="connected" {return Ok(json!({"ok":true,"connection":saved}));}
                            saved
                        },
                        Err(e) if e.status()==Some(404) => c.product_post("/api/connections",input.clone()).await?,
                        Err(e) => return Err(e),
                    };
                    let exact=c.product_get(&format!("/api/connections/{id}")).await?;
                    if exact["id"].as_str()!=Some(id.as_str()) || exact["updatedAt"]!=saved["updatedAt"] || !connection_public_matches(&input,&exact) {
                        return Err(opstwin_api::ApiError::Api{status:409,code:"connection_changed".into(),message:t("连接配置已变更，请先读取原连接"),detail:None});
                    }
                    input["baseUpdatedAt"]=exact["updatedAt"].clone();
                    // Only this transient request carries the key; durable intent and GET comparison above remain public.
                    if has_secret {input["config"]["apiKey"]=json!(secret);}
                    let mut result=c.product_post(&format!("/api/connections/{id}/test"),input).await?;
                    result["_nativeSecretAccepted"]=json!(has_secret && result["ok"]==true);
                    Ok(result)
                } else {
                    let saved=c.product_patch(&path, body).await?;
                    if secret_connection {
                        let exact=c.product_get(&path).await?;
                        if exact["id"]!=saved["id"] || exact["updatedAt"]!=saved["updatedAt"] || !connection_public_matches(&saved,&exact) {
                            return Err(opstwin_api::ApiError::Api{status:409,code:"connection_changed".into(),message:t("连接配置已变更，请先读取原连接"),detail:None});
                        }
                        let mut result=c.product_post(&format!("{path}/test"),json!({"baseUpdatedAt":exact["updatedAt"],"config":{"apiKey":secret}})).await?;
                        result["_nativeSecretAccepted"]=json!(result["ok"]==true);
                        Ok(result)
                    } else {Ok(saved)}
                }
            })
            .await;
            _ = this.update(cx, |this, cx| {
                this.busy = false;
                match result {
                    Ok(v) => {
                        if saved_section == "connections" && !request && v["ok"].as_bool() == Some(false) {
                            let active_group = this.group_key() == key;
                            if let Some(id) = v["connection"]["id"].as_str().map(str::to_string) {
                                let mut retained = this.drafts.get(&key).cloned().unwrap_or_else(||v["connection"].clone());
                                retained["updatedAt"] = v["connection"]["updatedAt"].clone();
                                if let Some(map) = this.drafts.as_object_mut() {
                                    map.remove(&key);
                                }
                                this.drafts[format!("connection:{id}")] = retained;
                                if active_group {
                                    if let Some((secret_key, _)) = this.connection_secret.as_mut().filter(|(secret_key, _)| *secret_key == key) {
                                        *secret_key = format!("connection:{id}");
                                    }
                                    this.detail = Some(id);
                                }
                                this.persist();
                            }
                            this.error = Some(
                                v["message"]
                                    .as_str()
                                    .unwrap_or(
                                        "Connection could not be verified; inputs are preserved.",
                                    )
                                    .to_string(),
                            );
                            this.merge_saved_connection(&v["connection"]);
                            cx.notify();
                            return;
                        }
                        // Rebuild controls from the canonical response, not the
                        // old bootstrap. A later reload preserves existing input
                        // entities and cannot repair stale values created here.
                        let canonical_connection = if v["connection"].is_object() {
                            v["connection"].clone()
                        } else {
                            v.clone()
                        };
                        match saved_section.as_str() {
                            "general" | "identity" | "autonomy" => {
                                this.data["settings"] = v.clone();
                            }
                            "models" => this.models = v.clone(),
                            "connections" if !request => {
                                this.merge_saved_connection(&canonical_connection);
                            }
                            _ => {}
                        }
                        let unchanged = this.drafts.get(&key) == submitted_draft.as_ref();
                        let active_group = this.group_key() == key;
                        if v["_nativeSecretAccepted"] == true && active_group && this.connection_secret.as_ref().map(|(_, state)| (state.entity_id(), this.connection_secret_revision)) == submitted_secret {
                            this.drop_connection_secret();
                        }
                        if unchanged {
                            if let Some(map) = this.drafts.as_object_mut() {
                                map.remove(&key);
                            }
                        } else if saved_section == "connections" && !request {
                            // A new edit remains a draft, based on the version
                            // actually saved rather than the obsolete lease.
                            this.drafts[&key]["updatedAt"] =
                                canonical_connection["updatedAt"].clone();
                        }
                        if request && active_group && unchanged {
                            this.detail = None;
                        } else if create && !request {
                            if let Some(id) = canonical_connection["id"].as_str() {
                                if !unchanged {
                                    let retained = this.drafts[&key].clone();
                                    if let Some(map) = this.drafts.as_object_mut() {
                                        map.remove(&key);
                                    }
                                    this.drafts[format!("connection:{id}")] = retained;
                                }
                                if active_group {
                                    if let Some((secret_key, _)) = this.connection_secret.as_mut().filter(|(secret_key, _)| *secret_key == key) {
                                        *secret_key = format!("connection:{id}");
                                    }
                                    this.detail = Some(id.to_string());
                                }
                            }
                        }
                        if active_group && unchanged {
                            this.fields.clear();
                            this.pending_fields = true;
                        }
                        this.persist();
                        this.notice = Some(
                            if has_secret && v["_nativeSecretAccepted"] != true && active_group {
                                "原连接已读取，新密钥尚未提交；请在原连接保存并检测"
                            } else if unchanged {
                                "已保存"
                            } else {
                                "提交的版本已保存，当前修改仍未保存"
                            }
                            .into(),
                        );
                        this.reload(cx);
                    }
                    Err(e) => this.error = Some(e.user_text()),
                }
                cx.notify();
            });
        });
        self._tasks.push(t);
        cx.notify();
    }
    fn merge_saved_connection(&mut self, saved: &Value) {
        if !saved["id"].is_string() {
            return;
        }
        if let Some(connections) = self.data["connections"].as_array_mut() {
            if let Some(existing) = connections
                .iter_mut()
                .find(|item| item["id"] == saved["id"])
            {
                *existing = saved.clone();
            } else {
                connections.push(saved.clone());
            }
        }
    }
    fn test_saved_connection(&mut self, id: String, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        let draft = self.draft();
        let saved = self.base();
        if draft["config"]["authMethod"] == "api-key"
            && !matches!(
                draft["type"]
                    .as_str()
                    .unwrap_or("mcp")
                    .to_ascii_lowercase()
                    .as_str(),
                "rest" | "mcp"
            )
        {
            self.error = Some(t(
                "API Key 当前仅支持 REST/MCP；Skill 请选择无需认证，Webhook 尚无检测适配器。",
            ));
            cx.notify();
            return;
        }
        if draft["type"] != saved["type"]
            || draft["endpoint"] != saved["endpoint"]
            || draft["config"]["authMethod"] != saved["config"]["authMethod"]
        {
            self.error = Some(t("请先保存连接配置，再检测连接"));
            cx.notify();
            return;
        }
        if !self.secret_value(cx).is_empty() {
            self.save(cx);
            return;
        }
        let key = self.group_key();
        let c = self.client.clone();
        self.busy = true;
        self.error = None;
        let task = cx.spawn(async move |this, cx| {
            let result = io(async move {
                let exact = c.product_get(&format!("/api/connections/{id}")).await?;
                if exact["id"].as_str() != Some(id.as_str())
                    || exact["updatedAt"] != saved["updatedAt"]
                    || !connection_public_matches(&saved, &exact)
                {
                    return Err(opstwin_api::ApiError::Api {
                        status: 409,
                        code: "connection_changed".into(),
                        message: t("连接配置已变更，请先读取原连接"),
                        detail: None,
                    });
                }
                if exact["config"]["authMethod"] == "api-key"
                    && exact["config"]["credentialReady"] != true
                {
                    return Err(opstwin_api::ApiError::Api {
                        status: 400,
                        code: "api_key_required".into(),
                        message: t("请输入 API Key；服务端尚未确认此连接的已有密钥"),
                        detail: None,
                    });
                }
                c.product_post(
                    &format!("/api/connections/{id}/test"),
                    json!({"baseUpdatedAt":exact["updatedAt"]}),
                )
                .await
            })
            .await;
            _ = this.update(cx, |this, cx| {
                this.busy = false;
                match result {
                    Ok(value) => {
                        this.merge_saved_connection(&value["connection"]);
                        if this.group_key() == key {
                            if let Some(draft) = this.drafts.get_mut(&key) {
                                draft["updatedAt"] = value["connection"]["updatedAt"].clone();
                                this.persist();
                            }
                            if value["ok"] == true {
                                this.notice = Some(t("连接实际检测成功"));
                            } else {
                                this.error = Some(
                                    value["message"]
                                        .as_str()
                                        .map(t)
                                        .unwrap_or_else(|| t("无法验证连接，输入已保留")),
                                );
                            }
                        }
                        this.reload(cx);
                    }
                    Err(error) if this.group_key() == key => this.error = Some(error.user_text()),
                    Err(_) => {}
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
        cx.notify();
    }
    fn recover_created_connection(&mut self, id: String, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        let original_key = self.group_key();
        self.busy = true;
        self.error = None;
        let client = self.client.clone();
        let task = cx.spawn(async move |this, cx| {
            let requested_id = id.clone();
            let result = io(async move {
                client
                    .product_get(&format!("/api/connections/{requested_id}"))
                    .await
            })
            .await;
            _ = this.update(cx, |this, cx| {
                this.busy = false;
                match result {
                    Ok(saved) if saved["id"].as_str() == Some(id.as_str()) => {
                        this.merge_saved_connection(&saved);
                        let active_group = this.group_key() == original_key;
                        let mut retained = this.drafts[&original_key].clone();
                        if retained["createId"].as_str() == Some(id.as_str()) {
                            retained["updatedAt"] = saved["updatedAt"].clone();
                            if let Some(map) = this.drafts.as_object_mut() {
                                map.remove(&original_key);
                            }
                            this.drafts[format!("connection:{id}")] = retained;
                            this.persist();
                        } else if retained.is_object() {
                            retained["updatedAt"] = saved["updatedAt"].clone();
                            this.drafts[&original_key] = retained;
                            this.persist();
                        }
                        if active_group {
                            if let Some((secret_key, _)) = this
                                .connection_secret
                                .as_mut()
                                .filter(|(secret_key, _)| *secret_key == original_key)
                            {
                                *secret_key = format!("connection:{id}");
                            }
                            this.detail = Some(id);
                            this.fields.clear();
                            this.pending_fields = true;
                        }
                        this.reload(cx);
                    }
                    Ok(_) => this.error = Some(t("原请求已保存不同内容，请核对后继续")),
                    Err(e) => this.error = Some(e.user_text()),
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
        cx.notify();
    }
    fn save_local(&mut self, path: &str, value: Value, cx: &mut Context<Self>) {
        set_path(&mut self.local, path, value);
        let Some(s) = self.saver.clone() else {
            self.error = Some("无法保存本机偏好".into());
            cx.notify();
            return;
        };
        let snapshot = json!({"local":self.local,"drafts":self.drafts});
        let catalog = path == "modelCatalog";
        let t = cx.spawn(async move |this, cx| {
            let r = s.save_now(snapshot).await;
            _ = this.update(cx, |this, cx| {
                match r {
                    Ok(()) => {
                        this.notice = if catalog {
                            Some(t("模型已添加到本机目录"))
                        } else {
                            None
                        };
                        if catalog {
                            this.model_add = false;
                        }
                        cx.emit(SettingsEvent::Appearance {
                            appearance: this.local["appearance"]
                                .as_str()
                                .unwrap_or("system")
                                .into(),
                            font_size: this.local["font"].as_u64().unwrap_or(15) as u32,
                            reduced_motion: this.local["reduced"].as_bool().unwrap_or(false),
                        });
                    }
                    Err(e) => this.error = Some(format!("偏好未保存，请重试：{e}")),
                }
                cx.notify();
            });
        });
        self._tasks.push(t);
        cx.notify();
    }
    fn connections(&self) -> Vec<&Value> {
        self.data["connections"]
            .as_array()
            .map(|v| {
                v.iter()
                    .filter(|x| {
                        x.get("supersededBy").is_none_or(Value::is_null)
                            && !matches!(
                                x["provider"].as_str(),
                                Some("slack" | "teams" | "whatsapp" | "telegram")
                            )
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
    fn provider_connection(&self, provider: &str) -> Option<&Value> {
        let connections = self.connections();
        let canonical = match provider {
            "feishu" => Some("feishu-local"),
            "wechat-sync" => Some("wechat-sync-local"),
            _ => None,
        };
        if let Some(id) = canonical {
            if let Some(c) = connections.iter().find(|c| c["id"].as_str() == Some(id)) {
                return Some(*c);
            }
        }
        connections
            .iter()
            .find(|c| connection_matches(c, provider) && c["status"] == "connected")
            .or_else(|| connections.iter().find(|c| connection_matches(c, provider)))
            .copied()
    }
    fn field(&self, path: &str) -> AnyElement {
        let font = px(13. * self.local["font"].as_u64().unwrap_or(15) as f32 / 15.);
        match self.fields.get(path) {
            Some(Field::Line(s)) => Input::new(s).h(px(34.)).text_size(font).disabled(self.model_add && self.section=="models" && !path.starts_with("catalog.")).into_any_element(),
            Some(Field::Multi(s)) => Textarea::new(s).text_size(font).into_any_element(),
            None => div().into_any_element(),
        }
    }
    fn language_cards(&self, cx: &mut Context<Self>) -> Div {
        let d = self.draft();
        let mut row = h_flex().w_full().gap(px(12.));
        for (value, label, glyph) in [("en", "English", "Aa"), ("zh-CN", "简体中文", "文")] {
            let selected = d["language"].as_str() == Some(value);
            let color = if selected {
                cx.theme().accent
            } else {
                cx.theme().background
            };
            row = row.child(
                Button::new(ElementId::Name(format!("language-{value}").into()))
                    .ghost()
                    .flex_1()
                    .h(px(60.))
                    .p(px(12.))
                    .rounded(px(10.))
                    .border_1()
                    .border_color(if selected {
                        rgb(0xb1c7ff).into()
                    } else {
                        cx.theme().border
                    })
                    .bg(color)
                    .accessibility_label(label)
                    .child(
                        h_flex()
                            .w_full()
                            .gap(px(10.))
                            .child(
                                div()
                                    .w(px(30.))
                                    .text_size(px(19.))
                                    .text_color(cx.theme().muted_foreground)
                                    .child(glyph),
                            )
                            .child(
                                div()
                                    .flex_1()
                                    .text_size(px(13.))
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(t(label)),
                            )
                            .child(
                                Radio::new(ElementId::Name(
                                    format!("language-radio-{value}").into(),
                                ))
                                .checked(selected)
                                .accessibility_label(label)
                                .on_click(cx.listener(
                                    move |this, _value: &bool, _, cx| {
                                        this.change("language", json!(value), cx);
                                        this.save(cx);
                                    },
                                )),
                            ),
                    )
                    .disabled(self.busy)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.change("language", json!(value), cx);
                        this.save(cx);
                    })),
            );
        }
        row
    }
    fn font_menu(&self, cx: &mut Context<Self>) -> Div {
        let selected = self.local["font"].as_u64().unwrap_or(15);
        let view = cx.entity().downgrade();
        h_flex().child(
            Button::new("font-size-menu")
                .small()
                .h(px(32.))
                .label(format!("{selected} pt"))
                .dropdown_caret(true)
                .outline()
                .dropdown_menu(move |mut menu, _, _| {
                    for value in [14u64, 15, 16] {
                        let view = view.clone();
                        menu = menu.item(
                            PopupMenuItem::new(format!("{value} pt"))
                                .checked(selected == value)
                                .on_click(move |_, _, cx| {
                                    _ = view.update(cx, |this, cx| {
                                        this.save_local("font", json!(value), cx)
                                    });
                                }),
                        );
                    }
                    menu
                }),
        )
    }
    fn row(&self, label: &str, control: impl IntoElement, cx: &App) -> Div {
        self.row_raw(&t(label), control, cx)
    }
    fn row_raw(&self, label: &str, control: impl IntoElement, cx: &App) -> Div {
        h_flex()
            .min_h(px(52.))
            .py_3()
            .gap_3()
            .border_b_1()
            .border_color(cx.theme().border)
            .child(div().flex_1().text_size(px(13.)).child(label.to_string()))
            .child(div().max_w(px(340.)).child(control))
    }
    fn row_detail(
        &self,
        label: &str,
        description: &str,
        control: impl IntoElement,
        cx: &App,
    ) -> Div {
        self.row_detail_raw(&t(label), &t(description), control, cx)
    }
    fn row_detail_raw(
        &self,
        label: &str,
        description: &str,
        control: impl IntoElement,
        cx: &App,
    ) -> Div {
        h_flex()
            .min_h(px(52.))
            .py_3()
            .gap_3()
            .border_b_1()
            .border_color(cx.theme().border)
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .child(
                        div()
                            .text_size(px(13.))
                            .line_height(relative(1.5))
                            .child(label.to_string()),
                    )
                    .when(!description.is_empty(), |v| {
                        v.child(
                            div()
                                .mt(px(5.))
                                .text_size(px(11.))
                                .line_height(relative(1.65))
                                .text_color(cx.theme().muted_foreground)
                                .child(description.to_string()),
                        )
                    }),
            )
            .child(div().max_w(px(230.)).flex_shrink_0().child(control))
    }
    fn explained_card(&self, title: &str, description: &str, cx: &mut Context<Self>) -> Div {
        self.explained_brand_card(title, description, None, cx)
    }
    fn explained_brand_card(
        &self,
        title: &str,
        description: &str,
        brand: Option<&str>,
        cx: &mut Context<Self>,
    ) -> Div {
        let key = format!("card-details-{title}");
        let open = self.expanded.contains(&key);
        let mut c = card_heading(title, brand, cx).child(
            h_flex().mb(px(12.)).child(
                Button::new(ElementId::Name(key.clone().into()))
                    .small()
                    .h(px(17.))
                    .px_0()
                    .ghost()
                    .text_size(px(11.))
                    .font_weight(FontWeight::NORMAL)
                    .text_color(cx.theme().muted_foreground)
                    .label(format!("{} {}", if open { "▾" } else { "▸" }, t("详情")))
                    .on_click(cx.listener(move |this, _, _, cx| this.flip(&key, cx))),
            ),
        );
        if open {
            c = c.child(note(description, cx).line_height(relative(1.7)).mb(px(8.)));
        }
        c
    }
    fn choices(
        &self,
        path: &str,
        values: &[(&str, &str)],
        local: bool,
        locked: bool,
        cx: &mut Context<Self>,
    ) -> Div {
        let d = if local {
            self.local.clone()
        } else {
            self.draft()
        };
        let level = if path.starts_with("levels.") {
            if path.ends_with("sensitive") {
                "observe"
            } else if locked {
                "draft"
            } else {
                normalize_level(at(&d, path))
            }
        } else {
            ""
        };
        let val = match path {
            "native.syncScope" => self.sync_scope.as_str(),
            "native.recordKind" => self.record_kind.as_str(),
            _ if path.starts_with("levels.") => level,
            _ => at(&d, path).as_str().unwrap_or(match path {
                "dictation.handsfree" => "none",
                "add.personRole" => "VIP",
                "type" => "mcp",
                "config.authMethod" => "none",
                _ => "",
            }),
        };
        let mut r = h_flex().gap_1().flex_wrap().min_w_0();
        if path == "alerts" {
            r = r.flex_col().items_start().gap(px(10.));
            for (value, label) in values {
                let value = value.to_string();
                r = r.child(
                    Radio::new(ElementId::Name(format!("alert-{value}").into()))
                        .checked(val == value)
                        .label(t(label))
                        .disabled(locked || self.busy)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.change("alerts", json!(value), cx)
                        })),
                );
            }
            return r;
        }
        if !matches!(path, "language" | "appearance" | "alerts") {
            let selected = val.to_string();
            let business_choice = path.ends_with(".providerId") || path.ends_with(".model");
            let label = values
                .iter()
                .find(|x| x.0 == val || (path == "type" && x.0.eq_ignore_ascii_case(val)))
                .map(|x| {
                    if business_choice {
                        x.1.to_string()
                    } else {
                        t(x.1)
                    }
                })
                .unwrap_or_else(|| {
                    if business_choice {
                        val.to_string()
                    } else {
                        t(val)
                    }
                });
            let choices: Vec<(String, String)> = values
                .iter()
                .map(|(v, l)| {
                    (
                        v.to_string(),
                        if business_choice { l.to_string() } else { t(l) },
                    )
                })
                .collect();
            let view = cx.entity().downgrade();
            let path = path.to_string();
            return r.when(business_choice, |row| row.w_full()).child(
                Button::new(ElementId::Name(format!("select-{path}").into()))
                    .small()
                    .h(px(32.))
                    .label(label)
                    .dropdown_caret(true)
                    .outline()
                    .when(business_choice, |button| button.w_full())
                    .disabled(locked || self.busy)
                    .dropdown_menu(move |mut menu, _, _| {
                        for (value, label) in &choices {
                            let view = view.clone();
                            let p = path.clone();
                            let v = value.clone();
                            menu = menu.item(
                                PopupMenuItem::new(label.clone())
                                    .checked(
                                        selected == *value
                                            || (path == "type"
                                                && selected.eq_ignore_ascii_case(value)),
                                    )
                                    .on_click(move |_, window, cx| {
                                        _ = view.update(cx, |this, cx| {
                                            if p == "native.syncScope" {
                                                this.sync_scope = v.clone();
                                                cx.notify();
                                            } else if p == "native.recordKind" {
                                                this.load_records(v.clone(), 0, cx);
                                            } else if local {
                                                this.save_local(&p, json!(v), cx);
                                            } else {
                                                this.change(&p, json!(v), cx);
                                            }
                                            if let Some(role) = p.strip_suffix(".providerId") {
                                                let next = this.models["providers"]
                                                    .as_array()
                                                    .and_then(|a| {
                                                        a.iter().find(|x| {
                                                            x["id"].as_str() == Some(v.as_str())
                                                        })
                                                    })
                                                    .and_then(|x| x["models"].as_array())
                                                    .and_then(|a| a.first())
                                                    .and_then(Value::as_str)
                                                    .unwrap_or("")
                                                    .to_string();
                                                let field_path = format!("{role}.model");
                                                this.change(&field_path, json!(next), cx);
                                                if let Some(Field::Line(field)) =
                                                    this.fields.get(&field_path).cloned()
                                                {
                                                    field.update(cx, |state, cx| {
                                                        state.set_value(next, window, cx)
                                                    });
                                                }
                                            }
                                            if p.ends_with(".model") {
                                                if let Some(Field::Line(field)) =
                                                    this.fields.get(&p).cloned()
                                                {
                                                    field.update(cx, |state, cx| {
                                                        state.set_value(v.clone(), window, cx)
                                                    });
                                                }
                                            }
                                        });
                                    }),
                            );
                        }
                        menu
                    }),
            );
        }
        if path == "appearance" {
            r = r
                .bg(rgb(if cx.theme().is_dark() {
                    0x333742
                } else {
                    0xe7e9ee
                }))
                .p(px(2.))
                .rounded(px(6.));
        }
        for (value, label) in values {
            let p = path.to_string();
            let v = value.to_string();
            r = r.child(
                Button::new(ElementId::Name(format!("choice-{path}-{value}").into()))
                    .small()
                    .h(px(32.))
                    .ghost()
                    .label(t(label))
                    .selected(val == *value)
                    .when(path == "appearance" && val == *value, |button| {
                        button
                            .bg(cx.theme().background)
                            .text_color(cx.theme().foreground)
                    })
                    .disabled(locked || self.busy)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if local {
                            this.save_local(&p, json!(v), cx)
                        } else {
                            this.change(&p, json!(v), cx)
                        }
                    })),
            );
        }
        r
    }
    fn toggle(&self, path: &str, label: &str, local: bool, cx: &mut Context<Self>) -> AnyElement {
        let d = if local {
            self.local.clone()
        } else {
            self.draft()
        };
        let checked = at(&d, path).as_bool().unwrap_or(false);
        let p = path.to_string();
        Switch::new(ElementId::Name(format!("toggle-{path}").into()))
            .checked(checked)
            .accessibility_label(t(label))
            .disabled(self.busy || (self.model_add && self.section=="models" && !path.starts_with("catalog.")) || (path=="enabled" && self.section=="models" && ["standard","deep"].iter().any(|role|self.models[*role]["providerId"]==self.draft()["id"])))
            .on_click(cx.listener(move |this, value: &bool, _, cx| {
                if local {
                    this.save_local(&p, json!(*value), cx)
                } else {
                    this.change(&p, json!(*value), cx)
                }
            }))
            .into_any_element()
    }
    fn footer(&self, cx: &mut Context<Self>) -> Div {
        let dirty =
            self.drafts.get(self.group_key()).is_some() || !self.secret_value(cx).is_empty();
        h_flex()
            .gap_2()
            .py_3()
            .child(
                div()
                    .flex_1()
                    .text_size(px(11.))
                    .text_color(cx.theme().muted_foreground)
                    .child(t(if dirty { "未保存" } else { "" })),
            )
            .child(
                Button::new("cancel-settings")
                    .small()
                    .h(px(32.))
                    .ghost()
                    .label(t("取消"))
                    .disabled(self.busy || !dirty)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.drop_connection_secret();
                        let key = this.group_key();
                        if let Some(m) = this.drafts.as_object_mut() {
                            m.remove(&key);
                        }
                        this.fields.clear();
                        this.pending_fields = true;
                        this.persist();
                        cx.notify();
                    })),
            )
            .child(
                Button::new("save-settings")
                    .small()
                    .h(px(32.))
                    .primary()
                    .label(t("保存"))
                    .loading(self.busy)
                    .disabled(!dirty)
                    .on_click(cx.listener(|this, _, _, cx| this.save(cx))),
            )
    }
    fn history(&mut self, kind: &str, cx: &mut Context<Self>) {
        let kind = kind.to_string();
        let c = self.client.clone();
        let t = cx.spawn(async move |this, cx| {
            let memory = kind == "memory";
            let result = io(async move {
                c.product_get(if memory {
                    "/api/memories/history"
                } else {
                    "/api/settings/history"
                })
                .await
            })
            .await;
            _ = this.update(cx, |this, cx| {
                match result {
                    Ok(v) => this.history = Some((kind, v)),
                    Err(e) => this.error = Some(e.user_text()),
                }
                cx.notify();
            });
        });
        self._tasks.push(t);
    }
    // Scope changes clear private reader results, never ordinary settings drafts.
    // InputState needs the actual render Window; reset it there, not via a new window.
    fn invalidate_wechat_reader(&mut self, scope_changed: bool, clear_pages: bool) {
        self.cancel_wechat_save();
        self.wechat_generation = self.wechat_generation.wrapping_add(1);
        self.wechat_loading = false;
        self.wechat_selected_message = None;
        self.wechat_exact = None;
        self.wechat_image = None;
        self.wechat_media = None;
        self.wechat_saved = None;
        if clear_pages {
            self.wechat_page = json!({});
            self.wechat_messages = json!({});
            self.wechat_chat_cursors.clear();
            self.wechat_message_cursors.clear();
        }
        if scope_changed {
            self.wechat_capabilities = json!({});
            self.wechat_chat = None;
            self.wechat_applied_query.clear();
            self.wechat_query_needs_reset = true;
        }
    }
    fn cancel_wechat_save(&mut self) {
        if let Some(cancel) = self.wechat_save_cancel.take() {
            cancel.store(true, std::sync::atomic::Ordering::Release);
        }
        self.wechat_save_busy = false;
    }
    fn wechat_reader_connection(&self) -> Option<WechatReaderConnection> {
        self.provider_connection("wechat-sync").map(|c| WechatReaderConnection {
            id: c["id"].as_str().unwrap_or("").to_string(),
            updated_at: c["updatedAt"].clone(),
            status: c["status"].as_str().unwrap_or("").to_string(),
            readable: c["permissions"].as_array().is_some_and(|p| p.iter().any(|v| v == "read")),
        })
    }
    fn wechat_reader_active(&self) -> bool {
        self.visible && self.section == "connections"
            && self.detail.as_deref() == Some("wechat-sync-local")
    }
    fn wechat_owner_matches(&self, generation: u64, connection: &WechatReaderConnection,
        conversation: Option<&str>, message: Option<&str>) -> bool {
        self.wechat_reader_active() && self.wechat_generation == generation
            && connection.status == "connected" && connection.readable
            && self.wechat_reader_connection().as_ref() == Some(connection)
            && self.wechat_chat.as_ref().map(|c| c.0.as_str()) == conversation
            && self.wechat_selected_message.as_deref() == message
    }
    fn wechat_reader_error(&mut self, error: opstwin_api::ApiError) {
        if matches!(error.code(), Some("wechat_not_connected" | "connection_changed" | "wechat_source_changed" | "wechat_conversation_unverified")) {
            self.invalidate_wechat_reader(true, true);
        }
        self.error = Some(t(&error.user_text()));
    }
    fn read_wechat(&mut self, cursor: String, history: Vec<String>, cx: &mut Context<Self>) {
        if self.wechat_loading || !self.wechat_reader_active() { return; }
        let Some(connection) = self.wechat_reader_connection()
            .filter(|c| c.status == "connected" && c.readable) else {
            self.invalidate_wechat_reader(true, true);
            self.error = Some(t("请先连接本机微信"));
            cx.notify();
            return;
        };
        self.invalidate_wechat_reader(false, false);
        self.wechat_capabilities = json!({});
        let generation = self.wechat_generation;
        self.wechat_loading = true;
        self.error = None;
        let conversation = self.wechat_chat.as_ref().map(|c| c.0.clone());
        let owner_conversation = conversation.clone();
        let path = if let Some(id) = &conversation {
            format!("/api/wechat/messages?conversation={}&cursor={}",
                opstwin_api::product::query_value(id), opstwin_api::product::query_value(&cursor))
        } else {
            format!("/api/wechat/chats?cursor={}", opstwin_api::product::query_value(&cursor))
        };
        let applied_query = self.wechat_applied_query.clone();
        let client = self.client.clone();
        let task = cx.spawn(async move |this, cx| {
            let capabilities_client=client.clone();
            let capabilities=io(async move {capabilities_client.product_get("/api/wechat/capabilities").await}).await;
            if !this.update(cx,|this,_|this.wechat_owner_matches(generation,&connection,owner_conversation.as_deref(),None)).unwrap_or(false){return;}
            let result = io(async move {
                let capabilities = capabilities?;
                let page = if applied_query.is_empty() { client.product_get(&path).await }
                else if let Some(id) = conversation { client.wechat_search(json!({"conversation":id,"query":applied_query,"cursor":cursor})).await }
                else { client.wechat_contacts(json!({"query":applied_query,"cursor":cursor,"searchAll":true,"limit":100})).await }?;
                Ok::<_, opstwin_api::ApiError>((capabilities, page))
            }).await;
            _ = this.update(cx, |this, cx| {
                if !this.wechat_owner_matches(generation, &connection, owner_conversation.as_deref(), None) { return; }
                this.wechat_loading = false;
                match result {
                    Ok((capabilities, value)) => {
                        this.wechat_capabilities = capabilities;
                        if owner_conversation.is_some() {
                            this.wechat_messages = value;
                            this.wechat_message_cursors = history;
                        } else {
                            this.wechat_page = value;
                            this.wechat_chat_cursors = history;
                        }
                    }
                    Err(error) => this.wechat_reader_error(error),
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
        cx.notify();
    }
    fn begin_wechat_message(&mut self, message: &str) {
        self.cancel_wechat_save();
        if self.wechat_selected_message.as_deref() != Some(message) {
            self.invalidate_wechat_reader(false, false);
        } else {
            self.wechat_generation = self.wechat_generation.wrapping_add(1);
        }
        self.wechat_selected_message = Some(message.to_string());
        self.wechat_loading = true;
        self.error = None;
    }
    fn wechat_can_read_message(&self, message: &str) -> bool {
        self.wechat_reader_active() && !self.wechat_loading && !self.wechat_save_busy
            && self.wechat_messages["items"].as_array().is_some_and(|items|
                items.iter().any(|item| item["id"].as_str() == Some(message)))
    }
    fn wechat_media_supported(&self, kind: crate::wechat_media::Kind) -> bool {
        self.wechat_capabilities["readOnly"]==true
            && self.wechat_capabilities["attachments"]["maxBytes"].as_u64().is_some_and(|n|n>0&&n<=crate::wechat_media::MAX_BYTES)
            && self.wechat_capabilities["attachments"][kind.capability()].as_str()
            .is_some_and(|v| v.starts_with("exact-message-"))
    }
    fn read_wechat_image(&mut self, message: String, cx: &mut Context<Self>) {
        self.read_wechat_media(message, crate::wechat_media::Kind::Image, cx);
    }
    fn read_wechat_media(&mut self, message: String, kind: crate::wechat_media::Kind, cx: &mut Context<Self>) {
        if !self.wechat_can_read_message(&message) || !self.wechat_media_supported(kind)
            || !self.wechat_messages["items"].as_array().is_some_and(|items| items.iter().any(|item|
                item["id"].as_str()==Some(message.as_str()) && crate::wechat_media::Kind::from_message(item)==Some(kind))) { return; }
        let Some((conversation, _)) = self.wechat_chat.clone() else { return; };
        let Some(connection) = self.wechat_reader_connection()
            .filter(|c| c.status == "connected" && c.readable) else { return; };
        self.begin_wechat_message(&message);
        self.wechat_media = None;
        self.wechat_saved = None;
        self.wechat_image = None;
        let generation = self.wechat_generation;
        let client = self.client.clone();
        let task = cx.spawn(async move |this, cx| {
            let meta_conversation = conversation.clone();
            let meta_message = message.clone();
            let meta_client = client.clone();
            let meta = io(async move { meta_client.wechat_attachment(&meta_conversation, &meta_message).await }).await;
            if !this.update(cx, |this, _| this.wechat_owner_matches(generation, &connection,
                Some(&conversation), Some(&message))).unwrap_or(false) { return; }
            let result = io(async move {
                let meta = crate::wechat_media::MediaMeta::parse(&meta?, kind).map_err(opstwin_api::ApiError::Decode)?;
                let file = client.wechat_attachment_bytes(&meta.token).await?;
                crate::wechat_media::verify(meta, file).map(std::sync::Arc::new).map_err(opstwin_api::ApiError::Decode)
            }).await;
            _ = this.update(cx, |this, cx| {
                if !this.wechat_owner_matches(generation, &connection, Some(&conversation), Some(&message)) { return; }
                this.wechat_loading = false;
                match result {
                    Ok(media) => {
                        if media.meta.kind == crate::wechat_media::Kind::Image {
                            let format = match media.meta.mime.as_str() {
                                "image/png"=>ImageFormat::Png, "image/jpeg"=>ImageFormat::Jpeg,
                                "image/webp"=>ImageFormat::Webp, "image/gif"=>ImageFormat::Gif,
                                _=>return,
                            };
                            this.wechat_image=Some(std::sync::Arc::new(Image::from_bytes(format, media.bytes.to_vec())));
                        }
                        this.wechat_media=Some(media);
                    }
                    Err(error) => this.wechat_reader_error(error),
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
        cx.notify();
    }
    fn wechat_save_owner_matches(&self, generation: u64, connection: &WechatReaderConnection,
        conversation: &str, message: &str, media: &std::sync::Arc<crate::wechat_media::Media>,
        cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>) -> bool {
        self.wechat_owner_matches(generation, connection, Some(conversation), Some(message))
            && self.wechat_media.as_ref().is_some_and(|m| std::sync::Arc::ptr_eq(m,media))
            && self.wechat_save_cancel.as_ref().is_some_and(|c|std::sync::Arc::ptr_eq(c,cancel))
            && !cancel.load(std::sync::atomic::Ordering::Acquire)
    }
    fn save_wechat_media(&mut self, cx: &mut Context<Self>) {
        if self.wechat_save_busy || self.wechat_loading || !self.wechat_reader_active() { return; }
        let Some(media) = self.wechat_media.clone().filter(|m|!m.meta.expired()) else { return; };
        if let Err(error)=crate::wechat_media::policy_stamp() { self.error=Some(t(&error));cx.notify();return; }
        let Some((conversation,_))=self.wechat_chat.clone() else {return;};
        let Some(message)=self.wechat_selected_message.clone() else {return;};
        let Some(connection)=self.wechat_reader_connection().filter(|c|c.status=="connected"&&c.readable) else {return;};
        self.cancel_wechat_save();
        let cancel=std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        self.wechat_save_cancel=Some(cancel.clone());self.wechat_save_busy=true;self.error=None;self.notice=None;
        let generation=self.wechat_generation;
        let home=std::env::var_os("HOME").map(std::path::PathBuf::from).filter(|p|p.is_absolute()).unwrap_or_else(||"/".into());
        let downloads=home.join("Downloads");let directory=if downloads.is_dir(){downloads}else{home};
        let rx=cx.prompt_for_new_path(&directory,Some(&media.suggested_name()));
        let task=cx.spawn(async move |this,cx| {
            let path=match rx.await {
                Ok(Ok(Some(path)))=>path,
                result=>{
                    _=this.update(cx,|this,cx| {
                        if !this.wechat_save_owner_matches(generation,&connection,&conversation,&message,&media,&cancel){return;}
                        this.cancel_wechat_save();
                        if matches!(result,Ok(Err(_))|Err(_)){this.error=Some(t("无法打开保存选择器，请重试"));}
                        cx.notify();
                    });return;
                }
            };
            if !this.update(cx,|this,_|this.wechat_save_owner_matches(generation,&connection,&conversation,&message,&media,&cancel)).unwrap_or(false){return;}
            let preparing_media=media.clone();let preparing_cancel=cancel.clone();
            let result=io(async move {crate::wechat_media::prepare(preparing_media,path,preparing_cancel).await}).await;
            _=this.update(cx,|this,cx| {
                if !this.wechat_save_owner_matches(generation,&connection,&conversation,&message,&media,&cancel){return;}
                // No await between this owner check and descriptor-bound no-overwrite publish.
                match result.and_then(|prepared|prepared.publish()) {
                    Ok(saved)=>{this.wechat_saved=Some(saved);this.notice=Some(t("文件已保存"));},
                    Err(error)=>this.error=Some(t(&error)),
                }
                this.cancel_wechat_save();cx.notify();
            });
        });self._tasks.push(task);cx.notify();
    }
    fn open_saved_wechat_media(&mut self,cx:&mut Context<Self>) {
        if self.wechat_save_busy||self.wechat_loading||!self.wechat_reader_active(){return;}
        let Some(media)=self.wechat_media.clone().filter(|m|m.system_open&&!m.meta.expired()) else{return;};
        let Some(saved)=self.wechat_saved.clone() else{return;};
        let Some((conversation,_))=self.wechat_chat.clone() else{return;};
        let Some(message)=self.wechat_selected_message.clone() else{return;};
        let Some(connection)=self.wechat_reader_connection().filter(|c|c.status=="connected"&&c.readable) else{return;};
        self.cancel_wechat_save();let cancel=std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        self.wechat_save_cancel=Some(cancel.clone());self.wechat_save_busy=true;self.error=None;
        let generation=self.wechat_generation;let client=self.client.clone();let verifying=media.clone();
        let task=cx.spawn(async move |this,cx| {
            let token=verifying.meta.token.clone();
            let download=io(async move {client.wechat_attachment_bytes(&token).await}).await;
            // An in-flight GET may finish, but a stale owner must not start a new disk read.
            if !this.update(cx,|this,_|this.wechat_save_owner_matches(generation,&connection,&conversation,&message,&media,&cancel)).unwrap_or(false){return;}
            let verifying_cancel=cancel.clone();
            let result=io(async move {
                crate::wechat_media::verify(verifying.meta.clone(),download?).map_err(opstwin_api::ApiError::Decode)?;
                saved.verify_for_open(verifying,verifying_cancel).await.map_err(opstwin_api::ApiError::Decode)
            }).await;
            _=this.update(cx,|this,cx|{
                if !this.wechat_save_owner_matches(generation,&connection,&conversation,&message,&media,&cancel){return;}
                this.cancel_wechat_save();
                match result {
                    Ok(verified) if !media.meta.expired()=>match verified.path_if_current(){
                        Ok(path)=>{cx.open_with_system(path);this.notice=Some(t("已请求系统打开；播放或查看取决于系统应用"));},
                        Err(error)=>this.error=Some(t(&error)),
                    },
                    Ok(_)=>this.error=Some(t("附件读取已过期，请重新读取原消息")),
                    Err(error)=>this.wechat_reader_error(error),
                }cx.notify();
            });
        });self._tasks.push(task);cx.notify();
    }
    fn read_wechat_exact(&mut self, message: String, cx: &mut Context<Self>) {
        if !self.wechat_can_read_message(&message) { return; }
        let Some((conversation, _)) = self.wechat_chat.clone() else { return; };
        let Some(connection) = self.wechat_reader_connection()
            .filter(|c| c.status == "connected" && c.readable) else { return; };
        self.begin_wechat_message(&message);
        let generation = self.wechat_generation;
        let request_conversation = conversation.clone();
        let request_message = message.clone();
        let client = self.client.clone();
        let task = cx.spawn(async move |this, cx| {
            let result = io(async move { client.wechat_message(&request_conversation, &request_message).await }).await;
            _ = this.update(cx, |this, cx| {
                if !this.wechat_owner_matches(generation, &connection, Some(&conversation), Some(&message)) { return; }
                this.wechat_loading = false;
                match result {
                    Ok(value) => this.wechat_exact = Some(value),
                    Err(error) => this.wechat_reader_error(error),
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
        cx.notify();
    }
    fn wechat_view(&self, cx: &mut Context<Self>) -> Div {
        let theme = cx.theme().clone();
        let conn = self.provider_connection("wechat-sync");
        let connected = conn.is_some_and(|c| c["status"] == "connected");
        let mut out = v_flex().gap_4().child(
            Button::new("wechat-connections-back").self_start()
                .small()
                .h(px(32.))
                .ghost()
                .icon(gpui_kit::assets::IconName::ChevronLeft)
                .label(t("连接"))
                .on_click(cx.listener(|this, _, _, cx| {
                    this.detail = None;
                    this.invalidate_wechat_reader(true, true);
                    cx.notify();
                })),
        );
        let mut status = card("个人微信", cx)
            .gap_2()
            .child(h_flex().gap_2()
                .child(div().text_size(px(13.)).font_weight(FontWeight::SEMIBOLD)
                    .text_color(if connected { theme.success } else { theme.muted_foreground })
                    .child(t(if connected { "已连接 · 只读" } else { "未连接" }))))
            .child(note("按需查看本机联系人和消息，不自动导入或发送", cx));
        if let Some(conn) = conn {
            if let Some(value) = conn["evidence"]["verifiedAt"].as_str() {
                status = status.child(note_raw(&format!("{} {}", t("最近检测"), crate::util::fmt_time(value)), cx));
            }
            if conn["evidence"]["coverageComplete"] == false {
                status = status.child(note("当前读取范围可能不完整", cx));
            }
            if !connected {
                status = status.child(note_raw(conn["message"].as_str().unwrap_or(""), cx));
            }
        }
        status = status.child(
            h_flex()
                .gap_2()
                .child(
                    Button::new("wechat-connect")
                        .small()
                        .h(px(32.))
                        .outline()
                        .label(t(if connected {
                            "重新检测"
                        } else {
                            "连接本机微信"
                        }))
                        .disabled(self.busy || self.wechat_loading)
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.mutate("POST", "/api/wechat/connect".into(), json!({}), cx)
                        })),
                )
                .when(connected, |v| {
                    v.child(
                        Button::new("wechat-disconnect")
                            .small()
                            .h(px(32.))
                            .ghost()
                            .label(t("断开连接"))
                            .disabled(self.busy || self.wechat_loading)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.mutate(
                                    "POST",
                                    "/api/connections/wechat-sync-local/disconnect".into(),
                                    json!({}),
                                    cx,
                                )
                            })),
                    )
                }),
        );
        out = out.child(status);
        if !connected {
            return out;
        }
        out = out.child(h_flex().gap_2()
            .child(div().flex_1().child(Input::new(&self.wechat_query).small()))
            .child(Button::new("wechat-context-search").small().h(px(32.)).outline().loading(self.wechat_loading)
                .label(t(if self.wechat_chat.is_some() { "搜索当前会话" } else { "查找联系人" }))
                .disabled(self.wechat_loading || self.wechat_save_busy)
                .on_click(cx.listener(|this, _, _, cx| {
                    this.wechat_applied_query = this.wechat_query.read(cx).value().trim().to_string();
                    this.wechat_exact = None;
                            this.wechat_image = None;
                    this.read_wechat(String::new(), vec![String::new()], cx);
                })))
            .child(Button::new("wechat-context-all").small().h(px(32.)).ghost().label(t("全部"))
                .disabled(self.wechat_loading || self.wechat_save_busy).on_click(cx.listener(|this, _, window, cx| {
                    this.wechat_query.update(cx, |input, cx| input.set_value("", window, cx));
                    this.wechat_applied_query.clear();this.wechat_exact=None;this.wechat_image=None;
                    this.read_wechat(String::new(),vec![String::new()],cx);
                }))));
        out = out.child(note(if self.wechat_chat.is_some() {
            "只搜索当前会话中的消息"
        } else { "按昵称、备注或微信号查找联系人，搜索会继续读取后续页" }, cx));
        if let Some(image)=&self.wechat_image {
            out=out.child(document_card(cx)
                .child(Button::new("wechat-close-image").small().ghost().label(t("关闭图片"))
                    .on_click(cx.listener(|this,_,_,cx|{
                        this.wechat_generation = this.wechat_generation.wrapping_add(1);
                        this.wechat_loading = false;
                        this.cancel_wechat_save();
                        this.wechat_image = None;
                        this.wechat_media = None;
                        this.wechat_saved = None;
                        cx.notify();
                    })))
                .child(img(image.clone()).max_w(px(580.)).max_h(px(480.)).object_fit(ObjectFit::Contain)));
        }
        if let Some(media)=self.wechat_media.as_ref().filter(|m|m.meta.kind!=crate::wechat_media::Kind::Image) {
            let policy_error=crate::wechat_media::policy_stamp().err();
            let mut panel=document_card(cx)
                .child(h_flex().gap_2().child(div().flex_1().text_size(px(13.)).child(media.suggested_name()))
                    .child(Button::new("wechat-close-media").small().ghost().label(t("关闭附件"))
                        .on_click(cx.listener(|this,_,_,cx|{this.invalidate_wechat_reader(false,false);cx.notify();}))))
                .child(note_raw(&format!("{} · {}",media.meta.mime,crate::util::human_size(media.meta.size)),cx))
                .child(note("附件只保留在内存中；保存需要你选择位置",cx))
                .child(h_flex().gap_2()
                    .child(Button::new("wechat-save-media").small().outline().label(t("保存到…"))
                        .loading(self.wechat_save_busy)
                        .disabled(self.wechat_save_busy || media.meta.expired() || policy_error.is_some())
                        .on_click(cx.listener(|this,_,_,cx|this.save_wechat_media(cx))))
                    .when(self.wechat_saved.is_some(),|v|v.child(Button::new("wechat-open-saved-media").small().outline().label(t("在系统应用打开"))
                        .disabled(self.wechat_save_busy || !media.system_open || media.meta.expired() || policy_error.is_some())
                        .on_click(cx.listener(|this,_,_,cx|this.open_saved_wechat_media(cx))))));
            if media.meta.expired(){panel=panel.child(note("附件读取已过期，请重新读取原消息",cx));}
            if let Some(error)=policy_error {panel=panel.child(note(&error,cx));}
            if !media.system_open {panel=panel.child(note("此格式只能保存，不能系统打开",cx));}
            out=out.child(panel);
        }
        if let Some(value) = &self.wechat_exact {
            let item = &value["item"];
            out = out.child(document_card(cx)
                .child(Button::new("wechat-close-exact").small().ghost().label(t("关闭全文"))
                    .on_click(cx.listener(|this,_,_,cx| {this.invalidate_wechat_reader(false, false);cx.notify();})))
                .child(div().text_size(body_px(13.,cx)).line_height(relative(1.65)).child(item["text"].as_str().unwrap_or("").to_string()))
                .when(item["contentTruncated"]==true,|v|v.child(note("此来源正文仍有截断，不能视为完整消息",cx))));
        }
        out = out.child(
            h_flex()
                .gap_2()
                .when(self.wechat_chat.is_some(), |v| {
                    v.child(
                        Button::new("wechat-back-chats")
                            .small()
                            .h(px(32.))
                            .ghost()
                            .label(t("微信会话"))
                            .disabled(self.wechat_loading || self.wechat_save_busy)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.invalidate_wechat_reader(true, true);
                                cx.notify();
                            })),
                    )
                })
                .child(
                    Button::new("wechat-read")
                        .small()
                        .h(px(32.))
                        .outline()
                        .label(t("刷新"))
                        .loading(self.wechat_loading)
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.read_wechat(String::new(), vec![String::new()], cx)
                        })),
                ),
        );
        let page = if self.wechat_chat.is_some() {
            &self.wechat_messages
        } else {
            &self.wechat_page
        };
        let mut list = document_card(cx);
        if self.wechat_chat.is_none() && !self.wechat_applied_query.is_empty() {
            list = list.child(note_raw(&format!("{} {} · {} {}", t("已检查"),
                page["scanned"].as_u64().unwrap_or(0), t("匹配"),
                page["items"].as_array().map_or(0, |items| items.len())), cx));
        }
        if let Some((_, name)) = &self.wechat_chat {
            list = list.child(
                div()
                    .text_size(px(15.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(name.clone()),
            );
        }
        if page["coverageComplete"].as_bool() == Some(false) {
            list = list.child(note("当前读取范围可能不完整", cx));
        }
        if page["hasWarnings"].as_bool() == Some(true) {
            list = list.child(note("本机数据存在读取提醒，请检查 GreenBubbles", cx));
        }
        if page["ambiguous"]==true {list=list.child(note("多个匹配，请选择精确联系人后再读取；不会按名字猜测会话。",cx));}
        for warning in page["warnings"].as_array().into_iter().flatten() {
            let label=warning.as_str().map(str::to_string).unwrap_or_else(||format!("{} {}",warning["code"].as_str().unwrap_or(""),warning["message"].as_str().unwrap_or("")));
            if !label.trim().is_empty() {list=list.child(note_raw(&label,cx));}
        }

        for item in page["items"].as_array().into_iter().flatten() {
            if self.wechat_chat.is_some() {
                let message_id = item["id"].as_str().unwrap_or("").to_string();
                let image_id = message_id.clone();
                let media_kind = crate::wechat_media::Kind::from_message(item);
                let media_id = message_id.clone();
                let direction = match item["self"].as_bool() { Some(true)=>"本人",Some(false)=>"对方",None=>"方向未知" };
                list = list.child(
                    v_flex()
                        .gap_1()
                        .py_3()
                        .border_b_1()
                        .border_color(theme.border)
                        .child(
                            h_flex()
                                .gap_2()
                                .child(
                                    div()
                                        .text_size(px(11.))
                                        .child(item["sender"].as_str().unwrap_or("").to_string()),
                                )
                                .child(
                                    div()
                                        .text_size(px(11.))
                                        .text_color(theme.muted_foreground)
                                        .child(
                                            item["at"]
                                                .as_i64()
                                                .and_then(|s| {
                                                    chrono::DateTime::from_timestamp(s, 0)
                                                })
                                                .map(|d| {
                                                    d.with_timezone(&chrono::Local)
                                                        .format("%m-%d %H:%M")
                                                        .to_string()
                                                })
                                                .unwrap_or_default(),
                                        ),
                                ),
                        )
                        .child(div().text_size(px(11.)).text_color(theme.muted_foreground).child(t(direction)))
                        .when(item["contentTruncated"]==true,|v|v.child(note("正文有截断，请精确读取；来源截断可能仍无法恢复全文",cx)))
                        .when(media_kind==Some(crate::wechat_media::Kind::Image), |v| v.child(Button::new(ElementId::Name(format!("wechat-image-{image_id}").into())).small().ghost().label(t("查看来源图片"))
                            .disabled(self.wechat_loading || self.wechat_save_busy || !self.wechat_media_supported(crate::wechat_media::Kind::Image)).on_click(cx.listener(move |this,_,_,cx|{this.read_wechat_image(image_id.clone(),cx);}))))
                        .when(media_kind.is_some_and(|k|k!=crate::wechat_media::Kind::Image), |v| {
                            let kind=media_kind.unwrap();
                            let label=match kind {crate::wechat_media::Kind::Voice=>"读取来源语音",crate::wechat_media::Kind::Video=>"读取来源视频",_=>"读取来源文件"};
                            v.child(Button::new(ElementId::Name(format!("wechat-media-{media_id}").into())).small().ghost().label(t(label))
                                .disabled(self.wechat_loading || self.wechat_save_busy || !self.wechat_media_supported(kind))
                                .on_click(cx.listener(move |this,_,_,cx|this.read_wechat_media(media_id.clone(),kind,cx))))
                                .when(!self.wechat_media_supported(kind), |v|v.child(note("当前微信来源不支持此类附件，请重新检测连接",cx)))
                        })
                        .child(Button::new(ElementId::Name(format!("wechat-exact-{message_id}").into())).small().ghost().label(t("精确读取全文"))
                            .disabled(self.wechat_loading || self.wechat_save_busy).on_click(cx.listener(move |this,_,_,cx| {this.read_wechat_exact(message_id.clone(),cx);})))
                        .child(
                            div()
                                .text_size(body_px(13., cx))
                                .line_height(relative(1.65))
                                .child(item["text"].as_str().unwrap_or("").to_string()),
                        ),
                );
            } else {
                let id = item["id"].as_str().unwrap_or("").to_string();
                let name = item["name"].as_str().unwrap_or("").to_string();
                let label = name.clone();
                list = list.child(
                    Button::new(ElementId::Name(format!("wechat-chat-{id}").into()))
                        .small()
                        .h(px(40.))
                        .ghost()
                        .accessibility_label(label.clone())
                        .child(div().w_full().text_size(px(13.)).child(label))
                        .disabled(self.wechat_loading || self.wechat_save_busy)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if !this.wechat_reader_active() || this.wechat_loading
                                || !this.wechat_page["items"].as_array().is_some_and(|items|
                                    items.iter().any(|item| item["id"].as_str() == Some(id.as_str()))) {
                                return;
                            }
                            if this.wechat_chat.as_ref().map(|c| c.0.as_str()) != Some(id.as_str()) {
                                this.invalidate_wechat_reader(true, true);
                            }
                            this.wechat_chat = Some((id.clone(), name.clone()));
                            this.read_wechat(String::new(), vec![String::new()], cx);
                        })),
                );
            }
        }
        if page["items"].as_array().is_some_and(|a| a.is_empty()) {
            list = list.child(note(if self.wechat_chat.is_some() {
                if self.wechat_applied_query.is_empty() { "暂无消息" } else { "未找到匹配的消息" }
            } else if !self.wechat_applied_query.is_empty() {
                if page["hasMore"] == true { "本批尚未找到匹配，继续搜索后续联系人" }
                else if page["queryComplete"] == true { "未找到匹配的联系人" }
                else { "当前可读范围内没有匹配" }
            } else { "暂无会话" }, cx));
        }
        if page["items"].is_null() {
            list = list.child(note("点击刷新读取本机记录", cx));
        }
        let cursors = if self.wechat_chat.is_some() {
            self.wechat_message_cursors.clone()
        } else {
            self.wechat_chat_cursors.clone()
        };
        let prior = cursors.clone();
        let next = page["nextCursor"].as_str().unwrap_or("").to_string();
        let has_more = page["hasMore"].as_bool() == Some(true) && !next.is_empty();
        list = list.child(
            h_flex()
                .gap_2()
                .child(
                    Button::new("wechat-previous-page")
                        .small()
                        .h(px(32.))
                        .outline()
                        .label(t("上一页"))
                        .disabled(self.wechat_loading || cursors.len() < 2)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            let mut history = prior.clone();
                            history.pop();
                            this.read_wechat(
                                history.last().cloned().unwrap_or_default(),
                                history,
                                cx,
                            );
                        })),
                )
                .child(
                    Button::new("wechat-next-page")
                        .small()
                        .h(px(32.))
                        .outline()
                        .label(t(if self.wechat_chat.is_none() && !self.wechat_applied_query.is_empty() { "继续搜索" } else { "下一页" }))
                        .disabled(self.wechat_loading || !has_more)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            let mut history = cursors.clone();
                            if history.is_empty() {
                                history.push(String::new());
                            }
                            history.push(next.clone());
                            this.read_wechat(next.clone(), history, cx);
                        })),
                ),
        );
        out.child(list)
    }
    fn provider_card(
        &self,
        provider: &str,
        title: &str,
        caption: &str,
        description: &str,
        cx: &mut Context<Self>,
    ) -> Div {
        let theme = cx.theme().clone();
        let conn = self.provider_connection(provider);
        let id = conn
            .and_then(|x| x["id"].as_str())
            .unwrap_or(if provider == "wechat-sync" {
                "wechat-sync-local"
            } else {
                provider
            })
            .to_string();
        let status = conn
            .and_then(|x| x["status"].as_str())
            .unwrap_or("not_connected");
        let connected = status == "connected";
        let account = conn
            .and_then(|c| {
                c["config"]["account"]
                    .as_str()
                    .or_else(|| c["config"]["workspace"].as_str())
                    .or_else(|| c["evidence"]["name"].as_str())
            })
            .unwrap_or(caption);
        let mut c = document_card(cx)
            .flex_1()
            .min_w(px(0.))
            .gap_3()
            .child(
                h_flex()
                    .gap(px(10.))
                    .mb(px(2.))
                    .child(
                        div()
                            .size(px(34.))
                            .rounded(px(9.))
                            .border_1()
                            .border_color(theme.border)
                            .bg(rgb(0xffffff))
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(img(provider_art(provider)).size(px(26.))),
                    )
                    .child(
                        div()
                            .flex_1()
                            .text_size(px(11.))
                            .text_color(theme.muted_foreground)
                            .child(t(account)),
                    )
                    .child(
                        div()
                            .text_size(px(11.))
                            .text_color(if connected {
                                rgb(0x478766).into()
                            } else {
                                theme.muted_foreground
                            })
                            .child(format!(
                                "{}{}",
                                if connected { "● " } else { "" },
                                t(status_label(status))
                            )),
                    ),
            )
            .child(
                div()
                    .text_size(px(13.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(t(title)),
            );
        if connected {
            let granted = conn
                .and_then(|c| c["permissions"].as_array())
                .cloned()
                .unwrap_or_default();
            let mut features = v_flex().gap_1();
            for (key, label) in [
                (
                    "read",
                    if provider == "wechat-sync" {
                        "查看个人微信会话与消息"
                    } else {
                        "已授予读取权限"
                    },
                ),
                ("draft", "已授予草稿权限"),
                ("send", "已授予发送权限，仍遵循自主规则"),
                ("auto", "已授予自动发送权限"),
            ] {
                if granted.iter().any(|x| x.as_str() == Some(key))
                    && (provider != "wechat-sync" || key == "read")
                {
                    features = features.child(note(&format!("✓ {}", t(label)), cx));
                }
            }
            if provider == "wechat-sync" {
                features = features.child(note("只读，不发送或自动回复", cx));
            }
            if granted.is_empty() {
                features = features.child(note("权限信息未提供", cx));
            }
            c = c.child(features);
        } else {
            c = c.child(note(description, cx));
        }
        let manage = id.clone();
        let probe = id.clone();
        let exists = conn.is_some();
        let is_wechat = provider == "wechat-sync";
        let provider_name = title.to_string();
        c.child(h_flex().gap_2().mt(px(3.)).child(Button::new(ElementId::Name(format!("manage-provider-{id}").into())).small().h(px(32.)).outline().label(t(if provider=="gmail"&&!connected{"设置 Gmail 连接"}else if provider=="wechat-sync"{"查看微信"}else{"自定义"})).on_click(cx.listener(move |this,_,_,cx|{this.detail=Some(if exists||is_wechat{manage.clone()}else{"new".into()});if !exists&&!is_wechat&&this.drafts.get("connection:new").is_none(){this.drafts["connection:new"]=json!({"name":provider_name,"type":"rest","endpoint":"","permissions":["read"],"config":{"authMethod":"none"}});this.persist();}this.delete_confirm=false;this.fields.clear();this.pending_fields=true;if is_wechat{this.wechat_chat=None;this.wechat_messages=json!({});if exists{this.read_wechat(String::new(),vec![String::new()],cx);}}cx.notify();}))).child(Button::new(ElementId::Name(format!("test-provider-{id}").into())).small().h(px(32.)).outline().label(t(if connected{"检测连接"}else{"连接"})).disabled(self.busy).on_click(cx.listener(move |this,_,_,cx|{if is_wechat{this.mutate("POST","/api/wechat/connect".into(),json!({}),cx);}else if exists{this.mutate("POST",format!("/api/connections/{probe}/test"),json!({}),cx);}else{this.detail=Some("new".into());this.fields.clear();this.pending_fields=true;cx.notify();}}))))
    }
    fn open_model_provider(&mut self, id: String, cx: &mut Context<Self>) {
        self.drop_connection_secret();
        self.detail = Some(id);
        let key = self.group_key();
        if self.drafts.get(&key).is_none() {
            let mut draft = self.base();
            draft["_version"] = self.models["version"].clone();
            self.drafts[key] = draft;
            self.persist();
        }
        self.model_add = false;
        self.fields.clear();
        self.pending_fields = true;
        self.error = None;
        self.notice = None;
        cx.notify();
    }
    fn save_model_provider(&mut self, add_model: bool, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        let key = self.group_key();
        let draft = self.draft();
        let mut definitions = draft["definitions"].as_array().cloned().unwrap_or_default();
        if add_model {
            let catalog = &draft["catalog"];
            let id = catalog["model"].as_str().unwrap_or("").trim();
            let smart = catalog["smart"].as_bool().unwrap_or(true);
            let number = |name: &str, default: u64| -> Option<u64> {
                let v = &catalog[name];
                if v.is_null() || v.as_str() == Some("") {
                    if smart { Some(default) } else { None }
                } else {
                    v.as_u64().or_else(|| v.as_str()?.parse().ok())
                }
            };
            let context = number("contextWindow", 200000);
            let max = number("maxTokens", 7000);
            if id.is_empty() || context.is_none() || max.is_none() {
                self.error = Some(t("请填写模型 ID 和有效 Token 数量"));
                cx.notify();
                return;
            }
            let model = json!({"id":id,"smart":catalog["smart"].as_bool().unwrap_or(true),"contextWindow":context,"maxTokens":max,"reasoning":catalog["reasoning"].as_bool().unwrap_or(false),"vision":catalog["vision"].as_bool().unwrap_or(true)});
            let original = catalog["originalId"].as_str();
            if definitions
                .iter()
                .any(|m| m["id"] == id && Some(id) != original)
            {
                self.error = Some(t("此模型 ID 已存在"));
                cx.notify();
                return;
            }
            if let Some(original) = original {
                definitions.retain(|m| m["id"] != original);
            }
            definitions.push(model);
        }
        let mut provider = json!({"id":draft["id"],"name":draft["name"],"baseUrl":draft["baseUrl"],"api":draft["api"],"enabled":draft["enabled"],"compatibility":draft["compatibility"].as_str().unwrap_or(""),"definitions":definitions});
        let secret = self.secret_value(cx);
        if !secret.is_empty() {
            provider["apiKey"] = json!(secret);
        }
        let submitted_secret = self
            .connection_secret
            .as_ref()
            .map(|(_, s)| (s.entity_id(), self.connection_secret_revision));
        let lease = draft
            .get("_version")
            .unwrap_or(&self.models["version"])
            .clone();
        let body = json!({"version":lease,"provider":provider});
        let client = self.client.clone();
        self.busy = true;
        self.error = None;
        self._tasks.push(cx.spawn(async move |this, cx| {
            let result = io(async move {
                client
                    .product_patch("/api/settings/models/providers", body)
                    .await
            })
            .await;
            _ = this.update(cx, |this, cx| {
                this.busy = false;
                match result {
                    Ok(saved) => {
                        this.models = saved;
                        let unchanged = this
                            .drafts
                            .get(&key)
                            .cloned()
                            .unwrap_or_else(|| draft.clone())
                            == draft;
                        let active = this.group_key() == key;
                        if unchanged {
                            if let Some(map) = this.drafts.as_object_mut() {
                                map.remove(&key);
                            }
                        } else {
                            this.drafts[&key]["definitions"] = json!(definitions);
                            this.drafts[&key]["_version"] = this.models["version"].clone();
                        }
                        if active
                            && this
                                .connection_secret
                                .as_ref()
                                .map(|(_, s)| (s.entity_id(), this.connection_secret_revision))
                                == submitted_secret
                        {
                            this.drop_connection_secret();
                        }
                        if active && unchanged {
                            this.model_add = false;
                            this.fields.clear();
                            this.pending_fields = true;
                        }
                        this.notice = Some(t(if unchanged {
                            "已保存"
                        } else {
                            "提交的版本已保存，当前修改仍未保存"
                        }));
                        this.persist();
                    }
                    Err(error) => {
                        this.error = Some(error.user_text());
                    }
                }
                cx.notify();
            });
        }));
        cx.notify();
    }
    fn render_model_provider(&self, cx: &mut Context<Self>) -> Div {
        let d = self.draft();
        let mut out = v_flex().gap_4().child(
            Button::new("model-provider-back").self_start()
                .h(px(32.))
                .small()
                .ghost()
                .icon(gpui_kit::assets::IconName::ChevronLeft)
                .label(t("模型"))
                .disabled(self.busy || self.model_add)
                .on_click(cx.listener(|this, _, _, cx| {
                    this.drop_connection_secret();
                    this.detail = None;
                    this.model_add = false;
                    this.fields.clear();
                    this.pending_fields = true;
                    cx.notify();
                })),
        );
        let mut c = card("供应商", cx)
            .gap_2()
            .bg(cx.theme().background)
            .child(self.row("启用", self.toggle("enabled", "启用", false, cx), cx))
            .child(div().text_size(px(12.)).child(t("供应商名称")))
            .child(self.field("name"))
            .child(div().text_size(px(12.)).child("Base URL"))
            .child(self.field("baseUrl"))
            .child(div().text_size(px(12.)).child(t("API 格式")))
            .child(self.choices(
                "api",
                &[
                    ("anthropic-messages", "Anthropic Messages (/v1/messages)"),
                    (
                        "openai-completions",
                        "OpenAI Chat Completions (/v1/chat/completions)",
                    ),
                    ("openai-responses", "OpenAI Responses (/v1/responses)"),
                ],
                false,
                self.model_add,
                cx,
            ))
            .child(div().text_size(px(12.)).child("API Key"));
        if let Some((_, state)) = &self.connection_secret {
            c = c.child(
                Input::new(state)
                    .text_size(px(13.))
                    .disabled(self.model_add),
            );
        }
        if d["configured"] == true {
            c = c.child(note("凭据已配置；留空保留，修改地址或协议后请重新输入", cx));
        }
        let compatibility = if d["api"] == "anthropic-messages" {
            vec![("", "标准协议"), ("claude-code", "Claude Code 网关兼容")]
        } else {
            vec![("", "标准协议")]
        };
        c = c.child(self.choices("compatibility", &compatibility, false, self.model_add, cx));
        out = out.child(c).child(
            h_flex().child(div().flex_1().child(t("模型列表"))).child(
                Button::new("add-model-catalog")
                    .small()
                    .outline()
                    .label(t("＋ 添加模型"))
                    .disabled(self.busy || self.model_add)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.model_add = true;
                        this.error = None;
                        this.notice = None;
                        let mut d = this.draft();
                        d["catalog"] = json!({"smart":true,"vision":true});
                        let key = this.group_key();
                        this.drafts[key] = d;
                        this.fields.clear();
                        this.pending_fields = true;
                        cx.notify();
                    })),
            ),
        );
        let definitions = d["definitions"].as_array().cloned().unwrap_or_default();
        if definitions.is_empty() {
            out = out.child(note("当前没有配置模型，添加模型后可在聊天中使用。", cx));
        }
        for m in definitions {
            let selected = m.clone();
            out = out.child(
                card(m["id"].as_str().unwrap_or(""), cx)
                    .child(note(
                        &format!(
                            "{}: {} · {}: {}",
                            t("上下文窗口"),
                            m["contextWindow"],
                            t("最大输出 Token"),
                            m["maxTokens"]
                        ),
                        cx,
                    ))
                    .child(
                        Button::new(ElementId::Name(
                            format!("edit-model-{}", m["id"].as_str().unwrap_or("")).into(),
                        ))
                        .small()
                        .ghost()
                        .label(t("编辑模型"))
                        .disabled(self.busy || self.model_add)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            let mut catalog = selected.clone();
                            catalog["model"] = selected["id"].clone();
                            catalog["originalId"] = selected["id"].clone();
                            this.change("catalog", catalog, cx);
                            this.error = None;
                            this.model_add = true;
                            this.fields.clear();
                            this.pending_fields = true;
                            cx.notify();
                        })),
                    ),
            );
        }
        out = out.child(
            Button::new("save-model-provider")
                .small()
                .primary()
                .label(t("保存供应商"))
                .disabled(self.busy || self.model_add)
                .on_click(cx.listener(|this, _, _, cx| this.save_model_provider(false, cx))),
        );
        out
    }
    fn close_model_editor(&mut self, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        let mut draft = self.draft();
        if let Some(map) = draft.as_object_mut() {
            map.remove("catalog");
        }
        let key = self.group_key();
        self.drafts[key] = draft;
        self.model_add = false;
        self.fields.retain(|key, _| !key.starts_with("catalog."));
        self.pending_fields = true;
        self.error = None;
        self.persist();
        cx.notify();
    }
    fn render_model_form(&self, cx: &mut Context<Self>) -> Div {
        let advanced = self.expanded.contains("model-advanced");
        let mut form = card("添加模型", cx)
            .relative()
            .gap_2()
            .bg(cx.theme().background)
            .child(
                div().absolute().top(px(12.)).right(px(12.)).child(
                    Button::new("close-model-dialog")
                        .small()
                        .ghost()
                        .label("×")
                        .disabled(self.busy)
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.close_model_editor(cx);
                        })),
                ),
            )
            .child(self.row(
                "智能配置",
                self.toggle("catalog.smart", "智能配置", false, cx),
                cx,
            ))
            .child(div().text_size(px(12.)).child(t("模型 ID")))
            .child(self.field("catalog.model"))
            .child(div().text_size(px(12.)).child(t("上下文窗口")))
            .child(self.field("catalog.contextWindow"))
            .child(div().text_size(px(12.)).child(t("最大输出 Token")))
            .child(self.field("catalog.maxTokens"))
            .child(note("智能配置使用兼容默认值；可按供应商实际限制调整。", cx))
            .child(
                Button::new("model-advanced")
                    .small()
                    .ghost()
                    .label(t("高级配置"))
                    .on_click(cx.listener(|this, _, _, cx| {
                        if !this.expanded.remove("model-advanced") {
                            this.expanded.insert("model-advanced".into());
                        }
                        cx.notify();
                    })),
            );
        if advanced {
            form = form
                .child(self.row(
                    "深度思考能力",
                    self.toggle("catalog.reasoning", "深度思考能力", false, cx),
                    cx,
                ))
                .child(self.row(
                    "图片输入",
                    self.toggle("catalog.vision", "图片输入", false, cx),
                    cx,
                ));
        }
        if let Some(error) = &self.error {
            form = form.child(
                div()
                    .text_size(px(12.))
                    .text_color(cx.theme().danger)
                    .child(t(error)),
            );
        }
        form = form.child(
            h_flex()
                .gap_2()
                .child(
                    Button::new("model-reset")
                        .small()
                        .ghost()
                        .label(t("重置表单"))
                        .on_click(cx.listener(|this, _, _, cx| {
                            let old = this.draft()["catalog"].clone();
                            let mut reset = json!({"smart":true,"vision":true});
                            if let Some(id) = old["originalId"].as_str() {
                                reset["originalId"] = json!(id);
                                reset["model"] = json!(id);
                            }
                            this.change("catalog", reset, cx);
                            this.fields.clear();
                            this.pending_fields = true;
                        })),
                )
                .child(div().flex_1())
                .child(
                    Button::new("cancel-add-model")
                        .small()
                        .ghost()
                        .label(t("取消"))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.close_model_editor(cx);
                        })),
                )
                .child(
                    Button::new("save-add-model")
                        .small()
                        .primary()
                        .label(t("保存"))
                        .disabled(self.busy)
                        .on_click(cx.listener(|this, _, _, cx| this.save_model_provider(true, cx))),
                ),
        );
        form
    }
    fn render_body(&self, cx: &mut Context<Self>) -> Div {
        let mut out = v_flex().gap_4();
        let theme = cx.theme().clone();
        let d = self.draft();
        if self.section == "connections" && self.detail.as_deref() == Some("request") {
            return out
                .child(
                    Button::new("request-back").self_start()
                        .small()
                        .h(px(32.))
                        .ghost()
                        .icon(gpui_kit::assets::IconName::ChevronLeft)
                        .label(t("返回连接"))
                        .disabled(self.busy)
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.detail = None;
                            this.fields.clear();
                            this.pending_fields = true;
                            cx.notify();
                        })),
                )
                .child(
                    card("申请其他应用", cx)
                        .child(note(
                            "告诉分身需要哪个应用以及用途。申请将保留在任务中直到处理完成。",
                            cx,
                        ))
                        .child(note("应用名称", cx))
                        .child(self.field("name"))
                        .child(note("希望用它完成什么？", cx))
                        .child(self.field("reason"))
                        .child(self.footer(cx)),
                );
        }
        match self.section.as_str() {
            "general" => {
                out = out
                    .child(card("语言", cx).child(self.language_cards(cx)))
                    .child(
                        card("外观", cx)
                            .child(self.row(
                                "显示模式",
                                self.choices(
                                    "appearance",
                                    &[("light", "浅色"), ("dark", "深色"), ("system", "跟随系统")],
                                    true,
                                    false,
                                    cx,
                                ),
                                cx,
                            ))
                            .child(self.row("正文大小", self.font_menu(cx), cx))
                            .child(self.row(
                                "减少动态效果",
                                self.toggle("reduced", "", true, cx),
                                cx,
                            )),
                    );
                let mut keys = card("快捷键", cx);
                for (label, key) in [
                    ("全局搜索", "⌘K"),
                    ("打开设置", "⌘,"),
                    ("对话", "⌘1"),
                    ("收件箱", "⌘2"),
                    ("灵感", "⌘3"),
                ] {
                    keys = keys.child(self.row(
                        label,
                        div().text_color(theme.muted_foreground).child(key),
                        cx,
                    ));
                }
                out = out
                    .child(keys)
                    .when(self.drafts.get(self.group_key()).is_some(), |v| {
                        v.child(self.footer(cx))
                    });
            }
            "models" => {
                if let Some(status) = &self.model_probe_status { out = out.child(note(status, cx)); }
                if self.detail.is_some() { return self.render_model_provider(cx); }
                if self.models["version"].is_null() {
                    out = out.child(
                        card("模型配置暂不可读取", cx)
                            .child(note("服务端渠道配置暂不可读取，请检查连接后重试。", cx)),
                    );
                } else {
                    let mut roles = h_flex().gap_4().items_start();
                    for (role, title) in [("standard", "当前模型")] {
                        let provider_path = format!("{role}.providerId");
                        let providers = self.models["providers"]
                            .as_array()
                            .cloned()
                            .unwrap_or_default();
                        let provider_choices: Vec<_> = providers
                            .iter()
                            .map(|p| {
                                (
                                    p["id"].as_str().unwrap_or(""),
                                    p["name"].as_str().unwrap_or(""),
                                )
                            })
                            .collect();
                        let p = d[role]["providerId"].as_str().unwrap_or("");
                        let info = providers.iter().find(|x| x["id"].as_str() == Some(p));
                        let mut c = card(title, cx)
                            .flex_1()
                            .child(div().text_size(px(11.)).child(t("服务渠道")))
                            .child(self.choices(
                                &provider_path,
                                &provider_choices,
                                false,
                                false,
                                cx,
                            ))
                            .child(div().text_size(px(11.)).child(t("模型")))
                            ;
                        let mut names = info
                            .and_then(|p| p["models"].as_array())
                            .cloned()
                            .unwrap_or_default();
                        names.extend(
                            self.local["modelCatalog"][p]
                                .as_array()
                                .cloned()
                                .unwrap_or_default(),
                        );
                        if let Some(current) = d[role]["model"].as_str() {
                            if !names.iter().any(|v| v.as_str() == Some(current)) {
                                names.push(json!(current));
                            }
                        }
                        let names: Vec<(String, String)> = names
                            .iter()
                            .filter_map(Value::as_str)
                            .map(|s| (s.to_string(), model_display_name(s)))
                            .collect();
                        let values: Vec<(&str, &str)> = names
                            .iter()
                            .map(|(v, l)| (v.as_str(), l.as_str()))
                            .collect();
                        if !values.is_empty() {
                            c = c.child(self.choices(
                                &format!("{role}.model"),
                                &values,
                                false,
                                false,
                                cx,
                            ));
                        }
                        if let Some(info) = info {
                            c = c.child(note(
                                if info["configured"].as_bool() == Some(true) {
                                    "凭据已配置"
                                } else {
                                    "渠道尚未配置"
                                },
                                cx,
                            ));
                            c = c.child(note(
                                &format!(
                                    "{} · {}",
                                    info["baseUrl"].as_str().unwrap_or(""),
                                    info["api"].as_str().unwrap_or("")
                                ),
                                cx,
                            ));
                        }
                        let r = role.to_string();
                        c = c.child(
                            Button::new(ElementId::Name(format!("model-test-{role}").into()))
                                .small()
                                .h(px(32.))
                                .outline()
                                .label(if self.model_probe["requestId"].is_string() { if self.model_probe_retry { t("重试原测试") } else { t("回查测试") } } else { t("测试连接") })
                                .disabled(self.busy)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    if !this.model_probe["requestId"].is_string() && this.draft()[&r] != this.models[&r] {
                                        this.error = Some(t("请先保存模型选择，再测试连接"));
                                        cx.notify();
                                        return;
                                    }
                                    this.test_model(&r, false, cx)
                                })),
                        );
                        roles = roles.child(c);
                    }
                    out = out.child(roles).child(self.footer(cx));
                    out=out.child(h_flex().child(div().flex_1().child(t("供应商"))).child(Button::new("add-model-provider").small().outline().label(t("＋ 新供应商")).on_click(cx.listener(|this,_,_,cx|this.open_model_provider(format!("provider-{}",opstwin_api::new_request_id()),cx)))));
                    for provider in self.models["providers"].as_array().cloned().unwrap_or_default() {
                        let id=provider["id"].as_str().unwrap_or("").to_string();
                        out=out.child(Button::new(ElementId::Name(format!("edit-provider-{id}").into())).small().h(px(44.)).outline().label(provider["name"].as_str().unwrap_or("").to_string()).on_click(cx.listener(move|this,_,_,cx|this.open_model_provider(id.clone(),cx))));
                    }
                }
            }
            "identity" => {
                let mut soul = document_card(cx).child(
                    h_flex()
                        .gap_2()
                        .child(
                            div()
                                .flex_1()
                                .text_size(px(13.))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child("soul.md"),
                        )
                        .child(
                            Button::new("identity-history")
                                .small()
                                .h(px(32.))
                                .ghost()
                                .label(t("历史"))
                                .on_click(
                                    cx.listener(|this, _, _, cx| this.history("identity", cx)),
                                ),
                        )
                        .child(
                            Button::new("edit-identity")
                                .small()
                                .h(px(32.))
                                .outline()
                                .label(t(if self.identity_edit {
                                    "阅读"
                                } else {
                                    "编辑"
                                }))
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.identity_edit = !this.identity_edit;
                                    cx.notify();
                                })),
                        ),
                );
                soul = soul.child(
                    Button::new("soul-details")
                        .small()
                        .h(px(32.))
                        .ghost()
                        .accessibility_label(t("详情"))
                        .child(div().w_full().child(format!(
                            "{} {}",
                            if self.soul_details { "⌄" } else { "›" },
                            t("详情")
                        )))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.soul_details = !this.soul_details;
                            cx.notify();
                        })),
                );
                if self.soul_details {
                    soul = soul.child(note("个性、表达与规则，由你撰写。", cx));
                }
                if self.identity_edit {
                    for (path, label) in [
                        ("name", "姓名"),
                        ("role", "角色"),
                        ("about", "关于你"),
                        ("instructions", "指令（Markdown）"),
                    ] {
                        soul = soul
                            .child(
                                div()
                                    .text_size(px(11.))
                                    .text_color(theme.muted_foreground)
                                    .child(t(label)),
                            )
                            .child(self.field(path));
                    }
                    soul = soul.child(self.footer(cx));
                } else {
                    let content = format!(
                        "# Soul\n\n## Who I am\nI’m the work twin of {}.\n{}\n{}\n\n## How I work\n{}",
                        d["name"].as_str().unwrap_or("Steve"),
                        d["role"].as_str().unwrap_or(""),
                        d["about"].as_str().unwrap_or(""),
                        d["instructions"]
                            .as_str()
                            .unwrap_or("Ask before sending messages or making commitments.")
                    );
                    soul = soul
                        .child(
                            div()
                                .py_3()
                                .text_size(body_px(12., cx))
                                .line_height(px(22.8))
                                .font_family("SFMono-Regular")
                                .child(content),
                        )
                        .child(note(
                            if self.drafts.get("identity").is_some() {
                                "当前显示未保存的预览草稿"
                            } else {
                                "保存的身份资料用于新的草稿和对话。"
                            },
                            cx,
                        ));
                }
                out = out.child(soul);
                let mut memory = document_card(cx).child(
                    h_flex()
                        .gap_2()
                        .child(
                            div()
                                .flex_1()
                                .text_size(px(13.))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child("memory.md"),
                        )
                        .child(
                            Button::new("memory-history")
                                .small()
                                .h(px(32.))
                                .ghost()
                                .label(t("历史"))
                                .on_click(cx.listener(|this, _, _, cx| this.history("memory", cx))),
                        )
                        .child(
                            Button::new("edit-memory-document")
                                .small()
                                .h(px(32.))
                                .outline()
                                .label(t(if self.memory_manage {
                                    "阅读"
                                } else {
                                    "编辑"
                                }))
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.memory_manage = !this.memory_manage;
                                    cx.notify();
                                })),
                        ),
                );
                memory = memory.child(
                    Button::new("memory-details")
                        .small()
                        .h(px(32.))
                        .ghost()
                        .accessibility_label(t("详情"))
                        .child(div().w_full().child(format!(
                            "{} {}",
                            if self.memory_details { "⌄" } else { "›" },
                            t("详情")
                        )))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.memory_details = !this.memory_details;
                            cx.notify();
                        })),
                );
                if self.memory_details {
                    memory =
                        memory.child(note("保存的知识与沟通偏好，可按分类阅读、编辑或移除。", cx));
                }
                if self.memory_manage {
                    memory = memory.child(
                        Button::new("memory-snapshot")
                            .small()
                            .h(px(32.))
                            .ghost()
                            .label(t("保存快照"))
                            .disabled(self.busy)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.mutate("POST", "/api/memories/snapshot".into(), json!({}), cx)
                            })),
                    );
                    memory = memory.child(
                        Button::new("add-memory")
                            .small()
                            .h(px(32.))
                            .outline()
                            .label(t("添加记忆"))
                            .on_click(cx.listener(|this, _, _, cx| this.open_memory("new", cx))),
                    );
                    if self.memory_edit.is_some() {
                        if self.memory_edit.as_deref() != Some("new")
                            && self.memory_edit.as_ref().is_some_and(|id| {
                                self.drafts[format!("memory:{id}")]["fullRead"].as_bool()
                                    != Some(true)
                            })
                        {
                            memory = memory
                                .child(note(
                                    "旧草稿未经全文校验，保存已禁用。可保留草稿，或重新读取全文。",
                                    cx,
                                ))
                                .child(
                                    Button::new("memory-reload-full")
                                        .small()
                                        .h(px(32.))
                                        .outline()
                                        .label(t("重新读取全文（丢弃旧草稿）"))
                                        .disabled(self.busy)
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            if let Some(id) = this.memory_edit.clone() {
                                                this.drafts
                                                    .as_object_mut()
                                                    .map(|a| a.remove(&format!("memory:{id}")));
                                                this.open_memory(&id, cx);
                                                this.persist();
                                            }
                                        })),
                                );
                        }
                        memory = memory
                            .child(self.field("memory.category"))
                            .child(self.field("memory.content"))
                            .child(
                                h_flex()
                                    .gap_2()
                                    .child(
                                        Button::new("cancel-memory")
                                            .small()
                                            .h(px(32.))
                                            .ghost()
                                            .label(t("取消"))
                                            .disabled(self.busy)
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.memory_edit = None;
                                                cx.notify();
                                            })),
                                    )
                                    .child(
                                        Button::new("save-memory")
                                            .small()
                                            .h(px(32.))
                                            .primary()
                                            .label(t("保存"))
                                            .disabled(self.busy)
                                            .on_click(
                                                cx.listener(|this, _, _, cx| this.save_memory(cx)),
                                            ),
                                    ),
                            );
                    }
                }
                let mut count = 0;
                for m in self.data["memories"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|m| m["deleted"].as_bool() != Some(true))
                {
                    count += 1;
                    let id = m["id"].as_str().unwrap_or("").to_string();
                    let edit_id = id.clone();
                    let text = m["content"]
                        .as_str()
                        .or_else(|| m["body"].as_str())
                        .or_else(|| m["title"].as_str())
                        .unwrap_or("");
                    let text = if m["_nativeFull"].as_bool() == Some(true) {
                        text.to_string()
                    } else {
                        t("记忆全文尚未读取，已阻止编辑；请重新读取后重试")
                    };
                    memory = memory.child(
                        v_flex()
                            .gap_2()
                            .py_3()
                            .border_b_1()
                            .border_color(theme.border)
                            .child(note(m["category"].as_str().unwrap_or("Learned"), cx))
                            .child(
                                crate::util::markdown(
                                    ElementId::Name(format!("memory-{id}").into()),
                                    text.to_string(),
                                )
                                .selectable(true)
                                .text_size(body_px(12., cx)),
                            )
                            .when(self.memory_manage, |v| {
                                v.child(
                                    Button::new(ElementId::Name(
                                        format!("memory-edit-{id}").into(),
                                    ))
                                    .small()
                                    .h(px(32.))
                                    .ghost()
                                    .label(t("编辑"))
                                    .on_click(cx.listener(
                                        move |this, _, _, cx| this.open_memory(&edit_id, cx),
                                    )),
                                )
                                .child(
                                    Button::new(ElementId::Name(
                                        format!("memory-delete-{id}").into(),
                                    ))
                                    .small()
                                    .h(px(32.))
                                    .ghost()
                                    .label(t("移除"))
                                    .disabled(self.busy)
                                    .on_click(cx.listener(
                                        move |this, _, _, cx| {
                                            this.mutate(
                                                "DELETE",
                                                format!("/api/memories/{id}"),
                                                json!({}),
                                                cx,
                                            )
                                        },
                                    )),
                                )
                            }),
                    );
                }
                if count == 0 && !self.memory_manage {
                    memory = memory.child(note("还没有保存的记忆，点击编辑可添加知识。", cx));
                }
                memory = memory.child(note(&format!("{count} {}", t("条已保存记忆")), cx));
                out = out.child(memory);
            }
            "autonomy" => {
                out = out.child(
                    self.explained_card("暂停所有发送", "分身继续读取和起草，关闭前不会发送。", cx)
                        .child(
                            self.row(
                                "暂停所有发送",
                                self.toggle("holdSending", "", false, cx),
                                cx,
                            )
                            .border_b_0(),
                        ),
                );
                let mut levels =
                    self.explained_card("消息处理等级", "新类型从草稿开始，信任后可提高等级。", cx);
                for (key, label, sub, locked) in [
                    ("ack", "确认收到", "“收到了”、“谢谢”、“正在看”", false),
                    ("meet", "会议时间确认", "确认日历上已有的会议时间", false),
                    (
                        "docs",
                        "文档已有答案的问题",
                        "根据你自己的笔记与文件作答",
                        false,
                    ),
                    ("commit", "日期、数字或承诺", "任何承诺都需要你审批", true),
                    ("boss", "主管与公司外部人员", "始终先取得你的审批", true),
                    (
                        "sensitive",
                        "冲突、人事、法律与金钱",
                        "分身标记这些消息，不会自动回复",
                        true,
                    ),
                ] {
                    let level = if key == "sensitive" {
                        "observe"
                    } else if locked {
                        "draft"
                    } else {
                        normalize_level(&d["levels"][key])
                    };
                    let effect = match level {
                        "observe" => "只读取并摘要，不撰写回复。",
                        "send_undo" => "等待 2 分钟后发送，期间可以撤销。",
                        "autonomous" => "立即发送，并记录在 Activity 中。",
                        _ => "起草回复，等待你审批。",
                    };
                    let description = format!(
                        "{}{} · {}",
                        t(sub),
                        if locked {
                            format!(" · {}", t("已锁定"))
                        } else {
                            String::new()
                        },
                        t(effect)
                    );
                    levels = levels.child(
                        self.row_detail(
                            label,
                            &description,
                            self.choices(
                                &format!("levels.{key}"),
                                &[
                                    ("observe", "观察"),
                                    ("draft", "草稿"),
                                    ("send_undo", "可撤销发送"),
                                    ("autonomous", "自主发送"),
                                ],
                                false,
                                locked,
                                cx,
                            ),
                            cx,
                        )
                        .when(key == "sensitive", |row| row.border_b_0()),
                    );
                }
                out = out.child(levels);
                let mut deep = self.explained_card(
                    "主动深度思考",
                    "为这些对象起草回复前，分身会主动深度思考。",
                    cx,
                );
                for (key, label) in [
                    ("vip", "VIP"),
                    ("customers", "客户"),
                    ("manager", "你的主管"),
                    ("stakes", "涉及金钱或截止日期的任何人"),
                    ("everyone", "所有人"),
                ] {
                    let checked = d["deepThink"]
                        .as_array()
                        .is_some_and(|a| a.iter().any(|v| v.as_str() == Some(key)));
                    let k = key.to_string();
                    deep = deep.child(
                        div()
                            .min_h(px(36.))
                            .py(px(7.))
                            .border_b_1()
                            .border_color(theme.border)
                            .when(key == "everyone", |row| row.border_b_0())
                            .child(
                                Checkbox::new(ElementId::Name(format!("deep-{key}").into()))
                                    .checked(checked)
                                    .label(t(label))
                                    .on_click(cx.listener(move |this, value: &bool, _, cx| {
                                        let mut a = this.draft()["deepThink"]
                                            .as_array()
                                            .cloned()
                                            .unwrap_or_default();
                                        a.retain(|v| v.as_str() != Some(k.as_str()));
                                        if *value {
                                            a.push(json!(k));
                                        }
                                        this.change("deepThink", json!(a), cx);
                                    })),
                            ),
                    );
                }
                out = out
                    .child(deep)
                    .child(
                        self.explained_card("安静时间", "非紧急通知延后到安静时间结束。", cx)
                            .child(self.row("开始", self.field("quietFrom"), cx))
                            .child(self.row("结束", self.field("quietUntil"), cx)),
                    )
                    .child(card("通知时机", cx).child(self.choices(
                        "alerts",
                        &[
                            ("urgent_digest", "紧急事项立即，其他每日汇总"),
                            ("every", "每条需要我的消息"),
                            ("digest", "仅汇总，不推送"),
                        ],
                        false,
                        false,
                        cx,
                    )))
                    .child(card("透明度", cx).child(self.row_detail(
                        "标注分身自主发送的消息",
                        "某些工作场所要求公开说明，默认开启。",
                        self.toggle("transparency", "", false, cx),
                        cx,
                    )))
                    .child(self.footer(cx));
            }
            "connections" => {
                if let Some(id) = &self.detail {
                    if id == "wechat-sync-local" {
                        return self.wechat_view(cx);
                    }
                    out = out.child(
                        Button::new("connection-back").self_start()
                            .small()
                            .h(px(32.))
                            .ghost()
                            .icon(gpui_kit::assets::IconName::ChevronLeft)
                            .label(t("连接"))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.detail = None;
                                this.delete_confirm = false;
                                this.fields.clear();
                                this.pending_fields = true;
                                cx.notify();
                            })),
                    );
                    let status = d["status"].as_str().unwrap_or("not_connected");
                    out = out.child(note(status_label(status), cx));
                    let custom = self.is_custom_connection(&d);
                    if custom {
                        let saved = self.base();
                        if id != "new"
                            && (d["type"] != saved["type"]
                                || d["endpoint"] != saved["endpoint"]
                                || d["config"]["authMethod"] != saved["config"]["authMethod"])
                        {
                            out = out.child(note(
                                "连接状态属于已保存配置；当前修改仍需保存并检测。",
                                cx,
                            ));
                        }
                        out = out.child(
                            card("连接方式", cx)
                                .child(self.row(
                                    "连接方式",
                                    self.choices(
                                        "type",
                                        &[
                                            ("mcp", "MCP 服务器"),
                                            ("rest", "REST API"),
                                            ("webhook", "Webhook"),
                                            ("skill", "Skill"),
                                        ],
                                        false,
                                        false,
                                        cx,
                                    ),
                                    cx,
                                ))
                                .child(self.row(
                                    "认证",
                                    self.choices(
                                        "config.authMethod",
                                        &[
                                            ("none", "无需认证"),
                                            ("oauth", "OAuth"),
                                            ("api-key", "API Key"),
                                        ],
                                        false,
                                        false,
                                        cx,
                                    ),
                                    cx,
                                )),
                        );
                        if d["type"]
                            .as_str()
                            .is_some_and(|v| v.eq_ignore_ascii_case("webhook"))
                        {
                            out = out.child(note(
                                "Webhook 尚无可验证适配器；保存配置不代表已连接。",
                                cx,
                            ));
                        }
                        if d["config"]["authMethod"] == "oauth" {
                            out = out.child(note(
                                "自定义 OAuth 尚无授权适配器；选择 OAuth 不代表已授权。",
                                cx,
                            ));
                        } else if d["config"]["authMethod"] == "api-key" {
                            if let Some((_, state)) = &self.connection_secret {
                                out =
                                    out.child(card("API Key", cx).child(Input::new(state).small()));
                            }
                            out = out.child(note(if d["config"]["credentialReady"] == true {
                                "服务端已有此连接的密钥。留空复用，输入新密钥后保存并检测；密钥不写入本机草稿。"
                            } else {
                                "请输入密钥后保存并检测。输入仅保留在内存，切换页面或退出会清除。"
                            }, cx));
                        }
                    }
                    let endpoint_label = if d["type"]
                        .as_str()
                        .is_some_and(|v| v.eq_ignore_ascii_case("skill"))
                    {
                        "Skill 路径"
                    } else if custom {
                        "服务器 URL"
                    } else {
                        "服务器或桥接 URL"
                    };
                    for (path, label) in [("name", "应用名称"), ("endpoint", endpoint_label)] {
                        out = out.child(card(label, cx).child(self.field(path)));
                    }
                    out = out.child(self.connection_collections(cx));
                    let mut perms = card("分身可以做什么", cx);
                    for (key, label) in [
                        ("read", "读取消息"),
                        ("draft", "起草回复"),
                        ("send", "发送回复"),
                        ("react", "添加表情回复"),
                        ("unmentioned", "未被提及的频道发言"),
                    ] {
                        let k = key.to_string();
                        let checked = d["permissions"]
                            .as_array()
                            .is_some_and(|a| a.iter().any(|v| v.as_str() == Some(key)));
                        perms = perms.child(
                            Checkbox::new(ElementId::Name(format!("permission-{key}").into()))
                                .checked(checked)
                                .label(t(label))
                                .disabled(id == "wechat-sync-local" && key != "read")
                                .on_click(cx.listener(move |this, value: &bool, _, cx| {
                                    let mut a = this.draft()["permissions"]
                                        .as_array()
                                        .cloned()
                                        .unwrap_or_default();
                                    a.retain(|v| v.as_str() != Some(k.as_str()));
                                    if *value {
                                        a.push(json!(k));
                                        if !a.iter().any(|v| v == "read") {
                                            a.push(json!("read"));
                                        }
                                    } else if k == "read" {
                                        a.clear();
                                    }
                                    this.change("permissions", json!(a), cx);
                                })),
                        );
                    }
                    out = out
                        .child(perms)
                        .child(
                            card("工作时间", cx)
                                .child(self.row(
                                    "仅在工作时间行动",
                                    self.toggle("config.workingHoursOnly", "", false, cx),
                                    cx,
                                ))
                                .child(self.row("开始", self.field("config.workFrom"), cx))
                                .child(self.row("结束", self.field("config.workUntil"), cx))
                                .child(self.row("时区", self.field("config.timezone"), cx)),
                        )
                        .child(card("连接与同步规则", cx).child(self.row(
                            "消息过滤",
                            self.field("config.filter"),
                            cx,
                        )))
                        .child(self.footer(cx));
                    if id == "new" {
                        if let Some(created) = d["createId"].as_str() {
                            let created = created.to_string();
                            out = out
                                .child(
                                    Button::new("recover-created-connection")
                                        .small()
                                        .h(px(32.))
                                        .outline()
                                        .label(t("读取原连接"))
                                        .disabled(self.busy)
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.recover_created_connection(created.clone(), cx);
                                        })),
                                )
                                .child(note("原结果未知时先读取此连接；不会重复创建。", cx));
                        }
                    }
                    if id != "new" {
                        let test = id.clone();
                        let disconnect = id.clone();
                        out = out.child(
                            h_flex()
                                .gap_2()
                                .child(
                                    Button::new("connection-test")
                                        .small()
                                        .h(px(32.))
                                        .outline()
                                        .label(t("检测连接"))
                                        .disabled(self.busy)
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.test_saved_connection(test.clone(), cx)
                                        })),
                                )
                                .child(
                                    Button::new("connection-disconnect")
                                        .small()
                                        .h(px(32.))
                                        .ghost()
                                        .label(t("断开连接"))
                                        .disabled(self.busy || status == "disconnected")
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.mutate(
                                                "POST",
                                                format!("/api/connections/{disconnect}/disconnect"),
                                                json!({}),
                                                cx,
                                            )
                                        })),
                                ),
                        );
                        let recover = id.clone();
                        out = out.child(
                            Button::new("read-saved-connection")
                                .small()
                                .h(px(32.))
                                .ghost()
                                .label(t("读取原连接"))
                                .disabled(self.busy)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.recover_created_connection(recover.clone(), cx)
                                })),
                        );
                    }
                    if !matches!(
                        d["provider"].as_str(),
                        Some(
                            "feishu"
                                | "lark"
                                | "wechat-sync"
                                | "wechat"
                                | "gmail"
                                | "google-calendar"
                        )
                    ) && id != "new"
                    {
                        if self.delete_confirm {
                            out = out.child(
                                card("删除应用？", cx)
                                    .child(note("应用将从连接列表移除，外部服务数据保留。", cx))
                                    .child(
                                        h_flex()
                                            .gap_2()
                                            .child(
                                                Button::new("cancel-delete-app")
                                                    .small()
                                                    .h(px(32.))
                                                    .ghost()
                                                    .label(t("取消"))
                                                    .disabled(self.busy)
                                                    .on_click(cx.listener(|this, _, _, cx| {
                                                        this.delete_confirm = false;
                                                        cx.notify();
                                                    })),
                                            )
                                            .child(
                                                Button::new("confirm-delete-app")
                                                    .small()
                                                    .h(px(32.))
                                                    .danger()
                                                    .label(t("删除应用"))
                                                    .loading(self.busy)
                                                    .on_click(cx.listener(|this, _, _, cx| {
                                                        this.delete_connection(cx)
                                                    })),
                                            ),
                                    ),
                            );
                        } else {
                            out = out.child(
                                Button::new("delete-custom-app")
                                    .small()
                                    .h(px(32.))
                                    .ghost()
                                    .label(t("删除应用"))
                                    .disabled(self.busy)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.delete_confirm = true;
                                        cx.notify();
                                    })),
                            );
                        }
                    }
                    if id == "feishu-local" {
                        out = out.child(self.sync_card(cx));
                    }
                } else {
                    for pair in [
                        [
                            (
                                "gmail",
                                "Gmail",
                                "工作邮箱",
                                "通过已授权的邮件适配器接入。Google 账号一键授权尚未开放。",
                            ),
                            (
                                "google-calendar",
                                "Google 日历",
                                "工作日历",
                                "查看空闲时间，创建专注时段和提醒，准备会议简报。",
                            ),
                        ],
                        [
                            (
                                "feishu",
                                "飞书",
                                "兼容 Lark",
                                "一次连接接入消息、文档和日历，起草回复并维护文档。",
                            ),
                            (
                                "wechat-sync",
                                "个人微信",
                                "本机微信",
                                "按需读取这台 Mac 上的个人微信会话与消息。",
                            ),
                        ],
                    ] {
                        let mut row = h_flex().gap_4().items_stretch();
                        for (provider, title, caption, desc) in pair {
                            row = row.child(self.provider_card(provider, title, caption, desc, cx));
                        }
                        out = out.child(row);
                    }
                    out = out.child(
                        Button::new("add-connection")
                            .small()
                            .h(px(32.))
                            .ghost()
                            .accessibility_label(t("添加自定义应用"))
                            .child(
                                div()
                                    .w_full()
                                    .text_size(px(12.))
                                    .child(format!("› {}", t("添加自定义应用"))),
                            )
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.detail = Some("new".into());
                                this.fields.clear();
                                this.pending_fields = true;
                                cx.notify();
                            })),
                    );
                    let mut custom = card("你的自定义应用", cx);
                    let mut custom_count = 0;
                    for conn in self.connections().into_iter().filter(|c| {
                        !["gmail", "google-calendar", "feishu", "wechat-sync"]
                            .iter()
                            .any(|p| connection_matches(c, p))
                            && !matches!(
                                c["id"].as_str(),
                                Some("feishu-local" | "wechat-sync-local")
                            )
                    }) {
                        let id = conn["id"].as_str().unwrap_or("").to_string();
                        custom_count += 1;
                        custom = custom.child(
                            self.row_raw(
                                &conn["name"]
                                    .as_str()
                                    .map(str::to_string)
                                    .unwrap_or_else(|| t("自定义应用")),
                                Button::new(ElementId::Name(format!("manage-{id}").into()))
                                    .small()
                                    .h(px(32.))
                                    .ghost()
                                    .label(t("管理"))
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.detail = Some(id.clone());
                                        this.delete_confirm = false;
                                        this.fields.clear();
                                        this.pending_fields = true;
                                        cx.notify();
                                    })),
                                cx,
                            ),
                        );
                    }
                    if custom_count == 0 {
                        custom = custom.child(note(
                            "尚无自定义应用。实际检测成功后，应用会出现在这里。",
                            cx,
                        ));
                    }
                    out = out.child(custom);
                    out = out.child(
                        h_flex()
                            .gap_2()
                            .child(
                                Button::new("request-other-app")
                                    .small()
                                    .h(px(32.))
                                    .outline()
                                    .label(t("申请其他应用"))
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.detail = Some("request".into());
                                        this.fields.clear();
                                        this.pending_fields = true;
                                        cx.notify();
                                    })),
                            )
                            .child(
                                Button::new("connection-activity")
                                    .small()
                                    .h(px(32.))
                                    .outline()
                                    .label(t("查看操作记录"))
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.history = Some((
                                            "activity".into(),
                                            this.data["activities"].clone(),
                                        ));
                                        cx.notify();
                                    })),
                            ),
                    );
                }
            }
            "channels" => {
                let status = self.binding["status"].as_str().unwrap_or("unbound");
                out = out.child(
                    self.explained_brand_card("飞书聊天渠道", "将 OpsTwins 绑定到飞书 PersonalAgent Bot。", Some("feishu"), cx)
                        .child(self.row(
                            "当前绑定状态",
                            div().text_size(px(12.)).child(t(status_label(status))),
                            cx,
                        ))
                        .child(note(
                            "扫码创建聊天机器人。Bot 消息收发尚未接入；读取与发送权限在「连接」中管理。",
                            cx,
                        ).line_height(relative(1.7)).my(px(8.)))
                        .child(
                            h_flex()
                                .gap_2()
                                .mt(px(7.))
                                .child(
                                    Button::new("bind-feishu")
                                        .small()
                                        .h(px(32.))
                                        .outline()
                                        .label(t(if status == "pending" {
                                            "继续绑定"
                                        } else {
                                            "绑定飞书"
                                        }))
                                        .disabled(self.busy || status == "bound")
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.mutate(
                                                "POST",
                                                "/api/feishu/binding".into(),
                                                json!({}),
                                                cx,
                                            )
                                        })),
                                )
                                .child(
                                    Button::new("manage-feishu-connection")
                                        .small().h(px(32.)).outline()
                                        .label(t("管理飞书连接"))
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            let id = this.provider_connection("feishu")
                                                .and_then(|c| c["id"].as_str())
                                                .unwrap_or("feishu-local").to_string();
                                            this.section("connections", cx);
                                            this.detail = Some(id);
                                            this.pending_fields = true;
                                            cx.notify();
                                        })),
                                )
                                .child(
                                    Button::new("poll-feishu")
                                        .small()
                                        .h(px(32.))
                                        .ghost()
                                        .label(t("检查授权"))
                                        .disabled(self.busy)
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.mutate(
                                                "POST",
                                                "/api/feishu/binding/poll".into(),
                                                json!({}),
                                                cx,
                                            )
                                        })),
                                ),
                        ),
                );
                for key in [
                    "url",
                    "verificationUriComplete",
                    "verificationUri",
                    "verification_uri_complete",
                    "verification_uri",
                ] {
                    if let Some(uri) = self.binding[key]
                        .as_str()
                        .filter(|uri| opstwin_api::product::valid_binding_url(uri))
                    {
                        let url = uri.to_string();
                        out = out.child(
                            Button::new(ElementId::Name(format!("binding-url-{key}").into()))
                                .small()
                                .h(px(32.))
                                .outline()
                                .label(t("打开飞书授权页"))
                                .on_click(move |_, _, cx| cx.open_url(&url)),
                        );
                        break;
                    }
                }
                if self.binding["status"] == "pending" {
                    if let Some((_, image)) = &self.qr {
                        out = out.child(img(image.clone()).size(px(220.)).rounded(px(8.)));
                    }
                    if let Some(expiry) = self.binding["expiresAt"].as_i64() {
                        out = out.child(note(
                            &format!(
                                "{} {}",
                                t("授权到期"),
                                chrono::DateTime::from_timestamp_millis(expiry)
                                    .map(|d| d
                                        .with_timezone(&chrono::Local)
                                        .format("%m-%d %H:%M")
                                        .to_string())
                                    .unwrap_or_default()
                            ),
                            cx,
                        ));
                    }
                }
                if let Some(message) = self.binding["message"].as_str() {
                    out = out.child(note_raw(message, cx));
                }
            }
            "filesystem" => {
                out = out.child(self.permission_card(&[("完整磁盘访问", "Privacy_AllFiles")], cx));
                let mut apps = card("应用权限", cx);
                for (name, icon) in [
                    ("Mail.app", "filesystem"),
                    ("Messages.app", "channels"),
                    ("Notes.app", "filesystem"),
                    ("WhatsApp.app", "channels"),
                ] {
                    apps = apps.child(
                        h_flex()
                            .min_h(px(52.))
                            .py_3()
                            .gap_3()
                            .border_b_1()
                            .border_color(theme.border)
                            .child(
                                div()
                                    .size(px(30.))
                                    .rounded(px(7.))
                                    .bg(theme.background)
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .child(
                                        img(setting_art(icon, theme.is_dark(), false))
                                            .size(px(18.)),
                                    ),
                            )
                            .child(div().flex_1().text_size(px(13.)).child(name))
                            .child(note("未检测", cx))
                            .child(
                                Switch::new(ElementId::Name(format!("app-{name}").into()))
                                    .checked(false)
                                    .disabled(true),
                            ),
                    );
                }
                out =
                    out.child(apps).child(
                        card("屏蔽文件夹", cx)
                            .when(
                                self.local["filesystem"]["blocked"]
                                    .as_array()
                                    .is_none_or(|a| a.is_empty()),
                                |c| c.child(note("暂无", cx)),
                            )
                            .children(
                                self.local["filesystem"]["blocked"]
                                    .as_array()
                                    .into_iter()
                                    .flatten()
                                    .enumerate()
                                    .map(|(index, path)| {
                                        let path = path.as_str().unwrap_or("").to_string();
                                        h_flex()
                                            .w_full()
                                            .min_w_0()
                                            .min_h(px(52.))
                                            .py_3()
                                            .gap_3()
                                            .border_b_1()
                                            .border_color(cx.theme().border)
                                            .child(
                                                div().flex_1().min_w_0().child(
                                                    div()
                                                        .w_full()
                                                        .min_w_0()
                                                        .whitespace_normal()
                                                        .text_size(px(13.))
                                                        .child(path.clone()),
                                                ),
                                            )
                                            .child(
                                                div().flex_shrink_0().child(
                                                    Button::new(ElementId::Name(
                                                        format!("blocked-{index}").into(),
                                                    ))
                                                    .small()
                                                    .h(px(32.))
                                                    .ghost()
                                                    .label(t("移除"))
                                                    .on_click(cx.listener(move |this, _, _, cx| {
                                                        let mut list =
                                                            this.local["filesystem"]["blocked"]
                                                                .as_array()
                                                                .cloned()
                                                                .unwrap_or_default();
                                                        list.retain(|v| {
                                                            v.as_str() != Some(path.as_str())
                                                        });
                                                        this.save_local(
                                                            "filesystem.blocked",
                                                            json!(list),
                                                            cx,
                                                        );
                                                    })),
                                                ),
                                            )
                                    }),
                            )
                            .child(
                                Button::new("block-folder")
                                    .small()
                                    .h(px(32.))
                                    .outline()
                                    .self_start()
                                    .label(t("添加文件夹"))
                                    .on_click(cx.listener(|this, _, _, cx| this.pick_blocked(cx))),
                            ),
                    );
            }
            "dictation" => {
                out = out
                    .child(self.permission_card(
                        &[
                            ("麦克风", "Privacy_Microphone"),
                            ("辅助功能", "Privacy_Accessibility"),
                        ],
                        cx,
                    ))
                    .child(card("输入", cx).child(self.row(
                        "输入设备",
                        div().text_size(px(13.)).child(t("系统默认")),
                        cx,
                    )))
                    .child(
                        card("听写时", cx)
                            .child(self.row(
                                "自动发送",
                                self.toggle("dictation.autoSend", "", true, cx),
                                cx,
                            ))
                            .child(self.row(
                                "提示音",
                                self.toggle("dictation.cues", "", true, cx),
                                cx,
                            )),
                    )
                    .child(
                        card("快捷键", cx)
                            .child(self.row(
                                "免手持模式（应用内）",
                                self.choices(
                                    "dictation.handsfree",
                                    &[("none", "未设置"), ("option-space", "Option + 空格")],
                                    true,
                                    false,
                                    cx,
                                ),
                                cx,
                            ))
                            .child(
                                self.row(
                                    "按住说话",
                                    Button::new("push-to-talk-unavailable")
                                        .small()
                                        .h(px(32.))
                                        .ghost()
                                        .label(t("未设置"))
                                        .disabled(true),
                                    cx,
                                ),
                            ),
                    );
            }
            "devices" => {
                out = out
                    .child(card("这台设备", cx).child(self.row(
                        "Mac",
                        div().text_size(px(12.)).child(t("本机客户端")),
                        cx,
                    )))
                    .child(card("其他设备", cx).child(note("暂无已连接设备", cx)));
            }
            "help" => {
                let mut help = card("帮助", cx);
                for (title, text) in [
                    (
                        "快捷键",
                        "⌘K 搜索\n⌘, 设置\n⌘1 对话\n⌘2 收件箱\n⌘3 灵感\nEscape 关闭搜索",
                    ),
                    (
                        "连接问题",
                        "打开「连接」查看当前状态，再进入应用详情检测连接",
                    ),
                    ("权限问题", "打开对应的系统设置，检查 OpsTwins 的权限"),
                ] {
                    let key = format!("help-{title}");
                    let toggle = key.clone();
                    help = help.child(
                        self.row(
                            title,
                            Button::new(ElementId::Name(key.clone().into()))
                                .small()
                                .h(px(32.))
                                .outline()
                                .label(t(if self.expanded.contains(&key) {
                                    "收起"
                                } else {
                                    "查看"
                                }))
                                .on_click(
                                    cx.listener(move |this, _, _, cx| this.flip(&toggle, cx)),
                                ),
                            cx,
                        ),
                    );
                    if self.expanded.contains(&key) {
                        help = help.child(div().py_3().text_size(body_px(13., cx)).child(t(text)));
                    }
                }
                out = out.child(help);
            }
            "legal" => {
                out = out
                    .child(
                        card("隐私", cx)
                            .child(self.row_detail(
                                "文件访问",
                                "屏蔽的文件夹不得用于读取或 AI 处理",
                                note("已接入本机读取策略", cx),
                                cx,
                            ))
                            .child(self.row(
                                "凭据",
                                div().text_size(px(12.)).child(t("仅保留在服务端")),
                                cx,
                            ))
                            .child(self.row(
                                "外部发送",
                                div().text_size(px(12.)).child(t("遵循自主权限与审批规则")),
                                cx,
                            )),
                    )
                    .child(card("服务条款", cx).child(note("尚未提供", cx)));
            }
            "about" => {
                out =
                    out.child(
                        card("OpsTwins", cx)
                            .child(self.row("版本", div().child(env!("CARGO_PKG_VERSION")), cx))
                            .child(self.row(
                                "工作区版本",
                                div().child(format!(
                                    "r{}",
                                    self.data["revision"].as_u64().unwrap_or(0)
                                )),
                                cx,
                            ))
                            .child(self.row("客户端", div().child("macOS · GPUI"), cx)),
                    );
            }
            _ => {}
        }
        if let Some((kind, history)) = &self.history {
            let mut box_ = card(
                if kind == "activity" {
                    "操作记录"
                } else if kind == "memory" {
                    "记忆历史"
                } else {
                    "身份历史"
                },
                cx,
            )
            .child(
                Button::new("history-close")
                    .small()
                    .h(px(32.))
                    .ghost()
                    .label(t("关闭历史"))
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.history = None;
                        cx.notify();
                    })),
            );
            let rows = history.as_array().or_else(|| history["history"].as_array());
            for row in rows.into_iter().flatten() {
                if kind == "activity" {
                    box_ = box_.child(
                        v_flex()
                            .gap_1()
                            .py_2()
                            .border_b_1()
                            .border_color(theme.border)
                            .child(note(row["createdAt"].as_str().unwrap_or(""), cx))
                            .child(
                                div().text_size(px(12.)).child(
                                    row["summary"]
                                        .as_str()
                                        .or_else(|| row["title"].as_str())
                                        .or_else(|| row["action"].as_str())
                                        .unwrap_or("")
                                        .to_string(),
                                ),
                            )
                            .child(note(row["status"].as_str().unwrap_or(""), cx)),
                    );
                    continue;
                }
                let id = row["id"].as_str().unwrap_or("").to_string();
                let memory = kind == "memory";
                let identity = row["identity"]
                    .as_object()
                    .map(|_| row["identity"].clone())
                    .or_else(|| {
                        ["settings", "snapshot", "value", "before", "data"]
                            .iter()
                            .find_map(|key| {
                                row[*key]["identity"]
                                    .as_object()
                                    .map(|_| row[*key]["identity"].clone())
                            })
                    })
                    .unwrap_or(Value::Null);
                box_ = box_.child(
                    self.row_raw(
                        row["createdAt"].as_str().unwrap_or("历史版本"),
                        Button::new(ElementId::Name(format!("restore-history-{id}").into()))
                            .small()
                            .h(px(32.))
                            .outline()
                            .label(t("恢复"))
                            .disabled(self.busy)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if memory {
                                    this.mutate(
                                        "POST",
                                        format!("/api/memories/history/{id}/restore"),
                                        json!({}),
                                        cx,
                                    )
                                } else {
                                    if !identity.is_null() {
                                        this.mutate(
                                            "PATCH",
                                            "/api/settings".into(),
                                            json!({"identity":identity}),
                                            cx,
                                        )
                                    } else {
                                        this.error = Some(t("该版本不包含身份资料"));
                                        cx.notify();
                                    }
                                }
                            })),
                        cx,
                    ),
                );
            }
            out = out.child(box_);
        }
        out
    }
    fn pick_blocked(&mut self, cx: &mut Context<Self>) {
        let rx = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: true,
            prompt: Some("屏蔽文件夹".into()),
        });
        let task = cx.spawn(async move |this, cx| match rx.await {
            Ok(Ok(Some(paths))) => {
                _ = this.update(cx, |this, cx| {
                    let mut list = this.local["filesystem"]["blocked"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default();
                    for path in paths {
                        let path = path.to_string_lossy().to_string();
                        if !list.iter().any(|v| v.as_str() == Some(path.as_str())) {
                            list.push(json!(path));
                        }
                    }
                    this.save_local("filesystem.blocked", json!(list), cx);
                });
            }
            Ok(Ok(None)) => {}
            _ => {
                _ = this.update(cx, |this, cx| {
                    this.error = Some("无法打开文件夹选择器".into());
                    cx.notify();
                });
            }
        });
        self._tasks.push(task);
    }
    fn add_connection_value(&mut self, kind: &str, window: &mut Window, cx: &mut Context<Self>) {
        let d = self.draft();
        let input = match kind {
            "scope" => "add.scopeName",
            "person" => "add.personName",
            _ => "add.urgentWord",
        };
        let text = at(&d, input).as_str().unwrap_or("").trim().to_string();
        if text.is_empty() {
            self.error = Some(t("请输入名称或关键词"));
            cx.notify();
            return;
        }
        let path = match kind {
            "scope" => "config.scopes",
            "person" => "config.importantPeople",
            _ => "config.urgentWords",
        };
        let mut a = at(&d, path).as_array().cloned().unwrap_or_default();
        if kind == "scope" {
            if a.iter().any(|v| v["name"].as_str() == Some(text.as_str())) {
                self.error = Some(t("已添加"));
                cx.notify();
                return;
            }
            a.push(json!({"id":opstwin_api::new_request_id(),"name":text,"mode":"draft","enabled":true}));
        } else if kind == "person" {
            let role = at(&d, "add.personRole")
                .as_str()
                .filter(|x| !x.is_empty())
                .unwrap_or("VIP");
            if a.iter().any(|v| v["name"].as_str() == Some(text.as_str())) {
                self.error = Some(t("已添加"));
                cx.notify();
                return;
            }
            a.push(json!({"name":text,"role":role}));
        } else {
            if a.iter().any(|v| v.as_str() == Some(text.as_str())) {
                self.error = Some(t("已添加"));
                cx.notify();
                return;
            }
            a.push(json!(text));
        }
        self.error = None;
        self.change(path, json!(a), cx);
        self.change(input, json!(""), cx);
        if let Some(Field::Line(field)) = self.fields.get(input).cloned() {
            field.update(cx, |state, cx| state.set_value("", window, cx));
        }
    }
    fn remove_connection_value(&mut self, path: &str, index: usize, cx: &mut Context<Self>) {
        let mut list = at(&self.draft(), path)
            .as_array()
            .cloned()
            .unwrap_or_default();
        if index < list.len() {
            list.remove(index);
        }
        self.change(path, json!(list), cx);
    }
    fn delete_connection(&mut self, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        let Some(id) = self.detail.clone() else {
            return;
        };
        if id == "new" {
            return;
        }
        let client = self.client.clone();
        self.busy = true;
        self.error = None;
        let task = cx.spawn(async move |this, cx| {
            let result = io(async move {
                client
                    .product_delete(&format!("/api/connections/{id}"))
                    .await
            })
            .await;
            _ = this.update(cx, |this, cx| {
                this.busy = false;
                match result {
                    Ok(_) => {
                        let key = this.group_key();
                        this.drafts.as_object_mut().map(|m| m.remove(&key));
                        this.persist();
                        this.detail = None;
                        this.delete_confirm = false;
                        this.fields.clear();
                        this.pending_fields = true;
                        this.reload(cx);
                    }
                    Err(e) => this.error = Some(e.user_text()),
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
        cx.notify();
    }
    fn connection_collections(&self, cx: &mut Context<Self>) -> Div {
        let d = self.draft();
        let mut out = v_flex().gap_4();
        let mut scopes = card("分身关注的频道", cx);
        for (index, scope) in d["config"]["scopes"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            let prefix = format!("config.scopes.{index}");
            scopes = scopes.child(
                self.row_raw(
                    scope["name"].as_str().unwrap_or("频道"),
                    h_flex()
                        .gap_2()
                        .child(self.choices(
                            &format!("{prefix}.mode"),
                            &[
                                ("draft", "起草回复"),
                                ("send_undo", "发送且可撤销"),
                                ("summary", "仅摘要"),
                                ("deep", "深度思考草稿"),
                            ],
                            false,
                            false,
                            cx,
                        ))
                        .child(self.toggle(&format!("{prefix}.enabled"), "", false, cx))
                        .child(
                            Button::new(ElementId::Name(format!("scope-remove-{index}").into()))
                                .small()
                                .h(px(32.))
                                .ghost()
                                .label(t("移除"))
                                .disabled(self.busy)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.remove_connection_value("config.scopes", index, cx)
                                })),
                        ),
                    cx,
                ),
            );
        }
        scopes = scopes.child(
            h_flex()
                .gap_2()
                .child(div().flex_1().child(self.field("add.scopeName")))
                .child(
                    Button::new("add-scope")
                        .small()
                        .h(px(32.))
                        .outline()
                        .label(t("添加频道或范围"))
                        .disabled(self.busy)
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.add_connection_value("scope", window, cx)
                        })),
                ),
        );
        out = out.child(scopes);
        let mut important = card("重要内容", cx).child(note("人员", cx));
        for (index, person) in d["config"]["importantPeople"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            important = important.child(
                self.row_raw(
                    &format!(
                        "{} · {}",
                        person["name"].as_str().unwrap_or(""),
                        person["role"].as_str().unwrap_or("")
                    ),
                    Button::new(ElementId::Name(format!("person-remove-{index}").into()))
                        .small()
                        .h(px(32.))
                        .ghost()
                        .label(t("移除"))
                        .disabled(self.busy)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.remove_connection_value("config.importantPeople", index, cx)
                        })),
                    cx,
                ),
            );
        }
        important = important
            .child(
                h_flex()
                    .gap_2()
                    .child(div().flex_1().child(self.field("add.personName")))
                    .child(self.choices(
                        "add.personRole",
                        &[
                            ("VIP", "VIP"),
                            ("Manager", "主管"),
                            ("Customer", "客户"),
                            ("Teammate", "同事"),
                        ],
                        false,
                        false,
                        cx,
                    ))
                    .child(
                        Button::new("add-person")
                            .small()
                            .h(px(32.))
                            .outline()
                            .label(t("添加人员"))
                            .disabled(self.busy)
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.add_connection_value("person", window, cx)
                            })),
                    ),
            )
            .child(note("表示紧急的关键词", cx));
        for (index, word) in d["config"]["urgentWords"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            important = important.child(
                self.row_raw(
                    word.as_str().unwrap_or(""),
                    Button::new(ElementId::Name(format!("word-remove-{index}").into()))
                        .small()
                        .h(px(32.))
                        .ghost()
                        .label(t("移除"))
                        .disabled(self.busy)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.remove_connection_value("config.urgentWords", index, cx)
                        })),
                    cx,
                ),
            );
        }
        important = important.child(
            h_flex()
                .gap_2()
                .child(div().flex_1().child(self.field("add.urgentWord")))
                .child(
                    Button::new("add-urgent-word")
                        .small()
                        .h(px(32.))
                        .outline()
                        .label(t("添加关键词"))
                        .disabled(self.busy)
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.add_connection_value("word", window, cx)
                        })),
                ),
        );
        out.child(important)
    }
    fn open_memory(&mut self, id: &str, cx: &mut Context<Self>) {
        if id != "new" {
            let full = self.data["memories"]
                .as_array()
                .and_then(|a| a.iter().find(|m| m["id"].as_str() == Some(id)))
                .is_some_and(|m| m["_nativeFull"].as_bool() == Some(true));
            if !full {
                self.error = Some(t("记忆全文尚未读取，已阻止编辑；请重新读取后重试"));
                self.reload(cx);
                cx.notify();
                return;
            }
        }
        let key = format!("memory:{id}");
        if self.drafts.get(&key).is_none() {
            let item = self.data["memories"]
                .as_array()
                .and_then(|a| a.iter().find(|v| v["id"].as_str() == Some(id)))
                .cloned()
                .unwrap_or(json!({"category":"Learned","content":""}));
            self.drafts[&key] = json!({"category":item["category"].as_str().unwrap_or("Learned"),"content":item["body"].as_str().filter(|s|!s.is_empty()).or_else(||item["content"].as_str()).unwrap_or(""),"baseUpdatedAt":item["updatedAt"],"fullRead":true});
        }
        self.memory_edit = Some(id.into());
        self.fields.remove("memory.category");
        self.fields.remove("memory.content");
        self.pending_fields = true;
        cx.notify();
    }
    fn save_memory(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.memory_edit.clone() else {
            return;
        };
        let key = format!("memory:{id}");
        let v = self.drafts[&key].clone();
        let content = v["content"].as_str().unwrap_or("").trim().to_string();
        if content.is_empty() {
            self.error = Some("记忆内容不能为空".into());
            cx.notify();
            return;
        }
        if self.busy {
            return;
        }
        if id != "new" && v["fullRead"] != true {
            self.error = Some(t(
                "旧草稿未经全文校验，保存已禁用。可保留草稿，或重新读取全文。",
            ));
            cx.notify();
            return;
        }
        let created_id = if id == "new" {
            Some(
                v["createId"]
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("memory-{}", opstwin_api::new_request_id())),
            )
        } else {
            None
        };
        if let Some(new_id) = &created_id {
            self.drafts[&key]["createId"] = json!(new_id);
        }
        let Some(saver) = self.saver.clone() else {
            self.error = Some(t("无法保存本机偏好"));
            cx.notify();
            return;
        };
        let snapshot = json!({"local":self.local,"drafts":self.drafts});
        let c = self.client.clone();
        let mut body = json!({"title":content.lines().next().unwrap_or("").chars().take(100).collect::<String>(),"body":content,"content":content,"category":v["category"],"baseUpdatedAt":v["baseUpdatedAt"]});
        self.busy = true;
        let task = cx.spawn(async move |this, cx| {
            if saver.save_now(snapshot).await.is_err() {
                _ = this.update(cx, |this, cx| {
                    this.busy = false;
                    this.error = Some(t("无法保存本机偏好"));
                    cx.notify();
                });
                return;
            }
            let r = io(async move {
                if let Some(new_id) = created_id {
                    match c.product_get(&format!("/api/memories/{new_id}")).await {
                        Ok(saved)
                            if saved["body"] == body["body"]
                                && saved["category"] == body["category"] =>
                        {
                            Ok(saved)
                        }
                        Ok(_) => Err(opstwin_api::ApiError::Decode(t(
                            "原请求已保存不同内容，请核对后继续",
                        ))),
                        Err(e) if e.status() == Some(404) => {
                            c.product_post("/api/memories/snapshot", json!({})).await?;
                            body["id"] = json!(new_id);
                            c.product_post("/api/memories", body).await
                        }
                        Err(e) => Err(e),
                    }
                } else {
                    let current = c.product_get(&format!("/api/memories/{id}")).await?;
                    if current["body"] == body["body"] && current["category"] == body["category"] {
                        return Ok(current);
                    }
                    c.product_post("/api/memories/snapshot", json!({})).await?;
                    c.product_patch(&format!("/api/memories/{id}"), body).await
                }
            })
            .await;
            _ = this.update(cx, |this, cx| {
                this.busy = false;
                match r {
                    Ok(_) => {
                        this.memory_edit = None;
                        this.drafts.as_object_mut().map(|m| m.remove(&key));
                        this.persist();
                        this.reload(cx);
                    }
                    Err(e) => this.error = Some(e.user_text()),
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
        cx.notify();
    }
    fn save_sync(&mut self, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        let mut v = self
            .drafts
            .get("feishuSync")
            .cloned()
            .unwrap_or_else(|| self.sync["settings"].clone());
        for key in [
            "chatIntervalMinutes",
            "analysisDelayMinutes",
            "meetingIntervalMinutes",
            "mailIntervalMinutes",
            "chatLimit",
            "messagesPerChat",
            "minutesLimit",
            "minutesMessageLimit",
            "mailLimit",
        ] {
            if let Some(text) = v[key].as_str() {
                match text.parse::<u64>() {
                    Ok(n) => v[key] = json!(n),
                    Err(_) => {
                        self.error = Some(format!("{key} 必须为非负整数"));
                        cx.notify();
                        return;
                    }
                }
            }
        }
        if let Some(fields) = v.as_object_mut() {
            fields.remove("updatedAt");
        }
        let c = self.client.clone();
        self.busy = true;
        let task = cx.spawn(async move |this, cx| {
            let r = io(async move { c.product_patch("/api/feishu/sync/settings", v).await }).await;
            _ = this.update(cx, |this, cx| {
                this.busy = false;
                match r {
                    Ok(_) => {
                        this.drafts.as_object_mut().map(|m| m.remove("feishuSync"));
                        this.persist();
                        this.reload(cx);
                    }
                    Err(e) => this.error = Some(e.user_text()),
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
        cx.notify();
    }
    fn permission_card(&self, items: &[(&str, &str)], cx: &mut Context<Self>) -> Div {
        let mut c = card("系统权限", cx);
        for (title, pane) in items {
            let url = format!("x-apple.systempreferences:com.apple.preference.security?{pane}");
            c = c.child(
                self.row(
                    title,
                    h_flex()
                        .gap_2()
                        .child(note(
                            permission_label(
                                self.permissions[match *pane {
                                    "Privacy_Microphone" => "microphone",
                                    "Privacy_Accessibility" => "accessibility",
                                    _ => "fullDisk",
                                }]
                                .as_str()
                                .unwrap_or("unknown"),
                            ),
                            cx,
                        ))
                        .child(
                            Button::new(ElementId::Name(format!("permission-pane-{pane}").into()))
                                .small()
                                .h(px(32.))
                                .outline()
                                .label(t("系统设置"))
                                .on_click(move |_, _, cx| cx.open_url(&url)),
                        ),
                    cx,
                ),
            );
        }
        c.child(
            Button::new("refresh-system-permissions")
                .small()
                .h(px(32.))
                .ghost()
                .label(t("刷新状态"))
                .on_click(cx.listener(|this, _, _, cx| this.reload(cx))),
        )
    }
    fn load_sync_page(&mut self, offset: usize, cx: &mut Context<Self>) {
        self.sync_generation += 1;
        let generation = self.sync_generation;
        self.sync_loading = true;
        let client = self.client.clone();
        let task = cx.spawn(async move |this, cx| {
            let result = io(async move {
                client
                    .product_get(&format!("/api/feishu/sync?offset={offset}"))
                    .await
            })
            .await;
            _ = this.update(cx, |this, cx| {
                if generation != this.sync_generation {
                    return;
                }
                this.sync_loading = false;
                match result {
                    Ok(page) => {
                        this.sync = page;
                        this.sync_offset = offset;
                    }
                    Err(e) => this.error = Some(e.user_text()),
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
        cx.notify();
    }
    fn load_records(&mut self, kind: String, offset: usize, cx: &mut Context<Self>) {
        self.records_generation += 1;
        let generation = self.records_generation;
        self.records_loading = true;
        let client = self.client.clone();
        let selected = kind.clone();
        let task = cx.spawn(async move |this, cx| {
            let result = io(async move {
                client
                    .product_get(&format!(
                        "/api/feishu/sync/records?kind={kind}&offset={offset}"
                    ))
                    .await
            })
            .await;
            _ = this.update(cx, |this, cx| {
                if generation != this.records_generation {
                    return;
                }
                this.records_loading = false;
                match result {
                    Ok(page) => {
                        this.sync_records = page;
                        this.record_kind = selected;
                        this.record_offset = offset;
                    }
                    Err(e) => this.error = Some(e.user_text()),
                }
                cx.notify();
            });
        });
        self._tasks.push(task);
        cx.notify();
    }
    fn flip(&mut self, key: &str, cx: &mut Context<Self>) {
        if !self.expanded.remove(key) {
            self.expanded.insert(key.into());
        }
        cx.notify();
    }
    fn sync_card(&self, cx: &mut Context<Self>) -> Div {
        let mut c = card("数据同步", cx);
        if self.sync.is_null() {
            return c.child(note("同步状态暂不可读取", cx));
        }
        let counts = self.sync["storage"]["counts"].as_object();
        if let Some(counts) = counts {
            let mut stats = h_flex().gap_6().flex_wrap();
            for (key, value) in counts {
                stats = stats.child(
                    v_flex()
                        .gap_1()
                        .child(div().text_size(px(21.)).child(value.to_string()))
                        .child(note(key, cx)),
                );
            }
            c = c.child(stats);
        }
        for (key, label) in [("chats", "聊天"), ("minutes", "会议纪要"), ("mail", "邮箱")] {
            let value = self.sync["nextRuns"][key]
                .as_str()
                .map(date_text)
                .unwrap_or_else(|| t("手动或已暂停"));
            c = c.child(self.row_detail(
                label,
                "下次同步",
                div().text_size(px(11.)).child(value),
                cx,
            ));
        }
        c = c.child(self.row(
            "同步范围",
            self.choices(
                "native.syncScope",
                &[
                    ("all", "全部数据"),
                    ("chats", "聊天"),
                    ("minutes", "会议纪要"),
                    ("mail", "邮箱"),
                ],
                false,
                self.busy,
                cx,
            ),
            cx,
        ));
        c = c
            .child(note(
                &format!(
                    "数据大小 {}",
                    crate::util::human_size(
                        self.sync["storage"]["totalBytes"].as_u64().unwrap_or(0)
                    )
                ),
                cx,
            ))
            .child(
                Button::new("sync-now")
                    .small()
                    .h(px(32.))
                    .outline()
                    .label(t(if self.sync["running"].as_bool() == Some(true) {
                        "正在同步…"
                    } else {
                        "立即同步"
                    }))
                    .disabled(self.busy || self.sync["running"].as_bool() == Some(true))
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.mutate(
                            "POST",
                            "/api/feishu/sync".into(),
                            json!({"scope":this.sync_scope}),
                            cx,
                        )
                    })),
            );
        c = c.child(
            Button::new("sync-configuration-toggle")
                .small()
                .h(px(32.))
                .ghost()
                .label(format!(
                    "{} {}",
                    if self.expanded.contains("sync-configuration") {
                        "⌄"
                    } else {
                        "›"
                    },
                    t("同步时间与采集设置")
                ))
                .on_click(cx.listener(|this, _, _, cx| this.flip("sync-configuration", cx))),
        );
        if self.expanded.contains("sync-configuration") {
            let mut configuration = card("同步时间与采集设置", cx);
            for (path, label) in [
                ("sync.chatIntervalMinutes", "聊天同步频率"),
                ("sync.analysisDelayMinutes", "同步后延迟分析"),
                ("sync.meetingIntervalMinutes", "纪要同步间隔（分钟）"),
                ("sync.mailIntervalMinutes", "邮箱同步间隔（分钟）"),
                ("sync.sourceChatName", "纪要助手名称"),
                ("sync.chatLimit", "会话数"),
                ("sync.messagesPerChat", "每会话消息数"),
                ("sync.minutesLimit", "纪要文档数"),
                ("sync.minutesMessageLimit", "助手消息数"),
                ("sync.mailLimit", "邮件数"),
            ] {
                configuration = configuration.child(self.row(label, self.field(path), cx));
            }
            let draft = self
                .drafts
                .get("feishuSync")
                .unwrap_or(&self.sync["settings"]);
            for (key, label) in [
                ("meetingEnabled", "自动同步会议纪要"),
                ("mailEnabled", "自动同步邮箱"),
                ("includeAttachments", "下载消息附件"),
            ] {
                let path = format!("sync.{key}");
                configuration = configuration.child(
                    Checkbox::new(ElementId::Name(path.clone().into()))
                        .checked(draft[key].as_bool().unwrap_or(false))
                        .label(t(label))
                        .on_click(cx.listener(move |this, value: &bool, _, cx| {
                            this.change(&path, json!(*value), cx)
                        })),
                );
            }
            c = c.child(configuration).child(
                Button::new("save-sync-settings")
                    .small()
                    .h(px(32.))
                    .primary()
                    .label(t("保存同步设置"))
                    .disabled(self.busy)
                    .on_click(cx.listener(|this, _, _, cx| this.save_sync(cx))),
            );
        }
        for run in self.sync["history"]["items"]
            .as_array()
            .into_iter()
            .flatten()
            .take(20)
        {
            let id = run["id"].as_str().unwrap_or("").to_string();
            let key = format!("sync-run-{id}");
            let toggle = key.clone();
            c = c.child(
                Button::new(ElementId::Name(key.clone().into()))
                    .small()
                    .h(px(32.))
                    .ghost()
                    .label(format!(
                        "{} {} · {}",
                        if self.expanded.contains(&key) {
                            "⌄"
                        } else {
                            "›"
                        },
                        date_text(run["startedAt"].as_str().unwrap_or("")),
                        t(status_label(run["status"].as_str().unwrap_or("unknown")))
                    ))
                    .on_click(cx.listener(move |this, _, _, cx| this.flip(&toggle, cx))),
            );
            if !self.expanded.contains(&key) {
                continue;
            }
            c = c.child(
                self.row_raw(
                    run["startedAt"].as_str().unwrap_or("同步记录"),
                    div()
                        .text_size(px(12.))
                        .child(t(status_label(run["status"].as_str().unwrap_or("unknown")))),
                    cx,
                ),
            );
            if let Some(f) = run["failures"].as_array() {
                for failure in f {
                    c = c.child(note(
                        failure["message"].as_str().unwrap_or("采集部分失败"),
                        cx,
                    ));
                }
            }
            if run["truncated"].as_array().is_some_and(|v| !v.is_empty()) {
                c = c.child(note("已达到采集窗口上限", cx));
            }
            if let Some(error) = run["error"]["message"].as_str() {
                c = c.child(note_raw(error, cx));
            }
            if let Some(counts) = run["counts"].as_object() {
                for (key, value) in counts {
                    c = c.child(self.row(
                        key,
                        div().text_size(px(11.)).child(value.to_string()),
                        cx,
                    ));
                }
            }
            c = c.child(note(
                &format!(
                    "{} · {} ms · {}",
                    t("执行记录"),
                    run["durationMs"].as_u64().unwrap_or(0),
                    crate::util::human_size(run["receivedBytes"].as_u64().unwrap_or(0))
                ),
                cx,
            ));
        }
        let offset = self.sync_offset;
        let total = self.sync["history"]["total"].as_u64().unwrap_or(0) as usize;
        c = c.child(
            h_flex()
                .gap_2()
                .child(
                    Button::new("sync-history-newer")
                        .small()
                        .h(px(32.))
                        .outline()
                        .label(t("较新记录"))
                        .disabled(self.sync_loading || offset == 0)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.load_sync_page(offset.saturating_sub(20), cx)
                        })),
                )
                .child(note(
                    &format!(
                        "{}–{} / {}",
                        if total == 0 { 0 } else { offset + 1 },
                        (offset + 20).min(total),
                        total
                    ),
                    cx,
                ))
                .child(
                    Button::new("sync-history-older")
                        .small()
                        .h(px(32.))
                        .outline()
                        .label(t("较早记录"))
                        .disabled(self.sync_loading || offset + 20 >= total)
                        .on_click(
                            cx.listener(move |this, _, _, cx| this.load_sync_page(offset + 20, cx)),
                        ),
                ),
        );
        let mut index = card("已同步数据记录", cx).child(self.row(
            "数据类型",
            self.choices(
                "native.recordKind",
                &[
                    ("chats", "聊天"),
                    ("messages", "消息"),
                    ("minutes", "会议纪要"),
                    ("mail", "邮箱"),
                ],
                false,
                self.records_loading,
                cx,
            ),
            cx,
        ));
        for record in self.sync_records["items"].as_array().into_iter().flatten() {
            index = index.child(self.row_detail_raw(
                record["sourceId"].as_str().unwrap_or(""),
                &date_text(record["syncedAt"].as_str().unwrap_or("")),
                div().text_size(px(11.)).child(crate::util::human_size(
                    record["bytes"].as_u64().unwrap_or(0),
                )),
                cx,
            ));
        }
        let offset = self.record_offset;
        let total = self.sync_records["total"].as_u64().unwrap_or(0) as usize;
        let previous = self.record_kind.clone();
        let next = self.record_kind.clone();
        index = index.child(
            h_flex()
                .gap_2()
                .child(
                    Button::new("records-previous")
                        .small()
                        .h(px(32.))
                        .outline()
                        .label(t("上一页"))
                        .disabled(self.records_loading || offset == 0)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.load_records(previous.clone(), offset.saturating_sub(25), cx)
                        })),
                )
                .child(note(
                    &format!(
                        "{}–{} / {}",
                        if total == 0 { 0 } else { offset + 1 },
                        (offset + 25).min(total),
                        total
                    ),
                    cx,
                ))
                .child(
                    Button::new("records-next")
                        .small()
                        .h(px(32.))
                        .outline()
                        .label(t("下一页"))
                        .disabled(self.records_loading || offset + 25 >= total)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.load_records(next.clone(), offset + 25, cx)
                        })),
                ),
        );
        c = c.child(index);
        c
    }
}
impl Render for SettingsView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.wechat_reader_active() && std::mem::take(&mut self.wechat_query_needs_reset) {
            self.wechat_query.update(cx, |input, cx| input.set_value("", window, cx));
        }
        let title = t("设置");
        if window.window_title() != title {
            window.set_window_title(&title);
        }
        crate::backdrop::preferences_controls(window);
        self.setup_fields(window, cx);
        self.setup_connection_secret(window, cx);
        let theme = cx.theme().clone();
        let mut nav = v_flex()
            .w(px(225.))
            .flex_shrink_0()
            .h_full()
            .px(px(16.))
            .pt(px(40.))
            .pb(px(14.))
            .gap(px(4.))
            .bg(theme.sidebar)
            .border_r_1()
            .border_color(theme.border)
            .overflow_y_scrollbar();
        for (key, label, _) in SECTIONS {
            nav = nav.child(
                Button::new(ElementId::Name(format!("setting-{key}").into()))
                    .ghost()
                    .w_full()
                    .h(px(34.))
                    .px(px(12.))
                    .accessibility_label(t(label))
                    .child(
                        h_flex()
                            .w_full()
                            .gap(px(10.))
                            .items_center()
                            .child(
                                img(setting_art(key, theme.is_dark(), false))
                                    .size(px(18.))
                                    .flex_shrink_0(),
                            )
                            .child(div().flex_1().text_size(px(14.)).font_weight(FontWeight::NORMAL).child(t(label))),
                    )
                    .selected(self.section == key)
                    .disabled(self.section=="models" && self.model_add)
                    .when(self.section == key, |button| {
                        button.bg(theme.sidebar_accent).text_color(theme.foreground)
                    })
                    .on_click(cx.listener(move |this, _, _, cx| this.section(key, cx))),
            );
        }
        let title = SECTIONS
            .iter()
            .find(|x| x.0 == self.section)
            .map(|x| x.1)
            .unwrap_or("设置");
        let mut content = v_flex()
            .flex_1()
            .min_w_0()
            .h_full()
            .overflow_y_scrollbar()
            // One call site renders every section and detail editor. Give each
            // group its own scroll state so a long editor cannot offset another page.
            .id(ElementId::Name(format!("settings-content:{}", self.group_key()).into()))
            .px(px(24.))
            .pt(px(18.))
            .pb(px(24.))
            .gap_4()
            .child(
                div()
                    .text_size(px(20.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .mb_2()
                    .child(t(title)),
            );
        if let Some(err) = &self.error {
            content = content.child(
                h_flex()
                    .gap_2()
                    .child(
                        div()
                            .flex_1()
                            .text_size(px(12.))
                            .text_color(theme.danger)
                            .child(t(err)),
                    )
                    .child(
                        Button::new("settings-reload")
                            .small()
                            .h(px(32.))
                            .ghost()
                            .label(t("重新读取"))
                            .on_click(cx.listener(|this, _, _, cx| {
                                if this.section=="models" && this.detail.is_some() {
                                    let key=this.group_key();let mut draft=this.draft();draft["_rebase"]=json!(true);this.drafts[key]=draft;
                                }
                                this.reload(cx)
                            })),
                    ),
            );
        }
        if let Some(notice) = &self.notice {
            content = content.child(note(notice, cx));
        }
        if self.loading && self.data["settings"].is_null() {
            content = content.child(note("正在读取设置…", cx));
        } else {
            content = content.child(self.render_body(cx));
        }
        div().relative().size_full().text_size(px(14.))
            .child(h_flex().size_full().bg(theme.sidebar).child(nav).child(content))
            .when(self.section=="models" && self.detail.is_some() && self.model_add, |root| {
                root.child(div().absolute().inset_0().size_full().bg(rgba(0x00000066)).flex().items_center().justify_center()
                    .on_mouse_down(MouseButton::Left,|_,_,cx|cx.stop_propagation())
                    .on_key_down(cx.listener(|this,event:&KeyDownEvent,_,cx|{if event.keystroke.key=="escape"&&!this.busy{this.close_model_editor(cx);cx.stop_propagation();}}))
                    .child(div().id("model-editor-dialog").w(px(560.)).max_w_full().max_h_full().p_4().overflow_y_scrollbar().child(self.render_model_form(cx))))
            })
    }
}
fn at<'a>(v: &'a Value, path: &str) -> &'a Value {
    let mut v = v;
    for part in path.split('.') {
        v = if v.is_array() {
            part.parse::<usize>()
                .ok()
                .map(|i| &v[i])
                .unwrap_or(&Value::Null)
        } else {
            &v[part]
        };
    }
    v
}
fn set_path(v: &mut Value, path: &str, value: Value) {
    fn put(v: &mut Value, parts: &[&str], value: Value) {
        let key = parts[0];
        if v.is_array() {
            let Ok(index) = key.parse::<usize>() else {
                return;
            };
            if index >= v.as_array().unwrap().len() {
                return;
            }
            if parts.len() == 1 {
                v[index] = value
            } else {
                put(&mut v[index], &parts[1..], value)
            }
        } else {
            if !v.is_object() {
                *v = json!({});
            }
            if parts.len() == 1 {
                v[key] = value
            } else {
                if v.get(key).is_none() {
                    v[key] = json!({});
                }
                put(&mut v[key], &parts[1..], value)
            }
        }
    }
    put(v, &path.split('.').collect::<Vec<_>>(), value);
}
fn connection_matches(c: &Value, provider: &str) -> bool {
    let name = c["provider"]
        .as_str()
        .filter(|p| !p.is_empty())
        .or_else(|| c["name"].as_str())
        .unwrap_or("")
        .to_lowercase()
        .replace([' ', '_'], "-");
    match provider {
        "google-calendar" => name.contains("calendar"),
        "feishu" => name.contains("feishu") || name.contains("lark"),
        "wechat-sync" => matches!(name.as_str(), "wechat" | "wechat-sync"),
        _ => name == provider || name.starts_with(&format!("{provider}-")),
    }
}
fn permission_label(status: &str) -> &'static str {
    match status {
        "granted" => "已允许",
        "denied" => "已拒绝",
        "restricted" => "受限制",
        "notDetermined" => "尚未授权",
        "notGranted" => "未允许",
        _ => "未检测",
    }
}
fn date_text(value: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|d| {
            d.with_timezone(&chrono::Local)
                .format("%m-%d %H:%M")
                .to_string()
        })
        .unwrap_or_else(|_| value.to_string())
}
async fn probe_permissions() -> Value {
    tokio::task::spawn_blocking(|| {
        let helper = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.join("opstwin-settings-permissions")));
        helper
            .filter(|p| p.is_file())
            .and_then(|p| std::process::Command::new(p).output().ok())
            .filter(|r| r.status.success())
            .and_then(|r| serde_json::from_slice::<Value>(&r.stdout).ok())
            .unwrap_or(
                json!({"microphone":"unknown","accessibility":"unknown","fullDisk":"unknown"}),
            )
    })
    .await
    .unwrap_or(json!({"microphone":"unknown","accessibility":"unknown","fullDisk":"unknown"}))
}
fn document_card(cx: &App) -> Div {
    v_flex()
        .gap_2()
        .px(px(20.))
        .py(px(18.))
        .rounded(px(12.))
        .border_1()
        .border_color(cx.theme().border)
        .bg(cx.theme().muted)
}
fn card(title: &str, cx: &App) -> Div {
    card_heading(title, None, cx)
}
fn card_heading(title: &str, brand: Option<&str>, cx: &App) -> Div {
    v_flex()
        .gap_0()
        .px(px(20.))
        .py(px(18.))
        .rounded(px(12.))
        .border_1()
        .border_color(cx.theme().border)
        .bg(cx.theme().muted)
        .when_some(brand, |card, brand| {
            card.child(
                div()
                    .size(px(34.))
                    .rounded(px(9.))
                    .bg(rgb(0xffffff))
                    .border_1()
                    .border_color(rgb(0xe7eaf0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(img(provider_art(brand)).size(px(26.))),
            )
        })
        .child(
            div()
                .text_size(px(13.))
                .font_weight(FontWeight::SEMIBOLD)
                .mb(px(10.))
                .child(t(title)),
        )
}
fn note(text: &str, cx: &App) -> Div {
    note_raw(&t(text), cx)
}
fn note_raw(text: &str, cx: &App) -> Div {
    div()
        .text_size(px(11.))
        .text_color(cx.theme().muted_foreground)
        .child(text.to_string())
}
fn normalize_level(v: &Value) -> &'static str {
    if let Some(n) = v.as_u64() {
        return match n {
            1 => "observe",
            3 => "send_undo",
            4 => "autonomous",
            _ => "draft",
        };
    }
    match v.as_str() {
        Some("observe") => "observe",
        Some("send_undo" | "send_with_undo" | "undo") => "send_undo",
        Some("autonomous" | "auto") => "autonomous",
        _ => "draft",
    }
}
fn status_label(s: &str) -> &str {
    match s {
        "connected" => "已连接",
        "disconnected" | "not_connected" => "未连接",
        "setup_required" => "需要配置",
        "failed" | "error" => "需要处理",
        "expired" => "已过期",
        "auth_required" => "需要授权",
        "succeeded" => "成功",
        "partial" => "部分完成",
        "running" => "进行中",
        "bound" => "Bot 已绑定",
        "pending" => "等待授权",
        "unbound" => "未绑定",
        _ => s,
    }
}

fn connection_public_config(value: &Value) -> Value {
    let mut config = value.clone();
    if let Some(object) = config.as_object_mut() {
        object.remove("credentialReady");
    }
    config
}

fn connection_public_matches(submitted: &Value, saved: &Value) -> bool {
    [
        "name",
        "type",
        "provider",
        "endpoint",
        "permissions",
        "config",
    ]
    .iter()
    .all(|key| {
        submitted.get(*key).is_none_or(|value| {
            if *key == "config" {
                connection_public_config(value) == connection_public_config(&saved[*key])
            } else {
                *value == saved[*key]
            }
        })
    })
}

static LOCALE_EN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub fn is_english() -> bool {
    LOCALE_EN.load(std::sync::atomic::Ordering::Relaxed)
}
pub fn t(s: &str) -> String {
    if !is_english() {
        return s.into();
    }
    for (prefix, english) in [
        ("数据大小 ", "Data Size "),
        (
            "偏好未保存，请重试：",
            "Preferences Were Not Saved. Retry: ",
        ),
    ] {
        if let Some(rest) = s.strip_prefix(prefix) {
            return format!("{english}{rest}");
        }
    }
    if let Some(rest) = s.strip_suffix(" 必须为非负整数") {
        return format!("{rest} must be a nonnegative integer");
    }
    if let Some((action, detail)) = s.split_once("失败：") {
        if matches!(
            action,
            "完成"
                | "标记完成"
                | "重新打开"
                | "删除"
                | "恢复"
                | "更新状态"
                | "取消任务"
                | "移到回收站"
        ) {
            return format!("{} Failed: {}", t(action), detail);
        }
    }
    for (prefix, english, suffix, english_suffix) in [
        (
            "补充消息状态：",
            "Follow-up Status: ",
            "，请检查原记录",
            ". Check the Original Record.",
        ),
        (
            "补充请求未确认：",
            "Follow-up Request Unconfirmed: ",
            "；先回查原请求",
            ". Check the Original Request First.",
        ),
        (
            "结果尚未确认：",
            "Result Unconfirmed: ",
            "；先检查结果",
            ". Check the Result First.",
        ),
        (
            "无法创建会话：",
            "Unable to Create Conversation: ",
            "；当前草稿保留",
            ". Your Current Draft Is Kept.",
        ),
        (
            "听写失败：",
            "Dictation Failed: ",
            "；原草稿保留",
            ". Your Original Draft Is Kept.",
        ),
        (
            "执行记录读取失败：",
            "Unable to Read the Execution Record: ",
            "",
            "",
        ),
        ("打开失败：", "Open Failed: ", "", ""),
        ("发送中…（第 ", "Sending… (attempt ", " 次尝试）", ")"),
        ("发送失败：", "Send Failed: ", "", ""),
        ("正在上传 ", "Uploading ", " 个文件…", " files…"),
        ("加载失败：", "Loading Failed: ", "", ""),
        ("刷新失败：", "Refresh Failed: ", "", ""),
        (
            "无法保存自动起草状态，未运行：",
            "Unable to Save Automatic Draft State; Nothing Ran: ",
            "",
            "",
        ),
        (
            "保存失败：",
            "Save Failed: ",
            "（本地修改已保留）",
            " (Local Edits Are Kept)",
        ),
        (
            "无法保存生成请求，未运行：",
            "Unable to Save the Generation Request; Nothing Ran: ",
            "",
            "",
        ),
        (
            "草稿仍在生成，等待原运行结束…（",
            "Draft Still Running; Waiting for the Original Run… (",
            "s）",
            "s)",
        ),
        ("生成失败：", "Generation Failed: ", "", ""),
        ("操作失败：", "Action Failed: ", "", ""),
        (
            "无法保存发送凭据（",
            "Unable to Save Send State (",
            "），未发送",
            "); Nothing Was Sent",
        ),
        (
            "已发送，回执消息 ID：",
            "Sent; Receipt Message ID: ",
            "",
            "",
        ),
        (
            "回读确认已发送，回执消息 ID：",
            "Checked and Confirmed Sent; Receipt Message ID: ",
            "",
            "",
        ),
        ("发送未完成：", "Sending Not Completed: ", "", ""),
        (
            "撤回未完成：",
            "Recall Not Completed: ",
            "（已重新读取状态）",
            " (Status Reloaded)",
        ),
        (
            "附件：",
            "Attachment: ",
            "（仅来源描述，未读取正文）",
            " (Source Description Only; Content Not Read)",
        ),
        (
            "当前草稿保持不变 · 候选请求 ",
            "Current Draft Unchanged · Candidate Request ",
            "",
            "",
        ),
        ("回执消息 ID：", "Receipt Message ID: ", "", ""),
        ("服务器：", "Server: ", "", ""),
        ("我的：", "Mine: ", "", ""),
        ("加载更多（已显示 ", "Load More (Shown ", "）", ")"),
        ("离线：", "Offline: ", "", ""),
        ("无法读取文件（", "Unable to Read File (", "）", ")"),
        (
            "文件 ",
            "File ",
            " 超过 25 MB 上限",
            " Exceeds the 25 MB Limit",
        ),
        (
            "无法创建缓存目录（",
            "Unable to Create Cache Directory (",
            "）",
            ")",
        ),
        (
            "文件大小不符（记录 ",
            "File Size Mismatch (Expected ",
            "）",
            ")",
        ),
        (
            "文件类型不符（记录 ",
            "File Type Mismatch (Expected ",
            "）",
            ")",
        ),
        ("无法写入缓存（", "Unable to Write Cache (", "）", ")"),
        ("附件 ", "Attachment ", "", ""),
    ] {
        if let Some(rest) = s.strip_prefix(prefix) {
            if suffix.is_empty() {
                return format!("{english}{rest}");
            }
            if let Some(value) = rest.strip_suffix(suffix) {
                return format!("{english}{value}{english_suffix}");
            }
        }
    }
    match s {
        "{count} 条匹配记录" => "{count} matches",
        "读取来源语音" => "Read Source Voice",
        "读取来源视频" => "Read Source Video",
        "读取来源文件" => "Read Source Document",
        "当前微信来源不支持此类附件，请重新检测连接" => "This WeChat source does not support this attachment type. Check the connection again.",
        "关闭附件" => "Close Attachment",
        "附件只保留在内存中；保存需要你选择位置" => "Attachments stay in memory. Choose a location to save them.",
        "保存到…" => "Save As…",
        "文件已保存" => "File Saved",
        "已请求系统打开；播放或查看取决于系统应用" => "System open requested. Playback or viewing depends on the system app.",
        "无法打开保存选择器，请重试" => "Unable to open the save dialog. Retry.",
        "附件读取已过期，请重新读取原消息" => "Attachment access expired. Read the original message again.",
        "本机文件访问策略无法读取" => "Local file access policy cannot be read.",
        "本机文件访问策略无法读取或已损坏" => "Local file access policy cannot be read or is damaged.",
        "请先在设置保存有效文件访问策略" => "Save a valid file access policy in Settings first.",
        "本机文件屏蔽策略格式无效" => "Local blocked path policy is invalid.",
        "本机文件屏蔽路径无效" => "A local blocked path is invalid.",
        "无法解析文件屏蔽路径，请保存有效策略后重试" => "A blocked path cannot be resolved. Save a valid policy and retry.",
        "本机文件访问策略无效" => "Local file access policy is invalid.",
        "所选路径无效" => "The selected path is invalid.",
        "无法访问所选路径，请另选位置后重试" => "Cannot access the selected path. Choose another location.",
        "保存位置必须是绝对路径" => "The save location must be an absolute path.",
        "保存位置含无效路径或符号链接" => "The save location contains an invalid path or symbolic link.",
        "无法验证保存位置" => "Cannot verify the save location.",
        "保存位置无效" => "The save location is invalid.",
        "附件读取已失效，请重新读取原消息" => "Attachment access is no longer valid. Read the original message again.",
        "保存文件名无效" => "The save filename is invalid.",
        "请保留已验证的文件扩展名后重试" => "Keep the verified file extension and retry.",
        "无法写入文件，请另选位置后重试" => "Cannot write the file. Choose another location.",
        "无法完成文件保存，请重试" => "Cannot finish saving the file. Retry.",
        "无法验证保存文件" => "Cannot verify the saved file.",
        "保存文件摘要校验失败" => "Saved file checksum verification failed.",
        "保存已取消" => "Save Canceled",
        "保存位置已变化，请另选位置" => "The save location changed. Choose another location.",
        "无法准备保存，请重试" => "Cannot prepare the file for saving. Retry.",
        "保存已取消或附件读取已过期" => "Saving was canceled or attachment access expired.",
        "文件访问策略或保存位置已变化，请重试" => "File access policy or save location changed. Retry.",
        "保存文件完整性无效" => "Saved file integrity is invalid.",
        "保存临时文件已变化，未发布" => "The temporary file changed. The file was not published.",
        "目标已存在，未覆盖，请另选位置" => "The target already exists and was kept. Choose another location.",
        "无法完成保存，请另选位置后重试" => "Cannot finish saving. Choose another location.",
        "文件已写入但磁盘同步失败，请核对目标后另选位置重试" => "The file was written but disk synchronization failed. Check the target before choosing another location.",
        "此格式不能在系统打开，或附件读取已失效" => "This format cannot be opened by the system or attachment access expired.",
        "文件访问策略已变化，请重新保存" => "File access policy changed. Save the file again.",
        "无法读取已保存文件" => "Cannot read the saved file.",
        "已保存文件不再符合安全读取条件，请重新保存" => "The saved file no longer meets safe access requirements. Save it again.",
        "无法验证已保存文件" => "Cannot verify the saved file.",
        "已保存文件已变化，请重新保存" => "The saved file changed. Save it again.",
        "此格式只能保存，不能系统打开" => "This format can be saved but cannot be opened by the system.",
        "已保存文件或访问策略已变化，请重新保存" => "The saved file or access policy changed. Save it again.",
        "将 OpsTwins 绑定到飞书 PersonalAgent Bot。" => "Bind OpsTwins to a Feishu PersonalAgent Bot.",
        "扫码创建聊天机器人。Bot 消息收发尚未接入；读取与发送权限在「连接」中管理。" => "Scan to create a chatbot. Bot messaging is not connected yet; manage read and send permissions in Connections.",
        "管理飞书连接" => "Manage Feishu Connection",
        "阅读" => "Read",
        "详情" => "Details",
        "条已保存记忆" => "saved memories",
        "保存的身份资料用于新的草稿和对话。" => {
            "Saved identity is used for new drafts and conversations."
        }
        "当前显示未保存的预览草稿" => "Showing your unsaved draft.",
        "个性、表达与规则，由你撰写。" => {
            "Personality, expression and rules, written by you."
        }
        "保存的知识与沟通偏好，可按分类阅读、编辑或移除。" => {
            "Saved knowledge and preferences. Read, edit or remove by category."
        }
        "还没有保存的记忆，点击编辑可添加知识。" => {
            "No saved memories. Choose Edit to add knowledge."
        }
        "你的自定义应用" => "Your Custom Apps",
        "尚无自定义应用。实际检测成功后，应用会出现在这里。" => {
            "No custom apps. Verified connections will appear here."
        }
        "服务端渠道配置暂不可读取，请检查连接后重试。" => {
            "Provider settings are unavailable. Check the connection and retry."
        }
        "通过已授权的邮件适配器接入。Google 账号一键授权尚未开放。" => {
            "Connect an authorized mail adapter. Google sign-in is not available yet."
        }
        "查看空闲时间，创建专注时段和提醒，准备会议简报。" => {
            "Check availability, create focus blocks and reminders, prepare meeting briefs."
        }
        "一次连接接入消息、文档和日历，起草回复并维护文档。" => {
            "Connect messages, documents and calendars, draft replies and maintain documents."
        }
        "按需读取这台 Mac 上的个人微信会话与消息。" => {
            "Read personal WeChat conversations and messages on this Mac on demand."
        }
        "已授予读取权限" => "Read permission granted",
        "已授予草稿权限" => "Draft permission granted",
        "已授予发送权限，仍遵循自主规则" => {
            "Send permission granted, subject to autonomy rules"
        }
        "已授予自动发送权限" => "Autonomous send permission granted",
        "权限信息未提供" => "Permission details unavailable",
        "设置 Gmail 连接" => "Set Up Gmail",
        "查看微信" => "View WeChat",
        "申请其他应用" => "Request Another App",
        "查看操作记录" => "View Activity",
        "操作记录" => "Activity",
        "希望用它完成什么？" => "What do you want to do with it?",
        "告诉分身需要哪个应用以及用途。申请将保留在任务中直到处理完成。" => {
            "Tell your twin which app you need and why. The request remains in Tasks until resolved."
        }
        "请填写应用名称与用途" => "Enter the app name and its purpose",
        "返回连接" => "Back to Connections",
        "通用" => "General",
        "模型" => "Models",
        "连接" => "Connections",
        "文件访问" => "File Access",
        "听写" => "Dictation",
        "身份与记忆" => "Identity & Memory",
        "自主权限" => "Autonomy",
        "消息渠道" => "Channels",
        "设备" => "Devices",
        "帮助" => "Help",
        "隐私与条款" => "Privacy & Terms",
        "关于" => "About",
        "应用" => "App",
        "电脑" => "Computer",
        "分身" => "Twin",
        "支持" => "Support",
        "语言" => "Language",
        "外观" => "Appearance",
        "显示模式" => "Appearance",
        "浅色" => "Light",
        "深色" => "Dark",
        "跟随系统" => "System",
        "正文大小" => "Text Size",
        "减少动态效果" => "Reduce Motion",
        "快捷键" => "Keyboard Shortcuts",
        "全局搜索" => "Search",
        "打开设置" => "Settings",
        "对话" => "Chat",
        "收件箱" => "Inbox",
        "灵感" => "Ideas",
        "任务" => "Tasks",
        "未保存" => "Unsaved",
        "取消" => "Cancel",
        "保存" => "Save",
        "重新读取" => "Reload",
        "当前模型" => "Current Model",
        "普通任务" => "Standard Tasks",
        "深度思考" => "Deep Thinking",
        "服务渠道" => "Provider",
        "测试连接" => "Test Connection",
        "历史" => "History",
        "保存快照" => "Save Snapshot",
        "姓名" => "Name",
        "角色" => "Role",
        "关于你" => "About You",
        "指令（Markdown）" => "Instructions (Markdown)",
        "移除" => "Remove",
        "暂停所有发送" => "Hold All Sending",
        "消息处理等级" => "Message Handling",
        "确认收到" => "Acknowledgements",
        "会议时间确认" => "Meeting Confirmations",
        "文档已有答案的问题" => "Questions Answered in Documents",
        "日期、数字或承诺" => "Dates, Numbers & Commitments",
        "主管与公司外部人员" => "Manager & External Contacts",
        "冲突、人事、法律与金钱" => "Conflicts, HR, Legal & Money",
        "观察" => "Observe",
        "草稿" => "Draft",
        "可撤销发送" => "Send with Undo",
        "自主发送" => "Autonomous",
        "主动深度思考" => "Proactive Deep Thinking",
        "客户" => "Customers",
        "你的主管" => "Your Manager",
        "涉及金钱或截止日期的任何人" => "Anyone Involving Money or Deadlines",
        "所有人" => "Everyone",
        "安静时间" => "Quiet Hours",
        "开始" => "From",
        "结束" => "Until",
        "通知时机" => "Notifications",
        "透明度" => "Transparency",
        "标注分身自主发送的消息" => "Disclose Autonomous Messages",
        "工作时间" => "Working Hours",
        "仅在工作时间行动" => "Act Only During Working Hours",
        "时区" => "Time Zone",
        "连接与同步规则" => "Connection & Sync Rules",
        "消息过滤" => "Message Filter",
        "应用名称" => "App Name",
        "服务器或桥接 URL" => "Server or Bridge URL",
        "服务器 URL" => "Server URL",
        "Skill 路径" => "Skill Path",
        "连接方式" => "Connection Type",
        "MCP 服务器" => "MCP Server",
        "认证" => "Authentication",
        "API Key 当前仅支持 REST/MCP；Skill 请选择无需认证，Webhook 尚无检测适配器。" => "API keys currently support REST/MCP only. Choose No Authentication for Skill; a Webhook test adapter is not available yet.",
        "无需认证" => "No Authentication",
        "输入 API Key（仅内存保存）" => "Enter API Key (Memory Only)",
        "请输入 API Key；服务端尚未确认此连接的已有密钥" => "Enter an API key. The server has not confirmed a saved key for this connection.",
        "请先保存连接配置，再检测连接" => "Save the connection configuration before testing it.",
        "连接配置已变更，请先读取原连接" => "Connection configuration changed. Read the original connection first.",
        "连接实际检测成功" => "Connection Test Succeeded",
        "无法验证连接，输入已保留" => "Connection could not be verified. Your input is preserved.",
        "原连接已读取，新密钥尚未提交；请在原连接保存并检测" => "The original connection was read. The new key has not been submitted; save and test it on this connection.",
        "连接状态属于已保存配置；当前修改仍需保存并检测。" => "Connection status applies to the saved configuration. Current changes still need to be saved and tested.",
        "Webhook 尚无可验证适配器；保存配置不代表已连接。" => "A verifiable Webhook adapter is not available yet. Saving configuration does not establish a connection.",
        "自定义 OAuth 尚无授权适配器；选择 OAuth 不代表已授权。" => "A custom OAuth authorization adapter is not available yet. Selecting OAuth does not authorize a connection.",
        "服务端已有此连接的密钥。留空复用，输入新密钥后保存并检测；密钥不写入本机草稿。" => "The server has a saved key for this connection. Leave blank to reuse it, or enter a new key to save and test. Keys are not stored in local drafts.",
        "请输入密钥后保存并检测。输入仅保留在内存，切换页面或退出会清除。" => "Enter a key, then save and test. Input stays in memory and is cleared when changing pages or quitting.",
        "分身可以做什么" => "What Your Twin May Do",
        "读取消息" => "Read Messages",
        "起草回复" => "Draft Replies",
        "发送回复" => "Send Replies",
        "添加表情回复" => "React to Messages",
        "未被提及的频道发言" => "Post When Not Mentioned",
        "检测连接" => "Test Connection",
        "断开连接" => "Disconnect",
        "管理" => "Manage",
        "添加自定义应用" => "Add Custom App",
        "飞书聊天渠道" => "Feishu Chat Channel",
        "当前绑定状态" => "Binding Status",
        "继续绑定" => "Continue Binding",
        "绑定飞书" => "Bind Feishu",
        "检查授权" => "Check Authorization",
        "打开飞书授权页" => "Open Feishu Authorization",
        "系统权限" => "System Permissions",
        "未检测" => "Not Checked",
        "系统设置" => "System Settings",
        "完整磁盘访问" => "Full Disk Access",
        "麦克风" => "Microphone",
        "辅助功能" => "Accessibility",
        "应用权限" => "App Access",
        "屏蔽文件夹" => "Blocked Folders",
        "添加文件夹" => "Add Folder",
        "输入" => "Input",
        "输入设备" => "Input Device",
        "系统默认" => "System Default",
        "听写时" => "During Dictation",
        "自动发送" => "Auto Send",
        "提示音" => "Sound Cues",
        "这台设备" => "This Device",
        "其他设备" => "Other Devices",
        "暂无已连接设备" => "No Connected Devices",
        "连接问题" => "Connection Issues",
        "权限问题" => "Permission Issues",
        "隐私" => "Privacy",
        "凭据" => "Credentials",
        "仅保留在服务端" => "Stored on Server Only",
        "外部发送" => "External Sending",
        "遵循自主权限与审批规则" => "Follows Autonomy and Approval Rules",
        "服务条款" => "Terms of Service",
        "尚未提供" => "Not Provided Yet",
        "版本" => "Version",
        "工作区版本" => "Workspace Revision",
        "客户端" => "Client",
        "数据同步" => "Data Sync",
        "立即同步" => "Sync Now",
        "关闭历史" => "Close History",
        "恢复" => "Restore",
        "记忆历史" => "Memory History",
        "身份历史" => "Identity History",
        "深入聊聊" => "Discuss",
        "忽略" => "Ignore",
        "取消忽略" => "Undo Ignore",
        "一起想想" => "Think Together",
        "全部" => "All",
        "洞察" => "Insights",
        "自动化" => "Automation",
        "效率" => "Productivity",
        "会议" => "Meetings",
        "跟进" => "Follow-ups",
        "已忽略" => "Ignored",
        "重试" => "Retry",
        "打开文件" => "Open File",
        "对话消息" => "Chat Messages",
        "文件" => "Files",
        "项目" => "Projects",
        "记忆" => "Memory",
        "自动行动" => "Automations",
        "记录" => "Activity",
        "最近打开" => "Recent",
        "没有匹配的记录" => "No Matching Records",
        "↑ ↓ 选择" => "↑ ↓ Select",
        "↵ 打开" => "↵ Open",
        "esc 关闭" => "esc Close",
        "会话" => "Conversations",
        "主会话" => "Primary Chat",
        "其他会话" => "Other Chats",
        "已归档会话" => "Archived Chats",
        "搜索会话" => "Search Chats",
        "输入消息…" => "Message…",
        "置顶" => "Pin",
        "取消置顶" => "Unpin",
        "重命名" => "Rename",
        "重命名会话" => "Rename Chat",
        "归档" => "Archive",
        "恢复归档" => "Unarchive",
        "删除会话？" => "Delete Chat?",
        "撤销删除" => "Undo Delete",
        "收起面板" => "Collapse Panel",
        "保持面板可见" => "Keep Panel Open",
        "取消保持可见" => "Unpin Panel",
        "显示活跃会话" => "Show Active Chats",
        "查看归档会话" => "Show Archived Chats",
        "正在加载对话…" => "Loading Chat…",
        "还没有消息，发送第一条吧" => "No Messages Yet",
        "加载更早消息" => "Load Earlier Messages",
        "正在加载更早消息…" => "Loading Earlier Messages…",
        "复制消息" => "Copy Message",
        "查看执行记录" => "View Run",
        "执行记录" => "Execution Record",
        "已停止" => "Stopped",
        "已被新消息打断" => "Interrupted by a new message",
        "插入当前运行" => "Steer Current Run",
        "等待完成后发送" => "Send After Current Run",
        "编辑待发消息" => "Edit Queued Message",
        "插入" => "Steer",
        "编辑" => "Edit",
        "正在转写…" => "Transcribing…",
        "开始听写" => "Start Dictation",
        "取消听写" => "Cancel Dictation",
        "停止听写，填入草稿" => "Stop Dictation into Draft",
        "转写并发送" => "Transcribe and Send",
        "发送消息" => "Send Message",
        "添加附件（≤25 MB）" => "Add Attachment (≤25 MB)",
        "关闭文件预览" => "Close File Preview",
        "在系统应用打开" => "Open with System App",
        "此文件可用系统应用打开" => "Open this File with a System App",
        "处理中" => "Running",
        "插入中" => "Steering",
        "已中断，请检查结果" => "Interrupted; Check Result",
        "失败，请检查结果" => "Failed; Check Result",
        "结果未确认" => "Result Unconfirmed",
        "搜索对话、收件箱、灵感…" => "Search chats, inbox, ideas…",
        "你想推进什么？" => "What Would You Like to Work On?",
        "工作区建议" => "Workspace Suggestions",
        "示例建议 · 仅供预览" => "Example Suggestions · Preview",
        "当前分类没有建议" => "No Suggestions in This Category",
        "正在读取灵感…" => "Loading Suggestions…",
        "模型 ID" => "Model ID",
        "开始 HH:mm" => "From HH:mm",
        "结束 HH:mm" => "Until HH:mm",
        "检查结果" => "Check Result",
        "回查后重试" => "Check Before Retry",
        "已完成" => "Completed",
        "部分完成" => "Partially Completed",
        "进行中" => "Running",
        "失败" => "Failed",
        "已连接" => "Connected",
        "未连接" => "Disconnected",
        "需要配置" => "Setup Required",
        "需要处理" => "Needs Attention",
        "已过期" => "Expired",
        "需要授权" => "Authorization Required",
        "成功" => "Succeeded",
        "Bot 已绑定" => "Bot Bound",
        "等待授权" => "Awaiting Authorization",
        "未绑定" => "Unbound",
        "原生全局听写快捷键尚未注册" => "Global Dictation Shortcuts Are Not Registered",
        "扫码创建 PersonalAgent Bot。绑定状态与 Bot 消息收发能力分别确认" => "Scan to create a PersonalAgent Bot. Binding and messaging readiness are checked separately.",
        "打开「连接」查看当前状态，再进入应用详情检测连接" => "Open Connections, then select an app to check its connection.",
        "打开对应的系统设置，检查 OpsTwins 的权限" => "Open System Settings to review OpsTwins permissions.",
        "紧急事项立即，其他每日汇总" => "Urgent Immediately; Daily Digest for Others",
        "每条需要我的消息" => "Every Message Requiring Me",
        "仅汇总，不推送" => "Digest Only, No Push",
        "‹ 连接" => "‹ Connections",
        "‹ 灵感" => "‹ Ideas",
        "‹ 搜索结果" => "‹ Search Results",
        "已有结果" => "Saved Results",
        "重试转写" => "Retry Transcription",
        "正在保存会话，请稍候" => "Saving Conversation, Please Wait",
        "正在保存…" => "Saving…",
        "标题不能为空且最多120字" => "Title Is Required, Maximum 120 Characters",
        "重命名保存失败，输入已保留" => "Rename Failed; Your Input Is Kept",
        "消息不能为空" => "Message Cannot Be Empty",
        "保存失败，输入已保留" => "Save Failed; Your Input Is Kept",
        "会话管理保存失败，原状态保留" => "Chat Settings Save Failed; Original State Is Kept",
        "分身关注的频道" => "Channels Your Twin Follows",
        "重要内容" => "Important Content",
        "人员" => "People",
        "频道" => "Channel",
        "添加频道或范围" => "Add Channel or Scope",
        "发送且可撤销" => "Send with Undo",
        "仅摘要" => "Summary Only",
        "深度思考草稿" => "Deep Thinking Draft",
        "添加人员" => "Add Person",
        "表示紧急的关键词" => "Urgency Keywords",
        "添加关键词" => "Add Keyword",
        "删除应用？" => "Delete App?",
        "删除应用" => "Delete App",
        "应用将从连接列表移除，外部服务数据保留。" => "The connection will be removed. External service data is preserved.",
        "已添加" => "Already Added",
        "请输入名称或关键词" => "Enter a Name or Keyword",
        "主管" => "Manager",
        "同事" => "Teammate",
        "记忆分类" => "Memory Category",
        "记忆内容" => "Memory Content",
        "添加记忆" => "Add Memory",
        "后续事项" => "Follow-ups",
        "等待你审核" => "Awaiting Your Review",
        "保存同步设置" => "Save Sync Settings",
        "同步时间与采集设置" => "Sync Schedule & Collection",
        "聊天同步频率" => "Chat Sync Frequency",
        "同步后延迟分析" => "Delay Before Analysis",
        "纪要同步间隔（分钟）" => "Minutes Sync Interval (min)",
        "邮箱同步间隔（分钟）" => "Mail Sync Interval (min)",
        "纪要助手名称" => "Minutes Assistant Name",
        "会话数" => "Chat Limit",
        "每会话消息数" => "Messages per Chat",
        "纪要文档数" => "Minutes Limit",
        "助手消息数" => "Assistant Messages Limit",
        "邮件数" => "Mail Limit",
        "自动同步会议纪要" => "Sync Meeting Minutes Automatically",
        "自动同步邮箱" => "Sync Mail Automatically",
        "下载消息附件" => "Download Message Attachments",
        "免手持模式（应用内）" => "Handsfree Shortcut (In App)",
        "按住说话" => "Push to Talk",
        "未设置" => "Not Set",
        "Option + 空格" => "Option + Space",
        "记忆内容不能为空" => "Memory Text Is Required",
        "Google 日历" => "Google Calendar",
        "“收到了”、“谢谢”、“正在看”" => "“Received”, “Thanks”, “Looking into it”",
        "上一页" => "Previous Page",
        "下一页" => "Next Page",
        "下次同步" => "Next Sync",
        "个人微信" => "Personal WeChat",
        "为这些对象起草回复前，分身会主动深度思考。" => "Think deeply before drafting replies to these people.",
        "任何承诺都需要你审批" => "Every commitment requires your approval",
        "会议纪要" => "Meeting Minutes",
        "全部数据" => "All Data",
        "关键词或短语" => "Keyword or Phrase",
        "兼容 Lark" => "Works with Lark",
        "凭据已配置" => "Credentials Configured",
        "分身标记这些消息，不会自动回复" => "Flag these messages without replying automatically",
        "分身继续读取和起草，关闭前不会发送。" => "Continue reading and drafting; sending stays paused until turned off.",
        "刷新" => "Refresh",
        "刷新状态" => "Refresh Status",
        "历史版本" => "History Version",
        "原请求已保存不同内容，请核对后继续" => "The original request saved different content. Review it first.",
        "受限制" => "Restricted",
        "只有查看时才读取本机历史，不自动批量导入，也不自动提交给 AI 模型。" => "Read local history only when viewed. No bulk import or automatic submission to AI models.",
        "只读取并摘要，不撰写回复。" => "Read and summarize without drafting a reply.",
        "只读，不发送或自动回复" => "Read Only; No Sending or Automatic Replies",
        "同步状态暂不可读取" => "Sync status is unavailable",
        "同步范围" => "Sync Scope",
        "同步记录" => "Sync History",
        "始终先取得你的审批" => "Always get your approval first",
        "尚未授权" => "Not Yet Authorized",
        "屏蔽的文件夹不得用于读取或 AI 处理" => "Blocked folders cannot be read or processed by AI",
        "工作日历" => "Work Calendar",
        "工作邮箱" => "Work Email",
        "已保存" => "Saved",
        "提交的版本已保存，当前修改仍未保存" => "Submitted version saved; current edits are still unsaved",
        "已允许" => "Allowed",
        "已同步数据记录" => "Synced Data Index",
        "已拒绝" => "Denied",
        "已接入本机读取策略" => "Local Read Policy Applied",
        "已达到采集窗口上限" => "Collection Window Limit Reached",
        "已锁定" => "Locked",
        "延迟分析（分钟）" => "Analysis Delay (min)",
        "当前读取范围可能不完整" => "The current reading coverage may be incomplete",
        "微信会话" => "WeChat Conversations",
        "多个匹配，请选择精确联系人后再读取；不会按名字猜测会话。" => "Multiple matches. Select the exact contact; a name does not identify a unique conversation.",
        "查看来源图片" => "View Source Image",
        "关闭图片" => "Close Image",
        "正文有截断，请精确读取；来源截断可能仍无法恢复全文" => "The body is truncated. Read the exact message; source truncation may remain.",
        "精确读取全文" => "Read Exact Message",
        "方向未知" => "Direction Unknown",
        "本人" => "Account Holder",
        "查找只过滤当前联系人页；无结果时仍可继续下一页，不代表整个档案无匹配。" => "Contact lookup filters this bounded page. An empty page can have more results; it does not cover the whole archive.",
        "此来源正文仍有截断，不能视为完整消息" => "The source is still truncated and cannot be treated as the full message",
        "关闭全文" => "Close Full Text",
        "个人微信" => "Personal WeChat",
        "已连接 · 只读" => "Connected · Read only",
        "按需查看本机联系人和消息，不自动导入或发送" => "View local contacts and messages on demand; no automatic import or sending",
        "最近检测" => "Last checked",
        "只搜索当前会话中的消息" => "Search messages in this conversation only",
        "按昵称、备注或微信号查找联系人，搜索会继续读取后续页" => "Find contacts by nickname, remark or WeChat ID, including later pages",
        "本批尚未找到匹配，继续搜索后续联系人" => "No match in this batch. Continue searching later contacts",
        "未找到匹配的联系人" => "No matching contacts found",
        "当前可读范围内没有匹配" => "No match within the readable data",
        "暂无会话" => "No conversations yet",
        "暂无消息" => "No messages yet",
        "未找到匹配的消息" => "No matching messages found",
        "已检查" => "Checked",
        "匹配" => "Matches",
        "继续搜索" => "Continue search",
        "查找联系人" => "Find Contacts",
        "搜索当前会话" => "Search Conversation",
        "查找联系人或当前会话消息" => "Find contacts or messages in this conversation",
        "手动或已暂停" => "Manual or Paused",
        "授权到期" => "Authorization Expires",
        "操作已完成" => "Action Completed",
        "操作需要处理" => "Action Needs Attention",
        "收起" => "Collapse",
        "数据类型" => "Data Type",
        "新增模型" => "Add Model",
        "供应商" => "Providers",
        "编辑模型" => "Edit model",
        "供应商名称" => "Provider name",
        "＋ 新供应商" => "+ New provider",
        "＋ 添加模型" => "+ Add model",
        "‹ 模型" => "‹ Models",
        "API 格式" => "API format",
        "智能配置" => "Smart configuration",
        "上下文窗口" => "Context window",
        "最大输出 Token" => "Maximum output tokens",
        "高级配置" => "Advanced configuration",
        "图片输入" => "Image input",
        "深度思考能力" => "Reasoning capability",
        "重置表单" => "Reset form",
        "保存供应商" => "Save provider",
        "添加模型" => "Add model",
        "模型列表" => "Models",
        "标准协议" => "Standard protocol",
        "Claude Code 网关兼容" => "Claude Code gateway compatibility",
        "凭据已配置；留空保留，修改地址或协议后请重新输入" => "Key configured; leave blank to keep it. Re-enter after changing URL or protocol.",
        "智能配置使用兼容默认值；可按供应商实际限制调整。" => "Uses compatibility defaults; adjust to the provider's actual limits.",
        "当前没有配置模型，添加模型后可在聊天中使用。" => "No models configured. Add a model to use it in chat.",
        "新类型从草稿开始，信任后可提高等级。" => "New types start with drafts. Increase autonomy as trust grows.",
        "无法保存本机偏好" => "Unable to Save Local Preferences",
        "无法打开文件夹选择器" => "Unable to Open the Folder Picker",
        "旧草稿未经全文校验，保存已禁用。可保留草稿，或重新读取全文。" => "This older draft has not been checked against the full text. Keep it or reload the full document before saving.",
        "暂无" => "None",
        "未允许" => "Not Allowed",
        "本机客户端" => "Local Client",
        "本机微信" => "WeChat on This Mac",
        "本机数据存在读取提醒，请检查 GreenBubbles" => "Local data has reading warnings. Check GreenBubbles.",
        "本机数据库数" => "Local Database Count",
        "某些工作场所要求公开说明，默认开启。" => "Some workplaces require disclosure. Enabled by default.",
        "查看" => "View",
        "查看个人微信会话与消息" => "View Personal WeChat Conversations and Messages",
        "根据你自己的笔记与文件作答" => "Answer using your own notes and files",
        "检测时间" => "Verified At",
        "模型已添加到本机目录" => "Model Added to the Local Catalog",
        "模型配置暂不可读取" => "Model configuration is unavailable",
        "正在同步…" => "Syncing…",
        "正在读取设置…" => "Loading Settings…",
        "消息" => "Messages",
        "渠道尚未配置" => "Channel Not Configured",
        "点击刷新读取本机记录" => "Refresh to read local records",
        "确认日历上已有的会议时间" => "Confirm meeting times already on the calendar",
        "立即发送，并记录在 Activity 中。" => "Send immediately and record it in Activity.",
        "等待 2 分钟后发送，期间可以撤销。" => "Send after 2 minutes; you can undo before then.",
        "聊天" => "Chats",
        "聊天同步间隔（分钟）" => "Chat Sync Interval (min)",
        "自定义" => "Custom",
        "自定义应用" => "Custom App",
        "记忆全文尚未读取，已阻止编辑；请重新读取后重试" => "The full memory has not been read. Reload before editing.",
        "设置" => "Settings",
        "该版本不包含身份资料" => "This version does not contain identity details",
        "请先连接本机微信" => "Connect Local WeChat First",
        "请选择已配置渠道并填写有效模型 ID" => "Choose a configured channel and enter a valid model ID",
        "请先保存模型选择，再测试连接" => "Save the model selection before testing its connection",
        "模型实际调用成功" => "Model invocation succeeded",
        "模型测试失败" => "Model test failed",
        "重试原测试" => "Retry original test",
        "未收到测试请求，可重试原测试" => "Test request not received. Retry the original test.",
        "回查测试" => "Check original test",
        "测试仍在运行，请回查原请求" => "Test is running. Check the original request.",
        "测试结果未知，请回查原请求" => "Test outcome is unknown. Check the original request.",
        "附件记录与请求不一致" => "The attachment record does not match the request",
        "读取范围完整" => "Complete Coverage",
        "读取这台 Mac 上的个人微信" => "Read Personal WeChat on This Mac",
        "起草回复，等待你审批。" => "Draft a reply and wait for your approval.",
        "较新记录" => "Newer Records",
        "较早记录" => "Older Records",
        "连接本机微信" => "Connect Local WeChat",
        "选择服务端已配置渠道，模型 ID 保存到本机可选目录。渠道协议与凭据由服务端保留。" => "Choose a configured server channel. Model IDs are saved in the local catalog; protocols and credentials stay on the server.",
        "邮箱" => "Mail",
        "采集部分失败" => "Collection Partially Failed",
        "重新检测" => "Check Again",
        "重新读取全文（丢弃旧草稿）" => "Reload Full Text (Discard Older Draft)",
        "非紧急通知延后到安静时间结束。" => "Delay nonurgent notifications until quiet hours end.",
        "频道或范围名称" => "Channel or Scope Name",
        "飞书" => "Feishu",
        "没有匹配会话" => "No Matching Conversations",
        "暂无归档会话" => "No Archived Conversations",
        "还没有侧会话" => "No Side Conversations Yet",
        "移除已确认请求" => "Remove Confirmed Request",
        "只有已确认未执行或失败的请求可以移除" => "Only requests confirmed as not started or failed can be removed",
        "先检查原请求结果" => "Check the Original Request First",
        "建议仍在运行，可稍后检查结果" => "The suggestion is still running. Check its result later.",
        "建议部分完成，请审阅已保存结果；不能重新执行" => "Partially completed. Review the saved result; it cannot be run again.",
        "执行会话未保存，未开始运行" => "The execution conversation was not saved; nothing started.",
        "执行失败，可重试原请求" => "Execution failed. Retry the original request.",
        "执行请求未保存，未开始运行" => "The request was not saved; nothing started.",
        "无法持久化执行请求，未开始运行" => "The request could not be saved; nothing started.",
        "查看部分结果" => "View Partial Result",
        "检查运行" => "Check Run",
        "生成结果未确认，请重新读取灵感记录后核对，避免重复运行" => "The generation result is unconfirmed. Reload ideas and check before running again.",
        "结果仍未确认，请再次检查" => "The result is still unconfirmed. Check again.",
        "已保存结果" => "Saved Result",
        "从会议纪要中整理行动项，把负责人、截止时间和待确认事项放在一起。" => "Turn meeting notes into actions with owners, deadlines, and open questions.",
        "会议结束后，下一步直接变成待办" => "Turn Meeting Next Steps into Tasks",
        "区分等待他人和需要你行动的内容" => "Separate Waiting Items from Your Next Actions",
        "客户回复后，提醒你继续跟进" => "Follow Up When a Customer Replies",
        "形成一份可讨论的改进建议" => "Prepare an Improvement Proposal",
        "把悬而未决的事项收回来" => "Bring Open Loops Back into Focus",
        "把本周工作整理成一页周报" => "Summarize This Week on One Page",
        "把来信、会议和待办整理成每日摘要，优先列出需要你决策的内容。" => "Summarize mail, meetings, and tasks each day, with decisions first.",
        "把近期重复的沟通和处理步骤放在一起，寻找可以复用的做法。" => "Review recurring communication and steps to find reusable approaches.",
        "把需要后续沟通的客户事项单独整理，准备简短的跟进回复。" => "Collect customer follow-ups and prepare short reply drafts.",
        "按进展、阻碍、下周计划整理" => "Organize Progress, Blockers, and Next Week",
        "提取行动项与负责人" => "Extract Actions and Owners",
        "整理未完成的沟通事项" => "Collect Open Communication Items",
        "整理重复步骤与耗时点" => "Review Repeated Steps and Time Spent",
        "检查并编辑周报草稿" => "Review and Edit the Weekly Draft",
        "每天早上，只看需要你处理的事项" => "Start Each Morning with What Needs You",
        "汇总已完成事项、待办和需要协调的问题，先生成一份可编辑的草稿。" => "Create an editable draft of completed work, tasks, and coordination needs.",
        "看看哪些重复工作值得简化" => "Find Repeated Work Worth Simplifying",
        "确认后创建任务" => "Confirm Before Creating Tasks",
        "确认并安排下一次跟进" => "Confirm and Schedule the Next Follow-up",
        "记录下一次跟进目标与时间" => "Record the Next Follow-up Goal and Time",
        "设置摘要时间与关注范围" => "Choose Summary Timing and Scope",
        "起草回复，等待确认" => "Draft a Reply for Review",
        "选择一份会议纪要" => "Choose Meeting Notes",
        "选择客户事项" => "Choose a Customer Item",
        "选择本周任务与记录" => "Choose This Week’s Tasks and Records",
        "选择要汇总的来源" => "Choose Sources to Summarize",
        "选择近期工作记录" => "Choose Recent Work Records",
        "集中查看仍在等待回复、确认或材料的工作，整理一次跟进清单。" => "Collect work waiting for replies, confirmation, or materials into a follow-up list.",
        "预览内容，再确认自动化" => "Preview the Content, Then Confirm Automation",
        "⌘K 搜索\n⌘, 设置\n⌘1 对话\n⌘2 收件箱\n⌘3 灵感\nEscape 关闭搜索" => "⌘K Search\n⌘, Settings\n⌘1 Chat\n⌘2 Inbox\n⌘3 Ideas\nEscape Close Search",
        "读取原连接" => "Read Original Connection",
        "原连接已创建，请读取原连接后继续编辑；不会创建重复连接" => "The original connection exists. Read it before editing; no duplicate will be created.",
        "原结果未知时先读取此连接；不会重复创建。" => "Read this connection first if the original outcome is unknown. It will not be created again.",
        "切换浅色/深色" => "Toggle Light / Dark",
        "退出 OpsTwins" => "Quit OpsTwins",
        "隐藏 OpsTwins" => "Hide OpsTwins",
        "前往" => "Go",
        "AI 灵感" => "AI Ideas",
        "Jev 回复判断" => "Jev Reply Assessment",
        "使用服务器版本" => "Use Server Version",
        "保存冲突" => "Save Conflict",
        "保存草稿" => "Save Draft",
        "保留我的并保存" => "Keep Mine and Save",
        "关闭" => "Close",
        "加载更多" => "Load More",
        "原始消息" => "Original Messages",
        "回复草稿" => "Reply Draft",
        "回复草稿（保存后才能发送）" => "Reply Draft (Save Before Sending)",
        "图片暂不可用" => "Image Unavailable",
        "图片暂不可用，点击重试预览" => "Image Unavailable; Click to Retry",
        "已处理上一条事项" => "Previous Item Handled",
        "已审阅，采用候选" => "Reviewed; Apply Candidate",
        "已批准" => "Approved",
        "并发修改后的候选草稿" => "Candidate Draft After Concurrent Edits",
        "我" => "Me",
        "我已审阅并明确批准发送此敏感内容" => "I Have Reviewed and Explicitly Approved Sending This Sensitive Content",
        "我的版本：" => "My Version:",
        "打开来源文件" => "Open Source File",
        "搜索收件箱" => "Search Inbox",
        "撤回" => "Recall",
        "撤销" => "Undo",
        "放弃修改" => "Discard Changes",
        "放弃本地修改并载入" => "Discard Local Changes and Load",
        "敏感" => "Sensitive",
        "时间未知" => "Unknown Time",
        "昨天" => "Yesterday",
        "服务器上的事项已更新，本地修改未被覆盖" => "The server item has changed. Your local edits are kept.",
        "服务器版本：" => "Server Version:",
        "未保存修改" => "Unsaved Changes",
        "未保存（已在本机保留）" => "Unsaved (Kept Locally)",
        "查看分析过程" => "View Analysis",
        "查看生成来源会话" => "View Source Conversation",
        "标记完成" => "Mark Done",
        "概率未知" => "Unknown Probability",
        "正在读取消息…" => "Loading Messages…",
        "正在读取预览…" => "Loading Preview…",
        "此格式不支持应用内预览，可打开来源文件" => "This format cannot be previewed here. Open the source file.",
        "此消息读取失败" => "This message could not be read",
        "没有事项" => "No Items",
        "涉及重要承诺或敏感内容，回复前需要你审核" => "Review Required Before Replying to Important Commitments or Sensitive Content",
        "确认无回执，用新幂等键发送" => "Confirm No Receipt and Send with a New Request Key",
        "缺少关键材料，请补充后再形成完整答复" => "Key Information Is Missing. Add It Before Preparing a Complete Reply.",
        "读取失败，已保存内容仍可查看。" => "Loading Failed. Saved Content Is Still Available.",
        "重新判断" => "Assess Again",
        "重新打开" => "Reopen",
        "预览已索引来源附件" => "Preview Indexed Source Attachment",
        "更多选项" => "More Options",
        "新建会话" => "New Conversation",
        "任务选项" => "Task Options",
        "设置…" => "Settings…",
        "打开收件事项" => "Open Inbox Item",
        "预览来源图片" => "Preview Source Image",
        "关闭来源预览" => "Close Source Preview",
        "发送中…（第 {attempt} 次尝试）" => "Sending… (attempt {attempt})",
        "发送中…" => "Sending…",
        "发送失败：" => "Send Failed: ",
        "正在上传 {count} 个文件…" => "Uploading {count} files…",
        "发送失败" => "Send Failed",
        "原请求仍在运行，等待结果…" => "The original request is still running. Waiting for its result…",
        "上次退出时尚未确认，先检查原请求结果" => "The result was unconfirmed at exit. Check the original request first.",
        "未命名会话" => "Untitled Conversation",
        "请输入消息再发送附件" => "Enter a message before sending attachments",
        "原请求未确认或已有部分写入，保留执行记录" => "The request is unconfirmed or partially applied. Keep the execution record.",
        "无法保存原请求，尚未发送。原草稿已保留" => "The original request could not be saved. Nothing was sent; your draft is kept.",
        "新会话" => "New Conversation",
        "原运行已有部分写入，请查看执行记录后继续" => "The original run has partial changes. Review its record before continuing.",
        "原请求已失败，请检查结果后用原请求重试" => "The original request failed. Check its result before retrying that request.",
        "运行长时间未确认，先检查结果" => "The run has been unconfirmed for a while. Check its result first.",
        "无法保存当前草稿，切换已取消" => "The draft could not be saved. Switching was canceled.",
        "运行、未知或部分结果尚未确认，不能隐藏会话" => "This conversation has a running, unknown, or partial result and cannot be hidden.",
        "会话结果尚未确认，不能隐藏" => "The conversation result is unconfirmed and cannot be hidden.",
        "删除后可通过会话面板撤销，原服务器记录保留" => "Undo deletion from the conversation panel. The original server record is retained.",
        "删除" => "Delete",
        "带附件的消息请选择等待完成后发送" => "Choose to send attachment messages after the current run finishes",
        "添加附件" => "Add Attachment",
        "无法打开文件选择器" => "Unable to Open the File Picker",
        "附件记录不存在" => "Attachment Record Not Found",
        "下载并用默认应用打开" => "Download and Open in the Default App",
        "重新加载" => "Reload",
        "回到最新" => "Back to Latest",
        "待处理" => "Pending",
        "安静记录" => "Quiet Records",
        "请等待当前操作完成" => "Wait for the Current Action to Finish",
        "已采用审阅后的候选，发送前请再次确认" => "The reviewed candidate was applied. Confirm again before sending.",
        "草稿再次发生变化，请重新审阅最新候选与草稿" => "The draft changed again. Review the latest candidate and draft.",
        "状态已改变，请在全部记录中查看" => "The status changed. View it in All Records.",
        "已外发或结果未知的消息内容已冻结" => "Sent messages and messages with unknown results are locked.",
        "草稿已保存（需重新批准后才能发送）" => "Draft Saved (Approve Again Before Sending)",
        "此事项已在其他地方更新，请选择保留哪一版" => "This item changed elsewhere. Choose which version to keep.",
        "请先保存或放弃本地修改，再生成草稿" => "Save or discard local edits before generating a draft",
        "已外发或结果未知的事项不能改写" => "Sent items and items with unknown results cannot be rewritten",
        "正在生成草稿…（模型运行可能需要几分钟）" => "Generating a draft… (the model may take a few minutes)",
        "草稿已生成，请审阅后再发送" => "Draft Generated. Review Before Sending.",
        "（重试将沿用原请求，不会重复生成）" => "(Retry uses the original request without generating twice)",
        "并发修改已保留。新候选在下方，审阅后可明确采用" => "Concurrent edits are kept. Review the candidate below before applying it.",
        "已有发送结果的状态只能通过回读或撤回更新" => "Update an existing send result only by checking it or recalling it",
        "已放回收件箱" => "Returned to Inbox",
        "已忽略，可在「全部」中重新打开" => "Ignored. Reopen It from All Records.",
        "已标记完成" => "Marked Done",
        "此事项已在其他地方更新，已重新读取，请确认后再操作" => "This item changed elsewhere and was reloaded. Review it before acting.",
        "导入的消息只能在这里起草；发送仅限有 OPSADV-QA 标记的本人测试项" => "Imported messages can only be drafted here. Sending is limited to your own OPSADV-QA test items.",
        "请先保存或放弃本地修改再发送" => "Save or discard local edits before sending",
        "请先生成或填写草稿" => "Generate or enter a draft first",
        "敏感内容需要先勾选明确批准" => "Explicitly Approve Sensitive Content First",
        "上次发送已被服务器判定失败；确认无回执后可用新幂等键重新发送" => "The server confirmed the previous send failed. Confirm there is no receipt before sending with a new request key.",
        "正在保存发送凭据…" => "Saving Send State…",
        "正在回读最新状态…" => "Checking the Latest State…",
        "草稿已在其他地方更新，未发送；请审阅最新草稿" => "The draft changed elsewhere. Nothing was sent; review the latest draft.",
        "；结果未知，已保留原幂等键，重试会先回读不会重复发送" => "; the result is unknown. The original request key is kept; retry checks the result before sending.",
        "找不到原发送幂等键，无法撤回" => "The original send key could not be found. Recall is unavailable.",
        "正在撤回…" => "Recalling…",
        "已撤回" => "Recalled",
        "敏感内容、失败或重要承诺" => "Sensitive Content, Failure, or Important Commitment",
        "需要你确认" => "Your Confirmation Required",
        "分析后回复" => "Analyze Before Replying",
        "简单回复" => "Simple Reply",
        "无关注信号或尚未判断" => "No Attention Signal or Not Yet Assessed",
        "选择一条事项查看详情" => "Select an Item to View Details",
        "正在加载…" => "Loading…",
        "需要回复" => "Needs Reply",
        "需要你决策" => "Needs Your Decision",
        "需要深度思考" => "Needs Deep Thought",
        "正在判断" => "Assessing",
        "判断失败，需人工查看" => "Assessment Failed; Review Manually",
        "规则判断，无模型概率" => "Rule Assessment; No Model Probability",
        "尚未判断" => "Not Yet Assessed",
        "对方" => "Other Person",
        "[图片]" => "[Image]",
        "来源附件" => "Source Attachments",
        "收起完整消息" => "Collapse Full Messages",
        "查看完整消息" => "View Full Messages",
        "收起编辑" => "Collapse Editor",
        "尚无回复草稿" => "No Reply Draft Yet",
        "未知" => "Unknown",
        "未分类" => "Uncategorized",
        "无保存理由" => "No Saved Reason",
        "未记录" => "Not Recorded",
        "尚无保存的分析记录" => "No Saved Analysis Yet",
        "（无草稿）" => "(No Draft)",
        "重试生成" => "Retry Generation",
        "生成草稿" => "Generate Draft",
        "回读发送结果" => "Check Send Result",
        "使用保存在本机的幂等键发送给本人" => "Send to Yourself Using the Saved Local Request Key",
        "仅本人 OPSADV-QA 测试项可外发" => "Only Your Own OPSADV-QA Test Items Can Be Sent",
        "附件" => "Attachments",
        "星期一" => "Monday",
        "星期二" => "Tuesday",
        "星期三" => "Wednesday",
        "星期四" => "Thursday",
        "星期五" => "Friday",
        "星期六" => "Saturday",
        "星期日" => "Sunday",
        "排队中" => "Queued",
        "发送中" => "Sending",
        "发送结果未知" => "Send Result Unknown",
        "已发送" => "Sent",
        "已送达" => "Delivered",
        "已取消" => "Canceled",
        "其他" => "Other",
        "回收站" => "Trash",
        "搜索任务" => "Search Tasks",
        "请先保存或明确关闭当前任务编辑，再打开其他任务" => "Save or explicitly close the current task editor before opening another task",
        "任务标题" => "Task Title",
        "备注（可选）" => "Notes (Optional)",
        "截止日期 YYYY-MM-DD（可选）" => "Due Date YYYY-MM-DD (Optional)",
        "本机任务草稿存储不可用，请恢复后再保存" => "Local task draft storage is unavailable. Restore it before saving.",
        "标题不能为空" => "Title Is Required",
        "截止日期使用 YYYY-MM-DD" => "Use YYYY-MM-DD for the Due Date",
        "无法保存任务请求，请检查本机存储后重试" => "The task request could not be saved. Check local storage and retry.",
        "任务请求已存在，内容不同；请先审阅原结果" => "This task request already exists with different content. Review its original result.",
        "任务已移到回收站，请先恢复" => "Restore the task from Trash before saving",
        "此任务已在其他地方更新" => "This Task Changed Elsewhere",
        "完成" => "Complete",
        "编辑任务" => "Edit Task",
        "新任务" => "New Task",
        "服务器上的此任务已更新；保存时会提示冲突" => "This task changed on the server. Saving will report a conflict.",
        "载入服务器版本" => "Load Server Version",
        "保存冲突：服务器版本与我的修改不同" => "Save Conflict: The Server Version Differs from Your Edits",
        "无截止" => "No Due Date",
        "保留我的修改" => "Keep My Edits",
        "更新状态" => "Update Status",
        "恢复进行" => "Resume",
        "取消任务" => "Cancel Task",
        "移到回收站" => "Move to Trash",
        "待办" => "To Do",
        "未知状态" => "Unknown Status",
        "回收站为空" => "Trash Is Empty",
        "没有任务" => "No Tasks",
        "今天" => "Today",
        "周一" => "Mon",
        "周二" => "Tue",
        "周三" => "Wed",
        "周四" => "Thu",
        "周五" => "Fri",
        "周六" => "Sat",
        "周日" => "Sun",
        "今天没有待办" => "No Tasks Today",
        "之后" => "Later",
        "暂无安排" => "Nothing Scheduled",
        "暂无记录" => "No Records",
        "未命名记录" => "Untitled Record",
        "正在搜索…" => "Searching…",
        "最近" => "Recent",
        "无法打开设置，请重试" => "Unable to Open Settings. Retry.",
        "连接中…" => "Connecting…",
        "实时同步" => "Live Sync",
        "轮询同步" => "Polling Sync",
        "只能上传文件" => "Only Files Can Be Uploaded",
        "文件为空" => "File Is Empty",
        "文件超过 25 MB 上限" => "File Exceeds the 25 MB Limit",
        "无法解析所选文件路径" => "Unable to Resolve the Selected File Path",
        "本机文件访问策略无法读取或已损坏，请在设置中明确保存有效策略后重试" => "The File Access Policy Is Unreadable or Corrupt. Save a Valid Policy in Settings to Retry",
        "本机文件屏蔽策略格式无效，未读取文件" => "The File Exclusion Policy Is Invalid; The File Was Not Read",
        "本机文件屏蔽路径无效，未读取文件" => "The Blocked Path Is Invalid; The File Was Not Read",
        "无法解析文件屏蔽路径，未读取文件；请在设置中保存有效路径后重试" => "Unable to Resolve the Blocked Path. Save a Valid Path in Settings to Retry",
        "图片超过直接显示上限，请打开附件预览" => "Image Exceeds the Inline Limit; Open the Attachment Preview",
        "图片读取失败" => "Unable to Read Image",
        "正在加载图片…" => "Loading Image…",
        "正在加载详情…" => "Loading Details…",
        "预览图片" => "Preview Image",
        "无法读取本机文件访问策略" => "Unable to Read the Local File Access Policy",
        "此文件位于已屏蔽路径，未读取或上传" => "This File Is in a Blocked Path; It Was Not Read or Uploaded",
        "无法读取预览文件" => "Unable to Read the Preview File",
        "文件超过 2 MB 正文预览上限，可在系统应用中打开已验证文件" => "File Exceeds the 2 MB Preview Limit. Open the Verified File in a System App.",
        "无法读取预览正文" => "Unable to Read the Preview Text",
        "文件不是 UTF-8 文本，无法预览" => "The File Is Not UTF-8 Text and Cannot Be Previewed",
        "找不到附件的完整元数据，未打开缓存" => "Full Attachment Metadata Is Missing; the Cache Was Not Opened",
        "服务端附件缺少 SHA-256，无法验证文件完整性" => "The Attachment Has No Server SHA-256; Its Integrity Cannot Be Verified",
        "下载不完整" => "Download Is Incomplete",
        "SHA-256 校验失败" => "SHA-256 Check Failed",
        "文件超过 2 MB 正文预览上限" => "File Exceeds the 2 MB Preview Limit",
        "找不到听写组件" => "Dictation Component Not Found",
        "无法启动听写组件，请重新安装本地应用" => "Unable to Start Dictation. Reinstall the Local App.",
        "听写组件没有输出" => "The Dictation Component Produced No Output",
        "麦克风采集已中断" => "Microphone Capture Was Interrupted",
        "录音超过12MB" => "Recording Exceeds 12 MB",
        "录音格式无效" => "Invalid Recording Format",
        "%-m月%-d日" => "%b %-d",
        "无法连接 OpsTwin 服务" => "Unable to Connect to the OpsTwins Service",
        "服务返回格式无法识别" => "The Service Response Could Not Be Parsed",
        "判断方法：" => "Assessment Method: ",
        "状态：" => "Status: ",
        "路线：" => "Route: ",
        "保存理由：" => "Saved Reason: ",
        "模型：" => "Model: ",
        _ => s,
    }
    .into()
}

pub fn set_language(language: &str, cx: &mut App) {
    LOCALE_EN.store(language == "en", std::sync::atomic::Ordering::Relaxed);
    crate::install_menus(cx);
    cx.refresh_windows();
}
pub fn body_px(base: f32, cx: &App) -> Pixels {
    px(base * cx.theme().font_size.as_f32() / 15.)
}
fn section_icon(key: &str) -> gpui_kit::assets::IconName {
    use gpui_kit::assets::IconName;
    match key {
        "general" => IconName::Settings2,
        "models" => IconName::Lightbulb,
        "connections" => IconName::Link,
        "filesystem" | "identity" => IconName::FileText,
        "dictation" => IconName::Mic,
        "autonomy" | "legal" => IconName::Shield,
        "channels" => IconName::MessageCircle,
        "devices" => IconName::MonitorSmartphone,
        _ => IconName::Info,
    }
}

// Display labels never replace the exact provider model ID sent to the API.
fn model_display_name(id: &str) -> String {
    match id {
        "deepseek-v4.1-flash" => "DeepSeek V4.1 Flash".into(),
        "claude-opus-5-5" => "Claude Opus 5.5".into(),
        _ => id.to_string(),
    }
}

fn setting_art(key: &str, dark: bool, selected: bool) -> std::sync::Arc<Image> {
    static ICONS: std::sync::OnceLock<Vec<std::sync::Arc<Image>>> = std::sync::OnceLock::new();
    let icons = ICONS.get_or_init(|| {
        [
            include_bytes!("../../assets/settings/settings-light.svg").as_slice(),
            include_bytes!("../../assets/settings/settings-dark.svg").as_slice(),
            include_bytes!("../../assets/settings/settings-selected.svg").as_slice(),
            include_bytes!("../../assets/settings/settings-selected-dark.svg").as_slice(),
            include_bytes!("../../assets/settings/bulb-light.svg").as_slice(),
            include_bytes!("../../assets/settings/bulb-dark.svg").as_slice(),
            include_bytes!("../../assets/settings/bulb-selected.svg").as_slice(),
            include_bytes!("../../assets/settings/bulb-selected-dark.svg").as_slice(),
            include_bytes!("../../assets/settings/link-light.svg").as_slice(),
            include_bytes!("../../assets/settings/link-dark.svg").as_slice(),
            include_bytes!("../../assets/settings/link-selected.svg").as_slice(),
            include_bytes!("../../assets/settings/link-selected-dark.svg").as_slice(),
            include_bytes!("../../assets/settings/file-light.svg").as_slice(),
            include_bytes!("../../assets/settings/file-dark.svg").as_slice(),
            include_bytes!("../../assets/settings/file-selected.svg").as_slice(),
            include_bytes!("../../assets/settings/file-selected-dark.svg").as_slice(),
            include_bytes!("../../assets/settings/mic-light.svg").as_slice(),
            include_bytes!("../../assets/settings/mic-dark.svg").as_slice(),
            include_bytes!("../../assets/settings/mic-selected.svg").as_slice(),
            include_bytes!("../../assets/settings/mic-selected-dark.svg").as_slice(),
            include_bytes!("../../assets/settings/shield-light.svg").as_slice(),
            include_bytes!("../../assets/settings/shield-dark.svg").as_slice(),
            include_bytes!("../../assets/settings/shield-selected.svg").as_slice(),
            include_bytes!("../../assets/settings/shield-selected-dark.svg").as_slice(),
            include_bytes!("../../assets/settings/chat-light.svg").as_slice(),
            include_bytes!("../../assets/settings/chat-dark.svg").as_slice(),
            include_bytes!("../../assets/settings/chat-selected.svg").as_slice(),
            include_bytes!("../../assets/settings/chat-selected-dark.svg").as_slice(),
            include_bytes!("../../assets/settings/devices-light.svg").as_slice(),
            include_bytes!("../../assets/settings/devices-dark.svg").as_slice(),
            include_bytes!("../../assets/settings/devices-selected.svg").as_slice(),
            include_bytes!("../../assets/settings/devices-selected-dark.svg").as_slice(),
            include_bytes!("../../assets/settings/info-light.svg").as_slice(),
            include_bytes!("../../assets/settings/info-dark.svg").as_slice(),
            include_bytes!("../../assets/settings/info-selected.svg").as_slice(),
            include_bytes!("../../assets/settings/info-selected-dark.svg").as_slice(),
        ]
        .into_iter()
        .map(|b| std::sync::Arc::new(Image::from_bytes(ImageFormat::Svg, b.to_vec())))
        .collect()
    });
    let base = match key {
        "general" => 0,
        "models" => 4,
        "connections" => 8,
        "filesystem" | "identity" => 12,
        "dictation" => 16,
        "autonomy" | "legal" => 20,
        "channels" => 24,
        "devices" => 28,
        _ => 32,
    };
    icons[base + usize::from(dark) + if selected { 2 } else { 0 }].clone()
}

fn provider_art(key: &str) -> std::sync::Arc<Image> {
    static ICONS: std::sync::OnceLock<Vec<std::sync::Arc<Image>>> = std::sync::OnceLock::new();
    let icons = ICONS.get_or_init(|| {
        [
            include_bytes!("../../../../docs/design/assets/gmail.svg").as_slice(),
            include_bytes!("../../../../docs/design/assets/google-calendar.svg").as_slice(),
            include_bytes!("../../../../docs/design/assets/feishu.svg").as_slice(),
            include_bytes!("../../../../docs/design/assets/wechat.svg").as_slice(),
        ]
        .into_iter()
        .map(|b| std::sync::Arc::new(Image::from_bytes(ImageFormat::Svg, b.to_vec())))
        .collect()
    });
    icons[match key {
        "gmail" => 0,
        "google-calendar" => 1,
        "feishu" => 2,
        _ => 3,
    }]
    .clone()
}
