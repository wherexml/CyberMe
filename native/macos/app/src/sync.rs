//! Shared change signal for every page: SSE `/api/native/events` when the
//! server advertises `events.sse`, otherwise 2 s polling of `/api/health`.
//! Emits `SyncEvent`s on the GPUI foreground; all sockets and timers live on
//! the Tokio runtime.

use gpui_kit::*;
use opstwin_api::Client;

use crate::runtime::io;

#[derive(Clone, Debug, PartialEq)]
pub enum Conn {
    Connecting,
    Live,
    Polling,
    Offline(String),
}

#[derive(Clone, Debug)]
pub enum SyncEvent {
    /// (Re)connected. `was_down` is true after an outage; `changed` when the
    /// revision differs from the last one seen.
    /// `first` is the initial connection after launch.
    Connected {
        was_down: bool,
        changed: bool,
        first: bool,
    },
    Revision,
    Down,
}

pub struct SyncHub {
    pub conn: Conn,
    pub revision: u64,
    ever_connected: bool,
    _task: Option<Task<()>>,
}

impl EventEmitter<SyncEvent> for SyncHub {}

enum Signal {
    Connected(u64, bool),
    Revision(u64),
    Down(String),
}

impl SyncHub {
    pub fn new(client: Client, cx: &mut Context<Self>) -> Self {
        let task = cx.spawn(async move |this, cx| {
            // Probe features; retry until the server answers.
            let mut delay = 1u64;
            let use_sse = loop {
                let c = client.clone();
                match io(async move { c.version().await }).await {
                    Ok(Some(v)) => break v.has("events.sse"),
                    Ok(None) => break false,
                    Err(e) => {
                        eprintln!("[opstwin] sync probe failed: {e}");
                        let msg = e.user_text();
                        if this
                            .update(cx, |this, cx| {
                                this.conn = Conn::Offline(msg);
                                cx.emit(SyncEvent::Down);
                                cx.notify();
                            })
                            .is_err()
                        {
                            return;
                        }
                        crate::runtime::sleep(delay * 1000).await;
                        delay = (delay * 2).min(15);
                    }
                }
            };

            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Signal>();
            let loop_client = client.clone();
            crate::runtime::runtime().spawn(event_loop(loop_client, use_sse, tx));

            while let Some(sig) = rx.recv().await {
                let alive = this
                    .update(cx, |this, cx| {
                        match sig {
                            Signal::Connected(rev, sse) => {
                                let was_down = !matches!(this.conn, Conn::Live | Conn::Polling);
                                let first = !std::mem::replace(&mut this.ever_connected, true);
                                let changed = rev != this.revision;
                                this.conn = if sse { Conn::Live } else { Conn::Polling };
                                this.revision = rev;
                                cx.emit(SyncEvent::Connected {
                                    was_down,
                                    changed,
                                    first,
                                });
                            }
                            Signal::Revision(rev) => {
                                this.revision = rev;
                                cx.emit(SyncEvent::Revision);
                            }
                            Signal::Down(msg) => {
                                this.conn = Conn::Offline(msg);
                                cx.emit(SyncEvent::Down);
                            }
                        }
                        cx.notify();
                    })
                    .is_ok();
                if !alive {
                    break;
                }
            }
        });
        Self {
            conn: Conn::Connecting,
            revision: 0,
            ever_connected: false,
            _task: Some(task),
        }
    }
}

async fn event_loop(client: Client, use_sse: bool, tx: tokio::sync::mpsc::UnboundedSender<Signal>) {
    let mut last: Option<u64> = None;
    let mut backoff = 1u64;
    loop {
        if tx.is_closed() {
            return;
        }
        if use_sse {
            let txc = tx.clone();
            let mut connected = false;
            let res = client
                .events(last, |ev| {
                    let rev = serde_json::from_str::<opstwin_api::RevisionData>(&ev.data)
                        .map(|d| d.revision)
                        .ok();
                    match (ev.event.as_str(), rev) {
                        ("hello", Some(r)) => {
                            connected = true;
                            _ = txc.send(Signal::Connected(r, true));
                        }
                        ("revision", Some(r)) => _ = txc.send(Signal::Revision(r)),
                        _ => {}
                    }
                })
                .await;
            match res {
                Ok(id) => {
                    last = id.or(last);
                    _ = tx.send(Signal::Down("事件流已断开".into()));
                }
                Err(e) => {
                    eprintln!("[opstwin] event stream error: {e}");
                    _ = tx.send(Signal::Down(e.user_text()));
                }
            }
            if connected {
                backoff = 1;
            }
            tokio::time::sleep(std::time::Duration::from_secs(backoff)).await;
            backoff = (backoff * 2).min(15);
        } else {
            match client.health_revision().await {
                Ok(r) => {
                    if last.is_none() {
                        _ = tx.send(Signal::Connected(r, false));
                    } else if last != Some(r) {
                        _ = tx.send(Signal::Revision(r));
                    }
                    last = Some(r);
                }
                Err(e) => {
                    last = None;
                    _ = tx.send(Signal::Down(e.user_text()));
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    }
}
