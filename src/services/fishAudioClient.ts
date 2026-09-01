import { WebSocket } from 'ws';

export interface FishAudioStreamConfig {
  apiKey?: string;
  voiceId?: string;
  format?: 'opus' | 'pcm' | 'mp3';
  latency?: 'normal' | 'low';
}

export class FishAudioClient {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private voiceId: string;
  private isConnected = false;

  constructor(config: FishAudioStreamConfig = {}) {
    this.apiKey = config.apiKey || (typeof process !== 'undefined' ? process.env?.FISH_AUDIO_API_KEY : '') || '';
    this.voiceId = config.voiceId || (typeof process !== 'undefined' ? process.env?.FISH_AUDIO_DEFAULT_VOICE_ID : '') || '7f92f8afb8ec43bf81429cc1c9199cb1';
  }

  /**
   * Initializes persistent WebSocket connection to Fish Audio live TTS endpoint
   */
  public async connect(): Promise<void> {
    if (this.ws && this.isConnected) return;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket('wss://api.fish.audio/v1/tts/live', {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        });

        this.ws.on('open', () => {
          this.isConnected = true;
          console.log('[Fish Audio] WebSocket connection established.');
          resolve();
        });

        this.ws.on('error', (err) => {
          console.error('[Fish Audio] WebSocket error:', err);
          this.isConnected = false;
          reject(err);
        });

        this.ws.on('close', () => {
          this.isConnected = false;
          console.log('[Fish Audio] WebSocket closed. Auto-reconnecting on next payload...');
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Streams text chunks to Fish Audio and executes callback on incoming audio buffers
   */
  public async streamText(
    text: string,
    onAudioChunk: (chunk: Buffer) => void,
    onComplete?: () => void
  ): Promise<void> {
    if (!this.isConnected || !this.ws) {
      await this.connect();
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('[Fish Audio] Unable to connect to streaming endpoint.');
    }

    // Attach data listener for this streaming turn
    const messageHandler = (data: Buffer | string) => {
      if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          if (parsed.event === 'finish' || parsed.status === 'completed') {
            if (onComplete) onComplete();
          }
        } catch {
          // Binary audio packet
        }
      } else if (Buffer.isBuffer(data)) {
        onAudioChunk(data);
      }
    };

    this.ws.on('message', messageHandler);

    // Send the TTS request payload
    const payload = JSON.stringify({
      text: text,
      reference_id: this.voiceId,
      format: 'opus',
      latency: 'low',
      normalize: true,
    });

    this.ws.send(payload);
  }

  /**
   * Barge-in Interrupt: Cancels active generation and flushes buffer
   */
  public interrupt(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'flush' }));
      console.log('[Fish Audio] Interrupted stream and flushed buffer.');
    }
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }
}
