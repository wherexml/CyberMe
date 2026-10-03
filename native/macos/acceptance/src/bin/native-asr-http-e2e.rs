//! Actual production client -> real ASR HTTP. No GUI, capture or playback.
//! Failure inventory: docs/journeys/native-ui-v12-recovery.md, ASR transcript field.
use opstwin_api::Client;
use serde_json::{Value, json};

fn runs(value: &Value) -> Vec<Value> {
    value
        .as_array()
        .or_else(|| value["items"].as_array())
        .cloned()
        .unwrap_or_default()
}
fn plain(text: &str) -> String {
    text.chars().filter(|c| c.is_alphanumeric()).collect()
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let api = args.next().ok_or("isolated API required")?;
    if api != "http://127.0.0.1:46218" {
        return Err("only isolated public 46218 is allowed".into());
    }
    let file = args.next().ok_or("public WAV path required")?;
    let client = Client::new(api);
    let before = runs(&client.product_get("/api/runs?limit=200").await?);
    let bytes = std::fs::read(file)?;
    if bytes.len() != 176784 || &bytes[..4] != b"RIFF" {
        return Err("known public PCM fixture required".into());
    }
    let text = client.transcribe_microphone(bytes).await?;
    let after = runs(&client.product_get("/api/runs?limit=200").await?);
    let fresh: Vec<_> = after
        .iter()
        .filter(|r| !before.iter().any(|old| old["id"] == r["id"]))
        .collect();
    let pass = plain(&text) == plain("这是公开的语音验收。请保留为草稿，不要发送。")
        && fresh.len() == 1
        && fresh[0]["kind"] == "voice"
        && fresh[0]["status"] == "succeeded"
        && fresh[0]["output"].as_str() == Some(text.as_str())
        && fresh[0]["audioSha256"]
            .as_str()
            .is_some_and(|s| s.len() == 64);
    println!(
        "{}",
        json!({"scope":"production Rust client and real synthetic-audio ASR; native GUI/hardware NOT_RUN","pass":pass,"runId":fresh.first().map(|r|&r["id"]),"model":fresh.first().map(|r|&r["model"]),"provider":fresh.first().map(|r|&r["provider"]),"audioSha256":fresh.first().map(|r|&r["audioSha256"]),"characters":text.chars().count(),"newRuns":fresh.len()})
    );
    if !pass {
        return Err("production ASR client E2E failed; metadata printed above".into());
    }
    Ok(())
}
