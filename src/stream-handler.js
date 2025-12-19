const { spawn } = require('child_process');
const path = require('path');

class StreamHandler {
    constructor(camera) {
        this.camera = camera;
        this.sipSession = null;
        this.isActive = false;
        this.ffmpegProcess = null;
    }

    async startStream() {
        if (this.isActive) {
            console.log('Stream already active');
            return { success: false, error: 'Stream already active' };
        }

        try {
            console.log(`Starting stream for camera: ${this.camera.name}`);

            // Use createSipSession for direct SIP control
            this.sipSession = await this.camera.createSipSession();
            this.isActive = true;

            console.log('SIP session created successfully');

            // Handle session events
            this.sipSession.onCallEnded.subscribe(() => {
                console.log('SIP session ended');
                this.isActive = false;
                if (this.onStreamEnd) {
                    this.onStreamEnd();
                }
            });

            // Start the SIP call
            await this.sipSession.start();
            console.log('SIP session started');

            return {
                success: true,
                message: 'Stream started',
                sessionId: Date.now().toString()
            };
        } catch (error) {
            console.error('Error starting stream:', error);
            this.isActive = false;
            return {
                success: false,
                error: error.message
            };
        }
    }

    async stopStream() {
        if (this.sipSession) {
            try {
                await this.sipSession.stop();
                console.log('SIP session stopped');
            } catch (e) {
                console.error('Error stopping stream:', e);
            }
            this.sipSession = null;
        }

        if (this.ffmpegProcess) {
            this.ffmpegProcess.kill('SIGTERM');
            this.ffmpegProcess = null;
        }

        this.isActive = false;
    }

    // Get SDP offer for WebRTC negotiation
    getSdpOffer() {
        if (this.sipSession) {
            return this.sipSession.sdp;
        }
        return null;
    }

    // Set callbacks
    setStreamEndCallback(callback) {
        this.onStreamEnd = callback;
    }
}

module.exports = { StreamHandler };
