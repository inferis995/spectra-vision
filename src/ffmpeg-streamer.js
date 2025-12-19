const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { RtpPacket, RtpHeader } = require('werift');
const OpusScript = require('opusscript');

// Opus configuration for Ring (48kHz standard for WebRTC/Opus)
const OPUS_SAMPLE_RATE = 48000;
const OPUS_CHANNELS = 1;
const OPUS_FRAME_SIZE = 960; // 20ms at 48kHz
const OPUS_BITRATE = 24000; // 24kbps for voice

// G.711 Mu-Law Lookup Table
const VAL_CMASK = 0x80;
const VAL_SIGN_BIT = 0x80;
const QUANT_MASK = 0xf;
const SEG_MASK = 0x70;
const SEG_SHIFT = 4;
const BIAS = 0x84;
const CLIP = 32635;

function linearToMuLaw(sample) {
    let sign = (sample >> 8) & VAL_SIGN_BIT;
    if (sample < 0) sample = -sample;
    if (sample > CLIP) sample = CLIP;
    sample += BIAS;

    let exponent = 7;
    let mask = 0x4000;
    for (let i = 0; i < 8; i++) {
        if (sample & mask) {
            exponent = 7 - i;
            break;
        }
        mask >>= 1;
    }

    let mantissa = (sample >> (exponent + 3)) & 0x0F;
    let byte = sign | (exponent << 4) | mantissa;
    return ~byte & 0xFF;
}

let ffmpegPath;
try {
    ffmpegPath = require('ffmpeg-for-homebridge');
} catch (e) {
    ffmpegPath = 'ffmpeg'; // System fallback
}

class FFmpegStreamer {
    constructor(camera, outputDir = './public/streams') {
        this.camera = camera;
        this.outputDir = outputDir;
        this.liveCall = null;
        this.ffmpegProcess = null;
        this.isActive = false;
        this.hlsPlaylist = null;

        // Assicura che la directory output esista
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
    }

    /**
     * Avvia lo streaming
     * @returns {Promise<{playlistUrl: string}>} - URL della playlist HLS
     */
    async start() {
        if (this.isActive) {
            console.log('[FFmpeg Streamer] Already active');
            return { playlistUrl: this.hlsPlaylist };
        }

        try {
            console.log(`[FFmpeg Streamer] Starting stream for: ${this.camera.name}`);

            // Genera nome univoco per questa sessione
            const sessionId = Date.now();
            const playlistPath = path.join(this.outputDir, `stream_${sessionId}.m3u8`);
            const segmentPath = path.join(this.outputDir, `stream_${sessionId}_%03d.ts`);

            // Avvia lo stream Ring con FFmpeg output e return audio abilitato
            this.liveCall = await this.camera.streamVideo({
                // FFmpeg video options - Ferrari Mode Low Latency
                video: [
                    '-vcodec', 'copy',  // Copy video senza re-encoding per velocità
                    '-fflags', 'nobuffer',
                    '-flags', 'low_delay'
                ],
                // FFmpeg audio options  
                audio: [
                    '-acodec', 'aac',
                    '-b:a', '128k',
                    '-ar', '44100'
                ],
                // Output HLS format - Ferrari Mode (1s segments, low latency)
                output: [
                    '-f', 'hls',
                    '-hls_time', '1',           // 1 second segments (was 2s)
                    '-hls_list_size', '2',      // Keep only 2 segments (was 3)
                    '-hls_flags', 'delete_segments+append_list+split_by_time',
                    '-hls_segment_filename', segmentPath,
                    playlistPath
                ],
                // Abilita return audio per parlare al citofono
                // False because WE are doing the transcoding (PCM -> G.711) manually
                transcodeReturnAudio: false
            });

            // Salva il returnAudioStream per invio audio
            this.returnAudioStream = this.liveCall.returnAudioStream;

            const fs = require('fs');
            try {
                const dump = {
                    keys: Object.keys(this.liveCall),
                    // connectionKeys: this.liveCall.connection ? Object.keys(this.liveCall.connection) : 'NoConnection',
                    hasReturnAudio: !!this.returnAudioStream
                };
                fs.writeFileSync('debug_dump.json', JSON.stringify(dump, null, 2));
                console.log('[FFmpeg Streamer] Dumped liveCall to debug_dump.json');
            } catch (e) {
                console.error('[FFmpeg Streamer] Dump failed:', e);
            }

            if (this.returnAudioStream) {
                console.log('[FFmpeg Streamer] Return Audio Stream available ✅');
            } else {
                console.error('[FFmpeg Streamer] Return Audio Stream MISSING ❌');
            }

            this.isActive = true;
            this.hlsPlaylist = `/streams/stream_${sessionId}.m3u8`;

            console.log(`[FFmpeg Streamer] Stream started, playlist: ${this.hlsPlaylist}`);

            // Attendi che la playlist sia disponibile
            const playlistReady = await this.waitForPlaylist(playlistPath);

            if (!playlistReady) {
                console.error('[FFmpeg Streamer] Playlist was not created - FFmpeg may have failed');
                this.isActive = false;
                throw new Error('HLS playlist not created - streaming may have failed');
            }

            // Gestisci fine chiamata
            this.liveCall.onCallEnded.subscribe(() => {
                console.log('[FFmpeg Streamer] Call ended');
                this.cleanup();
                if (this.onStreamEnd) {
                    this.onStreamEnd();
                }
            });

            return { playlistUrl: this.hlsPlaylist };

        } catch (error) {
            console.error('[FFmpeg Streamer] Error starting:', error);
            this.isActive = false;
            throw error;
        }
    }

