package cc.ccwu.clipquest.audio

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class ClipQuestLocalAudioDecoderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ClipQuestLocalAudioDecoder")

    AsyncFunction("decodeToChunks") {
      inputUri: String,
      outputDirectoryUri: String,
      chunkSeconds: Double,
      overlapSeconds: Double ->
      decode(inputUri, outputDirectoryUri, chunkSeconds, overlapSeconds)
    }.runOnQueue(Queues.DEFAULT)
  }

  private fun decode(
    inputUri: String,
    outputDirectoryUri: String,
    chunkSeconds: Double,
    overlapSeconds: Double
  ): List<Map<String, Any>> {
    require(chunkSeconds > 0 && overlapSeconds >= 0 && overlapSeconds < chunkSeconds)
    val inputFile = File(requireNotNull(Uri.parse(inputUri).path))
    val outputDirectory = File(requireNotNull(Uri.parse(outputDirectoryUri).path)).apply { mkdirs() }
    val rawFile = File(outputDirectory, "decoded-16k-mono.pcm")
    val extractor = MediaExtractor()
    extractor.setDataSource(inputFile.absolutePath)
    val trackIndex = (0 until extractor.trackCount).firstOrNull { index ->
      extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
    } ?: throw IllegalArgumentException("No audio track")
    extractor.selectTrack(trackIndex)
    val inputFormat = extractor.getTrackFormat(trackIndex)
    val mime = requireNotNull(inputFormat.getString(MediaFormat.KEY_MIME))
    val codec = MediaCodec.createDecoderByType(mime)
    codec.configure(inputFormat, null, null, 0)
    codec.start()

    var sourceRate = inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    var channels = inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    val bufferInfo = MediaCodec.BufferInfo()
    var inputDone = false
    var outputDone = false
    FileOutputStream(rawFile).use { rawOutput ->
      while (!outputDone) {
        if (!inputDone) {
          val inputIndex = codec.dequeueInputBuffer(10_000)
          if (inputIndex >= 0) {
            val inputBuffer = requireNotNull(codec.getInputBuffer(inputIndex))
            val size = extractor.readSampleData(inputBuffer, 0)
            if (size < 0) {
              codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              codec.queueInputBuffer(inputIndex, 0, size, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }
        val outputIndex = codec.dequeueOutputBuffer(bufferInfo, 10_000)
        when {
          outputIndex >= 0 -> {
            val outputBuffer = requireNotNull(codec.getOutputBuffer(outputIndex))
            if (bufferInfo.size > 0) {
              outputBuffer.position(bufferInfo.offset)
              outputBuffer.limit(bufferInfo.offset + bufferInfo.size)
              rawOutput.write(resampleTo16kMono(outputBuffer.slice(), sourceRate, channels))
            }
            outputDone = bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
            codec.releaseOutputBuffer(outputIndex, false)
          }
          outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            val format = codec.outputFormat
            sourceRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          }
        }
      }
    }
    codec.stop()
    codec.release()
    extractor.release()

    val bytesPerSecond = 16_000 * 2
    val chunkBytes = (chunkSeconds * bytesPerSecond).roundToInt()
    val stepBytes = ((chunkSeconds - overlapSeconds) * bytesPerSecond).roundToInt()
    val results = mutableListOf<Map<String, Any>>()
    rawFile.inputStream().use { input ->
      var offset = 0L
      var index = 0
      while (offset < rawFile.length()) {
        input.channel.position(offset)
        val remaining = min(chunkBytes.toLong(), rawFile.length() - offset).toInt()
        val pcm = ByteArray(remaining)
        var read = 0
        while (read < remaining) {
          val count = input.read(pcm, read, remaining - read)
          if (count <= 0) break
          read += count
        }
        val chunkFile = File(outputDirectory, "chunk-${index.toString().padStart(4, '0')}.wav")
        writeWav(chunkFile, if (read == pcm.size) pcm else pcm.copyOf(read))
        val end = offset + read
        results += mapOf(
          "uri" to Uri.fromFile(chunkFile).toString(),
          "startMs" to ((offset.toDouble() / bytesPerSecond) * 1000).roundToInt(),
          "endMs" to ((end.toDouble() / bytesPerSecond) * 1000).roundToInt(),
          "sampleRate" to 16_000,
          "channels" to 1
        )
        if (end >= rawFile.length()) break
        offset += stepBytes
        index += 1
      }
    }
    rawFile.delete()
    return results
  }

  private fun resampleTo16kMono(buffer: ByteBuffer, sourceRate: Int, channels: Int): ByteArray {
    buffer.order(ByteOrder.LITTLE_ENDIAN)
    val frameCount = buffer.remaining() / 2 / max(1, channels)
    if (frameCount <= 0) return ByteArray(0)
    val mono = FloatArray(frameCount)
    for (frame in 0 until frameCount) {
      var sum = 0f
      for (channel in 0 until channels) sum += buffer.short / 32768f
      mono[frame] = sum / channels
    }
    val outputFrames = max(1, (frameCount.toDouble() * 16_000 / sourceRate).roundToInt())
    val output = ByteBuffer.allocate(outputFrames * 2).order(ByteOrder.LITTLE_ENDIAN)
    for (index in 0 until outputFrames) {
      val sourcePosition = index.toDouble() * sourceRate / 16_000
      val left = min(frameCount - 1, sourcePosition.toInt())
      val right = min(frameCount - 1, left + 1)
      val fraction = (sourcePosition - left).toFloat()
      val sample = mono[left] + (mono[right] - mono[left]) * fraction
      output.putShort((sample.coerceIn(-1f, 1f) * 32767).roundToInt().toShort())
    }
    return output.array()
  }

  private fun writeWav(file: File, pcm: ByteArray) {
    val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    header.put("RIFF".toByteArray(Charsets.US_ASCII))
    header.putInt(36 + pcm.size)
    header.put("WAVEfmt ".toByteArray(Charsets.US_ASCII))
    header.putInt(16)
    header.putShort(1)
    header.putShort(1)
    header.putInt(16_000)
    header.putInt(32_000)
    header.putShort(2)
    header.putShort(16)
    header.put("data".toByteArray(Charsets.US_ASCII))
    header.putInt(pcm.size)
    FileOutputStream(file).use { output ->
      output.write(header.array())
      output.write(pcm)
    }
  }
}
