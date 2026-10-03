//! Device-local calendar and safe text formatting.
use chrono::{DateTime, Local, NaiveDate};

/// Format an ISO timestamp or epoch seconds/ms in the device's current zone.
/// Unknown/invalid timestamps are never replaced with the current time.
pub fn fmt_time(raw: &str) -> String {
    parse_ms(raw)
        .and_then(DateTime::from_timestamp_millis)
        .map(|date| {
            date.with_timezone(&Local)
                .format("%Y-%m-%d %H:%M")
                .to_string()
        })
        .unwrap_or_else(|| raw.to_string())
}
pub fn parse_ms(raw: &str) -> Option<i64> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if let Ok(n) = raw.parse::<f64>() {
        if !n.is_finite() {
            return None;
        }
        let ms = if n.abs() < 1e11 { n * 1000. } else { n };
        if ms < i64::MIN as f64 || ms > i64::MAX as f64 {
            return None;
        }
        let ms = ms as i64;
        return DateTime::from_timestamp_millis(ms).map(|_| ms);
    }
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|date| date.timestamp_millis())
}

pub fn human_size(n: u64) -> String {
    if n >= 1024 * 1024 {
        format!("{:.1} MB", n as f64 / 1024.0 / 1024.0)
    } else if n >= 1024 {
        format!("{:.0} KB", n as f64 / 1024.0)
    } else {
        format!("{n} B")
    }
}

/// First `max` chars of `s` on one line.
pub fn snippet(s: &str, max: usize) -> String {
    let one: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() > max {
        format!("{}…", one.chars().take(max).collect::<String>())
    } else {
        one
    }
}

pub fn valid_date(s: &str) -> bool {
    s.len() == 10 && NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

/// Use the local safe Markdown contract at every document entry point.
/// Source/attachment images use separately indexed and verified image controls.
pub fn markdown(
    id: impl Into<gpui_kit::ElementId>,
    text: impl Into<gpui_kit::SharedString>,
) -> gpui_kit::base::text::TextView {
    gpui_kit::base::text::TextView::markdown(id, text)
        .on_link_click(|url, _, _, cx| {
            if let Ok(parsed) = reqwest::Url::parse(url) {
                if matches!(parsed.scheme(), "http" | "https" | "mailto")
                    && parsed.username().is_empty()
                    && parsed.password().is_none()
                {
                    cx.open_url(url);
                }
            }
        })
        .image_source(|_| {
            gpui_kit::ImageSource::Image(std::sync::Arc::new(gpui_kit::Image::from_bytes(
                gpui_kit::ImageFormat::Svg,
                b"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\" height=\"1\"></svg>"
                    .to_vec(),
            )))
        })
}