    async activateMicrophone() {
        if (!this.liveCall) {
            console.log('[FFmpeg Streamer] No active call for microphone');
            return false;
        }

        try {
            const isOpus = await this.liveCall.isUsingOpus;
            console.log(`[FFmpeg Streamer] Activating speaker. Using Opus? ${isOpus}`);

            console.log('[FFmpeg Streamer] Activating camera speaker...');
            await this.liveCall.activateCameraSpeaker();

            // Initialize Opus encoder
            this.opusEncoder = new OpusScript(OPUS_SAMPLE_RATE, OPUS_CHANNELS, OpusScript.Application.VOIP);
            this.opusEncoder.setBitrate(OPUS_BITRATE);
            console.log(`[FFmpeg Streamer] Opus encoder initialized (${OPUS_SAMPLE_RATE}Hz, ${OPUS_CHANNELS}ch, ${OPUS_BITRATE}bps)`);

            // Initialize RTP state (Opus uses payload type 111)
            this.rtpSequence = 0;
            this.rtpTimestamp = 0;
            this.ssrc = Math.floor(Math.random() * 0xFFFFFFFF);

            console.log('[FFmpeg Streamer] Speaker activated - Opus RTP Link Ready ✅');
            return true;
        } catch (error) {
            console.error('[FFmpeg Streamer] Error activating speaker:', error);
            return false;
        }
    }

    async deactivateMicrophone() {
        console.log('[FFmpeg Streamer] Microphone deactivated');
        // No process to kill since we do JS processing
    }

    /**
     * Invia dati audio (PCM 16-bit 8000Hz) al Ring via RTP (Opus)
     * @param {Buffer} audioData - Buffer di Int16 (Little Endian)
     */
    sendAudioData(audioData) {
        if (!this.liveCall || !this.opusEncoder) return;

        try {
            // 1. Convert PCM Buffer to Int16Array
            const pcmSamples = new Int16Array(
                audioData.buffer,
                audioData.byteOffset,
                audioData.byteLength / 2
            );

            // 2. Encode to Opus (processes 160-sample frames = 20ms at 8kHz)
            const opusPacket = this.opusEncoder.encode(pcmSamples, OPUS_FRAME_SIZE);

            // 3. Create RTP Packet for Opus
            // Payload Type 111 (Opus standard)
            const header = new RtpHeader({
                version: 2,
                payloadType: 111, // Opus
                sequenceNumber: this.rtpSequence++,
                timestamp: this.rtpTimestamp,
                ssrc: this.ssrc,
                marker: false
            });

            // Increment timestamp (8000Hz * 20ms = 160 samples per frame)
            this.rtpTimestamp += OPUS_FRAME_SIZE;

            const rtp = new RtpPacket(header, Buffer.from(opusPacket));

            // 4. Send via LiveCall Connection
            this.liveCall.sendAudioPacket(rtp);

        } catch (error) {
            console.error('[FFmpeg Streamer] Opus RTP Send Error:', error);
        }
    }

    canSendAudio() {
        // We can send if we have a live call
        return !!this.liveCall;
    }

    /**
     * Ferma lo streaming
     */
    async stop() {
        console.log('[FFmpeg Streamer] Stopping...');

        if (this.liveCall) {
            try {
                await this.liveCall.stop();
            } catch (e) {
                console.error('[FFmpeg Streamer] Error stopping live call:', e);
            }
            this.liveCall = null;
        }

        this.cleanup();
    }

    /**
     * Attende che la playlist HLS sia disponibile
     */
    async waitForPlaylist(playlistPath, maxWaitMs = 10000) {
        const startTime = Date.now();
        const checkInterval = 500;

        console.log(`[FFmpeg Streamer] Waiting for playlist: ${playlistPath}`);

        while (Date.now() - startTime < maxWaitMs) {
            if (fs.existsSync(playlistPath)) {
                // Verifica che il file abbia contenuto
                const stat = fs.statSync(playlistPath);
                if (stat.size > 50) {
                    console.log(`[FFmpeg Streamer] Playlist ready (${stat.size} bytes)`);
                    return true;
                }
            }
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        console.log('[FFmpeg Streamer] Playlist wait timeout');
        return false;
    }

    /**
     * Cleanup files temporanei
     */
    cleanup() {
        this.isActive = false;
        // Pulizia opzionale dei file HLS
    }

    /**
     * Callback per fine stream
     */
    setOnStreamEnd(callback) {
        this.onStreamEnd = callback;
    }

    /**
     * Stato corrente
     */
    getState() {
        return {
            isActive: this.isActive,
            cameraName: this.camera?.name,
            playlistUrl: this.hlsPlaylist
        };
    }
}

module.exports = { FFmpegStreamer };
