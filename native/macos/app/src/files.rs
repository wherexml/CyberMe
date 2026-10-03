//! Attachment upload preparation and verified download to the local cache.
//! All functions here run on the Tokio runtime (called through `io`).

use std::path::{Path, PathBuf};

use opstwin_api::{Artifact, Client, MAX_UPLOAD_BYTES};
use sha2::{Digest, Sha256};

/// `~/Library/Caches/OpsTwin/files`, or `$OPSTWIN_DATA_DIR/cache/files` for QA.
pub fn cache_dir() -> PathBuf {
    if let Some(d) = std::env::var_os("OPSTWIN_DATA_DIR").filter(|d| !d.is_empty()) {
        return PathBuf::from(d).join("cache/files");
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    home.join("Library/Caches/OpsTwin/files")
}

pub struct UploadFile {
    pub name: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}

/// Read a picked file, rejecting empty files and files over 25 MB before
/// reading their bytes.
pub async fn read_upload(path: PathBuf) -> Result<UploadFile, String> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();
    validate_file_access(&path).await?;
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("无法读取文件（{}）", e.kind()))?;
    if !meta.is_file() {
        return Err("只能上传文件".into());
    }
    if meta.len() == 0 {
        return Err("文件为空".into());
    }
    if meta.len() > MAX_UPLOAD_BYTES {
        return Err(format!(
            "文件 {} 超过 25 MB 上限",
            crate::util::human_size(meta.len())
        ));
    }
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("无法读取文件（{}）", e.kind()))?;
    if bytes.len() as u64 > MAX_UPLOAD_BYTES {
        return Err("文件超过 25 MB 上限".into());
    }
    Ok(UploadFile {
        mime: guess_mime(&path).to_string(),
        name,
        bytes,
    })
}

/// Enforce app-local file exclusions at the actual file read boundary.
/// These rules do not grant or report macOS TCC permissions.
pub async fn validate_file_access(path: &Path) -> Result<(), String> {
    let target = tokio::fs::canonicalize(path)
        .await
        .map_err(|_| "无法解析所选文件路径".to_string())?;
    let store =
        opstwin_store::Store::open_default().map_err(|_| "无法读取本机文件访问策略".to_string())?;
    let preferences = store
        .load_strict::<serde_json::Value>("settings-drafts.json")
        .map_err(|_| {
            "本机文件访问策略无法读取或已损坏，请在设置中明确保存有效策略后重试".to_string()
        })?;
    let Some(preferences) = preferences else {
        return Ok(());
    };
    let blocked = preferences
        .pointer("/local/filesystem/blocked")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "本机文件屏蔽策略格式无效，未读取文件".to_string())?;
    for entry in blocked {
        let entry = entry
            .as_str()
            .filter(|s| !s.trim().is_empty() && Path::new(s).is_absolute())
            .ok_or_else(|| "本机文件屏蔽路径无效，未读取文件".to_string())?;
        let root = tokio::fs::canonicalize(entry).await.map_err(|_| {
            "无法解析文件屏蔽路径，未读取文件；请在设置中保存有效路径后重试".to_string()
        })?;
        if target.starts_with(&root) {
            return Err("此文件位于已屏蔽路径，未读取或上传".into());
        }
    }
    Ok(())
}

#[derive(Clone, Debug)]
pub enum FilePreview {
    Text {
        text: String,
        path: PathBuf,
        markdown: bool,
    },
    Image {
        path: PathBuf,
    },
    Unsupported {
        path: PathBuf,
    },
}
/// Download/repair/verify before reading content. Text is bounded to 2 MiB;
/// HTML/SVG remain unsupported to avoid executing remote document content.
pub async fn preview_verified(client: Client, artifact: Artifact) -> Result<FilePreview, String> {
    let path = fetch_verified(client, artifact.clone()).await?;
    let mime = base_mime(&artifact.mime);
    if matches!(
        mime.as_str(),
        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    ) {
        return Ok(FilePreview::Image { path });
    }
    if matches!(
        mime.as_str(),
        "text/plain" | "text/markdown" | "text/csv" | "application/json"
    ) {
        let metadata = tokio::fs::metadata(&path)
            .await
            .map_err(|_| "无法读取预览文件".to_string())?;
        if metadata.len() > 2 * 1024 * 1024 {
            return Err("文件超过 2 MB 正文预览上限，可在系统应用中打开已验证文件".into());
        }
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|_| "无法读取预览正文".to_string())?;
        let text =
            String::from_utf8(bytes).map_err(|_| "文件不是 UTF-8 文本，无法预览".to_string())?;
        return Ok(FilePreview::Text {
            text,
            path,
            markdown: mime == "text/markdown",
        });
    }
    Ok(FilePreview::Unsupported { path })
}

pub fn guess_mime(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "txt" | "log" => "text/plain",
        "md" | "markdown" => "text/markdown",
        "csv" => "text/csv",
        "json" => "application/json",
        "xml" => "application/xml",
        "html" | "htm" => "text/html",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "zip" => "application/zip",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        _ => "application/octet-stream",
    }
}

