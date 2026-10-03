//! Real HTTP E2E of the production source preview and automatic-draft guard.
//! Never writes source bytes, sender names or message bodies to evidence.
#[allow(dead_code)]
#[path = "../files.rs"]
mod files;
#[allow(dead_code)]
#[path = "../util.rs"]
mod util;
use opstwin_api::{Client, inbox_product::InboxProduct};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

/// Full read boundary exercised with fresh, synthetic policy and input files.
/// This harness refuses existing directories or paths outside repo/output.
async fn policy_e2e(rows: &mut Vec<Value>) -> Result<(), Box<dyn std::error::Error>> {
    use std::os::unix::fs::PermissionsExt;
    let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()?;
    let output = repo.join("output").canonicalize()?;
    let state = std::path::PathBuf::from(
        std::env::var_os("OPSTWIN_DATA_DIR")
            .ok_or("OPSTWIN_DATA_DIR required for isolated policy E2E")?,
    );
    if !state.is_absolute()
        || state.parent().ok_or("no policy parent")?.canonicalize()? != output
        || !state
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with("native-file-policy-e2e-"))
    {
        return Err("policy E2E requires fresh repo/output/native-file-policy-e2e-* path".into());
    }
    std::fs::create_dir(&state)?; // Never overwrite any existing user/state files.
    let store = opstwin_store::Store::open_default()?;
    let input = state.join("synthetic-input.txt");
    let bytes = b"Synthetic file policy E2E. No user content.\n";
    std::fs::write(&input, bytes)?;
    let policy = state.join("settings-drafts.json");
    let blocked = state.join("blocked");
    std::fs::create_dir(&blocked)?;
    let denied = blocked.join("synthetic.txt");
    std::fs::write(&denied, bytes)?;
    let similar = state.join("blocked-other.txt");
    std::fs::write(&similar, bytes)?;
    let link = state.join("blocked-link.txt");
    std::os::unix::fs::symlink(&denied, &link)?;
    let valid = |paths: Value| json!({"local":{"filesystem":{"blocked":paths}}});
    let record = |rows: &mut Vec<Value>, name: &str, ok: bool| {
        rows.push(json!({"name":name,"status":if ok {"PASS"} else {"FAIL"}}))
    };
    record(
        rows,
        "first use without policy or corrupt evidence permits synthetic read",
        files::read_upload(input.clone()).await.is_ok(),
    );
    store.save("settings-drafts.json", &valid(json!([blocked])))?;
    record(
        rows,
        "valid blocked root rejects actual production read",
        files::read_upload(denied.clone()).await.is_err(),
    );
    record(
        rows,
        "blocked symlink rejects actual production read",
        files::read_upload(link).await.is_err(),
    );
    record(
        rows,
        "similar prefix remains readable",
        files::read_upload(similar).await.is_ok(),
    );
    let corrupt = b"{ invalid synthetic policy";
    std::fs::write(&policy, corrupt)?;
    record(
        rows,
        "corrupt JSON refuses file read without changing policy",
        files::read_upload(input.clone()).await.is_err() && std::fs::read(&policy)? == corrupt,
    );
    let defaulted: Value = store.load("settings-drafts.json");
    record(
        rows,
        "generic UI recovery keeps corrupt evidence",
        defaulted.is_null()
            && !policy.exists()
            && std::fs::read_dir(&state)?.filter_map(Result::ok).any(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("settings-drafts.json.corrupt-")
            }),
    );
    let reopened = opstwin_store::Store::open_default()?;
    record(
        rows,
        "restart missing policy with corrupt evidence refuses read",
        reopened
            .load_strict::<Value>("settings-drafts.json")
            .is_err()
            && files::read_upload(input.clone()).await.is_err(),
    );
    record(
        rows,
        "repeated reads cannot erase corruption evidence",
        files::read_upload(input.clone()).await.is_err()
            && files::read_upload(input.clone()).await.is_err(),
    );
    store.save("settings-drafts.json", &valid(json!([])))?;
    record(
        rows,
        "explicit valid policy save recovers despite old evidence",
        files::read_upload(input.clone()).await.is_ok(),
    );
    for (name, invalid) in [
        ("null policy refuses read", Value::Null),
        (
            "missing blocked field refuses read",
            json!({"local":{"filesystem":{}}}),
        ),
        ("non array blocked refuses read", valid(json!("invalid"))),
        ("null blocked refuses read", valid(Value::Null)),
        ("non string blocked entry refuses read", valid(json!([42]))),
        (
            "relative blocked path refuses read",
            valid(json!(["relative/path"])),
        ),
        ("empty blocked path refuses read", valid(json!([""]))),
        (
            "mixed invalid blocked entry refuses read",
            valid(json!([blocked, {"path":"invalid"}])),
        ),
        (
            "unresolvable blocked root refuses read",
            valid(json!([state.join("missing-root")])),
        ),
    ] {
        store.save("settings-drafts.json", &invalid)?;
        record(rows, name, files::read_upload(input.clone()).await.is_err());
    }
    store.save("settings-drafts.json", &valid(json!([])))?;
    let original_policy = std::fs::read(&policy)?;
    std::fs::set_permissions(&policy, std::fs::Permissions::from_mode(0o000))?;
    let unreadable = store
        .load_strict::<Value>("settings-drafts.json")
        .err()
        .is_some_and(|e| e.kind() == std::io::ErrorKind::PermissionDenied);
    record(
        rows,
        "PermissionDenied strictly refuses file read",
        unreadable && files::read_upload(input.clone()).await.is_err(),
    );
    std::fs::set_permissions(&policy, std::fs::Permissions::from_mode(0o600))?;
    record(
        rows,
        "read failure preserves original policy bytes",
        std::fs::read(&policy)? == original_policy,
    );
    let inaccessible = state.join("inaccessible");
    let nested = inaccessible.join("nested");
    std::fs::create_dir_all(&nested)?;
    store.save("settings-drafts.json", &valid(json!([nested])))?;
    std::fs::set_permissions(&inaccessible, std::fs::Permissions::from_mode(0o000))?;
    record(
        rows,
        "PermissionDenied blocked root refuses file read",
        files::read_upload(input.clone()).await.is_err(),
    );
    std::fs::set_permissions(&inaccessible, std::fs::Permissions::from_mode(0o700))?;
    std::fs::remove_file(&policy)?;
    std::fs::create_dir(&policy)?;
    record(
        rows,
        "directory instead of policy refuses file read",
        files::read_upload(input.clone()).await.is_err(),
    );
    std::fs::remove_dir(&policy)?;
    std::os::unix::fs::symlink(state.join("missing-policy-target"), &policy)?;
    record(
        rows,
        "dangling policy symlink is never first use",
        files::read_upload(input.clone()).await.is_err(),
    );
    std::fs::remove_file(&policy)?;
    store.save("settings-drafts.json", &valid(json!([])))?;
    let recovered = files::read_upload(input.clone()).await?;
    record(
        rows,
        "final explicit save restores real synthetic read",
        recovered.bytes == bytes,
    );
    record(
        rows,
        "original input bytes unchanged by failed policy reads",
        std::fs::read(&input)? == bytes,
    );
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::from_env();
    let http = reqwest::Client::new();
    let marker = format!("OPSADV-QA-SOURCE-{}", opstwin_store::now_ms());
    let mut rows = Vec::<Value>::new();
    policy_e2e(&mut rows).await?;
    let mut record = |name: &str, ok: bool| {
        rows.push(json!({"name":name,"status":if ok {"PASS"} else {"FAIL"}}));
    };
    let escaped = client.source_asset_url("synthetic/id", "file key?#");
    record(
        "indexed source segments percent encoded",
        escaped.ends_with("/synthetic%2Fid/file%20key%3F%23"),
    );
    record(
        "arbitrary source attachment host rejected",
        client
            .indexed_source_url("https://example.com/private.txt")
            .is_none(),
    );
    record(
        "non indexed endpoint rejected",
        client.indexed_source_url("/files/anything").is_none(),
    );
    record(
        "source traversal and query rejected",
        client
            .indexed_source_url("/api/source-message-assets/../file")
            .is_none()
            && client
                .indexed_source_url("/api/source-message-assets/id/key?external=1")
                .is_none(),
    );
    record(
        "missing indexed source gives real 404",
        matches!(client.download_source_asset("/api/source-message-assets/native-missing/missing", 100).await, Err(e) if e.status()==Some(404)),
    );
    let created: Value = http.post(format!("{}/api/inbox", client.base())).json(&json!({
        "title":marker,"sender":"Synthetic QA","channel":"Internal","origin":"human","status":"pending",
        "body":"Synthetic local drafting eligibility. Do not send."

    })).send().await?.error_for_status()?.json().await?;
    let id = created["id"].as_str().ok_or("no synthetic id")?.to_string();
    let mut synthetic = client.inbox_product(&id).await?;
    // Eligibility input shape only; never inject or fake a saved server judgment.
    // The actual policy, Settings and connection reads still hit the live API.
    synthetic.triage = Some(
        json!({"method":"jev","status":"succeeded","route":"quick_reply","needsReply":0.9,"needsOwner":0.1,"needsDeepThink":0.1,"missingContext":0.1,"risk":0.1}),
    );
    record(
        "selected actionable item policy allowed",
        client.inbox_auto_draft_allowed(&synthetic).await?,
    );
    let mut variants: Vec<(&str, InboxProduct)> = Vec::new();
    let mut p = synthetic.clone();
    p.triage.as_mut().unwrap()["method"] = "rule".into();
    variants.push(("rule result cannot impersonate Jev probabilities", p));
    let mut p = synthetic.clone();
    p.item.draft = Some("Saved synthetic draft".into());
    variants.push(("saved draft prevents auto rewrite", p));
    let mut p = synthetic.clone();
    p.edited_by_user = true;
    variants.push(("manual edit prevents auto rewrite", p));
    let mut p = synthetic.clone();
    p.item.status = "send_unknown".into();
    variants.push(("unknown send prevents auto rewrite", p));
    let mut p = synthetic.clone();
    p.item.status = "done".into();
    variants.push(("completed item prevents auto draft", p));
    let mut p = synthetic.clone();
    p.item.is_self_test = true;
    variants.push(("self test prevents auto draft", p));
    let mut p = synthetic.clone();
    p.is_mine = true;
    variants.push(("self originated prevents auto draft", p));
    let mut p = synthetic.clone();
    p.direction = Some("outgoing".into());
    variants.push(("outgoing item prevents auto draft", p));
    let mut p = synthetic.clone();
    p.triage = None;
    variants.push(("unknown judgment prevents auto draft", p));
    let mut p = synthetic.clone();
    p.triage.as_mut().unwrap()["route"] = "no_reply".into();
    variants.push(("quiet judgment prevents auto draft", p));
    let mut p = synthetic.clone();
    p.triage.as_mut().unwrap()["missingContext"] = 0.7.into();
    variants.push(("missing context prevents auto draft", p));
    let mut p = synthetic.clone();
    p.item.draft_error = Some("Synthetic failed generation".into());
    variants.push(("failed generation requires explicit retry", p));
    let mut p = synthetic.clone();
    p.item.sensitive = true;
    variants.push(("sensitive observe policy prevents auto draft", p));
    let mut p = synthetic.clone();
    p.source_processing = Some(json!({"status":"running"}));
    variants.push(("running source prevents second automatic run", p));
    let mut p = synthetic.clone();
    p.item.channel = "Unknown".into();
    variants.push(("unknown channel prevents auto draft", p));
    let mut p = synthetic.clone();
    p.messages = vec![json!({"type":"text","isMine":true})];
    variants.push(("latest source self message prevents auto draft", p));
    for (name, product) in variants {
        record(name, !client.inbox_auto_draft_allowed(&product).await?);
    }
    drop(record);
    let cleanup = http
        .delete(format!("{}/api/inbox/{}", client.base(), id))
        .send()
        .await?
        .status()
        .as_u16();
    rows.push(json!({"name":"synthetic item cleaned","status":if cleanup==200 {"PASS"} else {"FAIL"},"http":cleanup}));

    // Only a small read-only sample; full source records remain transient memory.
    let query: Value = http
        .get(format!(
            "{}/api/inbox/query?includeQuiet=true&includeDone=true&limit=200",
            client.base()
        ))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let mut asset_attempts = 0usize;
    let mut source_read = false;
    let mut asset_read = false;
    let mut preview_read = false;
    for summary in query["items"]
        .as_array()
        .ok_or("no query items")?
        .iter()
        .filter(|m| m["id"].as_str().is_some_and(|id| id.starts_with("chat-")))
        .take(8)
    {
        let Some(id) = summary["id"].as_str() else {
            continue;
        };
        let product = client.inbox_product(id).await?;
        let Some(source_id) = product.source_id else {
            continue;
        };
        let first = client.inbox_source_history(&source_id, 0, 20).await?;
        source_read = true;
        let mut pages = vec![first.clone()];
        if first.has_more {
            pages.push(
                client
                    .inbox_source_history(&source_id, first.next_offset, 80)
                    .await?,
            );
        }
        rows.push(json!({"name":"real readonly source history and pagination","status":"PASS","messages":pages.iter().map(|p|p.messages.len()).sum::<usize>(),"secondPage":pages.len()==2}));
        for message in pages.iter().flat_map(|p| p.messages.iter()) {
            for a in message["attachments"].as_array().into_iter().flatten() {
                let Some(path) = a["url"].as_str() else {
                    continue;
                };
                let Some(url) = client.indexed_source_url(path) else {
                    continue;
                };
                asset_attempts += 1;
                if asset_attempts > 16 {
                    break;
                }
                match client.download_source_asset(&url,12*1024*1024).await {
                    Ok(download) => {
                        asset_read = true;
                        let bounded = client.download_source_asset(&url,1).await.is_err();
                        let preview = files::preview_source(client.clone(),url.clone()).await;
                        let kind = match preview { Ok(files::SourcePreview::Image {..}) => {preview_read=true;"image"},
                            Ok(files::SourcePreview::Text {..}) => {preview_read=true;"text"},
                            Ok(files::SourcePreview::Unsupported) => "unsupported", Err(_) => "unavailable" };
                        rows.push(json!({"name":"real indexed source bounded download","status":if bounded {"PASS"} else {"FAIL"},"bytes":download.bytes.len(),"sha256":format!("{:x}",Sha256::digest(&download.bytes)),"previewKind":kind}));
                        if preview_read { break; }
                    }
                    Err(_) => rows.push(json!({"name":"source indexed cache unavailable","status":"BLOCKED","reason":"index exists but current read refused or unavailable"})),
                }
            }
            if preview_read || asset_attempts >= 16 {
                break;
            }
        }
        if preview_read || asset_attempts >= 16 {
            break;
        }
    }
    if !source_read {
        rows.push(json!({"name":"real readonly source history","status":"NOT_RUN","reason":"no imported chat in sampled query"}));
    }
    if !asset_read {
        rows.push(json!({"name":"real indexed source preview","status":"NOT_RUN","reason":"no available indexed attachment in sampled source pages"}));
    }
    if asset_read && !preview_read {
        rows.push(json!({"name":"supported source image or text preview","status":"NOT_RUN","reason":"sample format unsupported"}));
    }
    let output = std::env::var("OPSTWIN_E2E_REPORT")
        .unwrap_or_else(|_| "output/native-source-preview-report.json".into());
    if let Some(parent) = std::path::Path::new(&output).parent() {
        std::fs::create_dir_all(parent)?;
    }
    let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let mut sources = serde_json::Map::new();
    for path in [
        "native/macos/app/src/inbox.rs",
        "native/macos/app/src/files.rs",
        "native/macos/crates/opstwin-api/src/inbox_product.rs",
        "native/macos/crates/opstwin-store/src/lib.rs",
        "native/macos/app/src/bin/native-source-preview-e2e.rs",
    ] {
        sources.insert(
            path.into(),
            format!("{:x}", Sha256::digest(std::fs::read(repo.join(path))?)).into(),
        );
    }
    std::fs::write(
        &output,
        serde_json::to_vec_pretty(
            &json!({"scope":"production Rust strict file policy with isolated synthetic disk E2E; source API/files real HTTP; synthetic eligibility and live policy/settings; GUI auto trigger independently required","marker":marker,"sources":sources,"rows":rows}),
        )?,
    )?;
    println!("{}", output);
    if rows.iter().any(|r| r["status"] == "FAIL") {
        return Err("source E2E assertion failed".into());
    }
    Ok(())
}
