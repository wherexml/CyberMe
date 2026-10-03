//! OpsTwin HTTP + SSE client for native shells.
//!
//! Holds no model keys: chat goes through `POST /api/chat` on the local
//! OpsTwin server. Never logs message bodies.

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
    /// Short user-facing text (server message is already localized).
    pub fn user_text(&self) -> String {
        match self {
            ApiError::Network(_) => "无法连接 OpsTwin 服务".into(),
            ApiError::Api { message, code, .. } => {
                if message.is_empty() { code.clone() } else { message.clone() }
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
        Self { base, http, stream_http }
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
            code: env.error.unwrap_or_else(|| status.canonical_reason().unwrap_or("error").to_string()),
            message: env.message.unwrap_or_default(),
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
            next_before: if start > 0 { items.first().map(|m| m.id.clone()) } else { None },
            items,
        })
    }

    pub async fn health_revision(&self) -> Result<u64, ApiError> {
        let v: serde_json::Value = self.get("/api/health").await?;
        Ok(v.get("revision").and_then(|r| r.as_u64()).unwrap_or(0))
    }

    /// `POST /api/chat`. Waits until the run finishes (no total timeout).
    pub async fn chat(&self, req: &ChatRequest) -> Result<ChatResponse, ApiError> {
        let resp = self
            .stream_http
            .post(self.url("/api/chat"))
            .json(&json!({
                "conversationId": req.conversation_id,
                "message": req.message,
                "requestId": req.request_id,
            }))
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

pub fn new_request_id() -> String {
    format!("native-{}", uuid::Uuid::new_v4())
}
