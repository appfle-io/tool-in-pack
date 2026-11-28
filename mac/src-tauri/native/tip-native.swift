// TIP · macOS 네이티브 도우미 (v1.29.0)
//
// 왜 Swift 인가
//   두 가지 일은 macOS 프레임워크(ObjC)에 붙어 있다.
//     1) 글자 추출 — Vision(VNRecognizeTextRequest). macOS 에 들어 있어 추가 다운로드가 없다.
//     2) 화상 회의 — ScreenCaptureKit 으로 **시스템 오디오(상대방 목소리)** 만 담는다.
//   Tauri(Rust) 쪽에서 objc2 로 부르면 셀렉터·블록 시그니처 실수로 런타임에만 터지는데,
//   Swift 로 두면 컴파일 때 Apple 헤더와 대조되므로 틀린 호출이 빌드에서 바로 드러난다.
//
// 빌드와 설치
//   build.rs 가 `xcrun swiftc -O -target <arch>-apple-macos11.0` 으로 이 파일을 컴파일해
//   Rust 바이너리에 include_bytes 로 넣는다. 앱은 처음 쓸 때 app_data_dir/bin/tip-native 로
//   꺼내 0755 로 두고(arm64 는 ad-hoc 서명) 실행한다 — 앱 번들 밖이라 공증·서명 검사와
//   부딪히지 않고, ffmpeg·whisper-cli 와 같은 방식이다.
//
// 쓰는 법 (Rust 가 부른다)
//   tip-native ocr --lang ko-KR,en-US --path /tmp/tip-ocr-....png
//       → 표준출력에 {"lines":[{"text":…,"confidence":…,"x":…,"y":…,"w":…,"h":…}]}
//   tip-native audio --out /tmp/….wav
//       → SIGTERM/SIGINT 를 받을 때까지 48kHz 모노 16-bit PCM WAV 로 시스템 오디오를 담는다.
//         (Rust 가 끝낼 때 SIGTERM 을 보내고, 이 프로그램이 WAV 헤더를 고쳐 닫고 끝난다.)
//   실패는 표준에러에 `vision-failed: …` / `capture-failed: …` 한 줄 + 종료코드 3.

import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit
import Vision

/// 표준에러에 한 줄 남기고 끝난다.
func fail(_ message: String, _ code: Int32 = 3) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(code)
}

/* ------------------------------ 인자 읽기 ------------------------------ */

let argv = CommandLine.arguments
guard argv.count >= 2 else {
    fail("usage: tip-native <ocr|audio> [options]", 2)
}
let command = argv[1]

func option(_ name: String) -> String? {
    if let index = argv.firstIndex(of: "--" + name), index + 1 < argv.count {
        return argv[index + 1]
    }
    return nil
}

/* ------------------------------ 글자 추출 (Vision) ------------------------------ */

/// 요청한 언어 중 이 Mac 의 Vision 이 아는 것만 남긴다. 하나도 없으면 빈 배열(=자동).
/// 한국어는 macOS 13(Vision 개정 3)부터다 — 그 전 Mac 에서는 자동 언어로 넘긴다.
func supportedLanguages(_ wanted: [String]) -> [String] {
    guard !wanted.isEmpty else { return [] }
    var supported: [String] = []
    if #available(macOS 13.0, *) {
        supported = (try? VNRecognizeTextRequest.supportedRecognitionLanguages(
            for: .accurate, revision: VNRecognizeTextRequestRevision3)) ?? []
    }
    if supported.isEmpty {
        supported = (try? VNRecognizeTextRequest.supportedRecognitionLanguages(
            for: .accurate, revision: VNRecognizeTextRequestRevision2)) ?? []
    }
    guard !supported.isEmpty else { return wanted }
    let known = Set(supported)
    return wanted.filter { known.contains($0) }
}

