//! Search-only compositor layer; no capture, event view or pixel readback.
use gpui_kit::{Bounds, Pixels, Window};
use objc2::{
    msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject},
};
use objc2_core_foundation::CGAffineTransform;
use objc2_foundation::{NSArray, NSNumber, NSPoint, NSRect, NSString, NSValue};
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
            let (
                Some(layer_class),
                Some(mask_class),
                Some(filter_class),
                Some(vector_class),
                Some(transaction),
            ) = (
                AnyClass::get(c"CALayer"),
                AnyClass::get(c"CAShapeLayer"),
                AnyClass::get(c"CIFilter"),
                AnyClass::get(c"CIVector"),
                AnyClass::get(c"CATransaction"),
            )
            else {
                return;
            };
            let filter: Option<Retained<AnyObject>> =
                msg_send![filter_class, filterWithName: &*NSString::from_str("CIGaussianBlur")];
            let Some(filter) = filter else { return };
            let _: () = msg_send![&*filter, setDefaults];
            // Background filters use layer points; multiplying Retina scale
            // doubled the actual blur in v13's independent screenshots.
            let radius = NSNumber::new_f64(3.);
            let _: () =
                msg_send![&*filter, setValue: &*radius forKey: &*NSString::from_str("inputRadius")];
            let clamp: Option<Retained<AnyObject>> =
                msg_send![filter_class, filterWithName: &*NSString::from_str("CIAffineClamp")];
            let input_crop: Option<Retained<AnyObject>> =
                msg_send![filter_class, filterWithName: &*NSString::from_str("CICrop")];
            let crop: Option<Retained<AnyObject>> =
                msg_send![filter_class, filterWithName: &*NSString::from_str("CICrop")];
            let (Some(clamp), Some(input_crop), Some(crop)) = (clamp, input_crop, crop) else {
                return;
            };
            let identity = NSValue::new(CGAffineTransform {
                a: 1.,
                b: 0.,
                c: 0.,
                d: 1.,
                tx: 0.,
                ty: 0.,
            });
            // A sampling candidate, not a mask band. Preserve full-frame blur
            // while avoiding transparent AppKit edge pixels in CA's input.
            let inset = 10.0_f64;
            if geometry[0] <= inset * 2. || geometry[1] <= inset * 2. {
                return;
            }
            let input_rectangle: Retained<AnyObject> = msg_send![vector_class,
                vectorWithX: inset Y: inset Z: geometry[0] - inset * 2. W: geometry[1] - inset * 2.];
            let _: () = msg_send![&*input_crop, setDefaults];
            let _: () = msg_send![&*input_crop, setValue: &*input_rectangle forKey: &*NSString::from_str("inputRectangle")];
            let rectangle: Retained<AnyObject> = msg_send![vector_class, vectorWithX: 0.0_f64 Y: 0.0_f64 Z: geometry[0] W: geometry[1]];
            let _: () = msg_send![&*clamp, setDefaults];
            let _: () = msg_send![&*clamp, setValue: &*identity forKey: &*NSString::from_str("inputTransform")];
            let _: () = msg_send![&*crop, setDefaults];
            let _: () = msg_send![&*crop, setValue: &*rectangle forKey: &*NSString::from_str("inputRectangle")];
            // Clamp prevents transparent-edge falloff. Its infinite extent
            // must not be the final CA output (v14 distorted the scene).
            // The candidate crops to logical layer bounds; real Retina
            // captures must confirm CA's automatically supplied CI extent.
            let filters = NSArray::from_slice(&[&*input_crop, &*clamp, &*filter, &*crop]);
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

/// Preferences retain resizing; minimize and zoom stay visible but disabled.
pub fn preferences_controls(window: &Window) {
    let Ok(handle) = HasWindowHandle::window_handle(window) else {
        return;
    };
    let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
        return;
    };
    let view = unsafe { &*handle.ns_view.as_ptr().cast::<AnyObject>() };
    unsafe {
        let native: Option<Retained<AnyObject>> = msg_send![view, window];
        if let Some(native) = native {
            for kind in [1usize, 2usize] {
                let button: Option<Retained<AnyObject>> =
                    msg_send![&*native, standardWindowButton: kind];
                if let Some(button) = button {
                    let _: () = msg_send![&*button, setHidden: false];
                    let _: () = msg_send![&*button, setEnabled: false];
                }
            }
        }
    }
}
