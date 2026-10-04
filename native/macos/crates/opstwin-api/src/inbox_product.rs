//! Additive native Inbox product presentation; all mutation uses existing API guards.
use crate::{ApiError, Client, DraftResult, InboxItem, InboxQueryPage, enc};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftCandidate {
    #[serde(default)]
    pub request_id: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub run_id: Option<String>,
    #[serde(default)]
    pub conversation_id: Option<String>,
}
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxProduct {
    #[serde(flatten)]
    pub item: InboxItem,
    #[serde(default)]
    pub draft_candidate: Option<DraftCandidate>,
    #[serde(default)]
    pub draft_preparation: Option<Value>,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub triage: Option<Value>,
    #[serde(default)]
    pub messages: Vec<Value>,
    #[serde(default)]
    pub source_attachments: Vec<Value>,
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub received_at: Option<String>,
    #[serde(default)]
    pub event_at: Option<String>,
    #[serde(default)]
    pub chat_mode: Option<String>,
    #[serde(default)]
    pub source_id: Option<String>,
    #[serde(default)]
    pub edited_by_user: bool,
    #[serde(default)]
    pub source_processing: Option<Value>,
    #[serde(default)]
    pub source_rule: Option<Value>,
    #[serde(default)]
    pub is_mine: bool,
    #[serde(default)]
    pub direction: Option<String>,
}
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceHistory {
    pub messages: Vec<Value>,
    pub next_offset: u64,
    pub has_more: bool,
}
impl Client {
    pub async fn inbox_policy(&self, id: &str) -> Result<Value, ApiError> {
        self.get(&format!("/api/inbox/{}/policy", enc(id))).await
    }
    /// Selection only auto-drafts after current server policy and permission readback.
    /// Unknown channels/permission states are deliberately ineligible.
    pub async fn inbox_auto_draft_allowed(&self, product: &InboxProduct) -> Result<bool, ApiError> {
        let item = &product.item;
        let triage = product.triage.as_ref();
        if item.status != "pending"
            || item.is_self_test
            || item.send_locked()
            || product.is_mine
            || product.direction.as_deref() == Some("outgoing")
            || item.draft.as_ref().is_some_and(|s| !s.trim().is_empty())
            || item.draft_error.is_some()
            || product.edited_by_user
            || product.draft_candidate.is_some()
            || product
                .source_rule
                .as_ref()
                .is_some_and(|r| r["active"] == true)
            || triage.is_none_or(|t| {
                t["status"] != "succeeded"
                    || t["method"] != "jev"
                    || !matches!(t["route"].as_str(), Some("quick_reply" | "deep_reply"))
                    || t["needsReply"]
                        .as_f64()
                        .is_none_or(|p| !p.is_finite() || !(0.75..=1.).contains(&p))
                    || t["missingContext"]
                        .as_f64()
                        .is_none_or(|p| !p.is_finite() || !(0.0..0.5).contains(&p))
            })
            || product
                .messages
                .iter()
                .rev()
                .find(|m| m["type"] != "recalled" && m["type"] != "system")
                .is_some_and(|m| m["isMine"] == true)
            || product.source_processing.as_ref().is_some_and(|p| {
                matches!(
                    p["status"].as_str(),
                    Some("running" | "pending" | "failed" | "blocked" | "interrupted")
                )
            })
        {
            return Ok(false);
        }
        let policy = self.inbox_policy(&item.id).await?;
        if !matches!(policy["mode"].as_str(), Some("chat" | "deep")) {
            return Ok(false);
        }
        let settings: Value = self.get("/api/settings").await?;
        if item.sensitive
            && !settings
                .pointer("/autonomy/levels/sensitive")
                .and_then(Value::as_str)
                .is_some_and(|v| matches!(v, "draft" | "approve" | "auto"))
        {
            return Ok(false);
        }
        if item.channel.eq_ignore_ascii_case("internal") {
            return Ok(!item.sensitive);
        }
        if !item.channel.eq_ignore_ascii_case("feishu") {
            return Ok(false);
        }
        if settings.pointer("/channels/feishu/enabled") == Some(&Value::Bool(false)) {
            return Ok(false);
        }
        let connections: Value = self.get("/api/connections").await?;
        let rows = connections
            .as_array()
            .or_else(|| connections["items"].as_array());
        Ok(rows.is_some_and(|rows| {
            rows.iter().any(|c| {
                c["id"] == "feishu-local"
                    && c["status"] == "connected"
                    && c["permissions"].as_array().is_some_and(|ps| {
                        ps.iter()
                            .any(|p| matches!(p.as_str(), Some("draft" | "drafts.create")))
                    })
            })
        }))
    }
    pub async fn inbox_source_history(
        &self,
        id: &str,
        offset: u64,
        limit: u32,
    ) -> Result<SourceHistory, ApiError> {
        self.send_json(
            self.http
                .get(self.url(&format!("/api/sources/chats/{}/messages", enc(id))))
                .query(&[("offset", offset.to_string()), ("limit", limit.to_string())]),
        )
        .await
    }
    pub fn source_asset_url(&self, message_id: &str, file_key: &str) -> String {
        self.url(&format!(
            "/api/source-message-assets/{}/{}",
            enc(message_id),
            enc(file_key)
        ))
    }
    /// Only a relative indexed source endpoint, never an attachment-provided host.
    pub fn indexed_source_url(&self, path: &str) -> Option<String> {
        let path = path.strip_prefix(self.base()).unwrap_or(path);
        let tail = path.strip_prefix("/api/source-message-assets/")?;
        let parts: Vec<_> = tail.split('/').collect();
        if parts.len() != 2
            || parts
                .iter()
                .any(|p| p.is_empty() || p.contains(['?', '#', '\\']) || matches!(*p, "." | ".."))
        {
            return None;
        }
        Some(self.url(path))
    }
    pub async fn download_source_asset(
        &self,
        path: &str,
        max_bytes: u64,
    ) -> Result<crate::Download, ApiError> {
        use futures_util::StreamExt;
        let url = self
            .indexed_source_url(path)
            .ok_or_else(|| ApiError::Decode("unindexed source asset".into()))?;
        let response = self.http.get(url).send().await.map_err(crate::net)?;
        if !response.status().is_success() {
            return Self::decode::<Value>(response)
                .await
                .and_then(|_| Err(ApiError::Decode("unexpected source body".into())));
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let content_length = response.content_length();
        if content_length.is_some_and(|n| n > max_bytes) {
            return Err(ApiError::Decode("source preview exceeds limit".into()));
        }
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(crate::net)?;
            if bytes.len() as u64 + chunk.len() as u64 > max_bytes {
                return Err(ApiError::Decode("source preview exceeds limit".into()));
            }
            bytes.extend_from_slice(&chunk);
        }
        if bytes.is_empty() || content_length.is_some_and(|n| n != bytes.len() as u64) {
            return Err(ApiError::Decode(
                "source attachment empty or incomplete".into(),
            ));
        }
        Ok(crate::Download {
            bytes,
            content_type,
            content_length,
        })
    }