func runOCR() {
    guard let path = option("path"), FileManager.default.fileExists(atPath: path) else {
        fail("vision-failed: 이미지 파일이 없습니다")
    }
    let wanted = (option("lang") ?? "").split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }
    let url = URL(fileURLWithPath: path)

    func recognize(_ languages: [String], _ latest: Bool) throws -> [VNRecognizedTextObservation] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        if #available(macOS 13.0, *), latest {
            request.revision = VNRecognizeTextRequestRevision3
        }
        if !languages.isEmpty {
            request.recognitionLanguages = languages
        }
        let handler = VNImageRequestHandler(url: url, options: [:])
        try handler.perform([request])
        return (request.results ?? [])
    }

    var observations: [VNRecognizedTextObservation] = []
    do {
        // 고른 언어가 이 macOS 에서 안 되면(예: 한국어가 없는 버전) 자동 언어로 한 번 더.
        observations = try recognize(supportedLanguages(wanted), true)
    } catch {
        do {
            observations = try recognize([], false)
        } catch {
            fail("vision-failed: \(error.localizedDescription)")
        }
    }

    var lines: [[String: Any]] = []
    for observation in observations {
        guard let candidate = observation.topCandidates(1).first else { continue }
        let box = observation.boundingBox
        lines.append([
            "text": candidate.string,
            "confidence": Double(candidate.confidence),
            "x": Double(box.origin.x),
            "y": Double(box.origin.y),
            "w": Double(box.size.width),
            "h": Double(box.size.height),
        ])
    }
    let payload: [String: Any] = ["lines": lines]
    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
          let text = String(data: data, encoding: .utf8) else {
        fail("vision-failed: 결과를 만들지 못했습니다")
    }
    print(text)
}

/* ------------------------------ 시스템 오디오 (ScreenCaptureKit) ------------------------------ */

/// 48kHz 모노 16-bit PCM WAV 를 조금씩 덧붙여 쓰고, 끝날 때 헤더의 길이를 고친다.
@available(macOS 13.0, *)
final class WavWriter {
    let url: URL
    let sampleRate: UInt32
    private var handle: FileHandle
    private var dataBytes: UInt32 = 0

    init(url: URL, sampleRate: UInt32) {
        self.url = url
        self.sampleRate = sampleRate
        FileManager.default.createFile(atPath: url.path, contents: nil)
        handle = (try? FileHandle(forWritingTo: url)) ?? FileHandle.standardOutput
        writeHeader(dataBytes: 0)
    }

    private func header(dataBytes: UInt32) -> Data {
        let channels: UInt16 = 1
        let bits: UInt16 = 16
        let byteRate = sampleRate * UInt32(channels) * UInt32(bits / 8)
        let blockAlign = channels * (bits / 8)
        var data = Data()
        func put(_ text: String) { data.append(text.data(using: .ascii)!) }
        func u32(_ value: UInt32) { var v = value.littleEndian; withUnsafeBytes(of: &v) { data.append(contentsOf: $0) } }
        func u16(_ value: UInt16) { var v = value.littleEndian; withUnsafeBytes(of: &v) { data.append(contentsOf: $0) } }
        put("RIFF"); u32(36 + dataBytes); put("WAVE")
        put("fmt "); u32(16); u16(1); u16(channels); u32(sampleRate)
        u32(byteRate); u16(blockAlign); u16(bits)
        put("data"); u32(dataBytes)
        return data
    }

    private func writeHeader(dataBytes: UInt32) {
        try? handle.seek(toOffset: 0)
        handle.write(header(dataBytes: dataBytes))
        try? handle.seekToEnd()
    }

    func append(_ samples: UnsafePointer<Float>, count: Int) {
        guard count > 0 else { return }
        var data = Data(capacity: count * 2)
        for index in 0..<count {
            let value = max(-1.0, min(1.0, samples[index]))
            var sample = Int16(value * 32767.0).littleEndian
            withUnsafeBytes(of: &sample) { data.append(contentsOf: $0) }
        }
        handle.write(data)
        dataBytes &+= UInt32(data.count)
    }

    func close() {
        writeHeader(dataBytes: dataBytes)
        try? handle.close()
    }
}

/// SCStream 이 주는 오디오 조각을 WAV 로 옮긴다. 여러 채널이면 평균을 낸다.
@available(macOS 13.0, *)
final class AudioSink: NSObject, SCStreamOutput {
    let writer: WavWriter
    var stream: SCStream?
    private var wrote = false

