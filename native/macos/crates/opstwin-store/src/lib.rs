//! Local persistence for the OpsTwin macOS client.
//!
//! Plain JSON files under `~/Library/Application Support/OpsTwin/` (override
//! with `OPSTWIN_DATA_DIR`). Holds only client-side state that the server
//! does not know yet: unsent composer text, outgoing chat requests with their
//! original requestId, unsaved Inbox edits and Inbox send idempotency keys,
//! plus window/page preferences. No credentials, no copies of server history.
//!
//! Writes are atomic (write temp file, fsync, rename). A corrupt file is moved
//! aside and replaced by defaults instead of crashing the app. Never logs
//! file contents.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

pub const UI_FILE: &str = "ui.json";
pub const CHAT_FILE: &str = "chat.json";
pub const INBOX_FILE: &str = "inbox.json";

#[derive(Clone, Debug)]
pub struct Store {
    dir: PathBuf,
}

impl Store {
    /// `OPSTWIN_DATA_DIR` if set, else `~/Library/Application Support/OpsTwin`.
    pub fn open_default() -> io::Result<Self> {
        let dir = match std::env::var_os("OPSTWIN_DATA_DIR") {
            Some(d) if !d.is_empty() => PathBuf::from(d),
            _ => {
                let home = std::env::var_os("HOME")
                    .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "HOME not set"))?;
                PathBuf::from(home).join("Library/Application Support/OpsTwin")
            }
        };
        Self::open(dir)
    }

    pub fn open(dir: impl Into<PathBuf>) -> io::Result<Self> {
        let dir = dir.into();
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&dir)?;
        Ok(Self { dir })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Load `name`; missing file gives defaults, a corrupt file is moved to
    /// `name.corrupt-<ms>` and defaults are returned.
    pub fn load<T: DeserializeOwned + Default>(&self, name: &str) -> T {
        let path = self.dir.join(name);
        let bytes = match fs::read(&path) {
            Ok(b) => b,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return T::default(),
            Err(e) => {
                eprintln!("[opstwin-store] read {name} failed: {}", e.kind());
                return T::default();
            }
        };
        match serde_json::from_slice(&bytes) {
            Ok(v) => v,
            Err(e) => {
                let aside = self.dir.join(format!("{name}.corrupt-{}", now_ms()));
                let _ = fs::rename(&path, &aside);
                eprintln!(
                    "[opstwin-store] {name} unreadable (line {} col {}); moved aside",
                    e.line(),
                    e.column()
                );
                T::default()
            }
        }
    }

    /// Read security policy without substituting defaults or changing its file.
    /// Missing is permitted only when no previous corrupt-file evidence exists.
    /// A valid explicit replacement takes precedence over preserved evidence.
    pub fn load_strict<T: DeserializeOwned>(&self, name: &str) -> io::Result<Option<T>> {
        let mut components = Path::new(name).components();
        if !matches!(components.next(), Some(std::path::Component::Normal(_)))
            || components.next().is_some()
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "state name must be a filename",
            ));
        }
        let path = self.dir.join(name);
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                // A dangling symlink is existing broken policy, not first use.
                match fs::symlink_metadata(&path) {
                    Ok(_) => {
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidData,
                            "policy target missing",
                        ));
                    }
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error),
                }
                let corrupt_prefix = format!("{name}.corrupt-");
                for entry in fs::read_dir(&self.dir)? {
                    if entry?
                        .file_name()
                        .to_string_lossy()
                        .starts_with(&corrupt_prefix)
                    {
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidData,
                            "previous corrupt policy requires valid replacement",
                        ));
                    }
                }
                return Ok(None);
            }
            Err(error) => return Err(error),
        };
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "persisted JSON is invalid"))
    }

    /// Atomically replace `name` with `value` serialized as JSON.
    pub fn save<T: Serialize>(&self, name: &str, value: &T) -> io::Result<()> {
        let bytes = serde_json::to_vec_pretty(value).map_err(io::Error::other)?;
        write_atomic(&self.dir.join(name), &bytes)
    }
}

/// Write to a sibling temp file, fsync, then rename over `path`.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().unwrap_or(Path::new("."));
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = parent.join(format!(
        ".{file_name}.tmp-{}-{}-{}",
        std::process::id(),
        now_ms(),
        TEMP_NONCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Stable FNV-1a 64-bit content fingerprint (hex). Used to bind an Inbox
/// send key to the exact draft text it was created for.
pub fn content_hash(text: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in text.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

// ------------------------------------------------------------------- shell

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UiState {
    pub last_page: Option<String>,
    pub window: Option<WindowRect>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WindowRect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub maximized: bool,
}

// -------------------------------------------------------------------- chat

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AttachmentRef {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub mime: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutgoingState {
    /// Request was in flight (or about to be) when last saved.
    #[default]
    Pending,
    /// Server reported the original request still running.
    Waiting,
    /// Terminal failure; `retryable` says whether Retry is allowed.
    Failed,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct OutgoingRecord {
    pub context_ids: Vec<String>,
    pub conversation_id: Option<String>,
    pub delivery: Option<String>,
    pub request_id: String,
    pub text: String,
    pub attachments: Vec<AttachmentRef>,
    pub state: OutgoingState,
    pub error: Option<String>,
    pub retryable: bool,
    pub generation: u32,
    pub created_at_ms: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ChatState {
    pub selected_conversation: Option<String>,
    pub keep_panel_visible: bool,
    pub conversations: BTreeMap<String, ConversationState>,
    pub drafts: BTreeMap<String, ConversationDraft>,
    /// Unsent composer text.
    pub draft: String,
    /// Uploaded attachments waiting to be sent with the draft.
    pub draft_attachments: Vec<AttachmentRef>,
    /// Outgoing messages not yet confirmed by the server.
    pub outgoing: Vec<OutgoingRecord>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ConversationDraft {
    pub text: String,
    pub attachments: Vec<AttachmentRef>,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ConversationState {
    pub title: String,
    pub pinned: bool,
    pub archived: bool,
    pub deleted: bool,
    pub created_locally: bool,
}

// ------------------------------------------------------------------- inbox

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct InboxEdit {
    pub text: String,
    /// Server `updatedAt` the edit was based on.
    pub base_updated_at: Option<String>,
    /// Server draft the edit started from (to detect real changes).
    pub base_draft: String,
    pub saved_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SendRecordState {
    /// Key persisted; request may or may not have reached the server.
    #[default]
    Pending,
    /// Server returned a receipt.
    Sent,
    /// Server rejected before any send boundary; a new key is needed.
    Failed,
    /// Recall confirmed.
    Recalled,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SendRecord {
    pub key: String,
    pub draft_hash: String,
    pub state: SendRecordState,
    pub receipt_ids: Vec<String>,
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct InboxState {
    /// Unsaved draft edits by item id.
    pub edits: BTreeMap<String, InboxEdit>,
    /// Send idempotency keys by item id.
    pub sends: BTreeMap<String, SendRecord>,
}
