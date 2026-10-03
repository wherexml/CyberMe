//! Native product pages use the existing server contracts. No credentials are
//! transported to the client; model reads are the public, redacted endpoint.
use crate::{ApiError, Client};
use serde_json::Value;

pub fn valid_binding_url(value: &str) -> bool {
    reqwest::Url::parse(value).ok().is_some_and(|u| {
        u.scheme() == "https"
            && u.host_str().is_some_and(|h| {
                ["feishu.cn", "larksuite.com"]
                    .iter()
                    .any(|d| h == *d || h.ends_with(&format!(".{d}")))
            })
    })
}

/// Only the bounded PNG data URL returned by the binding API is accepted.
pub fn binding_qr_png(value: &str) -> Option<Vec<u8>> {
    let encoded = value.strip_prefix("data:image/png;base64,")?;
    if encoded.len() > 256_000 || encoded.len() % 4 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(encoded.len() * 3 / 4);
    for (index, chunk) in encoded.as_bytes().chunks_exact(4).enumerate() {
        let decode = |b: u8| -> Option<u32> {
            match b {
                b'A'..=b'Z' => Some((b - b'A') as u32),
                b'a'..=b'z' => Some((b - b'a' + 26) as u32),
                b'0'..=b'9' => Some((b - b'0' + 52) as u32),
                b'+' => Some(62),
                b'/' => Some(63),
                _ => None,
            }
        };
        let a = decode(chunk[0])?;
        let b = decode(chunk[1])?;
        let pad = if chunk[2] == b'=' {
            if chunk[3] != b'=' {
                return None;
            }
            2
        } else if chunk[3] == b'=' {
            1
        } else {
            0
        };
        if pad > 0 && index * 4 + 4 != encoded.len() {
            return None;
        }
        let c = if pad == 2 { 0 } else { decode(chunk[2])? };
        let d = if pad > 0 { 0 } else { decode(chunk[3])? };
        let bits = (a << 18) | (b << 12) | (c << 6) | d;
        out.push((bits >> 16) as u8);
        if pad < 2 {
            out.push((bits >> 8) as u8);
        }
        if pad == 0 {
            out.push(bits as u8);
        }
    }
    if !out.starts_with(b"\x89PNG\r\n\x1a\n") {
        return None;
    }
    Some(out)
}

pub fn query_value(value: &str) -> String {
    reqwest::Url::parse_with_params("http://localhost/", [("q", value)])
        .ok()
        .and_then(|u| u.query().map(str::to_string))
        .and_then(|q| q.strip_prefix("q=").map(str::to_string))
        .unwrap_or_default()
}

impl Client {
    /// Full server workspace search. Empty-query recent records stay local.
    pub async fn workspace_search(
        &self,
        query: &str,
        kind: &str,
        offset: u64,
        limit: u64,
        revision: Option<u64>,
    ) -> Result<Value, ApiError> {
        let mut path = format!(
            "/api/workspace/search?q={}&kind={}&offset={offset}&limit={limit}",
            query_value(query),
            query_value(kind)
        );
        if let Some(revision) = revision {
            path.push_str(&format!("&revision={revision}"));
        }
        self.get(&path).await
    }

    pub async fn product_get(&self, path: &str) -> Result<Value, ApiError> {
        self.get(path).await
    }
    pub async fn product_post(&self, path: &str, body: Value) -> Result<Value, ApiError> {
        self.send_json(self.stream_http.post(self.url(path)).json(&body))
            .await
    }
    pub async fn product_patch(&self, path: &str, body: Value) -> Result<Value, ApiError> {
        self.send_json(self.http.patch(self.url(path)).json(&body))
            .await
    }
    pub async fn product_delete(&self, path: &str) -> Result<Value, ApiError> {
        self.send_json(self.http.delete(self.url(path))).await
    }
}
