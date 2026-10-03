//! Headless protocol acceptance for the native macOS client (V3, V6, V7).
//!
//! Reuses the exact `opstwin-api` client the GPUI app uses. Prints only ids,
//! counts, status codes and timings: never message bodies or secrets.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use opstwin_api::{ApiError, ChatRequest, ChatResponse, Client, Role, new_request_id};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

const PROXY_ADDR: &str = "127.0.0.1:46191";
const API_ADDR: &str = "127.0.0.1:46110";

#[derive(Clone, Copy)]
enum Verdict {
    Pass,
    Fail,
    Blocked,
}

impl Verdict {
    fn label(self) -> &'static str {
        match self {
            Verdict::Pass => "PASS",
            Verdict::Fail => "FAIL",
            Verdict::Blocked => "BLOCKED",
        }
    }
}

struct Report {
    rows: Vec<(String, Verdict, String)>,
}

impl Report {
    fn check(&mut self, id: &str, ok: bool, evidence: impl Into<String>) -> bool {
        let v = if ok { Verdict::Pass } else { Verdict::Fail };
        self.push(id, v, evidence);
        ok
    }
    fn push(&mut self, id: &str, v: Verdict, evidence: impl Into<String>) {
        let evidence = evidence.into();
        println!("[{}] {} :: {}", v.label(), id, evidence);
        self.rows.push((id.to_string(), v, evidence));
    }
}

fn unix_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis()
}

fn ts() -> String {
    format!("t={}", unix_ms())
}

fn err_desc(e: &ApiError) -> String {
    match e {
        ApiError::Network(_) => "Network(<redacted detail>)".into(),
        ApiError::Api { status, code, .. } => format!("Api status={status} code={code}"),
        ApiError::Decode(_) => "Decode".into(),
    }
}

/// SSE observation forwarded from the events task.
#[derive(Debug)]
struct Seen {
    at: Instant,
    event: String,
    revision: Option<u64>,
}