    init(writer: WavWriter) {
        self.writer = writer
        super.init()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid else { return }
        guard let format = CMSampleBufferGetFormatDescription(sampleBuffer),
              let description = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee else { return }
        let channels = Int(description.mChannelsPerFrame)
        let frames = CMSampleBufferGetNumSamples(sampleBuffer)
        guard channels > 0, frames > 0 else { return }

        let capacity = max(1, channels)
        let list = AudioBufferList.allocate(maximumBuffers: capacity)
        defer { free(list.unsafeMutablePointer) }
        var block: CMBlockBuffer?
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: list.unsafeMutablePointer,
            bufferListSize: AudioBufferList.sizeInBytes(maximumBuffers: capacity),
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: 0,
            blockBufferOut: &block)
        guard status == noErr else { return }

        let buffers = UnsafeMutableAudioBufferListPointer(list.unsafeMutablePointer)
        // ScreenCaptureKit 의 오디오는 보통 float32 다. 아니면 이 조각은 건너뛴다.
        if buffers.count == 1, let data = buffers[0].mData {
            let count = min(frames, Int(buffers[0].mDataByteSize) / MemoryLayout<Float>.size)
            writer.append(data.assumingMemoryBound(to: Float.self), count: count)
            wrote = true
        } else if buffers.count > 1 {
            var mixed = [Float](repeating: 0, count: frames)
            var used = 0
            for buffer in buffers {
                guard let data = buffer.mData else { continue }
                let pointer = data.assumingMemoryBound(to: Float.self)
                let count = min(frames, Int(buffer.mDataByteSize) / MemoryLayout<Float>.size)
                for index in 0..<count { mixed[index] += pointer[index] }
                used += 1
            }
            if used > 0 {
                let scale = Float(used)
                for index in 0..<frames { mixed[index] /= scale }
                mixed.withUnsafeBufferPointer { pointer in
                    if let base = pointer.baseAddress { writer.append(base, count: frames) }
                }
                wrote = true
            }
        }
    }
}

@available(macOS 13.0, *)
func runAudio() {
    guard let out = option("out") else { fail("capture-failed: --out 이 없습니다", 2) }
    let writer = WavWriter(url: URL(fileURLWithPath: out), sampleRate: 48000)
    let sink = AudioSink(writer: writer)

    var failure: String?
    let ready = DispatchSemaphore(value: 0)

    SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, error in
        if let error = error {
            failure = error.localizedDescription
            ready.signal()
            return
        }
        guard let display = content?.displays.first else {
            failure = "화면을 찾지 못했습니다"
            ready.signal()
            return
        }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 48000
        config.channelCount = 1
        // 화면은 쓰지 않는다 — 아주 작게 두어 부담을 줄인다(오디오만 받는다).
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        config.showsCursor = false
        let stream = SCStream(filter: filter, configuration: config, delegate: nil)
        do {
            try stream.addStreamOutput(sink, type: .audio, sampleHandlerQueue: DispatchQueue(label: "io.appfle.tip.audio"))
            sink.stream = stream
        } catch {
            failure = error.localizedDescription
            ready.signal()
            return
        }
        stream.startCapture { error in
            if let error = error { failure = error.localizedDescription }
            ready.signal()
        }
    }

    ready.wait()
    if let failure = failure {
        writer.close()
        try? FileManager.default.removeItem(at: writer.url)
        fail("capture-failed: \(failure)")
    }

    // SIGTERM/SIGINT 로 끝낸다 — Rust 가 중지를 누를 때 보낸다.
    signal(SIGTERM, SIG_IGN)
    signal(SIGINT, SIG_IGN)
    var stopped = false
    let finish: () -> Void = {
        if stopped { return }
        stopped = true
        writer.close()
        if let stream = sink.stream {
            stream.stopCapture { _ in exit(0) }
            // stopCapture 가 응답하지 않아도 파일은 이미 닫았다.
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { exit(0) }
        } else {
            exit(0)
        }
    }
    let termSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    let intSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
    termSource.setEventHandler(handler: finish)
    intSource.setEventHandler(handler: finish)
    termSource.resume()
    intSource.resume()

    RunLoop.main.run()
}

/* ------------------------------ 시작 ------------------------------ */

switch command {
case "ocr":
    runOCR()
case "audio":
    if #available(macOS 13.0, *) {
        runAudio()
    } else {
        fail("capture-failed: 화상 회의 녹음은 macOS 13 이상에서 됩니다")
    }
default:
    fail("usage: tip-native <ocr|audio> [options]", 2)
}
