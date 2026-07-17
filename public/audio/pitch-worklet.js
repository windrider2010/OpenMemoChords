/* global AudioWorkletProcessor, registerProcessor */

const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;

class PitchFrameProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(FRAME_SIZE);
    this.writeIndex = 0;
    this.samplesSeen = 0;
    this.samplesSinceFrame = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let index = 0; index < channel.length; index += 1) {
      this.buffer[this.writeIndex] = channel[index];
      this.writeIndex = (this.writeIndex + 1) % FRAME_SIZE;
      this.samplesSeen += 1;
      this.samplesSinceFrame += 1;

      if (this.samplesSeen >= FRAME_SIZE && this.samplesSinceFrame >= HOP_SIZE) {
        const frame = new Float32Array(FRAME_SIZE);
        const tailLength = FRAME_SIZE - this.writeIndex;
        frame.set(this.buffer.subarray(this.writeIndex), 0);
        frame.set(this.buffer.subarray(0, this.writeIndex), tailLength);
        this.port.postMessage(frame, [frame.buffer]);
        this.samplesSinceFrame = 0;
      }
    }
    return true;
  }
}

registerProcessor("pitch-frame-processor", PitchFrameProcessor);
