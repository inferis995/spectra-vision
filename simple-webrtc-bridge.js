/**
 * Simple WebRTC Bridge per Ring Doorbell - VERSIONE CORRETTA
 * 
 * Flusso corretto:
 * 1. Server chiede a Ring di iniziare stream
 * 2. Ring invia SDP offer (Ring è l'offerer)
 * 3. Server invia offer al browser
 * 4. Browser crea answer
 * 5. Server invia answer a Ring
 * 6. Stream media inizia
 */

class SimpleWebRtcBridge {
    constructor(camera) {
        this.camera = camera;
        this.session = null;
        this.isActive = false;
        this.onOfferReady = null;
    }

    /**
     * Avvia sessione WebRTC con Ring
     * Ring invierà un SDP offer che deve essere passato al browser
     * @returns {Promise<{type: string, sdp: string}>} - SDP offer da Ring
     */
    async startSession() {
        if (this.isActive) {
            console.log('[SimpleWebRTC] Session already active, stopping...');
            await this.stop();
        }

        try {
            console.log(`[SimpleWebRTC] Creating session for: ${this.camera.name}`);

            // Crea sessione WebRTC semplice
            // createSimpleWebRtcSession() ritorna una sessione che può essere avviata
            this.session = this.camera.createSimpleWebRtcSession();

            console.log('[SimpleWebRTC] Starting Ring session...');

            // Ring inizia la sessione e invia il suo offer
            // Noi dobbiamo poi rispondere con un answer
            const ringOffer = await this.session.start();

            this.isActive = true;
            console.log('[SimpleWebRTC] Ring offer received');

            // Gestisci fine sessione
            if (this.session.onCallEnded) {
                this.session.onCallEnded.subscribe(() => {
                    console.log('[SimpleWebRTC] Call ended by Ring');
                    this.isActive = false;
                    if (this.onSessionEnd) {
                        this.onSessionEnd();
                    }
                });
            }

            return {
                type: 'offer',
                sdp: ringOffer
            };
        } catch (error) {
            console.error('[SimpleWebRTC] Error starting session:', error);
            this.isActive = false;
            throw error;
        }
    }

    /**
     * Invia l'answer del browser a Ring
     * @param {string} browserAnswerSdp - SDP answer dal browser
     */
    async setAnswer(browserAnswerSdp) {
        if (!this.session) {
            throw new Error('Session not started');
        }

        try {
            console.log('[SimpleWebRTC] Sending browser answer to Ring...');
            await this.session.acceptAnswer(browserAnswerSdp);
            console.log('[SimpleWebRTC] Answer accepted, stream should start');
        } catch (error) {
            console.error('[SimpleWebRTC] Error setting answer:', error);
            throw error;
        }
    }

    /**
     * Ferma la sessione
     */
    async stop() {
        if (this.session) {
            try {
                if (typeof this.session.stop === 'function') {
                    await this.session.stop();
                } else if (typeof this.session.end === 'function') {
                    await this.session.end();
                }
                console.log('[SimpleWebRTC] Session stopped');
            } catch (e) {
                console.error('[SimpleWebRTC] Error stopping session:', e);
            }
            this.session = null;
        }
        this.isActive = false;
    }

    /**
     * Callback per fine sessione
     */
    setOnSessionEnd(callback) {
        this.onSessionEnd = callback;
    }

    /**
     * Stato corrente
     */
    getState() {
        return {
            isActive: this.isActive,
            cameraName: this.camera?.name
        };
    }
}

module.exports = { SimpleWebRtcBridge };
