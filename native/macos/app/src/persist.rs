//! Single background writer per state file. `save` coalesces to the latest
//! snapshot; `save_now` resolves once that snapshot (or a newer one) is on
//! disk, so callers can persist an idempotency key *before* sending.
//! File I/O runs on Tokio's blocking pool, never on the GPUI thread.

use std::{
    collections::HashMap,
    future::Future,
    path::PathBuf,
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
};

struct Commit {
    next: AtomicU64,
    written: Mutex<u64>,
}
static COMMITS: OnceLock<Mutex<HashMap<PathBuf, Arc<Commit>>>> = OnceLock::new();
fn commit_for(path: PathBuf) -> Arc<Commit> {
    COMMITS
        .get_or_init(Default::default)
        .lock()
        .expect("state registry")
        .entry(path)
        .or_insert_with(|| {
            Arc::new(Commit {
                next: AtomicU64::new(0),
                written: Mutex::new(0),
            })
        })
        .clone()
}

use opstwin_store::Store;
use serde::Serialize;
use tokio::sync::{mpsc, oneshot};

type Ack = oneshot::Sender<Result<(), String>>;

pub struct Saver<T> {
    tx: mpsc::UnboundedSender<(u64, T, Option<Ack>)>,
    store: Store,
    name: &'static str,
    commit: Arc<Commit>,
}

impl<T> Clone for Saver<T> {
    fn clone(&self) -> Self {
        Self {
            tx: self.tx.clone(),
            store: self.store.clone(),
            name: self.name,
            commit: self.commit.clone(),
        }
    }
}

impl<T: Serialize + Send + 'static> Saver<T> {
    pub fn new(store: Store, name: &'static str) -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<(u64, T, Option<Ack>)>();
        let commit = commit_for(store.dir().join(name));
        let worker_commit = commit.clone();
        let worker_store = store.clone();
        crate::runtime::runtime().spawn(async move {
            while let Some((mut seq, first, ack)) = rx.recv().await {
                let mut latest = first;
                let mut acks: Vec<Ack> = ack.into_iter().collect();
                while let Ok((next_seq, next, ack)) = rx.try_recv() {
                    if next_seq > seq {
                        seq = next_seq;
                        latest = next;
                    }
                    acks.extend(ack);
                }
                let s = worker_store.clone();
                let commit = worker_commit.clone();
                let result = tokio::task::spawn_blocking(move || -> std::io::Result<()> {
                    let mut written = commit
                        .written
                        .lock()
                        .map_err(|_| std::io::Error::other("state commit lock"))?;
                    if seq <= *written {
                        return Ok(());
                    }
                    s.save(name, &latest)?;
                    *written = seq;
                    Ok(())
                })
                .await
                .map_err(|e| e.to_string())
                .and_then(|r| r.map_err(|e| e.kind().to_string()));
                if let Err(e) = &result {
                    eprintln!("[opstwin] persist {name} failed: {e}");
                }
                for a in acks {
                    let _ = a.send(result.clone());
                }
            }
        });
        Self {
            tx,
            store,
            name,
            commit,
        }
    }

    pub fn save(&self, value: T) {
        let _ = self.tx.send((
            self.commit.next.fetch_add(1, Ordering::SeqCst) + 1,
            value,
            None,
        ));
    }

    pub fn save_now(&self, value: T) -> impl Future<Output = Result<(), String>> + use<T> {
        let (atx, arx) = oneshot::channel();
        let sent = self
            .tx
            .send((
                self.commit.next.fetch_add(1, Ordering::SeqCst) + 1,
                value,
                Some(atx),
            ))
            .is_ok();
        async move {
            if !sent {
                return Err("persist worker stopped".into());
            }
            arx.await
                .unwrap_or_else(|_| Err("persist worker stopped".into()))
        }
    }

    /// Synchronous write for app-quit, bypassing the queue.
    pub fn save_blocking(&self, value: &T) {
        let seq = self.commit.next.fetch_add(1, Ordering::SeqCst) + 1;
        let Ok(mut written) = self.commit.written.lock() else {
            return;
        };
        if seq <= *written {
            return;
        }
        match self.store.save(self.name, value) {
            Ok(()) => *written = seq,
            Err(e) => eprintln!(
                "[opstwin] persist {} on quit failed: {}",
                self.name,
                e.kind()
            ),
        }
    }
}