/// Send with a fixed requestId. Retries only with the SAME requestId:
/// on retryable errors (network / 5xx) and on 409 in-progress. Never mints a new id.
async fn send_same_id(
    client: &Client,
    req: &ChatRequest,
    max_attempts: u32,
    log: &str,
) -> (Result<ChatResponse, ApiError>, u32) {
    let mut attempt = 0;
    loop {
        attempt += 1;
        let started = Instant::now();
        let res = match tokio::time::timeout(Duration::from_secs(600), client.chat(req)).await {
            Ok(r) => r,
            Err(_) => Err(ApiError::Network("client-side 600s timeout".into())),
        };
        match &res {
            Ok(r) => {
                println!(
                    "  {log} attempt={attempt} ok latency_ms={} replayed={} {}",
                    started.elapsed().as_millis(),
                    r.replayed,
                    ts()
                );
                return (res, attempt);
            }
            Err(e) => {
                println!(
                    "  {log} attempt={attempt} err={} retryable={} in_progress={} latency_ms={}",
                    err_desc(e),
                    e.is_retryable(),
                    e.is_in_progress(),
                    started.elapsed().as_millis()
                );
                if attempt >= max_attempts || !(e.is_retryable() || e.is_in_progress()) {
                    return (res, attempt);
                }
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
        }
    }
}

async fn tail_ids(client: &Client, conv: &str) -> Result<Vec<opstwin_api::Message>, ApiError> {
    Ok(client.messages_page(conv, None, 200).await?.items)
}

/// Tiny TCP proxy on 46191. While `forward` is false it accepts and closes
/// immediately (API "down"); when true it pipes to 46110.
async fn run_proxy(listener: TcpListener, forward: Arc<AtomicBool>) {
    loop {
        let Ok((mut inbound, _)) = listener.accept().await else { continue };
        if !forward.load(Ordering::SeqCst) {
            drop(inbound);
            continue;
        }
        tokio::spawn(async move {
            if let Ok(mut out) = TcpStream::connect(API_ADDR).await {
                let _ = tokio::io::copy_bidirectional(&mut inbound, &mut out).await;
            }
        });
    }
}

#[tokio::main]
async fn main() {
    let mut rep = Report { rows: Vec::new() };
    let api = Client::new(format!("http://{API_ADDR}"));
    println!("opstwin-acceptance headless protocol run {}", ts());
    println!("api base={} proxy={PROXY_ADDR}", api.base());

    // ---- preflight
    match api.version().await {
        Ok(Some(v)) => println!(
            "version apiVersion={} revision={} features={:?}",
            v.api_version, v.revision, v.features
        ),
        Ok(None) => println!("version: /api/native/version absent (404)"),
        Err(e) => {
            rep.push("PREFLIGHT", Verdict::Blocked, format!("API unreachable: {}", err_desc(&e)));
            summary(&rep);
            std::process::exit(2);
        }
    }
    let conv = match api.primary_conversation().await {
        Ok(p) => p.conversation_id.or(p.conversation.map(|c| c.id)),
        Err(e) => {
            rep.push("PREFLIGHT", Verdict::Blocked, format!("primary failed: {}", err_desc(&e)));
            None
        }
    };
    let Some(conv) = conv else {
        rep.push("PREFLIGHT", Verdict::Blocked, "no primary conversation id");
        summary(&rep);
        std::process::exit(2);
    };
    println!("primary conversationId={conv}");

    // ---- V7 setup: SSE subscription
    let (tx, mut rx) = mpsc::unbounded_channel::<Seen>();
    let sse_client = api.clone();
    let sse_task = tokio::spawn(async move {
        let r = sse_client
            .events(None, |ev| {
                let revision = serde_json::from_str::<serde_json::Value>(&ev.data)
                    .ok()
                    .and_then(|v| v.get("revision").and_then(|r| r.as_u64()));
                let _ = tx.send(Seen { at: Instant::now(), event: ev.event.clone(), revision });
            })
            .await;
        println!("  sse task ended: {}", match &r { Ok(_) => "eof".into(), Err(e) => err_desc(e) });
    });
    let hello = match tokio::time::timeout(Duration::from_secs(5), rx.recv()).await {
        Ok(Some(s)) if s.event == "hello" => s.revision,
        Ok(Some(s)) => {
            println!("  first SSE event was {} (expected hello)", s.event);
            s.revision
        }
        _ => None,
    };
    let sse_ok = rep.check(
        "V7.hello",
        hello.is_some(),
        format!("hello revision={hello:?}"),
    );
    let hello_rev = hello.unwrap_or(0);

    // ---- V3 real send (exactly one new requestId)
    let rid = new_request_id();
    let req = ChatRequest {
        conversation_id: Some(conv.clone()),
        message: format!("OPSADV-QA-NATIVE-{} 请只回复：收到", unix_ms()),
        request_id: rid.clone(),
    };
    println!("V3 requestId={rid} message_chars={}", req.message.chars().count());
    let t0 = Instant::now();
    let (v3, v3_attempts) = send_same_id(&api, &req, 20, "V3 chat").await;
    let t_resp = Instant::now();
    let v3_latency = t_resp.duration_since(t0);
    let mut v3_ids: Option<(String, String)> = None;
    match &v3 {
        Ok(r) => {
            let um = r.user_message.as_ref();
            let am = r.assistant_message.as_ref();
            let run = am.and_then(|m| m.run_id.clone());
            println!(
                "  V3 response conversationId={} userMessage={:?} assistantMessage={:?} runId={:?} user_len={} assistant_len={} attempts={v3_attempts} latency_ms={}",
                r.conversation_id,
                um.map(|m| &m.id),
                am.map(|m| &m.id),
                run,
                um.map(|m| m.content.chars().count()).unwrap_or(0),
                am.map(|m| m.content.chars().count()).unwrap_or(0),
                v3_latency.as_millis()
            );
            rep.check("V3.conversation", r.conversation_id == conv, format!("response conversationId==primary ({})", r.conversation_id));
            rep.check(
                "V3.messages",
                um.is_some_and(|m| !m.content.is_empty() && m.role == Role::User && m.request_id.as_deref() == Some(rid.as_str()))
                    && am.is_some_and(|m| !m.content.is_empty() && m.role == Role::Assistant),
                "userMessage(role=user, requestId=R, non-empty) + assistantMessage(role=assistant, non-empty)",
            );
            rep.check("V3.run", run.is_some(), format!("runId={run:?} latency_ms={}", v3_latency.as_millis()));
            if let (Some(u), Some(a)) = (um, am) {
                v3_ids = Some((u.id.clone(), a.id.clone()));
            }
        }
        Err(e) => {
            rep.push("V3.send", Verdict::Fail, format!("send failed after {v3_attempts} same-id attempts: {}", err_desc(e)));
        }
    }

    // ---- V7: revision event after V3 write
    if sse_ok {
        // Revision as of right after the chat response (covers the assistant-message write).
        let rev_after = api.health_revision().await.unwrap_or(0);
        let mut seen: Vec<Seen> = Vec::new();
        while let Ok(s) = rx.try_recv() {
            seen.push(s);
        }
        let deadline = t_resp + Duration::from_secs(2);
        let mut hit = seen.iter().find(|s| s.event == "revision" && s.revision.unwrap_or(0) >= rev_after).map(|s| (s.at, s.revision));
        while hit.is_none() {
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            match tokio::time::timeout(deadline - now, rx.recv()).await {
                Ok(Some(s)) => {
                    let h = (s.event == "revision" && s.revision.unwrap_or(0) >= rev_after).then_some((s.at, s.revision));
                    seen.push(s);
                    hit = h;
                }
                _ => break,
            }
        }
        let during = seen.iter().filter(|s| s.event == "revision" && s.revision.unwrap_or(0) > hello_rev && s.at <= t_resp).count();
        let revs: Vec<u64> = seen.iter().filter_map(|s| s.revision).collect();
        println!("  V7 hello_rev={hello_rev} rev_after_response={rev_after} revision_events_during_run={during} observed_revisions={revs:?}");
        match hit {
            Some((at, r)) => {
                let lat = at.saturating_duration_since(t_resp).as_millis();
                rep.check(
                    "V7.sse",
                    r.unwrap_or(0) > hello_rev && at <= deadline,
                    format!("revision event {r:?} > hello {hello_rev}; latency from chat response = {lat} ms (0 = arrived before response)"),
                );
            }
            None => {
                rep.push("V7.sse", Verdict::Fail, format!("no revision event >= {rev_after} within 2s of chat response"));
            }
        }
    } else {
        rep.push("V7.sse", Verdict::Blocked, "SSE hello not received");
    }

    // ---- V3 tail confirmation
    if let Some((uid, aid)) = &v3_ids {
        match tail_ids(&api, &conv).await {
            Ok(items) => {
                let has_u = items.iter().any(|m| &m.id == uid);
                let has_a = items.iter().any(|m| &m.id == aid);
                let same_rid = items.iter().filter(|m| m.role == Role::User && m.request_id.as_deref() == Some(rid.as_str())).count();
                rep.check(
                    "V3.tail",
                    has_u && has_a && same_rid == 1,
                    format!("messages_page(limit=200) n={} user_present={has_u} assistant_present={has_a} user_msgs_with_R={same_rid}", items.len()),
                );
            }
            Err(e) => rep.push("V3.tail", Verdict::Fail, err_desc(&e)),
        }
    }

    // ---- V6 network failure + same-requestId retry
    v6(&mut rep, &api, &conv).await;

    sse_task.abort();
    summary(&rep);
    let failed = rep.rows.iter().any(|(_, v, _)| !matches!(v, Verdict::Pass));
    std::process::exit(if failed { 1 } else { 0 });
}

async fn v6(rep: &mut Report, api: &Client, conv: &str) {
    let listener = match TcpListener::bind(PROXY_ADDR).await {
        Ok(l) => l,
        Err(e) => {
            rep.push("V6", Verdict::Blocked, format!("cannot bind proxy {PROXY_ADDR}: {:?}", e.kind()));
            return;
        }
    };
    let forward = Arc::new(AtomicBool::new(false));
    let proxy = tokio::spawn(run_proxy(listener, forward.clone()));
    let via = Client::new(format!("http://{PROXY_ADDR}"));

    let r = new_request_id();
    let body = format!("OPSADV-QA-NATIVE-RETRY-{} 请只回复：收到", unix_ms());
    let req = ChatRequest { conversation_id: Some(conv.to_string()), message: body.clone(), request_id: r.clone() };
    println!("V6 requestId={r} message_chars={}", body.chars().count());

    // 1. API "down": proxy closes connections.
    let t = Instant::now();
    let down = via.chat(&req).await;
    match &down {
        Ok(_) => {
            rep.push("V6.down", Verdict::Fail, "send unexpectedly succeeded while proxy was closing connections");
            proxy.abort();
            return;
        }
        Err(e) => {
            rep.check(
                "V6.down",
                e.is_retryable() && matches!(e, ApiError::Network(_)),
                format!("err={} is_retryable={} user_text_len={} latency_ms={}", err_desc(e), e.is_retryable(), e.user_text().chars().count(), t.elapsed().as_millis()),
            );
        }
    }
    // Server must not have seen R.
    let before = tail_ids(api, conv).await.map(|items| items.iter().filter(|m| m.request_id.as_deref() == Some(r.as_str())).count());
    rep.check("V6.no_leak", matches!(before, Ok(0)), format!("user msgs with R after failed send = {before:?}"));

    // 2. API "up": same R through proxy.
    forward.store(true, Ordering::SeqCst);
    let (up, attempts) = send_same_id(&via, &req, 20, "V6 retry(same R)").await;
    let first_uid = match &up {
        Ok(resp) => {
            let uid = resp.user_message.as_ref().map(|m| m.id.clone());
            let aid = resp.assistant_message.as_ref().map(|m| m.id.clone());
            let run = resp.assistant_message.as_ref().and_then(|m| m.run_id.clone());
            rep.check(
                "V6.retry",
                resp.conversation_id == conv && uid.is_some() && aid.is_some() && !resp.replayed,
                format!("same R succeeded via proxy attempts={attempts} userMessage={uid:?} assistantMessage={aid:?} runId={run:?} replayed={}", resp.replayed),
            );
            uid
        }
        Err(e) => {
            rep.push("V6.retry", Verdict::Fail, format!("same-R retry failed: {}", err_desc(e)));
            None
        }
    };

    // 3. Same R + same body again: must be replayed, no new message.
    match api.chat(&req).await {
        Ok(resp) => {
            let uid = resp.user_message.as_ref().map(|m| m.id.clone());
            rep.check(
                "V6.replay",
                resp.replayed && uid.is_some() && uid == first_uid,
                format!("replayed={} userMessage={uid:?} same_as_first={}", resp.replayed, uid == first_uid),
            );
        }
        Err(e) => rep.push("V6.replay", Verdict::Fail, err_desc(&e)),
    }

    // 4. Same R + different body: 409 request_conflict.
    let conflict_req = ChatRequest { message: format!("{body} X"), ..req.clone() };
    match api.chat(&conflict_req).await {
        Ok(_) => rep.push("V6.conflict", Verdict::Fail, "different body with same R was accepted"),
        Err(e) => {
            rep.check(
                "V6.conflict",
                e.is_conflict() && e.code() == Some("request_conflict") && !e.is_retryable(),
                format!("err={} is_conflict={} is_retryable={}", err_desc(&e), e.is_conflict(), e.is_retryable()),
            );
        }
    }

    // 5. Server-side count of user messages with requestId R.
    match tail_ids(api, conv).await {
        Ok(items) => {
            let n = items.iter().filter(|m| m.role == Role::User && m.request_id.as_deref() == Some(r.as_str())).count();
            let by_id = first_uid.as_ref().map(|u| items.iter().filter(|m| &m.id == u).count());
            rep.check("V6.count", n == 1, format!("user msgs with requestId=R in tail(200) = {n}; by first userMessage id = {by_id:?}"));
        }
        Err(e) => rep.push("V6.count", Verdict::Fail, err_desc(&e)),
    }
    proxy.abort();
}

fn summary(rep: &Report) {
    println!("\n==== SUMMARY {} ====", ts());
    for (id, v, _) in &rep.rows {
        println!("{:<8} {}", v.label(), id);
    }
    let group = |p: &str| {
        let rows: Vec<_> = rep.rows.iter().filter(|(id, _, _)| id.starts_with(p)).collect();
        if rows.is_empty() {
            "NOT_RUN"
        } else if rows.iter().all(|(_, v, _)| matches!(v, Verdict::Pass)) {
            "PASS"
        } else if rows.iter().any(|(_, v, _)| matches!(v, Verdict::Fail)) {
            "FAIL"
        } else {
            "BLOCKED"
        }
    };
    println!("V3={} V6={} V7={}", group("V3"), group("V6"), group("V7"));
}
