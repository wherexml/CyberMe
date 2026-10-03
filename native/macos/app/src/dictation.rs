//! Real microphone helper, memory-only audio and live amplitude.
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct CaptureState {
    pub level: f32,
    pub seconds: f32,
    pub recording: bool,
    pub result: Option<Result<Vec<u8>, String>>,
}
pub struct Capture {
    child: Arc<Mutex<Child>>,
    pub state: Arc<Mutex<CaptureState>>,
}
impl Capture {
    pub fn start() -> Result<Self, String> {
        let path = std::env::var_os("OPSTWIN_DICTATION_HELPER")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::current_exe()
                    .ok()
                    .and_then(|p| p.parent().map(|p| p.join("opstwin-dictation")))
            })
            .ok_or("找不到听写组件")?;
        let mut child = Command::new(path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "无法启动听写组件，请重新安装本地应用".to_string())?;
        let stdout = child.stdout.take().ok_or("听写组件没有输出")?;
        let child = Arc::new(Mutex::new(child));
        let state = Arc::new(Mutex::new(CaptureState::default()));
        let output = state.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                    continue;
                };
                let Ok(mut s) = output.lock() else { break };
                if let Some(value) = v.get("level").and_then(|v| v.as_f64()) {
                    s.level = value as f32;
                }
                if let Some(value) = v.get("seconds").and_then(|v| v.as_f64()) {
                    s.seconds = value as f32;
                }
                if v.get("recording").is_some() {
                    s.recording = true;
                }
                if let Some(error) = v.get("error").and_then(|v| v.as_str()) {
                    s.result = Some(Err(error.to_string()));
                    break;
                }
                if let Some(audio) = v.get("audio").and_then(|v| v.as_str()) {
                    s.result = Some(decode_audio(audio));
                    break;
                }
                if v.get("cancelled").is_some() {
                    break;
                }
            }
            if let Ok(mut s) = output.lock() {
                s.recording = false;
                if s.result.is_none() {
                    s.result = Some(Err("麦克风采集已中断".into()));
                }
            }
        });
        Ok(Self { child, state })
    }
    pub fn stop(&self) {
        if let Ok(mut child) = self.child.lock() {
            if let Some(stdin) = child.stdin.as_mut() {
                let _ = stdin.write_all(b"STOP\n");
            }
        }
    }
    pub fn cancel(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
impl Drop for Capture {
    fn drop(&mut self) {
        self.cancel();
    }
}
fn decode_audio(text: &str) -> Result<Vec<u8>, String> {
    if text.len() > 16 * 1024 * 1024 {
        return Err("录音超过12MB".into());
    }
    let mut result = Vec::with_capacity(text.len() * 3 / 4);
    let mut bits = 0u32;
    let mut count = 0;
    for c in text.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            _ => return Err("录音格式无效".into()),
        };
        bits = (bits << 6) | u32::from(v);
        count += 6;
        if count >= 8 {
            count -= 8;
            result.push((bits >> count) as u8);
        }
    }
    Ok(result)
}
