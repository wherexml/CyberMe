//! Background tokio runtime. All network I/O runs here; results are awaited
//! from GPUI's foreground executor through `JoinHandle` (runtime-agnostic
//! future), so rendering is never blocked.

use std::future::Future;
use std::sync::OnceLock;

static RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();

pub fn runtime() -> &'static tokio::runtime::Runtime {
    RT.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("opstwin-io")
            .enable_all()
            .build()
            .expect("tokio runtime")
    })
}

/// Run `fut` on the tokio runtime and return a future that can be awaited
/// from any executor (GPUI's foreground task included).
pub fn io<F, T>(fut: F) -> impl Future<Output = T>
where
    F: Future<Output = T> + Send + 'static,
    T: Send + 'static,
{
    let handle = runtime().spawn(fut);
    async move { handle.await.expect("io task panicked") }
}

pub async fn sleep(ms: u64) {
    // Construct the timer inside Tokio, not on GPUI's foreground executor.
    io(async move { tokio::time::sleep(std::time::Duration::from_millis(ms)).await }).await
}
