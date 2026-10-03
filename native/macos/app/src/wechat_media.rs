//! Exact-message private media stays in RAM. Only an explicit picker permits disk writes.
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    ffi::CString,
    fs::File,
    io::{Read, Write},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::{ffi::OsStrExt, fs::MetadataExt},
    },
    path::{Component, Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Instant,
};

pub const MAX_BYTES: u64 = 25_000_000;
static TEMP_SERIAL: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Image,
    Voice,
    Video,
    Document,
}
impl Kind {
    pub fn from_message(item: &Value) -> Option<Self> {
        match (
            item["messageType"].as_u64(),
            item["messageSubtype"].as_u64(),
        ) {
            (Some(3), _) | (Some(49), Some(2 | 8)) => Some(Self::Image),
            (Some(34), _) | (Some(49), Some(3)) => Some(Self::Voice),
            (Some(43), _) | (Some(49), Some(4 | 51 | 63)) => Some(Self::Video),
            (Some(49), Some(6 | 74)) => Some(Self::Document),
            _ if item["messageTypeLabel"] == "image" => Some(Self::Image),
            _ => None,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Voice => "voice",
            Self::Video => "video",
            Self::Document => "document",
        }
    }
    pub fn capability(self) -> &'static str {
        if self == Self::Image {
            "images"
        } else {
            self.name()
        }
    }
}

#[derive(Clone)]
pub struct MediaMeta {
    pub token: String,
    pub kind: Kind,
    pub mime: String,
    pub format: String,
    pub sha256: String,
    pub size: u64,
    expires_at: i64,
    deadline: Instant,
}
impl MediaMeta {
    pub fn parse(value: &Value, expected: Kind) -> Result<Self, String> {
        let token = value["attachmentId"].as_str().unwrap_or("");
        if token.len() != 36
            || !token.bytes().enumerate().all(|(i, c)| {
                if [8, 13, 18, 23].contains(&i) {
                    c == b'-'
                } else {
                    c.is_ascii_hexdigit()
                }
            })
            || value["url"].as_str() != Some(format!("/api/wechat/attachments/{token}").as_str())
            || value["kind"].as_str() != Some(expected.name())
            || value["readOnly"] != true
            || value["storage"] != "bounded-memory"
        {
            return Err("附件元数据或精确消息绑定无效".into());
        }
        let size = value["bytes"]
            .as_u64()
            .filter(|n| *n > 0 && *n <= MAX_BYTES)
            .ok_or("附件大小无效或超过 25 MB")?;
        let sha = value["sha256"]
            .as_str()
            .filter(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit()))
            .ok_or("附件摘要无效")?;
        let ttl = value["expiresInSeconds"]
            .as_u64()
            .filter(|n| *n > 0 && *n <= 600)
            .ok_or("附件有效期无效")?;
        let expires =
            chrono::DateTime::parse_from_rfc3339(value["expiresAt"].as_str().unwrap_or(""))
                .map_err(|_| "附件有效期无效")?
                .timestamp_millis();
        let now = chrono::Utc::now().timestamp_millis();
        if expires <= now || expires - now > ttl as i64 * 1000 + 3000 {
            return Err("附件读取已过期，请重新读取原消息".into());
        }
        let mime = value["mime"]
            .as_str()
            .filter(|s| s.len() < 128 && !s.contains(['\r', '\n', ';']))
            .ok_or("附件类型无效")?;
        let format = value["format"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() < 128)
            .ok_or("附件格式无效")?;
        let expected_validation = if expected == Kind::Image {
            "image-metadata"
        } else if mime == "application/octet-stream" {
            "opaque-bytes"
        } else {
            "header-only"
        };
        if value["formatValidation"].as_str() != Some(expected_validation) {
            return Err("附件格式验证信息无效".into());
        }
        Ok(Self {
            token: token.into(),
            kind: expected,
            mime: mime.into(),
            format: format.into(),
            sha256: sha.to_ascii_lowercase(),
            size,
            expires_at: expires,
            deadline: Instant::now()
                + std::time::Duration::from_millis(((expires - now) as u64).min(ttl * 1000)),
        })
    }
    pub fn expired(&self) -> bool {
        Instant::now() >= self.deadline || chrono::Utc::now().timestamp_millis() >= self.expires_at
    }
}

