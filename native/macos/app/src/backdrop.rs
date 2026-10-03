//! Search-only compositor layer; no capture, event view or pixel readback.
use gpui_kit::{Bounds, Pixels, Window};
use objc2::{
    msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject},
};
use objc2_foundation::{NSArray, NSNumber, NSPoint, NSRect, NSString};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use std::ffi::c_void;
#[link(name = "CoreImage", kind = "framework")]
unsafe extern "C" {}
#[link(name = "QuartzCore", kind = "framework")]
unsafe extern "C" {}
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPathCreateMutable() -> *mut c_void;
    fn CGPathAddRect(path: *mut c_void, transform: *const c_void, rect: NSRect);
    fn CGPathAddRoundedRect(
        path: *mut c_void,
        transform: *const c_void,
        rect: NSRect,
        rx: f64,
        ry: f64,
    );
    fn CGPathRelease(path: *const c_void);
    fn CGColorCreateGenericRGB(r: f64, g: f64, b: f64, a: f64) -> *mut c_void;
    fn CGColorRelease(color: *const c_void);
}
#[derive(Default)]
pub struct SearchBackdrop {
    layer: Option<Retained<AnyObject>>,
    geometry: Option<[f64; 7]>,
}
impl SearchBackdrop {
    pub fn clear(&mut self) {
        if let Some(layer) = self.layer.take() {
            unsafe {
                let _: () = msg_send![&*layer, removeFromSuperlayer];
            }
        }
        self.geometry = None;
    }
    pub fn update(&mut self, window: &Window, panel: Bounds<Pixels>) {
        let Ok(handle) = HasWindowHandle::window_handle(window) else {
            self.clear();
            return;
        };
        let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
            return;
        };
        // Only this GPUI window's own view. No global window inspection.
        let view = unsafe { &*handle.ns_view.as_ptr().cast::<AnyObject>() };
        unsafe {
            let parent: Option<Retained<AnyObject>> = msg_send![view, layer];
            let Some(parent) = parent else {
                self.clear();
                return;
            };
            let frame: NSRect = msg_send![view, bounds];
            let scale = f64::from(window.scale_factor());
            let geometry = [
                frame.size.width,
                frame.size.height,
                f64::from(f32::from(panel.origin.x)),
                f64::from(f32::from(panel.origin.y)),
                f64::from(f32::from(panel.size.width)),
                f64::from(f32::from(panel.size.height)),
                scale,
            ];
            if self.geometry == Some(geometry) {
                return;
            }
            self.clear();
            let (Some(layer_class), Some(mask_class), Some(filter_class), Some(transaction)) = (
                AnyClass::get(c"CALayer"),
                AnyClass::get(c"CAShapeLayer"),
                AnyClass::get(c"CIFilter"),
                AnyClass::get(c"CATransaction"),
            ) else {
                return;
            };
            let filter: Option<Retained<AnyObject>> =
                msg_send![filter_class, filterWithName: &*NSString::from_str("CIGaussianBlur")];
            let Some(filter) = filter else { return };
            let _: () = msg_send![&*filter, setDefaults];
            // Candidate backing-scale radius; actual pixel parity remains a GUI gate.
            let radius = NSNumber::new_f64(3. * scale);
            let _: () =
                msg_send![&*filter, setValue: &*radius forKey: &*NSString::from_str("inputRadius")];
            let filters = NSArray::from_slice(&[&*filter]);
            let layer: Retained<AnyObject> = msg_send![layer_class, new];
            let mask: Retained<AnyObject> = msg_send![mask_class, new];
            let path = CGPathCreateMutable();
            if path.is_null() {
                return;
            }
            CGPathAddRect(path, std::ptr::null(), frame);
            let hole = NSRect::new(
                NSPoint::new(geometry[2], geometry[3]),
                objc2_foundation::NSSize::new(geometry[4], geometry[5]),
            );
            CGPathAddRoundedRect(path, std::ptr::null(), hole, 22., 22.);
            let white = CGColorCreateGenericRGB(1., 1., 1., 1.);
            let _: () = msg_send![transaction, begin];
            let _: () = msg_send![transaction, setDisableActions: true];
            let _: () = msg_send![&*layer, setFrame: frame];
            let _: () = msg_send![&*layer, setGeometryFlipped: true];
            let _: () = msg_send![&*layer, setContentsScale: scale];
            let _: () = msg_send![&*layer, setMasksToBounds: true];
            let _: () = msg_send![&*layer, setBackgroundFilters: &*filters];
            let _: () = msg_send![&*mask, setFrame: frame];
            let _: () = msg_send![&*mask, setPath: path];
            let _: () = msg_send![&*mask, setFillColor: white];
            let _: () = msg_send![&*mask, setFillRule: &*NSString::from_str("even-odd")];
            let _: () = msg_send![&*layer, setMask: &*mask];
            let _: () = msg_send![&*parent, addSublayer: &*layer];
            let _: () = msg_send![transaction, commit];
            CGPathRelease(path);
            if !white.is_null() {
                CGColorRelease(white);
            }
            self.layer = Some(layer);
            self.geometry = Some(geometry);
        }
    }
}
impl Drop for SearchBackdrop {
    fn drop(&mut self) {
        self.clear();
    }
}
