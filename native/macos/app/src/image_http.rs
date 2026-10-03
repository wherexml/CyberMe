//! Bounded GET transport for GPUI images. Business credentials stay in the server.
use futures_util::{FutureExt, StreamExt, future::BoxFuture};
use http_client::{AsyncBody, HttpClient, Request, Response};
use std::sync::Arc;

pub fn client() -> Arc<dyn HttpClient> {
    Arc::new(Images)
}
struct Images;
impl HttpClient for Images {
    fn send(
        &self,
        request: Request<AsyncBody>,
    ) -> BoxFuture<'static, anyhow::Result<Response<AsyncBody>>> {
        let uri = request.uri().to_string();
        let method = request.method().clone();
        let task = crate::runtime::runtime().spawn(async move {
            if method != http_client::Method::GET {
                anyhow::bail!("Image transport supports GET only");
            }
            let url =
                reqwest::Url::parse(&uri).map_err(|_| anyhow::anyhow!("Invalid image URL"))?;
            if !matches!(url.scheme(), "http" | "https")
                || !url.username().is_empty()
                || url.password().is_some()
            {
                anyhow::bail!("Unsupported image URL");
            }
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .redirect(reqwest::redirect::Policy::limited(3))
                .build()
                .map_err(|_| anyhow::anyhow!("Image transport unavailable"))?;
            let response = client
                .get(url)
                .send()
                .await
                .map_err(|_| anyhow::anyhow!("Image request failed"))?;
            let status = response.status();
            let headers = response.headers().clone();
            if !status.is_success() {
                anyhow::bail!("Image request returned {}", status.as_u16());
            }
            const LIMIT: usize = 8 * 1024 * 1024;
            if response.content_length().is_some_and(|n| n > LIMIT as u64) {
                anyhow::bail!("Image exceeds 8 MiB");
            }
            let mut bytes = Vec::new();
            let mut chunks = response.bytes_stream();
            while let Some(chunk) = chunks.next().await {
                let chunk = chunk.map_err(|_| anyhow::anyhow!("Image download interrupted"))?;
                if bytes.len() + chunk.len() > LIMIT {
                    anyhow::bail!("Image exceeds 8 MiB");
                }
                bytes.extend_from_slice(&chunk);
            }
            let mut result = Response::builder()
                .status(status)
                .body(AsyncBody::from(bytes))?;
            *result.headers_mut() = headers;
            Ok(result)
        });
        async move {
            task.await
                .map_err(|_| anyhow::anyhow!("Image worker interrupted"))?
        }
        .boxed()
    }
    fn proxy(&self) -> Option<&http_client::Url> {
        None
    }
    fn user_agent(&self) -> Option<&http_client::http::HeaderValue> {
        None
    }
}
