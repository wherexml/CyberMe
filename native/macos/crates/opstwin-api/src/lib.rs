//! OpsTwin HTTP + SSE client for native shells.
//!
//! Holds no model keys: chat goes through `POST /api/chat` on the local
//! OpsTwin server. Never logs message bodies.

pub mod chat_product;
pub mod inbox_product;
pub mod product;
pub mod sse;
pub mod types;

use std::time::Duration;

use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use serde_json::json;

pub use types::*;

pub const DEFAULT_BASE: &str = "http://127.0.0.1:46110";

/// Typed error. `Api` carries the server's `{error, message}` envelope.
#[derive(Debug, Clone, thiserror::Error)]
pub enum ApiError {
    #[error("network error: {0}")]
    Network(String),
    #[error("{status} {code}: {message}")]
    Api {
        status: u16,
        code: String,
        message: String,
        /// Server `detail` object (e.g. `edit_conflict` carries the current entity).
        detail: Option<serde_json::Value>,
    },
    #[error("decode error: {0}")]
    Decode(String),
}

impl ApiError {
    /// Whether the same request (same requestId) may be retried automatically.
    pub fn is_retryable(&self) -> bool {
        match self {
            ApiError::Network(_) => true,
            ApiError::Api { status, .. } => *status >= 500,
            ApiError::Decode(_) => false,
        }
    }
    pub fn code(&self) -> Option<&str> {
        match self {
            ApiError::Api { code, .. } => Some(code),
            _ => None,
        }
    }
    pub fn is_in_progress(&self) -> bool {
        matches!(self, ApiError::Api { status: 409, code, .. } if code == "request_in_progress" || code == "conversation_busy")
    }
    pub fn is_conflict(&self) -> bool {
        matches!(self, ApiError::Api { status: 409, code, .. } if code == "request_conflict")
    }
    pub fn is_edit_conflict(&self) -> bool {
        matches!(self, ApiError::Api { status: 409, code, .. } if code == "edit_conflict")
    }
    pub fn status(&self) -> Option<u16> {
        match self {
            ApiError::Api { status, .. } => Some(*status),
            _ => None,
        }
    }
    pub fn detail(&self) -> Option<&serde_json::Value> {
        match self {
            ApiError::Api { detail, .. } => detail.as_ref(),
            _ => None,
        }
    }
    /// The outcome of the request is unknown (connection lost or server
    /// error), so any external effect must be read back before a retry.
    pub fn outcome_unknown(&self) -> bool {
        match self {
            ApiError::Network(_) | ApiError::Decode(_) => true,
            ApiError::Api { status, .. } => *status >= 500,
        }
    }
    /// Short user-facing text (server message is already localized).
    pub fn user_text(&self) -> String {
        match self {
            ApiError::Network(_) => "无法连接 OpsTwin 服务".into(),
            ApiError::Api { message, code, .. } => {
                if message.is_empty() {
                    code.clone()
                } else {
                    message.clone()
                }
            }
            ApiError::Decode(_) => "服务返回格式无法识别".into(),
        }
    }
}

fn net(e: reqwest::Error) -> ApiError {
    // reqwest errors may include the URL but never the body.
    ApiError::Network(e.without_url().to_string())
}

#[derive(Clone)]
pub struct Client {
    base: String,
    http: reqwest::Client,
    /// Separate client without total timeout for SSE and long chat runs.
    stream_http: reqwest::Client,
}

impl Client {
    pub fn from_env() -> Self {
        let base = std::env::var("OPSTWIN_API").unwrap_or_else(|_| DEFAULT_BASE.to_string());
        Self::new(base)
    }