pub struct Media {
    pub meta: MediaMeta,
    pub bytes: Arc<[u8]>,
    pub extension: &'static str,
    pub system_open: bool,
}
pub fn verify(meta: MediaMeta, download: opstwin_api::Download) -> Result<Media, String> {
    if meta.expired() {
        return Err("附件读取已过期，请重新读取原消息".into());
    }
    if download.bytes.len() as u64 != meta.size
        || download.content_length.is_some_and(|n| n != meta.size)
        || download.content_type.as_deref() != Some(meta.mime.as_str())
        || hash(&download.bytes) != meta.sha256
    {
        return Err("附件大小、类型或摘要校验失败".into());
    }
    let (extension, system_open) = verified_format(&meta, &download.bytes)?;
    Ok(Media {
        meta,
        bytes: download.bytes.into(),
        extension,
        system_open,
    })
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn verified_format(m: &MediaMeta, b: &[u8]) -> Result<(&'static str, bool), String> {
    let f = m.format.as_str();
    let mime = m.mime.as_str();
    let v = match (m.kind, f, mime) {
        (Kind::Image, "png", "image/png") if b.starts_with(b"\x89PNG\r\n\x1a\n") => ("png", true),
        (Kind::Image, "jpg" | "jpeg", "image/jpeg") if b.starts_with(b"\xff\xd8\xff") => {
            ("jpg", true)
        }
        (Kind::Image, "webp", "image/webp")
            if b.starts_with(b"RIFF") && b.get(8..12) == Some(b"WEBP") =>
        {
            ("webp", true)
        }
        (Kind::Image, "gif", "image/gif")
            if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") =>
        {
            ("gif", true)
        }
        (Kind::Voice, "silk", "audio/silk")
            if b.starts_with(b"\x02#!SILK_V3") || b.starts_with(b"#!SILK_V3") =>
        {
            ("silk", true)
        }
        (Kind::Voice, "ogg", "audio/ogg") if b.starts_with(b"OggS") => ("ogg", true),
        (Kind::Video, "mp4" | "m4v", "video/mp4")
            if b.len() >= 12 && b.get(4..8) == Some(b"ftyp") =>
        {
            ("mp4", true)
        }
        (Kind::Video, "mov", "video/quicktime")
            if b.len() >= 12 && b.get(4..8) == Some(b"ftyp") =>
        {
            ("mov", true)
        }
        (Kind::Video, "avi", "video/x-msvideo")
            if b.starts_with(b"RIFF") && b.get(8..12) == Some(b"AVI ") =>
        {
            ("avi", true)
        }
        (Kind::Video, "mkv", "video/x-matroska") if b.starts_with(b"\x1a\x45\xdf\xa3") => {
            ("mkv", true)
        }
        (Kind::Document, "pdf", "application/pdf") if b.starts_with(b"%PDF-") => ("pdf", true),
        (Kind::Document, "zip", "application/zip") if b.starts_with(b"PK\x03\x04") => {
            ("zip", false)
        }
        (Kind::Document, _, "application/octet-stream") => ("bin", false),
        _ => return Err("附件实际格式与元数据不一致".into()),
    };
    Ok(v)
}
impl Media {
    pub fn suggested_name(&self) -> String {
        format!("wechat-{}.{}", self.meta.kind.name(), self.extension)
    }
}

// Unknown/corrupt policy is never silently treated as permission to write private media.
pub fn policy_stamp() -> Result<String, String> {
    checked_policy(None)
}
fn checked_policy(path: Option<&Path>) -> Result<String, String> {
    let store = opstwin_store::Store::open_default().map_err(|_| "本机文件访问策略无法读取")?;
    let value = store
        .load_strict::<Value>("settings-drafts.json")
        .map_err(|_| "本机文件访问策略无法读取或已损坏")?
        .ok_or("请先在设置保存有效文件访问策略")?;
    let blocked = value
        .pointer("/local/filesystem/blocked")
        .and_then(Value::as_array)
        .ok_or("本机文件屏蔽策略格式无效")?;
    if blocked.iter().any(|p| {
        p.as_str()
            .is_none_or(|s| s.is_empty() || !Path::new(s).is_absolute())
    }) {
        return Err("本机文件屏蔽路径无效".into());
    }
    let resolved = blocked
        .iter()
        .map(|p| std::fs::canonicalize(p.as_str().unwrap()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "无法解析文件屏蔽路径，请保存有效策略后重试")?;
    if let Some(path) = path {
        let target = std::fs::canonicalize(path).map_err(|_| "所选路径无效")?;
        if resolved.iter().any(|root| target.starts_with(root)) {
            return Err("此文件位于已屏蔽路径，未读取或上传".into());
        }
    }
    Ok(hash(
        serde_json::to_string(&(blocked, resolved))
            .map_err(|_| "本机文件访问策略无效")?
            .as_bytes(),
    ))
}
fn cstr(v: &std::ffi::OsStr) -> Result<CString, String> {
    CString::new(v.as_bytes()).map_err(|_| "所选路径无效".into())
}
fn file_from_fd(fd: libc::c_int) -> Result<File, String> {
    if fd < 0 {
        return Err("无法访问所选路径，请另选位置后重试".into());
    }
    // SAFETY: successful open/openat returns a new owned descriptor.
    Ok(unsafe { File::from_raw_fd(fd) })
}
fn directory(path: &Path) -> Result<File, String> {
    if !path.is_absolute() {
        return Err("保存位置必须是绝对路径".into());
    }
    // Open each component without following links, then keep the descriptor across awaits.
    let mut dir = file_from_fd(unsafe {
        libc::open(
            c"/".as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
        )
    })?;
    for part in path.components() {
        match part {
            Component::RootDir => {}
            Component::Normal(name) => {
                let name = cstr(name)?;
                dir = file_from_fd(unsafe {
                    libc::openat(
                        dir.as_raw_fd(),
                        name.as_ptr(),
                        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                    )
                })?;
            }
            _ => return Err("保存位置含无效路径或符号链接".into()),
        }
    }
    Ok(dir)
}
fn same_file(a: &File, b: &File) -> Result<bool, String> {
    let a = a.metadata().map_err(|_| "无法验证保存位置")?;
    let b = b.metadata().map_err(|_| "无法验证保存位置")?;
    Ok(a.dev() == b.dev() && a.ino() == b.ino())
}
pub struct PreparedSave {
    dir: File,
    temp: CString,
    file: File,
    target: CString,
    parent: PathBuf,
    path: PathBuf,
    policy: String,
    media: Arc<Media>,
    cancel: Arc<AtomicBool>,
}
impl Drop for PreparedSave {
    fn drop(&mut self) {
        // Delete only our descriptor-bound name if it still identifies our own temporary file.
        if let Ok(named) = file_from_fd(unsafe {
            libc::openat(
                self.dir.as_raw_fd(),
                self.temp.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        }) {
            if same_file(&named, &self.file).unwrap_or(false) {
                unsafe {
                    libc::unlinkat(self.dir.as_raw_fd(), self.temp.as_ptr(), 0);
                }
            }
        }
    }
}
pub async fn prepare(
    media: Arc<Media>,
    path: PathBuf,
    cancel: Arc<AtomicBool>,
) -> Result<PreparedSave, String> {
    let parent = path.parent().ok_or("保存位置无效")?.to_path_buf();
    crate::files::validate_file_access(&parent).await?;
    if cancel.load(Ordering::Acquire) || media.meta.expired() {
        return Err("附件读取已失效，请重新读取原消息".into());
    }
    let policy = checked_policy(Some(&parent))?;
    tokio::task::spawn_blocking(move || {
        if cancel.load(Ordering::Acquire) || media.meta.expired() {
            return Err("附件读取已失效，请重新读取原消息".into());
        }
        let dir = directory(&parent)?;
        let target = cstr(path.file_name().ok_or("保存文件名无效")?)?;
        let suffix = path.extension().and_then(|s| s.to_str()).unwrap_or("");
        if suffix != media.extension {
            return Err("请保留已验证的文件扩展名后重试".into());
        }
        let mut random = [0u8; 16];
        // SAFETY: arc4random_buf initializes exactly the provided macOS buffer.
        unsafe {
            libc::arc4random_buf(random.as_mut_ptr().cast(), random.len());
        }
        let temp = CString::new(format!(
            ".opstwins-media-{}-{}-{:x}",
            std::process::id(),
            TEMP_SERIAL.fetch_add(1, Ordering::Relaxed),
            u128::from_ne_bytes(random)
        ))
        .unwrap();
        let file = file_from_fd(unsafe {
            libc::openat(
                dir.as_raw_fd(),
                temp.as_ptr(),
                libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        })?;
        let mut prepared = PreparedSave {
            dir,
            temp,
            file,
            target,
            parent,
            path,
            policy,
            media,
            cancel,
        };
        prepared
            .file
            .write_all(&prepared.media.bytes)
            .map_err(|_| "无法写入文件，请另选位置后重试")?;
        prepared
            .file
            .sync_all()
            .map_err(|_| "无法完成文件保存，请重试")?;
        use std::io::{Seek, SeekFrom};
        let mut check = prepared.file.try_clone().map_err(|_| "无法验证保存文件")?;
        check
            .seek(SeekFrom::Start(0))
            .map_err(|_| "无法验证保存文件")?;
        let mut bytes = Vec::new();
        check
            .take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "无法验证保存文件")?;
        if hash(&bytes) != prepared.media.meta.sha256 {
            return Err("保存文件摘要校验失败".into());
        }
        if prepared.cancel.load(Ordering::Acquire) {
            return Err("保存已取消".into());
        }
        if !same_file(&prepared.dir, &directory(&prepared.parent)?)? {
            return Err("保存位置已变化，请另选位置".into());
        }
        Ok(prepared)
    })
    .await
    .map_err(|_| "无法准备保存，请重试".to_string())?
}
#[derive(Clone)]
pub struct Saved {
    pub path: PathBuf,
    sha256: String,
    size: u64,
    extension: &'static str,
    pub system_open: bool,
    policy: String,
}
pub struct VerifiedOpen {
    path: PathBuf,
    parent: PathBuf,
    dir: File,
    file: File,
    policy: String,
    ctime: i64,
    ctime_nsec: i64,
    size: u64,
}
impl VerifiedOpen {
    // Recheck after the UI owner guard, immediately before the explicit system request.
    pub fn path_if_current(&self) -> Result<&Path, String> {
        let name = cstr(self.path.file_name().ok_or("保存文件名无效")?)?;
        let named = file_from_fd(unsafe {
            libc::openat(
                self.dir.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        })?;
        let st = self.file.metadata().map_err(|_| "无法验证已保存文件")?;
        if checked_policy(Some(&self.path))? != self.policy
            || !same_file(&self.file, &named)?
            || !same_file(&self.dir, &directory(&self.parent)?)?
            || !st.is_file()
            || st.size() != self.size
            || st.mode() & 0o777 != 0o600
            || st.uid() != unsafe { libc::geteuid() }
            || st.nlink() != 1
            || st.ctime() != self.ctime
            || st.ctime_nsec() != self.ctime_nsec
        {
            return Err("已保存文件或访问策略已变化，请重新保存".into());
        }
        Ok(&self.path)
    }
}
impl PreparedSave {
    // Called synchronously after the UI owner guard. No await between guard and publish.
    pub fn publish(self) -> Result<Saved, String> {
        if self.cancel.load(Ordering::Acquire) || self.media.meta.expired() {
            return Err("保存已取消或附件读取已过期".into());
        }
        if checked_policy(Some(&self.parent))? != self.policy
            || !same_file(&self.dir, &directory(&self.parent)?)?
        {
            return Err("文件访问策略或保存位置已变化，请重试".into());
        }
        let st = self.file.metadata().map_err(|_| "无法验证保存文件")?;
        if !st.is_file()
            || st.size() != self.media.meta.size
            || st.mode() & 0o777 != 0o600
            || st.nlink() != 1
        {
            return Err("保存文件完整性无效".into());
        }
        let named = file_from_fd(unsafe {
            libc::openat(
                self.dir.as_raw_fd(),
                self.temp.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        })?;
        if !same_file(&named, &self.file)? {
            return Err("保存临时文件已变化，未发布".into());
        }
        if unsafe {
            libc::linkat(
                self.dir.as_raw_fd(),
                self.temp.as_ptr(),
                self.dir.as_raw_fd(),
                self.target.as_ptr(),
                0,
            )
        } != 0
        {
            return Err(if std::io::Error::last_os_error().kind()
                == std::io::ErrorKind::AlreadyExists
            {
                "目标已存在，未覆盖，请另选位置"
            } else {
                "无法完成保存，请另选位置后重试"
            }
            .into());
        }
        // The user-authorized target is now published; never remove it on late UI invalidation.
        if self.dir.sync_all().is_err() {
            return Err("文件已写入但磁盘同步失败，请核对目标后另选位置重试".into());
        }
        Ok(Saved {
            path: self.path.clone(),
            sha256: self.media.meta.sha256.clone(),
            size: self.media.meta.size,
            extension: self.media.extension,
            system_open: self.media.system_open,
            policy: self.policy.clone(),
        })
    }
}
impl Saved {
    pub async fn verify_for_open(
        &self,
        media: Arc<Media>,
        cancel: Arc<AtomicBool>,
    ) -> Result<VerifiedOpen, String> {
        if cancel.load(Ordering::Acquire) || !self.system_open || media.meta.expired() {
            return Err("此格式不能在系统打开，或附件读取已失效".into());
        }
        let parent = self.path.parent().ok_or("保存位置无效")?;
        crate::files::validate_file_access(&self.path).await?;
        if cancel.load(Ordering::Acquire) || media.meta.expired() {
            return Err("附件读取已失效，请重新读取原消息".into());
        }
        if checked_policy(Some(&self.path))? != self.policy {
            return Err("文件访问策略已变化，请重新保存".into());
        }
        let dir = directory(parent)?;
        let name = cstr(self.path.file_name().ok_or("保存文件名无效")?)?;
        if cancel.load(Ordering::Acquire) || media.meta.expired() {
            return Err("附件读取已失效，请重新读取原消息".into());
        }
        let mut file = file_from_fd(unsafe {
            libc::openat(
                dir.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        })?;
        let before = file.metadata().map_err(|_| "无法读取已保存文件")?;
        if !before.is_file()
            || before.size() != self.size
            || before.mode() & 0o777 != 0o600
            || before.uid() != unsafe { libc::geteuid() }
            || before.nlink() != 1
        {
            return Err("已保存文件不再符合安全读取条件，请重新保存".into());
        }
        let mut bytes = Vec::new();
        if cancel.load(Ordering::Acquire) || media.meta.expired() {
            return Err("附件读取已失效，请重新读取原消息".into());
        }
        (&mut file)
            .take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "无法读取已保存文件")?;
        let after = file.metadata().map_err(|_| "无法验证已保存文件")?;
        if cancel.load(Ordering::Acquire) || media.meta.expired() {
            return Err("附件读取已失效，请重新读取原消息".into());
        }
        let named = file_from_fd(unsafe {
            libc::openat(
                dir.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        })?;
        if !same_file(&file, &named)?
            || !same_file(&dir, &directory(parent)?)?
            || before.ctime() != after.ctime()
            || before.ctime_nsec() != after.ctime_nsec()
            || hash(&bytes) != self.sha256
            || self.path.extension().and_then(|s| s.to_str()) != Some(self.extension)
        {
            return Err("已保存文件已变化，请重新保存".into());
        }
        if !verified_format(&media.meta, &bytes)?.1 {
            return Err("此格式只能保存，不能系统打开".into());
        }
        Ok(VerifiedOpen {
            path: self.path.clone(),
            parent: parent.to_path_buf(),
            dir,
            file,
            policy: self.policy.clone(),
            ctime: after.ctime(),
            ctime_nsec: after.ctime_nsec(),
            size: self.size,
        })
    }
}
