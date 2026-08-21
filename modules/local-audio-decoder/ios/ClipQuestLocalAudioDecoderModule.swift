import AVFoundation
import ExpoModulesCore

public final class ClipQuestLocalAudioDecoderModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ClipQuestLocalAudioDecoder")

    AsyncFunction("decodeToChunks") {
      (inputUri: String, outputDirectoryUri: String, chunkSeconds: Double, overlapSeconds: Double) in
      return try Self.decode(
        inputUri: inputUri,
        outputDirectoryUri: outputDirectoryUri,
        chunkSeconds: chunkSeconds,
        overlapSeconds: overlapSeconds
      )
    }.runOnQueue(.global(qos: .userInitiated))
  }

  private static func decode(
    inputUri: String,
    outputDirectoryUri: String,
    chunkSeconds: Double,
    overlapSeconds: Double
  ) throws -> [[String: Any]] {
    guard chunkSeconds > 0, overlapSeconds >= 0, overlapSeconds < chunkSeconds else {
      throw DecoderError.invalidChunkConfiguration
    }
    guard let inputURL = URL(string: inputUri), let outputURL = URL(string: outputDirectoryUri) else {
      throw DecoderError.invalidURL
    }
    try FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)

    let asset = AVURLAsset(url: inputURL)
    let reader = try AVAssetReader(asset: asset)
    guard let audioTrack = asset.tracks(withMediaType: .audio).first else {
      throw DecoderError.noAudioTrack
    }
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: 16_000,
      AVNumberOfChannelsKey: 1,
      AVLinearPCMBitDepthKey: 16,
      AVLinearPCMIsFloatKey: false,
      AVLinearPCMIsBigEndianKey: false,
      AVLinearPCMIsNonInterleaved: false,
    ]
    let output = AVAssetReaderAudioMixOutput(audioTracks: [audioTrack], audioSettings: settings)
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else { throw DecoderError.unsupportedAudio }
    reader.add(output)
    guard reader.startReading() else { throw reader.error ?? DecoderError.readFailed }

    let rawURL = outputURL.appendingPathComponent("decoded-16k-mono.pcm")
    FileManager.default.createFile(atPath: rawURL.path, contents: nil)
    let rawWriter = try FileHandle(forWritingTo: rawURL)
    while let sample = output.copyNextSampleBuffer() {
      guard let block = CMSampleBufferGetDataBuffer(sample) else { continue }
      var length = 0
      var pointer: UnsafeMutablePointer<Int8>?
      let status = CMBlockBufferGetDataPointer(
        block,
        atOffset: 0,
        lengthAtOffsetOut: nil,
        totalLengthOut: &length,
        dataPointerOut: &pointer
      )
      if status == kCMBlockBufferNoErr, let pointer {
        rawWriter.write(Data(bytes: pointer, count: length))
      }
      CMSampleBufferInvalidate(sample)
    }
    try rawWriter.close()
    guard reader.status == .completed else { throw reader.error ?? DecoderError.readFailed }

    let bytesPerSecond = 16_000 * MemoryLayout<Int16>.size
    let chunkBytes = Int(chunkSeconds * Double(bytesPerSecond))
    let stepBytes = Int((chunkSeconds - overlapSeconds) * Double(bytesPerSecond))
    let attributes = try FileManager.default.attributesOfItem(atPath: rawURL.path)
    let pcmCount = (attributes[.size] as? NSNumber)?.intValue ?? 0
    let rawReader = try FileHandle(forReadingFrom: rawURL)
    var results: [[String: Any]] = []
    var offset = 0
    var index = 0
    while offset < pcmCount {
      let end = min(pcmCount, offset + chunkBytes)
      try rawReader.seek(toOffset: UInt64(offset))
      let slice = rawReader.readData(ofLength: end - offset)
      let filename = String(format: "chunk-%04d.wav", index)
      let fileURL = outputURL.appendingPathComponent(filename)
      try wavData(pcm: slice, sampleRate: 16_000, channels: 1).write(to: fileURL, options: .atomic)
      let startMs = Int((Double(offset) / Double(bytesPerSecond)) * 1_000)
      let endMs = Int((Double(end) / Double(bytesPerSecond)) * 1_000)
      results.append([
        "uri": fileURL.absoluteString,
        "startMs": startMs,
        "endMs": endMs,
        "sampleRate": 16_000,
        "channels": 1,
      ])
      if end == pcmCount { break }
      offset += stepBytes
      index += 1
    }
    try rawReader.close()
    try? FileManager.default.removeItem(at: rawURL)
    return results
  }

  private static func wavData(pcm: Data, sampleRate: Int, channels: Int) -> Data {
    let bitsPerSample = 16
    let byteRate = sampleRate * channels * bitsPerSample / 8
    let blockAlign = channels * bitsPerSample / 8
    var data = Data()
    data.append("RIFF".data(using: .ascii)!)
    data.appendUInt32LE(UInt32(36 + pcm.count))
    data.append("WAVEfmt ".data(using: .ascii)!)
    data.appendUInt32LE(16)
    data.appendUInt16LE(1)
    data.appendUInt16LE(UInt16(channels))
    data.appendUInt32LE(UInt32(sampleRate))
    data.appendUInt32LE(UInt32(byteRate))
    data.appendUInt16LE(UInt16(blockAlign))
    data.appendUInt16LE(UInt16(bitsPerSample))
    data.append("data".data(using: .ascii)!)
    data.appendUInt32LE(UInt32(pcm.count))
    data.append(pcm)
    return data
  }
}

private enum DecoderError: Error {
  case invalidChunkConfiguration
  case invalidURL
  case noAudioTrack
  case unsupportedAudio
  case readFailed
}

private extension Data {
  mutating func appendUInt16LE(_ value: UInt16) {
    var value = value.littleEndian
    Swift.withUnsafeBytes(of: &value) { append(contentsOf: $0) }
  }

  mutating func appendUInt32LE(_ value: UInt32) {
    var value = value.littleEndian
    Swift.withUnsafeBytes(of: &value) { append(contentsOf: $0) }
  }
}
