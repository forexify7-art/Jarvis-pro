export const GEMINI_LIVE_MODEL = 'gemini-3.8-live';

const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;
const AUDIO_BUFFER_LIMIT = 256_000;
const SETUP_TIMEOUT_MS = 15_000;
export const GEMINI_LIVE_CONVERSATION_TIMEOUT_MS = 30 * 60 * 1_000;

export function resampleAudio(samples, inputRate, outputRate = INPUT_SAMPLE_RATE) {
  if (!(samples instanceof Float32Array) || samples.length === 0) return new Float32Array();
  if (inputRate === outputRate) return samples;
  const outputLength = Math.max(1, Math.floor(samples.length * outputRate / inputRate));
  const output = new Float32Array(outputLength);
  const ratio = inputRate / outputRate;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const lower = Math.min(Math.floor(position), samples.length - 1);
    const upper = Math.min(lower + 1, samples.length - 1);
    const fraction = position - lower;
    output[index] = samples[lower] + (samples[upper] - samples[lower]) * fraction;
  }
  return output;
}

export function encodePcm16Base64(samples) {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

export function decodePcm16Base64(encoded) {
  const binary = atob(encoded);
  const view = new DataView(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) view.setUint8(index, binary.charCodeAt(index));
  const samples = new Int16Array(Math.floor(binary.length / 2));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true);
  }
  return samples;
}