    pub async fn task_lookup(&self, id: &str) -> Result<crate::Task, ApiError> {
        self.get(&format!("/api/tasks/{}", enc(id))).await
    }

    pub async fn inbox_product(&self, id: &str) -> Result<InboxProduct, ApiError> {
        // Deserialize twice: the flatten contract and presentation share source fields.
        let value: Value = self.get(&format!("/api/inbox/{}", enc(id))).await?;
        let mut product: InboxProduct =
            serde_json::from_value(value.clone()).map_err(|e| ApiError::Decode(e.to_string()))?;
        product.item =
            serde_json::from_value(value).map_err(|e| ApiError::Decode(e.to_string()))?;
        Ok(product)
    }
    pub async fn inbox_apply_candidate(
        &self,
        id: &str,
        request_id: &str,
        base: Option<&str>,
    ) -> Result<DraftResult, ApiError> {
        self.send_json(
            self.http
                .post(self.url(&format!("/api/inbox/{}/draft-candidate/apply", enc(id))))
                .json(&json!({"requestId":request_id,"baseUpdatedAt":base})),
        )
        .await
    }
    pub async fn inbox_triage(&self, id: &str, force: bool) -> Result<Value, ApiError> {
        self.send_json(
            self.stream_http
                .post(self.url(&format!("/api/inbox/{}/triage", enc(id))))
                .json(&json!({"force":force})),
        )
        .await
    }
    pub async fn inbox_quiet_query(
        &self,
        query: &str,
        offset: u64,
        limit: u32,
    ) -> Result<InboxQueryPage, ApiError> {
        let mut value: Value = self
            .send_json(self.http.get(self.url("/api/inbox/query")).query(&[
                ("includeQuiet", "true".to_string()),
                ("includeDone", "true".to_string()),
                ("query", query.to_string()),
                ("offset", offset.to_string()),
                ("limit", limit.to_string()),
            ]))
            .await?;
        let items = value.get_mut("items").and_then(Value::as_array_mut);
        if let Some(items) = items {
            items.retain(|item| item.get("surfacing").and_then(Value::as_str) == Some("quiet"));
        }
        serde_json::from_value(value).map_err(|e| ApiError::Decode(e.to_string()))
    }
}
