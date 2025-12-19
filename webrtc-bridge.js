/**
 * WebRTC Connection via go2rtc
 * go2rtc gestisce internamente SIP/RTP dal Ring.
 * Il frontend si connette direttamente a go2rtc via WebRTC.
 */

const GO2RTC_URL = 'http://localhost:1984';

class Go2RtcBridge {
    constructor(streamName = 'ring_doorbell') {
        this.streamName = streamName;
        this.isActive = false;
    }

    /**
     * Ottiene le informazioni per la connessione WebRTC
     */
    async getWebRtcInfo() {
        try {
            // Verifica che go2rtc sia attivo
            const response = await fetch(`${GO2RTC_URL}/api/streams`);

            if (!response.ok) {
                throw new Error('go2rtc non raggiungibile');
            }

            const streams = await response.json();

            return {
                success: true,
                webrtcUrl: `${GO2RTC_URL}/api/webrtc?src=${this.streamName}`,
                wsUrl: `ws://localhost:1984/api/ws?src=${this.streamName}`,
                streams: streams,
                hasStream: streams[this.streamName] !== undefined
            };
        } catch (error) {
            console.error('[Go2RTC Bridge] Error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Avvia una sessione WebRTC tramite go2rtc
     * @param {RTCSessionDescription} offer - SDP offer dal browser
     * @returns {Promise<RTCSessionDescription>} - SDP answer da go2rtc
     */
    async createWebRtcSession(offer) {
        try {
            console.log('[Go2RTC Bridge] Creating WebRTC session...');

            const response = await fetch(`${GO2RTC_URL}/api/webrtc?src=${this.streamName}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/sdp'
                },
                body: offer.sdp
            });

            if (!response.ok) {
                throw new Error(`go2rtc WebRTC error: ${response.status}`);
            }

            const answerSdp = await response.text();

            this.isActive = true;
            console.log('[Go2RTC Bridge] WebRTC session created');

            return {
                type: 'answer',
                sdp: answerSdp
            };
        } catch (error) {
            console.error('[Go2RTC Bridge] Error creating session:', error);
            throw error;
        }
    }

    /**
     * Invia ICE candidate a go2rtc (se supportato)
     */
    async addIceCandidate(candidate) {
        // go2rtc gestisce ICE internamente nella risposta SDP
        // Non è necessario inviare candidati separatamente
        console.log('[Go2RTC Bridge] ICE candidate (handled internally)');
    }

    /**
     * Ferma la sessione
     */
    stop() {
        this.isActive = false;
        console.log('[Go2RTC Bridge] Session stopped');
    }

    /**
     * Stato corrente
     */
    getState() {
        return {
            isActive: this.isActive,
            streamName: this.streamName
        };
    }
}

module.exports = { Go2RtcBridge };
