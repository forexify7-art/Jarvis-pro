class JarvisLiveCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(512);
    this.bufferIndex = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    if (!input) return true;

    for (let index = 0; index < input.length; index += 1) {
      this.buffer[this.bufferIndex] = input[index];
      this.bufferIndex += 1;
      if (this.bufferIndex === this.buffer.length) {
        const samples = this.buffer;
        this.buffer = new Float32Array(512);
        this.bufferIndex = 0;
        this.port.postMessage({ samples, sampleRate }, [samples.buffer]);
      }
    }
    return true;
  }
}

registerProcessor('jarvis-live-capture', JarvisLiveCaptureProcessor);