//! Product chat APIs. Recovery reads never start an Agent run.
use crate::{ApiError, ChatRequest, ChatResponse, Client, Conversation, enc, net};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RequestStatus {
    pub request_id: String,
    pub status: String,
    pub conversation_id: Option<String>,
    pub run_id: Option<String>,
    pub result: Option<ChatResponse>,
    pub run_status: Option<String>,
    /// Missing evidence remains unknown, never an invented zero.
    pub completed_writes: Option<Vec<Value>>,
}

impl RequestStatus {
    pub fn record_metadata(&self) -> Value {
        json!({"requestId":self.request_id,"conversationId":self.conversation_id,
            "status":self.status,"runId":self.run_id,"runStatus":self.run_status,
            "completedWrites":self.completed_writes,
            "completedWriteCount":self.completed_writes.as_ref().map(Vec::len)})
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RecoveryIntent {
    pub request_id: String,
    pub conversation_id: String,
    pub status: String,
    pub run_id: Option<String>,
    pub run_status: Option<String>,
    pub user_message_id: Option<String>,
    pub completed_write_count: Option<u64>,
    pub updated_at: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RecoveryPage {
    pub conversation_id: String,
    pub revision: u64,
    pub total: u64,
    pub partial_count: u64,
    pub items: Vec<RecoveryIntent>,
    pub has_more: bool,
    pub next_before: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Continuation {
    pub running: bool,
    pub items: Vec<Value>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SessionState {
    pub id: String,
    pub found: bool,
    pub running: bool,
    pub partial: bool,
    pub pending: u32,
    pub locked: bool,
}

impl Client {
    pub async fn chat_unresolved_intents(
        &self,
        conversation_id: &str,
        before: Option<&str>,
        revision: Option<u64>,
    ) -> Result<RecoveryPage, ApiError> {
        let mut route = format!("/api/chat/conversations/{}/unresolved?limit=100", enc(conversation_id));
        if let Some(before) = before { route.push_str(&format!("&before={}", enc(before))); }
        if let Some(revision) = revision { route.push_str(&format!("&revision={revision}")); }
        let value: Value = self.get(&route).await?;
        // Do not decode an unsupported/malformed response into an empty success.
        if value.get("items").and_then(Value::as_array).is_none()
            || value.get("conversationId").and_then(Value::as_str) != Some(conversation_id)
            || value.get("revision").and_then(Value::as_u64).is_none()
            || value.get("total").and_then(Value::as_u64).is_none()
            || value.get("partialCount").and_then(Value::as_u64).is_none()
            || value.get("hasMore").and_then(Value::as_bool).is_none()
        { return Err(ApiError::Decode("未确认运行回查响应无效".into())); }
        let page: RecoveryPage = serde_json::from_value(value).map_err(|e| ApiError::Decode(e.to_string()))?;
        if page.items.len() > 100 || page.total < page.items.len() as u64 || page.partial_count > page.total
            || page.items.iter().any(|v| v.request_id.is_empty() || v.conversation_id != conversation_id || !["running", "partial", "failed"].contains(&v.status.as_str()))
            || (page.has_more && (page.items.is_empty() || page.next_before.as_deref().is_none_or(str::is_empty)))
        { return Err(ApiError::Decode("未确认运行回查范围无效".into())); }
        Ok(page)
    }
    pub async fn chat_session_states(&self, ids: &[String]) -> Result<Vec<SessionState>, ApiError> {
        let value: Value = self
            .get(&format!(
                "/api/chat/conversations/state?ids={}",
                enc(&ids.join(","))
            ))
            .await?;
        serde_json::from_value(value.get("items").cloned().unwrap_or_default())
            .map_err(|e| ApiError::Decode(e.to_string()))
    }

    pub async fn chat_request_status(&self, id: &str) -> Result<RequestStatus, ApiError> {
        self.get(&format!("/api/chat/requests/{}", enc(id))).await
    }
    pub async fn chat_product(&self, req: &ChatRequest) -> Result<ChatResponse, ApiError> {
        self.chat_product_context(req, &[]).await
    }
    pub async fn chat_product_context(
        &self,
        req: &ChatRequest,
        context_ids: &[String],
    ) -> Result<ChatResponse, ApiError> {
        self.send_json(self.stream_http.post(self.url("/api/chat")).json(&json!({
            "conversationId":req.conversation_id,"message":req.message,"requestId":req.request_id,
            "attachmentIds":req.attachment_ids,"contextIds":context_ids,"preservePrimary":req.conversation_id.is_some()
        }))).await
    }
    /// A durable new request stops the prior chat before beginning its reply.
    pub async fn chat_product_interrupt_context(
        &self, req: &ChatRequest, context_ids: &[String],
    ) -> Result<ChatResponse, ApiError> {
        self.send_json(self.stream_http.post(self.url("/api/chat")).json(&json!({
            "conversationId":req.conversation_id,"message":req.message,"requestId":req.request_id,
            "attachmentIds":req.attachment_ids,"contextIds":context_ids,
            "preservePrimary":req.conversation_id.is_some(),"interruptCurrent":true
        }))).await
    }
    pub async fn chat_conversations(&self) -> Result<Vec<Conversation>, ApiError> {
        let v: Value = self.get("/api/conversations?limit=200").await?;
        serde_json::from_value(v.get("items").cloned().unwrap_or(v))
            .map_err(|e| ApiError::Decode(e.to_string()))
    }
    pub async fn chat_create_side(&self, id: &str, title: &str) -> Result<Conversation, ApiError> {
        self.send_json(
            self.http
                .post(self.url("/api/conversations/side"))
                .json(&json!({"id":id,"title":title})),
        )
        .await
    }
    pub async fn chat_continuation_receipt(&self, id: &str) -> Result<Value, ApiError> {
        self.get(&format!("/api/chat/continuation/receipts/{}", enc(id)))
            .await
    }
    pub async fn chat_continuation(&self, id: &str) -> Result<Continuation, ApiError> {
        self.get(&format!("/api/chat/continuation/{}", enc(id)))
            .await
    }
    pub async fn chat_continue(
        &self,
        req: &ChatRequest,
        delivery: &str,
    ) -> Result<Value, ApiError> {
        self.chat_continue_context(req, delivery, &[]).await
    }
    pub async fn chat_continue_context(
        &self,
        req: &ChatRequest,
        delivery: &str,
        context_ids: &[String],
    ) -> Result<Value, ApiError> {
        self.send_json(self.stream_http.post(self.url("/api/chat/continuation")).json(&json!({
            "conversationId":req.conversation_id,"message":req.message,"requestId":req.request_id,
            "attachmentIds":req.attachment_ids,"contextIds":context_ids,"delivery":delivery
        }))).await
    }
    pub async fn chat_queue_action(&self, id: &str, body: Value) -> Result<Value, ApiError> {
        self.send_json(
            self.http
                .patch(self.url(&format!("/api/chat/continuation/{}", enc(id))))
                .json(&body),
        )
        .await
    }
    /// Cancellation is a removal of a pending/confirmed-failed receipt,
    /// never a way to discard unknown or partial execution evidence.
    pub async fn chat_queue_cancel_verified(&self, id: &str) -> Result<Value, ApiError> {
        let receipt = self.chat_continuation_receipt(id).await?;
        let status = receipt
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        match self.chat_request_status(id).await {
            Ok(state) if ["partial", "running"].contains(&state.status.as_str()) => {
                return Err(ApiError::Api {
                    status: 409,
                    code: "queue_requires_review".into(),
                    message: "原运行未确认或已有部分写入，请查看执行记录".into(),
                    detail: None,
                });
            }
            Ok(state) if !["failed", "succeeded"].contains(&state.status.as_str()) => {
                return Err(ApiError::Decode("原运行状态尚未确认".into()));
            }
            Err(error) if error.status() == Some(404) && ["queued", "failed"].contains(&status) => {
            }
            Err(error) if error.status() == Some(404) => {
                return Err(ApiError::Api {
                    status: 409,
                    code: "queue_requires_review".into(),
                    message: "补充执行结果未知，请先查看原记录".into(),
                    detail: None,
                });
            }
            Err(error) => return Err(error),
            _ => {}
        }
        self.chat_queue_cancel(id).await
    }
    pub async fn chat_queue_cancel(&self, id: &str) -> Result<Value, ApiError> {
        self.send_json(
            self.http
                .delete(self.url(&format!("/api/chat/continuation/{}", enc(id)))),
        )
        .await
    }
    pub async fn chat_run(&self, id: &str) -> Result<Value, ApiError> {
        self.get(&format!("/api/runs/{}", enc(id))).await
    }
    pub async fn chat_record(&self, message_id: &str) -> Result<Value, ApiError> {
        let message: Value = self
            .get(&format!("/api/messages/{}", enc(message_id)))
            .await?;
        match message.get("runId").and_then(Value::as_str) {
            Some(id) => self.get(&format!("/api/runs/{}", enc(id))).await,
            None => match message.get("requestId").and_then(Value::as_str) {
                Some(id) => {
                    let receipt: Value = self.get(&format!("/api/chat/requests/{}", enc(id))).await?;
                    match receipt.get("runId").and_then(Value::as_str) {
                        Some(run_id) => {
                            match self.get::<Value>(&format!("/api/runs/{}", enc(run_id))).await {
                                Ok(run) => Ok(json!({"request":receipt,"run":run})),
                                Err(error) => Ok(json!({"request":receipt,"runReadError":error.user_text()})),
                            }
                        }
                        None => Ok(receipt),
                    }
                }
                None => Ok(json!({"status":"no_run","message":"此消息没有关联执行记录"})),
            },
        }
    }
    pub async fn transcribe_microphone(&self, bytes: Vec<u8>) -> Result<String, ApiError> {
        if bytes.len() > 12 * 1024 * 1024 {
            return Err(ApiError::Decode("录音超过12MB".into()));
        }
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name("dictation.wav")
            .mime_str("audio/wav")
            .map_err(|e| ApiError::Decode(e.to_string()))?;
        let resp = self
            .stream_http
            .post(self.url("/api/voice/transcribe"))
            .timeout(std::time::Duration::from_secs(120))
            .multipart(reqwest::multipart::Form::new().part("file", part))
            .send()
            .await
            .map_err(net)?;
        let v: Value = Self::decode(resp).await?;
        // Production ASR returns transcript; keep compatibility with older
        // adapters that used text. The server retains the run/audio evidence.
        let text = v
            .get("transcript")
            .and_then(Value::as_str)
            .or_else(|| v.get("text").and_then(Value::as_str))
            .unwrap_or("")
            .trim();
        if text.is_empty() {
            return Err(ApiError::Api {
                status: 422,
                code: "empty_transcript".into(),
                message: "没有识别到语音，请重新录音".into(),
                detail: None,
            });
        }
        Ok(text.to_string())
    }
}
