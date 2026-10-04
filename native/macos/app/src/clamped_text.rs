//! Two-line previews measured and painted from the same shaped glyphs.
use gpui_kit::*;
use std::{cell::RefCell, collections::BTreeSet, rc::Rc};
use unicode_segmentation::UnicodeSegmentation;
// GPUI's character-advance truncator can place its ellipsis on a fourth shaped
// line. Measure and paint the same glyph layout at the actual allocated width.
pub(crate) struct ClampedText {
    pub(crate) id: ElementId,
    pub(crate) text: SharedString,
}
pub(crate) struct ClampedTextLayout {
    style: TextStyle,
    line_height: Pixels,
    width: Option<Pixels>,
    lines: Vec<WrappedLine>,
}
impl ClampedTextLayout {
    fn measure(
        &mut self,
        text: &SharedString,
        width: Option<Pixels>,
        window: &Window,
        max_lines: usize,
    ) -> Size<Pixels> {
        self.width = width;
        let font_size = self.style.font_size.to_pixels(window.rem_size());
        let shape = |value: SharedString| {
            window
                .text_system()
                .shape_text(
                    value.clone(),
                    font_size,
                    &[self.style.to_run(value.len())],
                    width,
                    None,
                )
                .map(|lines| lines.into_iter().collect::<Vec<_>>())
                .unwrap_or_default()
        };
        let full = shape(text.clone());
        let line_count = |lines: &[WrappedLine]| {
            lines
                .iter()
                .map(|line| line.wrap_boundaries.len() + 1)
                .sum::<usize>()
        };
        self.lines = if width.is_some() && line_count(&full) > max_lines {
            // Cut points must satisfy both native glyph cluster starts and Unicode
            // extended-grapheme boundaries (ZWJ, modifiers, combining marks).
            let graphemes: BTreeSet<usize> = text
                .grapheme_indices(true)
                .map(|(index, _)| index)
                .collect();
            let mut boundaries = vec![0];
            let mut offset = 0;
            for line in &full {
                for run in &line.unwrapped_layout.runs {
                    for glyph in &run.glyphs {
                        let index = offset + glyph.index;
                        if index < text.len() && graphemes.contains(&index) {
                            boundaries.push(index);
                        }
                    }
                }
                offset += line.text.len() + 1;
            }
            boundaries.sort_unstable();
            boundaries.dedup();
            let candidate = |index: usize| {
                let prefix = text[..boundaries[index]].trim_end();
                shape(format!("{prefix}…").into())
            };
            let mut low = 0;
            let mut high = boundaries.len();
            let mut fitted = candidate(0);
            while low + 1 < high {
                let middle = low + (high - low) / 2;
                let lines = candidate(middle);
                if line_count(&lines) <= max_lines {
                    low = middle;
                    fitted = lines;
                } else {
                    high = middle;
                }
            }
            fitted
        } else {
            full
        };
        let mut measured: Size<Pixels> = Size::default();
        for line in &self.lines {
            let size = line.size(self.line_height);
            measured.width = measured.width.max(size.width).ceil();
            measured.height += size.height;
        }
        // Intrinsic probes have no wrap width. Their height must still remain
        // bounded; final width100% layout performs the actual wrapped measure.
        measured.height = measured.height.min(self.line_height * max_lines);
        measured
    }
}
impl IntoElement for ClampedText {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}
impl Element for ClampedText {
    type RequestLayoutState = Rc<RefCell<ClampedTextLayout>>;
    type PrepaintState = ();
    fn id(&self) -> Option<ElementId> {
        Some(self.id.clone())
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }
    fn a11y_role(&self) -> Option<Role> {
        Some(Role::Label)
    }
    fn write_a11y_info(&self, node: &mut accesskit::Node) {
        node.set_value(self.text.to_string());
    }
    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        _: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let style = window.text_style();
        let line_height = window.pixel_snap(style.line_height.to_pixels(
            style.font_size.to_pixels(window.rem_size()).into(),
            window.rem_size(),
        ));
        let state = Rc::new(RefCell::new(ClampedTextLayout {
            style,
            line_height,
            width: None,
            lines: vec![],
        }));
        let measure_state = state.clone();
        let text = self.text.clone();
        let mut layout_style = Style::default();
        layout_style.size.width = relative(1.).into();
        layout_style.min_size.width = px(0.).into();
        layout_style.max_size.height = (line_height * 2).into();
        let layout =
            window.request_measured_layout(layout_style, move |known, available, window, _| {
                let width = known.width.or(match available.width {
                    AvailableSpace::Definite(width) => Some(width.max(px(1.))),
                    _ => None,
                });
                measure_state.borrow_mut().measure(&text, width, window, 2)
            });
        (layout, state)
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        state: &mut Self::RequestLayoutState,
        window: &mut Window,
        _: &mut App,
    ) {
        let mut state = state.borrow_mut();
        let width = Some(bounds.size.width.max(px(1.)));
        let budget = ((bounds.size.height / state.line_height) + 0.001).floor() as usize;
        let painted_lines: usize = state
            .lines
            .iter()
            .map(|line| line.wrap_boundaries.len() + 1)
            .sum();
        if state.width != width || painted_lines > budget {
            // This is an exceptional guard, not a normal reflow path. Never paint
            // extra lines outside Taffy's already allocated height. A width drift
            // warning / reduced line budget is a GUI acceptance failure gate.
            eprintln!("Clamped text allocated-layout drift; guarded line budget");
            if budget == 0 {
                state.lines.clear();
                state.width = width;
            } else {
                state.measure(&self.text, width, window, budget.min(2));
            }
        }
    }
    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        state: &mut Self::RequestLayoutState,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        let state = state.borrow();
        let mut origin = bounds.origin;
        for line in &state.lines {
            let _ = line.paint(
                origin,
                state.line_height,
                state.style.text_align,
                Some(bounds),
                window,
                cx,
            );
            origin.y += line.size(state.line_height).height;
        }
    }
}
