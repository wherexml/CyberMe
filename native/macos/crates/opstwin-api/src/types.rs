use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Default, Deserialize)]
pub struct ErrorEnvelope {
    pub error: Option<String>,
    pub message: Option<String>,
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
    #[serde(flatten)]
    pub extra: Map<String, Value>,
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

#[derive(Debug, Clone)]
pub struct ChatRequest {
    pub conversation_id: Option<String>,
    pub message: String,
    pub request_id: String,
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
}

#[derive(Debug, Clone, Deserialize)]
pub struct RevisionData {
    pub revision: u64,
}