export function buildGeminiLiveSetup(language = 'en', speechOnly = false, voiceName = 'Puck') {
  return {
    setup: {
      model: `models/${GEMINI_LIVE_MODEL}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
      systemInstruction: {
        parts: [{
          text: speechOnly
            ? 'Speak the user-provided text exactly as written, naturally and clearly. Do not add, remove, translate, or answer it.'
              : `You are J.A.R.V.I.S., a helpful voice assistant. Have a natural, concise conversation with a warm, clear, expressive voice at a moderate pace. Pronounce Hindi and English accurately, including natural Hindi-English code-switching; use the user's script for Hindi. Reply in the language the user speaks, including Hindi, English, or a mixture of both. Language preference: ${language === 'hi' ? 'Hindi' : 'English'}, while matching the user's language when they switch.`,
        }],
      },
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false,
          silenceDurationMs: 600,
          prefixPaddingMs: 200,
        },
        activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
      },
      outputAudioTranscription: {},
      ...(speechOnly ? {} : { inputAudioTranscription: {} }),
    },
  };
}

export function getGeminiLiveWebSocketUrl(token) {
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`;
}

async function readSocketMessage(data) {
  if (typeof data === 'string') return JSON.parse(data);
  if (data instanceof Blob) return JSON.parse(await data.text());
  if (data instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(data));
  throw new TypeError('Gemini Live returned an unsupported message.');
}

export class GeminiLiveVoice {
  constructor({
    fetcher = globalThis.fetch,
    WebSocketConstructor = globalThis.WebSocket,
    conversationTimeoutMs = GEMINI_LIVE_CONVERSATION_TIMEOUT_MS,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    this.fetcher = fetcher;
    this.WebSocketConstructor = WebSocketConstructor;
    this.conversationTimeoutMs = Number.isFinite(conversationTimeoutMs) && conversationTimeoutMs > 0
      ? conversationTimeoutMs
      : GEMINI_LIVE_CONVERSATION_TIMEOUT_MS;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.outputContext = null;
    this.activeSession = null;
    this.sessionSequence = 0;
    this.requestSequence = 0;
    this.pendingType = null;
  }

  get supported() {
    return Boolean(
      this.fetcher
      && this.WebSocketConstructor
      && globalThis.navigator?.mediaDevices?.getUserMedia
      && (globalThis.AudioContext || globalThis.webkitAudioContext)
      && globalThis.AudioWorkletNode,
    );
  }

  get isConversationActive() {
    return this.pendingType === 'conversation'
      || (this.activeSession?.type === 'conversation' && !this.activeSession.closed);
  }

  get isSpeaking() {
    return Boolean(this.activeSession?.outputtingAudio);
  }

  async prime() {
    if (!this.supported) return false;
    const AudioContextConstructor = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.outputContext ||= new AudioContextConstructor();
    if (this.outputContext.state === 'suspended') await this.outputContext.resume();
    return this.outputContext.state === 'running';
  }

  async #getToken(headers) {
    const response = await this.fetcher('/api/live-token', {
      method: 'POST',
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.token !== 'string' || !data.token) {
      throw new Error(data.error || 'Gemini Live could not start. Check the Google Gemini provider in Settings.');
    }
    return data.token;
  }

  async #connect(options) {
    const { type, headers, language, speechOnly, voiceName, callbacks } = options;
    if (!this.supported) throw new Error('Live voice requires a current browser with microphone and AudioWorklet support.');
    const requestSequence = options.requestSequence ?? ++this.requestSequence;
    this.pendingType = type;
    await this.prime();
    const token = await this.#getToken(headers);
    if (requestSequence !== this.requestSequence) return null;
    const socket = new this.WebSocketConstructor(getGeminiLiveWebSocketUrl(token));
    const session = {
      id: ++this.sessionSequence,
      type,
      socket,
      callbacks,
      closed: false,
      setupComplete: false,
      outputtingAudio: false,
      receivedAudio: false,
      turnComplete: false,
      nextPlaybackTime: 0,
      playbackSources: new Set(),
      inputTranscript: '',
      outputTranscript: '',
      inputContext: null,
      inputStream: null,
      inputSource: null,
      inputProcessor: null,
      speechTimer: null,
      conversationTimer: null,
      speechResolve: null,
    };
    this.activeSession = session;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Gemini Live setup timed out. Check the connection and try again.')), SETUP_TIMEOUT_MS);
      const fail = (error) => {
        clearTimeout(timeout);
        reject(error);
      };
      socket.onopen = () => {
        if (session.closed) return;
        socket.send(JSON.stringify(buildGeminiLiveSetup(language, speechOnly, voiceName)));
      };
      socket.onmessage = async (event) => {
        try {
          const message = await readSocketMessage(event.data);
          if (message.error) {
            const error = new Error(message.error.message || 'Google Gemini Live returned an error.');
            if (!session.setupComplete) {
              fail(error);
              return;
            }
            callbacks.onError?.(error);
            if (session.type === 'speech') this.#finishSpeech(session, false);
            else {
              this.#cleanupSession(session, true);
              callbacks.onClosed?.();
            }
            return;
          }
          if (message.setupComplete) {
            session.setupComplete = true;
            clearTimeout(timeout);
            resolve(session);
          }
          this.#handleMessage(session, message);
        } catch (error) {
          if (!session.setupComplete) fail(error);
          else callbacks.onError?.(error);
        }
      };
      socket.onerror = () => {
        const error = new Error('Gemini Live WebSocket connection failed.');
        if (!session.setupComplete) fail(error);
        else {
          callbacks.onError?.(error);
          if (session.type === 'speech') this.#finishSpeech(session, false);
        }
      };
      socket.onclose = (event) => {
        const unexpectedClose = !session.closed;
        if (unexpectedClose && event.code !== 1000) {
          callbacks.onError?.(new Error('Gemini Live connection closed unexpectedly.'));
        }
        if (!session.setupComplete) fail(new Error('Gemini Live closed before setup completed.'));
        this.#cleanupSession(session, false);
        if (unexpectedClose) callbacks.onClosed?.();
      };
    }).catch((error) => {
      this.#cleanupSession(session, true);
      if (requestSequence === this.requestSequence) this.pendingType = null;
      throw error;
    });
    if (requestSequence === this.requestSequence) this.pendingType = null;
    return session;
  }

  #handleMessage(session, message) {
    if (session.closed || this.activeSession !== session) return;
    const content = message.serverContent;
    if (!content) return;

    const parts = content.modelTurn?.parts || [];
    for (const part of parts) {
      const encoded = part?.inlineData?.data;
      if (typeof encoded === 'string') this.#playAudio(session, encoded);
      if (typeof part?.text === 'string') session.callbacks.onModelText?.(part.text);
    }

    this.#readTranscript(session, 'inputTranscript', content.inputTranscription, session.callbacks.onInputTranscript);
    this.#readTranscript(session, 'outputTranscript', content.outputTranscription, session.callbacks.onOutputTranscript);

    if (content.interrupted) {
      this.#stopPlayback(session);
      session.callbacks.onInterrupted?.();
    }
    if (content.turnComplete) {
      session.turnComplete = true;
      this.#flushTranscript(session, 'inputTranscript', session.callbacks.onInputTranscript);
      this.#flushTranscript(session, 'outputTranscript', session.callbacks.onOutputTranscript);
      session.callbacks.onTurnComplete?.();
      this.#finishTurnIfReady(session);
    }
  }

  #readTranscript(session, key, transcription, callback) {
    if (typeof transcription?.text !== 'string' || !transcription.text) return;
    session[key] = transcription.finished && transcription.text.startsWith(session[key])
      ? transcription.text
      : session[key] + transcription.text;
    callback?.(session[key], { final: transcription.finished === true });
    if (transcription.finished) session[key] = '';
  }

  #flushTranscript(session, key, callback) {
    if (!session[key]) return;
    callback?.(session[key], { final: true });
    session[key] = '';
  }

  #playAudio(session, encoded) {
    if (!this.outputContext || session.closed) return;
    if (session.callbacks.shouldPlayAudio && !session.callbacks.shouldPlayAudio()) return;
    let pcm;
    try {
      pcm = decodePcm16Base64(encoded);
    } catch (error) {
      session.callbacks.onError?.(error);
      return;
    }
    if (!pcm.length) return;
    session.receivedAudio = true;
    const audio = this.outputContext.createBuffer(1, pcm.length, OUTPUT_SAMPLE_RATE);
    const channel = audio.getChannelData(0);
    let sumSquares = 0;
    for (let index = 0; index < pcm.length; index += 1) channel[index] = pcm[index] / 32768;
    for (const sample of channel) sumSquares += sample * sample;
    session.callbacks.onAudioLevel?.(Math.min(1, Math.sqrt(sumSquares / channel.length) * 4));
    const source = this.outputContext.createBufferSource();
    source.buffer = audio;
    source.connect(this.outputContext.destination);
    const startAt = Math.max(this.outputContext.currentTime + 0.015, session.nextPlaybackTime);
    session.nextPlaybackTime = startAt + audio.duration;
    session.playbackSources.add(source);
    if (!session.outputtingAudio) {
      session.outputtingAudio = true;
      session.callbacks.onAudioStart?.();
    }
    source.onended = () => {
      session.playbackSources.delete(source);
      this.#finishTurnIfReady(session);
    };
    source.start(startAt);
  }

  #stopPlayback(session) {
    session.turnComplete = false;
    for (const source of session.playbackSources) {
      try { source.stop(); } catch {}
    }
    session.playbackSources.clear();
    session.nextPlaybackTime = this.outputContext?.currentTime || 0;
    if (session.outputtingAudio) {
      session.outputtingAudio = false;
      session.callbacks.onAudioLevel?.(0);
      session.callbacks.onAudioEnd?.();
    }
  }

  #finishTurnIfReady(session) {
    if (!session.turnComplete || session.playbackSources.size) return;
    if (session.outputtingAudio) {
      session.outputtingAudio = false;
      session.callbacks.onAudioLevel?.(0);
      session.callbacks.onAudioEnd?.();
    }
    if (session.type === 'speech') this.#finishSpeech(session, session.receivedAudio);
    else session.turnComplete = false;
  }

  #finishSpeech(session, success) {
    if (session.closed) return;
    clearTimeout(session.speechTimer);
    session.callbacks.onSpeechEnd?.(success);
    session.speechResolve?.(success);
    this.#cleanupSession(session, true);
  }

  #cleanupSession(session, closeSocket) {
    if (session.closed) return;
    session.closed = true;
    clearTimeout(session.speechTimer);
    this.clearTimer(session.conversationTimer);
    this.#stopPlayback(session);
    session.inputProcessor?.disconnect();
    session.inputSource?.disconnect();
    if (session.inputStream) {
      for (const track of session.inputStream.getTracks()) track.stop();
    }
    session.inputContext?.close().catch(() => {});
    if (closeSocket && session.socket.readyState < 2) {
      try { session.socket.close(1000, 'Session finished'); } catch {}
    }
    if (this.activeSession === session) this.activeSession = null;
  }

  async startConversation({ headers = {}, language = 'en', voiceName = 'Puck', callbacks = {} } = {}) {
    if (!this.supported) throw new Error('Live voice requires a current browser with microphone and AudioWorklet support.');
    if (this.activeSession) await this.stop();
    const requestSequence = ++this.requestSequence;
    this.pendingType = 'conversation';
    let inputStream = null;
    let inputContext = null;
    let session = null;
    try {
      inputStream = await globalThis.navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: INPUT_SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (requestSequence !== this.requestSequence) {
        for (const track of inputStream.getTracks()) track.stop();
        return false;
      }
      await this.prime();
      const AudioContextConstructor = globalThis.AudioContext || globalThis.webkitAudioContext;
      inputContext = new AudioContextConstructor({ sampleRate: INPUT_SAMPLE_RATE });
      await inputContext.resume();
      await inputContext.audioWorklet.addModule('/voice/live-audio-processor.js');
      if (requestSequence !== this.requestSequence) {
        for (const track of inputStream.getTracks()) track.stop();
        await inputContext.close().catch(() => {});
        return false;
      }
      session = await this.#connect({
        type: 'conversation',
        headers,
        language,
        speechOnly: false,
        voiceName,
        callbacks,
        requestSequence,
      });
      if (!session || session.closed || requestSequence !== this.requestSequence) {
        for (const track of inputStream.getTracks()) track.stop();
        await inputContext.close().catch(() => {});
        return false;
      }
      session.inputStream = inputStream;
      session.inputContext = inputContext;
      const inputTracks = inputStream.getAudioTracks?.() || inputStream.getTracks();
      const handleInputEnded = () => {
        if (session.closed || this.activeSession !== session) return;
        const error = new Error('Microphone access ended. Check microphone permission and reconnect.');
        error.code = 'MICROPHONE_TRACK_ENDED';
        try {
          callbacks.onError?.(error);
        } finally {
          this.#cleanupSession(session, true);
          callbacks.onClosed?.();
        }
      };
      for (const track of inputTracks) track.addEventListener?.('ended', handleInputEnded, { once: true });
      if (inputTracks.some((track) => track.readyState === 'ended')) {
        handleInputEnded();
        return false;
      }
      session.inputProcessor = new globalThis.AudioWorkletNode(session.inputContext, 'jarvis-live-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      session.inputSource = session.inputContext.createMediaStreamSource(session.inputStream);
      session.inputProcessor.port.onmessage = (event) => {
        if (session.closed || session.socket.readyState !== 1 || session.socket.bufferedAmount > AUDIO_BUFFER_LIMIT) return;
        const samples = resampleAudio(event.data.samples, event.data.sampleRate);
        if (!samples.length) return;
        session.socket.send(JSON.stringify({
          realtimeInput: {
            audio: {
              mimeType: 'audio/pcm;rate=16000',
              data: encodePcm16Base64(samples),
            },
          },
        }));
      };
      session.inputSource.connect(session.inputProcessor);
      session.inputProcessor.connect(session.inputContext.destination);
      session.conversationTimer = this.setTimer(() => {
        if (session.closed || this.activeSession !== session) return;
        const error = new Error('Gemini Live voice reached its 30-minute session limit. Tap the microphone to reconnect.');
        error.code = 'LIVE_SESSION_TIMEOUT';
        try {
          callbacks.onError?.(error);
        } finally {
          this.#cleanupSession(session, true);
          callbacks.onClosed?.();
        }
      }, this.conversationTimeoutMs);
      callbacks.onReady?.();
      return true;
    } catch (error) {
      if (session) this.#cleanupSession(session, true);
      else if (requestSequence === this.requestSequence) this.pendingType = null;
      for (const track of inputStream?.getTracks() || []) track.stop();
      if (inputContext && inputContext.state !== 'closed') await inputContext.close().catch(() => {});
      throw error;
    }
  }

  async speakText(text, { headers = {}, language = 'en', voiceName = 'Puck', callbacks = {} } = {}) {
    if (!String(text || '').trim() || this.isConversationActive || !this.supported) return false;
    if (this.activeSession) await this.stop();
    const session = await this.#connect({
      type: 'speech',
      headers,
      language,
      speechOnly: true,
      voiceName,
      callbacks,
    });
    if (!session || session.closed) return false;
    const completed = new Promise((resolve) => { session.speechResolve = resolve; });
    session.speechTimer = setTimeout(() => this.#finishSpeech(session, false), 45_000);
    session.socket.send(JSON.stringify({
      realtimeInput: { text: `Read this text aloud exactly as written, without adding anything:\n${String(text).trim()}` },
    }));
    return completed;
  }

  sendTextMessage(text) {
    const session = this.activeSession;
    if (!this.isConversationActive || session.socket.readyState !== 1) return false;
    const content = String(text || '').trim();
    if (!content || session.socket.bufferedAmount > AUDIO_BUFFER_LIMIT) return false;
    session.socket.send(JSON.stringify({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: content }] }],
        turnComplete: true,
      },
    }));
    return true;
  }

  async stopSpeechPlayback() {
    const session = this.activeSession;
    if (session?.type !== 'speech') {
      if (this.pendingType === 'speech') {
        this.requestSequence += 1;
        this.pendingType = null;
      }
      return;
    }
    this.requestSequence += 1;
    this.pendingType = null;
    clearTimeout(session.speechTimer);
    session.speechResolve?.(false);
    this.#cleanupSession(session, true);
  }

  stopAudioPlayback() {
    if (this.activeSession?.type === 'conversation') this.#stopPlayback(this.activeSession);
  }

  async stop() {
    this.requestSequence += 1;
    this.pendingType = null;
    const session = this.activeSession;
    if (!session) return;
    if (session.type === 'speech') {
      clearTimeout(session.speechTimer);
      session.speechResolve?.(false);
    }
    this.#cleanupSession(session, true);
  }

  async close() {
    await this.stop();
    if (this.outputContext && this.outputContext.state !== 'closed') {
      await this.outputContext.close().catch(() => {});
    }
    this.outputContext = null;
  }
}