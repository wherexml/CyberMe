//! Real HTTP integrity regression through the exact production file-cache implementation.
//! Synthetic attachment only. Report excludes file contents and private messages.
#[allow(dead_code)]
#[path = "../files.rs"]
mod files;
#[allow(dead_code)]
#[path = "../util.rs"]
mod util;
use opstwin_api::Client;
use serde_json::json;
use sha2::{Digest, Sha256};
fn digest(data: &[u8]) -> String {
    Sha256::digest(data)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::var_os("OPSTWIN_DATA_DIR").is_none() {
        return Err("OPSTWIN_DATA_DIR must isolate E2E cache".into());
    }
    let client = Client::from_env();
    let marker = format!("OPSADV-QA-INTEGRITY-{}", opstwin_store::now_ms());
    let bytes = format!("{marker}\nSynthetic attachment integrity E2E. Same-length corruption.\n")
        .into_bytes();
    let artifact = client
        .upload_file(
            format!("{marker}.txt"),
            "text/plain".into(),
            bytes.clone(),
            None,
        )
        .await?;
    let path = files::fetch_verified(client.clone(), artifact.clone()).await?;
    let first = tokio::fs::read(&path).await?;
    assert_eq!(digest(&first), digest(&bytes));
    let mut corrupt = bytes.clone();
    corrupt[0] = if corrupt[0] == b'X' { b'Y' } else { b'X' };
    tokio::fs::write(&path, &corrupt).await?;
    let mut legacy = artifact.clone();
    legacy.sha256 = None;
    let corrected = files::fetch_verified(client.clone(), legacy).await?;
    let restored = tokio::fs::read(&corrected).await?;
    assert_eq!(digest(&restored), digest(&bytes));
    assert_ne!(digest(&restored), digest(&corrupt));
    tokio::fs::write(&path, &corrupt).await?;
    let corrected_known = files::fetch_verified(client.clone(), artifact.clone()).await?;
    assert_eq!(
        digest(&tokio::fs::read(&corrected_known).await?),
        digest(&bytes)
    );
    let mut missing = artifact.clone();
    missing.id = format!("missing-{marker}");
    missing.sha256 = None;
    let refused = files::fetch_verified(client, missing).await.is_err();
    assert!(refused);
    let text_preview_verified = matches!(files::preview_verified(Client::from_env(), artifact.clone()).await?,files::FilePreview::Text {text,..} if text.as_bytes()==bytes);
    assert!(text_preview_verified);
    let store = opstwin_store::Store::open_default()?;
    let blocked = store.dir().join("blocked");
    std::fs::create_dir_all(&blocked)?;
    let denied = blocked.join("synthetic.txt");
    std::fs::write(&denied, &bytes)?;
    let sibling = store.dir().join("blocked-sibling.txt");
    std::fs::write(&sibling, &bytes)?;
    let symlink = store.dir().join("blocked-link.txt");
    let _ = std::fs::remove_file(&symlink);
    std::os::unix::fs::symlink(&denied, &symlink)?;
    store.save(
        "settings-drafts.json",
        &json!({"local":{"filesystem":{"blocked":[blocked]}}}),
    )?;
    let blocked_read_refused = files::read_upload(denied).await.is_err();
    assert!(blocked_read_refused);
    let blocked_symlink_refused = files::read_upload(symlink).await.is_err();
    assert!(blocked_symlink_refused);
    let similar_prefix_allowed = files::read_upload(sibling).await.is_ok();
    assert!(similar_prefix_allowed);
    let report = json!({"status":"PASS","scope":"real HTTP and production Rust files.rs; synthetic data", "artifactId":artifact.id,"bytes":bytes.len(),"sha256":digest(&bytes),"corruptSha256":digest(&corrupt),"normalDownloadVerified":true,"legacyMissingHashRefetched":true,"sameSizeCorruptionRepaired":true,"knownHashCorruptionRepaired":true,"missingMetadataRefused":refused,"textPreviewVerified":text_preview_verified,"blockedReadRefused":blocked_read_refused,"blockedSymlinkRefused":blocked_symlink_refused,"similarPrefixAllowed":similar_prefix_allowed});
    if let Some(out) = std::env::var_os("OPSTWIN_E2E_REPORT") {
        std::fs::write(out, serde_json::to_vec_pretty(&report)?)?;
    }
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}
