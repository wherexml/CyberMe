//! Opt-in rendered-frame probe. Records only timings, never user content.
//! A forced-redraw sample is a rendering measurement, not an input-latency test.
use gpui_kit::*;
use std::{cell::RefCell, rc::Rc, time::Instant};

struct Sample {
    start: Instant,
    previous: Instant,
    times: Vec<f64>,
    output: std::path::PathBuf,
}

pub fn start(window: &mut Window) {
    let Some(path) = std::env::var_os("OPSTWIN_PERF_OUTPUT") else {
        return;
    };
    let now = Instant::now();
    next(
        window,
        Rc::new(RefCell::new(Sample {
            start: now,
            previous: now,
            times: Vec::new(),
            output: path.into(),
        })),
    );
}

fn next(window: &mut Window, sample: Rc<RefCell<Sample>>) {
    window.refresh();
    window.on_next_frame(move |window,_cx| {
        let done={
            let mut s=sample.borrow_mut();let now=Instant::now();
            let interval=now.duration_since(s.previous).as_secs_f64()*1000.;s.previous=now;
            if now.duration_since(s.start).as_secs_f64()>1. {s.times.push(interval);}
            now.duration_since(s.start).as_secs_f64()>=12.
        };
        if !done {next(window,sample);return;}
        let s=sample.borrow();let mut sorted=s.times.clone();sorted.sort_by(f64::total_cmp);
        if sorted.is_empty(){return;}
        let percentile=|p:f64| sorted[((sorted.len() as f64*p).ceil() as usize).saturating_sub(1).min(sorted.len()-1)];
        let report=serde_json::json!({"kind":"rendered-frame-forced-redraw","durationSeconds":12,"warmupSeconds":1,"count":sorted.len(),"p50Ms":percentile(0.5),"p95Ms":percentile(0.95),"maxMs":sorted.last(),"above33Ms":sorted.iter().filter(|x|**x>33.33).count(),"intervalsMs":s.times,"limitations":["Includes platform scheduling; not GPU timestamp duration","Not an input latency or real SQL benchmark"]});
        let output=s.output.clone();
        crate::runtime::runtime().spawn(async move {_=opstwin_store::write_atomic(&output,report.to_string().as_bytes());});
    });
}