fn base_mime(m: &str) -> String {
    m.split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
}

fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c == '/' || c == ':' || c == '\\' || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim_start_matches('.').trim();
    let cleaned: String = cleaned.chars().take(120).collect();
    if cleaned.is_empty() {
        "file".into()
    } else {
        cleaned
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Ensure a verified local copy of `art` exists and return its path.
/// Checks the byte count against the artifact record, the Content-Type
/// against the recorded MIME, and SHA-256 when the server recorded one.
pub async fn fetch_verified(client: Client, mut art: Artifact) -> Result<PathBuf, String> {
    // Legacy restored references omit the hash. Resolve authoritative metadata
    // before even considering a cache hit; byte length alone cannot prove integrity.
    if !art
        .sha256
        .as_deref()
        .is_some_and(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        art = lookup_artifacts(client.clone(), vec![art.id.clone()])
            .await?
            .into_iter()
            .find(|a| a.id == art.id)
            .ok_or_else(|| "找不到附件的完整元数据，未打开缓存".to_string())?;
    }
    let expected_hash = art
        .sha256
        .clone()
        .filter(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(|| "服务端附件缺少 SHA-256，无法验证文件完整性".to_string())?;
    let dir = cache_dir();
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("无法创建缓存目录（{}）", e.kind()))?;
    let path = dir.join(format!("{}-{}", safe_name(&art.id), safe_name(&art.name)));

    // Reuse a cached copy only if it still matches the record.
    if let Ok(bytes) = tokio::fs::read(&path).await {
        let size_ok = art.size == 0 || bytes.len() as u64 == art.size;
        let sha_ok = expected_hash.eq_ignore_ascii_case(&sha256_hex(&bytes));
        if size_ok && sha_ok && art.size > 0 {
            return Ok(path);
        }
    }

    // Unknown size: still cap the download.
    let max = if art.size > 0 {
        art.size
    } else {
        200 * 1024 * 1024
    };
    let dl = client
        .download_file(&art.id, max)
        .await
        .map_err(|e| e.user_text())?;
    if art.size > 0 && dl.bytes.len() as u64 != art.size {
        return Err(format!(
            "文件大小不符（记录 {}，收到 {}）",
            art.size,
            dl.bytes.len()
        ));
    }
    if let Some(len) = dl.content_length {
        if len != dl.bytes.len() as u64 {
            return Err("下载不完整".into());
        }
    }
    if !art.mime.is_empty() {
        let got = dl
            .content_type
            .as_deref()
            .map(base_mime)
            .unwrap_or_default();
        if got != base_mime(&art.mime) {
            return Err(format!(
                "文件类型不符（记录 {}，收到 {}）",
                base_mime(&art.mime),
                if got.is_empty() { "未知".into() } else { got }
            ));
        }
    }
    if let Some(expected) = art.sha256.as_deref().filter(|s| !s.is_empty()) {
        if !expected.eq_ignore_ascii_case(&sha256_hex(&dl.bytes)) {
            return Err("SHA-256 校验失败".into());
        }
    }
    let target = path.clone();
    tokio::task::spawn_blocking(move || opstwin_store::write_atomic(&target, &dl.bytes))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("无法写入缓存（{}）", e.kind()))?;
    Ok(path)
}

/// Resolve indexed metadata by exact id, independent of list depth.
pub async fn lookup_artifacts(client: Client, ids: Vec<String>) -> Result<Vec<Artifact>, String> {
    let mut found = Vec::new();
    for id in ids {
        if found.iter().any(|a: &Artifact| a.id == id) {
            continue;
        }
        let artifact = client.artifact_get(&id).await.map_err(|e| e.user_text())?;
        if artifact.id != id {
            return Err("附件记录与请求不一致".into());
        }
        found.push(artifact);
    }
    Ok(found)
}

/// Source attachments are transient and never copied into the Artifact cache.
#[derive(Clone, Debug)]
pub enum SourcePreview {
    Text { text: String, markdown: bool },
    Image { bytes: Vec<u8>, mime: String },
    Unsupported,
}
pub async fn preview_source(client: Client, indexed_url: String) -> Result<SourcePreview, String> {
    let download = client
        .download_source_asset(&indexed_url, 12 * 1024 * 1024)
        .await
        .map_err(|e| e.user_text())?;
    let mime = base_mime(download.content_type.as_deref().unwrap_or(""));
    if matches!(
        mime.as_str(),
        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    ) {
        return Ok(SourcePreview::Image {
            bytes: download.bytes,
            mime,
        });
    }
    if matches!(
        mime.as_str(),
        "text/plain" | "text/markdown" | "text/csv" | "application/json"
    ) {
        if download.bytes.len() > 2 * 1024 * 1024 {
            return Err("文件超过 2 MB 正文预览上限".into());
        }
        let text = String::from_utf8(download.bytes)
            .map_err(|_| "文件不是 UTF-8 文本，无法预览".to_string())?;
        return Ok(SourcePreview::Text {
            text,
            markdown: mime == "text/markdown",
        });
    }
    Ok(SourcePreview::Unsupported)
}
