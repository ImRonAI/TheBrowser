// Loaded as a same-origin asset; no blob: script CSP exception is required.
class RonPCM extends AudioWorkletProcessor {
  process(inputs) {
    const samples = inputs[0]?.[0]
    if (samples) this.port.postMessage(samples.slice())
    return true
  }
}
registerProcessor('ron-pcm', RonPCM)