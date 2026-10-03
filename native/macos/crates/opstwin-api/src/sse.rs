//! Minimal `text/event-stream` line parser (WHATWG subset: event/data/id,
//! comments ignored, CRLF/LF tolerant).

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Event {
    pub event: String,
    pub data: String,
    pub id: Option<String>,
}

#[derive(Default)]
pub struct Parser {
    buf: Vec<u8>,
    event: String,
    data: Vec<String>,
    id: Option<String>,
}

impl Parser {
    pub fn feed(&mut self, chunk: &[u8]) -> Vec<Event> {
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        while let Some(pos) = self.buf.iter().position(|b| *b == b'\n') {
            let mut line: Vec<u8> = self.buf.drain(..=pos).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            let line = String::from_utf8_lossy(&line).into_owned();
            if line.is_empty() {
                if !self.data.is_empty() || !self.event.is_empty() {
                    out.push(Event {
                        event: if self.event.is_empty() {
                            "message".into()
                        } else {
                            std::mem::take(&mut self.event)
                        },
                        data: self.data.join("\n"),
                        id: self.id.clone(),
                    });
                }
                self.event.clear();
                self.data.clear();
                continue;
            }
            if line.starts_with(':') {
                continue;
            }
            let (field, value) = match line.find(':') {
                Some(i) => {
                    let v = &line[i + 1..];
                    (&line[..i], v.strip_prefix(' ').unwrap_or(v))
                }
                None => (line.as_str(), ""),
            };
            match field {
                "event" => self.event = value.to_string(),
                "data" => self.data.push(value.to_string()),
                "id" => self.id = Some(value.to_string()),
                _ => {}
            }
        }
        out
    }
}
