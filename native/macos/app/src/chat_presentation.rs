//! Product-facing projections; raw execution evidence stays on the server.
use serde_json::Value;
use crate::settings::t;

pub fn reply(text: &str) -> String {
    let raw = text.trim();
    let raw = raw.strip_prefix("```json").or_else(|| raw.strip_prefix("```"))
        .and_then(|s| s.trim().strip_suffix("```" )).unwrap_or(raw).trim();
    let Ok(value) = serde_json::from_str::<Value>(raw) else { return text.into(); };
    let Some(ideas) = value.get("ideas").and_then(Value::as_array) else { return text.into(); };
    if ideas.is_empty() || ideas.iter().any(|i| i["title"].as_str().is_none() || i["description"].as_str().is_none()) { return text.into(); }
    ideas.iter().enumerate().map(|(n,i)| format!("### {}. {}\n\n{}",n+1,i["title"].as_str().unwrap(),i["description"].as_str().unwrap())).collect::<Vec<_>>().join("\n\n")
}

pub fn record(value: &Value) -> String {
    let request = value.get("request").unwrap_or(value);
    let run = value.get("run").unwrap_or(value);
    let state = request["status"].as_str().or_else(|| run["status"].as_str()).unwrap_or("unknown");
    let state = if state == "succeeded" { match run["taskOutcome"]["status"].as_str() { Some("partial") => "partial", Some("failed") => "failed", Some("pending") => "unknown", _ => state } } else { state };
    let (title, next) = match state {
        "succeeded" => ("已完成", "本次处理已结束。"),
        "running" | "pending" | "queued" => ("处理中", "处理尚未结束，请稍后重新查看记录。"),
        "partial" => ("部分完成", "已有部分操作完成。请先检查结果，原请求不会自动重发。"),
        "failed" => ("未完成", "本次处理失败。请检查下方已完成的操作，再决定是否重试。"),
        "cancelled" | "interrupted" => ("已停止", "本次处理已停止，已完成的操作仍然保留。"),
        "no_run" => ("没有执行记录", "此消息没有关联的执行过程。"),
        _ => ("结果待确认", "暂时无法确认处理结果，请稍后重新查看，避免重复操作。"),
    };
    let mut lines = vec![format!("## {}", t(title)), t(next).to_string()];
    if let Some(at) = run["startedAt"].as_str() { lines.push(format!("{}：{}",t("开始时间"),crate::util::fmt_time(at))); }
    if let Some(at) = run["completedAt"].as_str() { lines.push(format!("{}：{}",t("结束时间"),crate::util::fmt_time(at))); }
    if let Some(tools) = run["tools"].as_array() {
        let reads = tools.iter().filter(|v|v["effect"]=="read" && v["status"]=="succeeded").count();
        let writes = tools.iter().filter(|v|v["effect"]=="write" && v["status"]=="succeeded").count();
        let failures = tools.iter().filter(|v|v["status"]=="failed").count();
        lines.push(format!("{}：{}\n\n{}：{}\n\n{}：{}",t("已完成资料查询"),reads,t("已完成修改操作"),writes,t("未成功的操作"),failures));
    } else if let Some(n) = request["completedWriteCount"].as_u64() {
        lines.push(format!("{}：{}", t("已完成修改操作"), n));
    }
    if run["taskOutcome"]["status"] == "not_executed" { lines.push(t("本次仅完成分析，没有执行修改。").to_string()); }
    if run.get("error").is_some_and(|v| !v.is_null()) {
        let error = run["error"].as_str().unwrap_or("").to_lowercase();
        lines.push(t(if error.contains("timeout") || error.contains("超时") {"未完成原因：服务响应超时。"} else if error.contains("401") || error.contains("403") {"未完成原因：服务授权不可用，请检查连接设置。"} else {"未完成原因：处理过程中发生错误，请检查连接或模型设置后再试。"}).to_string());
    }
    if value.get("runReadError").is_some() { lines.push(t("详细过程暂时读取失败，以上仅为已确认的请求状态。请稍后重新查看。").to_string()); }
    lines.join("\n\n")
}
