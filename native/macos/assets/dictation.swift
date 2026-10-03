// Memory-only AVAudioEngine capture. JSON stdout carries levels and one WAV.
// No files, chat bodies, credentials or audio diagnostics are written.
import Foundation
import AVFoundation
import Darwin

func emit(_ value: [String: Any]) {
    guard let bytes = try? JSONSerialization.data(withJSONObject: value),
          let line = String(data: bytes, encoding: .utf8) else { return }
    print(line); fflush(stdout)
}
let permission = DispatchSemaphore(value: 0)
var granted = false
AVCaptureDevice.requestAccess(for: .audio) { allowed in granted = allowed; permission.signal() }
permission.wait()
guard granted else { emit(["error": "麦克风权限未允许，请在系统设置允许 OpsTwins 使用麦克风"]); exit(2) }
let engine = AVAudioEngine()
let input = engine.inputNode
let format = input.outputFormat(forBus: 0)
guard format.sampleRate > 0, format.channelCount > 0 else { emit(["error":"麦克风不可用"]); exit(3) }
let lock = NSLock()
var samples = Data()
var level: Float = 0
var failure: String? = nil
var elapsed: Double = 0
let started = Date()
var lastFrame = Date()
// Downsample to mono PCM16 at 16kHz; phase survives across hardware buffers.
var phase: Double = 0
input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
    guard let channels = buffer.floatChannelData else { return }
    lock.lock(); defer { lock.unlock() }
    var energy: Float = 0
    for i in 0..<Int(buffer.frameLength) {
        let value = channels[0][i]
        energy += value * value
        phase += 16000
        if phase >= format.sampleRate {
            phase -= format.sampleRate
            let sample = Int16(max(-1, min(1, value)) * 32767)
            var little = sample.littleEndian
            withUnsafeBytes(of: &little) { samples.append(contentsOf: $0) }
        }
    }
    elapsed += Double(buffer.frameLength) / format.sampleRate
    lastFrame = Date()
    level = min(1, sqrt(energy / Float(max(1, buffer.frameLength))) * 5)
    if samples.count > 12*1024*1024 { failure = "录音超过12MB" }
}
do { try engine.start() } catch { emit(["error":"无法启动麦克风采集"]); exit(4) }
emit(["recording":true])
let finished = DispatchSemaphore(value: 0)
var cancelled = false
DispatchQueue.global().async {
    let command = readLine()
    lock.lock(); cancelled = command != "STOP"; lock.unlock()
    finished.signal()
}
while finished.wait(timeout: .now() + 0.1) == .timedOut {
    lock.lock()
    if Date().timeIntervalSince(lastFrame) > 3 { failure = "麦克风采集已中断，请检查设备" }
    let amplitude = level, seconds = elapsed, error = failure
    lock.unlock()
    emit(["level":amplitude,"seconds":seconds])
    if seconds >= 89 || Date().timeIntervalSince(started) >= 89 || error != nil { break }
}
engine.stop(); input.removeTap(onBus: 0)
lock.lock()
let bytes = samples, stopError = failure, wasCancelled = cancelled
samples.removeAll(keepingCapacity:false)
lock.unlock()
if wasCancelled { emit(["cancelled":true]); exit(0) }
if let error = stopError { emit(["error":error]); exit(5) }
if bytes.count < 3200 { emit(["error":"录音太短，请重新录音"]); exit(6) }
var wav = Data()
func string(_ value:String) { wav.append(contentsOf:value.utf8) }
func u16(_ value:UInt16) { var v=value.littleEndian; withUnsafeBytes(of:&v){wav.append(contentsOf:$0)} }
func u32(_ value:UInt32) { var v=value.littleEndian; withUnsafeBytes(of:&v){wav.append(contentsOf:$0)} }
string("RIFF");u32(UInt32(bytes.count+36));string("WAVEfmt ");u32(16);u16(1);u16(1);u32(16000);u32(32000);u16(2);u16(16);string("data");u32(UInt32(bytes.count));wav.append(bytes)
emit(["audio":wav.base64EncodedString()])