    pub fn new(base: impl Into<String>) -> Self {
        let base = base.into().trim_end_matches('/').to_string();
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(30))
            .user_agent("opstwin-native-macos/0.1")
            .build()
            .expect("reqwest client");
        let stream_http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .user_agent("opstwin-native-macos/0.1")
            .build()
            .expect("reqwest client");
        Self {
            base,
            http,
            stream_http,
        }
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base, path)
    }

    async fn decode<T: DeserializeOwned>(resp: reqwest::Response) -> Result<T, ApiError> {
        let status = resp.status();
        let bytes = resp.bytes().await.map_err(net)?;
        if status.is_success() {
            return serde_json::from_slice(&bytes).map_err(|e| ApiError::Decode(e.to_string()));
        }
        let env: ErrorEnvelope = serde_json::from_slice(&bytes).unwrap_or_default();
        Err(ApiError::Api {
            status: status.as_u16(),
            code: env
                .error
                .unwrap_or_else(|| status.canonical_reason().unwrap_or("error").to_string()),
            message: env.message.unwrap_or_default(),
            detail: env.detail,
        })
    }

    async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, ApiError> {
        let resp = self.http.get(self.url(path)).send().await.map_err(net)?;
        Self::decode(resp).await
    }

    /// `GET /api/native/version`. `Ok(None)` when the server predates it (404).
    pub async fn version(&self) -> Result<Option<NativeVersion>, ApiError> {
        match self.get::<NativeVersion>("/api/native/version").await {
            Ok(v) => Ok(Some(v)),
            Err(ApiError::Api { status: 404, .. }) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub async fn primary_conversation(&self) -> Result<PrimaryConversation, ApiError> {
        self.get("/api/conversations/primary").await
    }

    pub async fn messages_page(
        &self,
        conversation_id: &str,
        before: Option<&str>,
        limit: u32,
    ) -> Result<MessagePage, ApiError> {
        let mut req = self
            .http
            .get(self.url(&format!("/api/conversations/{conversation_id}/messages")))
            .query(&[("limit", limit.to_string())]);
        if let Some(b) = before {
            req = req.query(&[("before", b)]);
        }
        let resp = req.send().await.map_err(net)?;
        Self::decode(resp).await
    }

    /// Fallback for servers without `messages.page`: read `/api/bootstrap`
    /// and slice the newest `limit` messages of the conversation.
    pub async fn messages_from_bootstrap(
        &self,
        conversation_id: &str,
        before: Option<&str>,
        limit: u32,
    ) -> Result<MessagePage, ApiError> {
        let boot: Bootstrap = self.get("/api/bootstrap").await?;
        let mut all: Vec<Message> = boot
            .messages
            .into_iter()
            .filter(|m| m.conversation_id.as_deref() == Some(conversation_id))
            .collect();
        all.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        let end = match before {
            Some(b) => all.iter().position(|m| m.id == b).unwrap_or(all.len()),
            None => all.len(),
        };
        let start = end.saturating_sub(limit as usize);
        let items: Vec<Message> = all[start..end].to_vec();
        Ok(MessagePage {
            has_more: start > 0,
            next_before: if start > 0 {
                items.first().map(|m| m.id.clone())
            } else {
                None
            },
            items,
        })
    }

    pub async fn health_revision(&self) -> Result<u64, ApiError> {
        let v: serde_json::Value = self.get("/api/health").await?;
        Ok(v.get("revision").and_then(|r| r.as_u64()).unwrap_or(0))
    }

    /// `POST /api/chat`. Waits until the run finishes (no total timeout).
    pub async fn chat(&self, req: &ChatRequest) -> Result<ChatResponse, ApiError> {
        let mut body = json!({
            "conversationId": req.conversation_id,
            "message": req.message,
            "requestId": req.request_id,
        });
        // Omitted when empty: the server fingerprints `attachmentIds||[]`,
        // so both forms replay identically.
        if !req.attachment_ids.is_empty() {
            body["attachmentIds"] = json!(req.attachment_ids);
        }
        let resp = self
            .stream_http
            .post(self.url("/api/chat"))
            .json(&body)
            .send()
            .await
            .map_err(net)?;
        Self::decode(resp).await
    }

    /// Open `GET /api/native/events`. Calls `on_event` for each SSE event
    /// until the stream ends or errors. Returns the last seen event id.
    pub async fn events(
        &self,
        last_event_id: Option<u64>,
        mut on_event: impl FnMut(sse::Event),
    ) -> Result<Option<u64>, ApiError> {
        use futures_util::StreamExt;
        let mut req = self
            .stream_http
            .get(self.url("/api/native/events"))
            .header("Accept", "text/event-stream");
        if let Some(id) = last_event_id {
            req = req.header("Last-Event-ID", id.to_string());
        }
        let resp = req.send().await.map_err(net)?;
        if resp.status() != StatusCode::OK {
            return Err(ApiError::Api {
                status: resp.status().as_u16(),
                code: "events_unavailable".into(),
                message: String::new(),
                detail: None,
            });
        }
        let mut parser = sse::Parser::default();
        let mut last = last_event_id;
        let mut stream = resp.bytes_stream();
        // Server pings every 15s; treat 45s silence as a dead connection.
        loop {
            let next = tokio::time::timeout(Duration::from_secs(45), stream.next()).await;
            let chunk = match next {
                Err(_) => return Err(ApiError::Network("event stream idle timeout".into())),
                Ok(None) => return Ok(last),
                Ok(Some(Err(e))) => return Err(net(e)),
                Ok(Some(Ok(c))) => c,
            };
            for ev in parser.feed(&chunk) {
                if let Some(id) = ev.id.as_deref().and_then(|s| s.parse().ok()) {
                    last = Some(id);
                }
                on_event(ev);
            }
        }
    }
}

/// Download result: bytes plus what the server declared.
#[derive(Debug, Clone)]
pub struct Download {
    pub bytes: Vec<u8>,
    pub content_type: Option<String>,
    pub content_length: Option<u64>,
}

pub const MAX_UPLOAD_BYTES: u64 = 25 * 1024 * 1024;

impl Client {
    async fn send_json<T: DeserializeOwned>(
        &self,
        req: reqwest::RequestBuilder,
    ) -> Result<T, ApiError> {
        let resp = req.send().await.map_err(net)?;
        Self::decode(resp).await
    }

    // ------------------------------------------------------------- inbox

    /// `GET /api/inbox/query` → `{items,total,offset,limit,hasMore,nextOffset,unknownTimeCount,...}`.
    pub async fn inbox_query(&self, q: &InboxQuery) -> Result<InboxQueryPage, ApiError> {
        let mut params: Vec<(&str, String)> = vec![
            ("offset", q.offset.to_string()),
            ("limit", q.limit.clamp(1, 200).to_string()),
        ];
        if !q.query.trim().is_empty() {
            params.push(("query", q.query.trim().to_string()));
        }
        if let Some(s) = &q.status {
            params.push(("status", s.clone()));
        }
        if q.include_done {
            params.push(("includeDone", "true".into()));
        }
        self.send_json(self.http.get(self.url("/api/inbox/query")).query(&params))
            .await
    }

    pub async fn inbox_item(&self, id: &str) -> Result<InboxItem, ApiError> {
        self.get(&format!("/api/inbox/{}", enc(id))).await
    }

    /// `PATCH /api/inbox/:id` with arbitrary fields (+ optional baseUpdatedAt).
    pub async fn inbox_patch(
        &self,
        id: &str,
        body: serde_json::Value,
    ) -> Result<InboxItem, ApiError> {
        self.send_json(
            self.http
                .patch(self.url(&format!("/api/inbox/{}", enc(id))))
                .json(&body),
        )
        .await
    }

    /// `POST /api/inbox/:id/draft` (model run; no total timeout).
    pub async fn inbox_generate_draft(
        &self,
        id: &str,
        request_id: &str,
    ) -> Result<DraftResult, ApiError> {
        self.send_json(
            self.stream_http
                .post(self.url(&format!("/api/inbox/{}/draft", enc(id))))
                .json(&json!({ "mode": "auto", "requestId": request_id })),
        )
        .await
    }

    /// `POST /api/inbox/:id/send {draft,idempotencyKey}`. The caller must have
    /// persisted `key` before calling.
    pub async fn inbox_send(
        &self,
        id: &str,
        draft: &str,
        key: &str,
    ) -> Result<SendResult, ApiError> {
        self.send_json(
            self.stream_http
                .post(self.url(&format!("/api/inbox/{}/send", enc(id))))
                .timeout(Duration::from_secs(300))
                .json(&json!({ "draft": draft, "idempotencyKey": key })),
        )
        .await
    }

    pub async fn inbox_undo(&self, id: &str, key: &str) -> Result<UndoResult, ApiError> {
        self.send_json(
            self.stream_http
                .post(self.url(&format!("/api/inbox/{}/undo", enc(id))))
                .timeout(Duration::from_secs(120))
                .json(&json!({ "idempotencyKey": key })),
        )
        .await
    }

    // ------------------------------------------------------------- tasks

    pub async fn tasks(
        &self,
        deleted: bool,
        status: Option<&str>,
        query: &str,
        offset: u64,
        limit: u32,
    ) -> Result<ListPage<Task>, ApiError> {
        let mut params: Vec<(&str, String)> = vec![
            ("offset", offset.to_string()),
            ("limit", limit.clamp(1, 200).to_string()),
        ];
        if deleted {
            params.push(("deleted", "true".into()));
        }
        if let Some(s) = status {
            params.push(("status", s.to_string()));
        }
        if !query.trim().is_empty() {
            params.push(("query", query.trim().to_string()));
        }
        self.send_json(self.http.get(self.url("/api/tasks")).query(&params))
            .await
    }

    pub async fn task_get(&self, id: &str) -> Result<Task, ApiError> {
        self.send_json(self.http.get(self.url(&format!("/api/tasks/{}", enc(id)))))
            .await
    }

    pub async fn task_get_including_deleted(&self, id: &str) -> Result<Task, ApiError> {
        self.send_json(
            self.http
                .get(self.url(&format!("/api/tasks/{}?includeDeleted=true", enc(id)))),
        )
        .await
    }

    pub async fn task_create(&self, body: serde_json::Value) -> Result<Task, ApiError> {
        self.send_json(self.http.post(self.url("/api/tasks")).json(&body))
            .await
    }

    pub async fn task_patch(&self, id: &str, body: serde_json::Value) -> Result<Task, ApiError> {
        self.send_json(
            self.http
                .patch(self.url(&format!("/api/tasks/{}", enc(id))))
                .json(&body),
        )
        .await
    }

    pub async fn task_delete(&self, id: &str) -> Result<serde_json::Value, ApiError> {
        self.send_json(
            self.http
                .delete(self.url(&format!("/api/tasks/{}", enc(id)))),
        )
        .await
    }

    pub async fn task_restore(&self, id: &str) -> Result<Task, ApiError> {
        self.send_json(
            self.http
                .post(self.url(&format!("/api/tasks/{}/restore", enc(id))))
                .json(&json!({})),
        )
        .await
    }

    // ------------------------------------------------------------- files

    /// `POST /api/files` multipart (`file`, optional `conversationId`).
    pub async fn upload_file(
        &self,
        file_name: String,
        mime: String,
        bytes: Vec<u8>,
        conversation_id: Option<String>,
    ) -> Result<Artifact, ApiError> {
        if bytes.len() as u64 > MAX_UPLOAD_BYTES {
            return Err(ApiError::Api {
                status: 413,
                code: "file_size".into(),
                message: "文件超过 25 MB".into(),
                detail: None,
            });
        }
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(file_name)
            .mime_str(&mime)
            .map_err(|e| ApiError::Decode(e.to_string()))?;
        let mut form = reqwest::multipart::Form::new().part("file", part);
        if let Some(c) = conversation_id {
            form = form.text("conversationId", c);
        }
        self.send_json(
            self.stream_http
                .post(self.url("/api/files"))
                .timeout(Duration::from_secs(300))
                .multipart(form),
        )
        .await
    }

    /// `GET /api/artifacts?offset&limit` envelope.
    pub async fn artifact_get(&self, id: &str) -> Result<Artifact, ApiError> {
        self.send_json(
            self.http
                .get(self.url(&format!("/api/artifacts/{}", enc(id)))),
        )
        .await
    }

    pub async fn artifacts_page(
        &self,
        offset: u64,
        limit: u32,
    ) -> Result<ListPage<Artifact>, ApiError> {
        self.send_json(
            self.http
                .get(self.url("/api/artifacts"))
                .query(&[("offset", offset.to_string()), ("limit", limit.to_string())]),
        )
        .await
    }

    /// `GET /files/:id`, refusing bodies larger than `max_bytes`.
    pub async fn download_file(&self, id: &str, max_bytes: u64) -> Result<Download, ApiError> {
        use futures_util::StreamExt;
        let resp = self
            .stream_http
            .get(self.url(&format!("/files/{}", enc(id))))
            .timeout(Duration::from_secs(300))
            .send()
            .await
            .map_err(net)?;
        if !resp.status().is_success() {
            return Self::decode::<serde_json::Value>(resp)
                .await
                .and_then(|_| Err(ApiError::Decode("unexpected success body".into())));
        }
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let content_length = resp.content_length();
        if content_length.is_some_and(|n| n > max_bytes) {
            return Err(ApiError::Decode("file larger than expected".into()));
        }
        let mut bytes = Vec::new();
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(net)?;
            bytes.extend_from_slice(&chunk);
            if bytes.len() as u64 > max_bytes {
                return Err(ApiError::Decode("file larger than expected".into()));
            }
        }
        Ok(Download {
            bytes,
            content_type,
            content_length,
        })
    }
}

fn enc(id: &str) -> String {
    // Ids are `[\w-]` in practice; percent-encode anything else.
    let mut out = String::with_capacity(id.len());
    for b in id.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

pub fn new_idempotency_key() -> String {
    // Server limit is 50 chars.
    format!("native-{}", uuid::Uuid::new_v4().simple())
}

pub fn new_request_id() -> String {
    format!("native-{}", uuid::Uuid::new_v4())
}
