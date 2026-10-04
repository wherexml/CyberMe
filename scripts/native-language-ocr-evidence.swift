// Read-only Vision analysis of already captured public native E2E PNGs.
import Foundation
import Vision
import ImageIO
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let directory = root.appendingPathComponent("output/native-parity-20261003/language-resume-20261004").resolvingSymlinksInPath()
guard directory.path.hasPrefix(root.resolvingSymlinksInPath().path + "/output/") else { fatalError("Invalid evidence root") }
let names = try FileManager.default.contentsOfDirectory(atPath: directory.path).filter { $0.hasSuffix(".png") }.sorted()
var records: [[String: Any]] = []
for name in names {
    let url = directory.appendingPathComponent(name).resolvingSymlinksInPath()
    guard url.path.hasPrefix(directory.path + "/"), let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { fatalError("Invalid original image") }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["en-US", "zh-Hans"]
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: image).perform([request])
    let lines = (request.results ?? []).compactMap { observation -> [String: Any]? in
        guard let text = observation.topCandidates(1).first else { return nil }
        let b = observation.boundingBox
        return ["text": text.string, "confidence": text.confidence, "bounds": [b.origin.x, b.origin.y, b.size.width, b.size.height]]
    }
    records.append(["name": name, "width": image.width, "height": image.height, "lines": lines])
}
let output: [String: Any] = ["mode": "READ_ONLY_ORIGINAL_PUBLIC_PNG_OCR", "languageCorrection": false, "records": records, "notClaimed": "OCR is fallible evidence, not independent scoring or new GUI interaction"]
let data = try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
try data.write(to: directory.appendingPathComponent("ocr-evidence.json"))
print("OCR original public frames: \(records.count)")
