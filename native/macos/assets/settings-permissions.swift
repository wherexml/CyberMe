// Read-only status probe for Settings. No permission request or private TCC access.
import Foundation
import AVFoundation
import ApplicationServices

let microphone: String
switch AVCaptureDevice.authorizationStatus(for: .audio) {
case .authorized: microphone = "granted"
case .denied: microphone = "denied"
case .restricted: microphone = "restricted"
case .notDetermined: microphone = "notDetermined"
@unknown default: microphone = "unknown"
}
let status: [String: String] = [
    "microphone": microphone,
    "accessibility": AXIsProcessTrusted() ? "granted" : "notGranted",
    "fullDisk": "unknown"
]
if let data = try? JSONSerialization.data(withJSONObject: status, options: [.sortedKeys]) {
    FileHandle.standardOutput.write(data)
}
