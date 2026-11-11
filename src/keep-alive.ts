// Background keep-alive utility using silent audio to prevent Chromium/PWA process freezing
// when minimized or running in the background.

const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

export class BackgroundKeepAlive {
  private audioCtx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private active = false;

  start() {
    if (this.active) return;
    this.active = true;

    // 1. Web Audio API with ultra-low gain sine oscillator
    try {
      const g = (typeof window !== 'undefined' ? window : globalThis) as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      };
      const AudioCtx = g.AudioContext || g.webkitAudioContext;
      if (AudioCtx) {
        if (!this.audioCtx || this.audioCtx.state === 'closed') {
          this.audioCtx = new AudioCtx();
        }
        const ctx = this.audioCtx;
        if (ctx) {
          if (ctx.state === 'suspended') {
            void ctx.resume();
          }

          this.gain = ctx.createGain();
          // Inaudible gain (0.00001) keeps the audio pipeline active without any audible sound
          this.gain.gain.setValueAtTime(0.00001, ctx.currentTime);

          this.osc = ctx.createOscillator();
          this.osc.frequency.setValueAtTime(440, ctx.currentTime);
          this.osc.connect(this.gain);
          this.gain.connect(ctx.destination);
          this.osc.start();
        }
      }
    } catch {
      // AudioContext unavailable or restricted
    }

    // 2. HTML5 Audio fallback with looping silent wav
    try {
      if (typeof Audio !== 'undefined') {
        if (!this.audioEl) {
          this.audioEl = new Audio(SILENT_WAV);
          this.audioEl.loop = true;
          this.audioEl.volume = 0.00001;
        }
        const promise = this.audioEl.play();
        if (promise) {
          promise.catch(() => {
            // Autoplay policy restriction fallback
          });
        }
      }
    } catch {
      // Audio element fallback failed silently
    }
  }

  stop() {
    if (!this.active) return;
    this.active = false;

    try {
      if (this.osc) {
        this.osc.stop();
        this.osc.disconnect();
        this.osc = null;
      }
      if (this.gain) {
        this.gain.disconnect();
        this.gain = null;
      }
      if (this.audioCtx && this.audioCtx.state !== 'closed') {
        void this.audioCtx.close();
        this.audioCtx = null;
      }
    } catch {
      // AudioContext cleanup ignored
    }

    try {
      if (this.audioEl) {
        this.audioEl.pause();
        this.audioEl.currentTime = 0;
      }
    } catch {
      // Audio element cleanup ignored
    }
  }

  isRunning(): boolean {
    return this.active;
  }
}

export const backgroundKeepAlive = new BackgroundKeepAlive();
