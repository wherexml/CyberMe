use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Default, Deserialize)]
pub struct ErrorEnvelope {
    pub error: Option<String>,
    pub message: Option<String>,
    #[serde(default)]
    pub detail: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeVersion {
    pub api_version: u32,
    #[serde(default)]
    pub revision: u64,
    #[serde(default)]
    pub server: String,
    #[serde(default)]
    pub features: Vec<String>,
}

impl NativeVersion {
    pub fn has(&self, feature: &str) -> bool {
        self.features.iter().any(|f| f == feature)
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrimaryConversation {
    pub conversation_id: Option<String>,
    pub conversation: Option<Conversation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    #[serde(default)]
    pub conversation_id: Option<String>,
    pub role: Role,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub run_id: Option<String>,
    #[serde(default)]
    pub request_id: Option<String>,
    /// Artifact ids attached to the message.
    #[serde(default, deserialize_with = "string_list")]
    pub attachments: Vec<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// Accepts `["id", ...]` or `[{id,...}, ...]`; ignores anything else.
fn string_list<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<String>, D::Error> {
    let v = Option::<Value>::deserialize(d)?;
    Ok(match v {
        Some(Value::Array(items)) => items
            .into_iter()
            .filter_map(|i| match i {
                Value::String(s) => Some(s),
                Value::Object(o) => o.get("id").and_then(|x| x.as_str()).map(str::to_string),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagePage {
    pub items: Vec<Message>,
    #[serde(default)]
    pub has_more: bool,
    #[serde(default)]
    pub next_before: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Bootstrap {
    #[serde(default)]
    pub messages: Vec<Message>,
}

#[derive(Debug, Clone, Default)]
pub struct ChatRequest {
    pub conversation_id: Option<String>,
    pub message: String,
    pub request_id: String,
    /// Uploaded artifact ids (`POST /api/files`) sent with the message.
    pub attachment_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    pub conversation_id: String,
    #[serde(default)]
    pub user_message: Option<Message>,
    #[serde(default)]
    pub assistant_message: Option<Message>,
    #[serde(default)]
    pub replayed: bool,
    /// Top-level run record (`Run` in shared/types.ts).
    #[serde(default)]
    pub run: Option<RunSummary>,
    /// Echo of the idempotency key (absent on older replays).
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub artifacts: Vec<Artifact>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub id: String,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RevisionData {
    pub revision: u64,
}

// ------------------------------------------------------------------ lists

/// `{items,total,offset,limit,nextOffset,hasMore}` list envelope.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPage<T> {
    pub items: Vec<T>,
    #[serde(default)]
    pub total: u64,
    #[serde(default)]
    pub offset: u64,
    #[serde(default)]
    pub next_offset: u64,
    #[serde(default)]
    pub has_more: bool,
}

// ------------------------------------------------------------------ inbox

/// Row of `GET /api/inbox/query` (server `inboxSummary`).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxSummary {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub sender: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub channel: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub draft: Option<String>,
    #[serde(default)]
    pub event_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub sensitive: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxQueryPage {
    pub items: Vec<InboxSummary>,
    #[serde(default)]
    pub total: u64,
    #[serde(default)]
    pub next_offset: u64,
    #[serde(default)]
    pub has_more: bool,
    #[serde(default)]
    pub unknown_time_count: u64,
}

#[derive(Debug, Clone, Default)]
pub struct InboxQuery {
    pub query: String,
    pub status: Option<String>,
    pub include_done: bool,
    pub offset: u64,
    pub limit: u32,
}

/// One source message in `InboxItem.messages`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMessage {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default, deserialize_with = "loose_string")]
    pub sent_at: Option<String>,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub sender_name: Option<String>,
    #[serde(default)]
    pub is_mine: bool,
    #[serde(default, rename = "type")]
    pub kind: Option<String>,
}

fn loose_string<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Ok(match Option::<Value>::deserialize(d)? {
        Some(Value::String(s)) => Some(s),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    })
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Triage {
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub route: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub needs_reply: Option<f64>,
    #[serde(default)]
    pub risk: Option<f64>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    #[serde(default)]
    pub message_id: Option<String>,
    #[serde(default)]
    pub message_ids: Vec<String>,
}

/// `GET /api/inbox/:id` (full item, presented).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub sender: String,
    #[serde(default)]
    pub channel: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub draft: Option<String>,
    #[serde(default)]
    pub draft_error: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub messages: Vec<SourceMessage>,
    #[serde(default)]
    pub triage: Option<Triage>,
    #[serde(default)]
    pub is_self_test: bool,
    #[serde(default)]
    pub recipient_id: Option<String>,
    #[serde(default)]
    pub test_marker: Option<String>,
    #[serde(default)]
    pub source_system: Option<String>,
    #[serde(default)]
    pub approved: bool,
    #[serde(default)]
    pub sensitive: bool,
    #[serde(default)]
    pub sensitive_approved: bool,
    #[serde(default)]
    pub receipt: Option<Receipt>,
    #[serde(default)]
    pub send_key: Option<String>,
    #[serde(default)]
    pub send_error: Option<String>,
    #[serde(default, deserialize_with = "string_list")]
    pub attachments: Vec<String>,
}

impl InboxItem {
    /// Statuses the web client treats as done (`isDone` in Inbox.tsx).
    pub fn is_done(&self) -> bool {
        is_done_status(&self.status)
    }
    /// Send is only allowed for a dedicated self-test item (server rule in
    /// `sendItem`; mirrored here only to disable the button).
    pub fn can_send(&self) -> bool {
        self.is_self_test
            && self.recipient_id.as_deref() == Some("self")
            && self.source_system.as_deref() != Some("opstwin")
            && self
                .test_marker
                .as_deref()
                .is_some_and(|m| m.starts_with("OPSADV-QA-"))
    }
    /// Payload frozen by an outbound attempt (server `locked_send_payload`).
    pub fn send_locked(&self) -> bool {
        matches!(
            self.status.as_str(),
            "sending" | "sent" | "recalled" | "send_unknown"
        )
    }
}

pub fn is_done_status(status: &str) -> bool {
    matches!(
        status,
        "sent" | "delivered" | "done" | "dismissed" | "recalled" | "cancelled"
    )
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftResult {
    pub item: InboxItem,
    #[serde(default)]
    pub run: Option<RunSummary>,
    #[serde(default)]
    pub replayed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendResult {
    pub item: InboxItem,
    #[serde(default)]
    pub receipt: Option<Receipt>,
    #[serde(default)]
    pub replayed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoResult {
    pub item: InboxItem,
}

// ------------------------------------------------------------------ tasks

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub deleted: bool,
}

impl Task {
    pub fn is_completed(&self) -> bool {
        matches!(self.status.as_str(), "completed" | "done")
    }
}

// -------------------------------------------------------------- artifacts

/// Server `Artifact` (upload result and chat artifacts).
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub mime: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
}
