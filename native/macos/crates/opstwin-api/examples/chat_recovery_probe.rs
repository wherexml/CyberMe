//! Real HTTP client probe, never an in-process/unit test or a Chat POST.
use opstwin_api::Client;
use serde_json::{Value, json};

#[tokio::main]
async fn main() {
    let result = probe().await;
    match result {
        Ok(rows) => {
            let pass = rows.iter().all(|v| v["pass"] == true);
            println!("{}", json!({"status":if pass {"PASS"}else{"FAIL"},"scope":"REAL_RUST_CLIENT_GET_ONLY; GUI_NOT_RUN","checks":rows}));
            if !pass { std::process::exit(1); }
        }
        Err(_) => {
            // Avoid printing response envelopes, prompts or provider errors.
            println!("{}", json!({"status":"FAIL","error":"recovery_http_probe_failed","scope":"GET_ONLY"}));
            std::process::exit(1);
        }
    }
}

async fn probe() -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    let base = std::env::var("OPSTWIN_API")?;
    let url = reqwest::Url::parse(&base)?;
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") || !url.port().is_some_and(|p| p >= 10000)
        || !url.username().is_empty() || url.password().is_some() || url.path() != "/" || url.query().is_some() || url.fragment().is_some()
    { return Err("explicit loopback API required".into()); }
    let real = std::env::args().any(|arg| arg == "--real");
    let cid = if real { "ui-side-4fd1adff-025f-4b18-bff5-523598b3e245" } else { "OPSADV-QA-RECOVERY-A" };
    let rid = if real { "native-5e035fea-3389-4f65-ab02-b5765c5cea71" } else { "OPSADV-QA-REQUEST-0000" };
    let client = Client::new(base);
    let mut rows = Vec::new();
    let first = client.chat_unresolved_intents(cid, None, None).await?;
    rows.push(json!({"name":"bounded typed recovery metadata","pass":first.items.len()<=100 && first.conversation_id==cid}));
    let mut intents = first.items;
    let (mut more,mut cursor) = (first.has_more,first.next_before);
    while more {
        let page = client.chat_unresolved_intents(cid,cursor.as_deref(),Some(first.revision)).await?;
        rows.push(json!({"name":"typed keyset page","pass":page.items.len()<=100 && page.revision==first.revision}));
        intents.extend(page.items);
        more=page.has_more;cursor=page.next_before;
    }
    rows.push(json!({"name":"original server-only intent discovered","pass":intents.iter().any(|v|v.request_id==rid && v.status=="partial")}));
    let receipt=client.chat_request_status(rid).await?;
    let count=receipt.completed_writes.as_ref().map(Vec::len);
    rows.push(json!({"name":"typed receipt preserves actual write evidence","pass":receipt.status=="partial" && count==Some(if real {2}else{1})}));
    let message=if real {"message-ced899ae-125f-44e4-a42e-7b6734fb88df"}else{"OPSADV-QA-MESSAGE-0"};
    let record=client.chat_record(message).await?;
    rows.push(json!({"name":"user message requestId resolves exact original run and partial receipt","pass":record["request"]["requestId"]==rid && record["request"]["status"]=="partial" && record["run"]["id"].as_str()==receipt.run_id.as_deref() && record["run"]["status"]=="failed"}));
    if !real {
        rows.push(json!({"name":"all old/multiple typed intents reachable","pass":intents.len()==235}));
        let unknown=client.chat_unresolved_intents("OPSADV-QA-RECOVERY-MISSING-MESSAGE",None,None).await?;
        rows.push(json!({"name":"missing user/run keeps unknown count","pass":unknown.items.len()==1 && unknown.items[0].completed_write_count.is_none() && unknown.items[0].run_status.is_none()}));
    }
    Ok(rows)
}
