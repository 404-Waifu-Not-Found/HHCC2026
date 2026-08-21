class ClipQuestCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = [];
    this.pendingLength = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length || !channels[0]?.length) return true;
    const frameCount = channels[0].length;
    const mono = new Float32Array(frameCount);
    for (const channel of channels) {
      for (let index = 0; index < frameCount; index += 1) {
        mono[index] += (channel[index] ?? 0) / channels.length;
      }
    }
    this.pending.push(mono);
    this.pendingLength += mono.length;
    if (this.pendingLength >= 4096) {
      const output = new Float32Array(this.pendingLength);
      let offset = 0;
      for (const piece of this.pending) {
        output.set(piece, offset);
        offset += piece.length;
      }
      this.pending = [];
      this.pendingLength = 0;
      this.port.postMessage({ pcm: output, sampleRate }, [output.buffer]);
    }
    return true;
  }
}

registerProcessor("clipquest-capture", ClipQuestCaptureProcessor);
