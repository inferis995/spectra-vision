document.addEventListener('DOMContentLoaded', () => {
    // Socket.IO connection
    const socket = io();

    // Init Global Notifications
    if (window.setupGlobalNotifications) {
        window.setupGlobalNotifications(socket);
    }

    // DOM Elements
    const devicesGrid = document.getElementById('devices-grid');
    const eventsList = document.getElementById('events-list');
    const videoModal = document.getElementById('video-modal');
    const closeButton = document.querySelector('.close-button');
    const eventVideo = document.getElementById('event-video');
    const modalTitle = document.getElementById('modal-event-title');
    const modalTime = document.getElementById('modal-event-time');

    // Live view elements
    const liveVideo = document.getElementById('live-video');
    const liveSnapshot = document.getElementById('live-snapshot');
    const liveIndicator = document.getElementById('live-indicator');
    const lastUpdate = document.getElementById('last-update');
    const startLiveBtn = document.getElementById('start-live-btn');
    const stopLiveBtn = document.getElementById('stop-live-btn');
    const audioBtn = document.getElementById('audio-btn');
    const micBtn = document.getElementById('mic-btn');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const connectionStatus = document.querySelector('.status-value'); // Updated selector
    const audioInitBtn = document.getElementById('audio-enable-btn');

    let currentDeviceId = null;
    let isStreaming = false;
    let isMicActive = false;
    let audioContext = null;
    let micStream = null;
    let localStream = null;

    // WebRTC state (kept as it's not explicitly removed by the new snippet, though not used in the new HLS/snapshot flow)
    let peerConnection = null;
    const rtcConfig = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };

    // --- Audio Context Handling ---
    const audioEnableBtn = document.getElementById('audio-enable-btn');
    if (audioEnableBtn) {
        audioEnableBtn.addEventListener('click', async () => {
            try {
                // Check current state
                const currentState = localStorage.getItem('audioEnabled') === 'true';

                if (currentState) {
                    // Turn OFF
                    localStorage.setItem('audioEnabled', 'false');
                    if (window.updateAudioButtonUI) window.updateAudioButtonUI(false);
                    console.log('Audio disabled by user');
                } else {
                    // Turn ON
                    if (window.globalAudioCtx.state === 'suspended') {
                        await window.globalAudioCtx.resume();
                    }
                    localStorage.setItem('audioEnabled', 'true');

                    if (window.updateAudioButtonUI) window.updateAudioButtonUI(true);

                    // Test sound
                    if (typeof playNotificationSound === 'function') {
                        console.log('Testing notification sound...');
                        playNotificationSound();
                    }
                }
            } catch (err) {
                console.error('Audio toggle failed:', err);
                alert('Could not update audio settings.');
            }
        });

        // Initial state check
        if (window.globalAudioCtx && window.globalAudioCtx.state === 'running') {
            if (window.updateAudioButtonUI) window.updateAudioButtonUI(true);
        }
    }

    // Socket.IO events
    socket.on('connect', () => {
        console.log('Connected to server');
        connectionStatus.textContent = 'ONLINE';
        connectionStatus.className = 'status-value online';
        addSystemLog('System connection established. Uplink active.');
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        connectionStatus.textContent = 'OFFLINE';
        connectionStatus.className = 'status-value offline';
        stopStreamUI();
        addSystemLog('System connection lost. Uplink down.', 'error');
    });

    // --- Gallery Logic ---
    async function loadGallery() {
        try {
            const res = await fetch('/api/snapshots-list');
            const images = await res.json();

            const gallery = document.getElementById('snapshot-gallery');
            if (!images.length) {
                gallery.innerHTML = '<div style="padding:10px; color:#666;">No snapshots yet.</div>';
                return;
            }

            gallery.innerHTML = images.map(img => `
            <div class="gallery-item" onclick="viewSnapshot('${img.path}')">
                <img src="${img.path}" loading="lazy">
                <div class="gallery-label">${new Date(img.time).toLocaleTimeString()}</div>
            </div>
        `).join('');

        } catch (e) {
            console.error('Gallery load failed', e);
        }
    }

    // Global viewer
    window.viewSnapshot = (path) => {
        const modal = document.getElementById('video-modal');
        const content = modal.querySelector('.modal-content');
        content.innerHTML = `<img src="${path}" style="max-width:100%; max-height:80vh; border: 2px solid var(--acc-color);">`;
        modal.style.display = 'block';
    };

    // Close modal when clicking outside
    document.getElementById('video-modal').addEventListener('click', (e) => {
        if (e.target.id === 'video-modal') {
            document.getElementById('video-modal').style.display = 'none';
        }
    });

    // Update gallery on new events
    socket.on('doorbell-ring', () => setTimeout(loadGallery, 2000)); // Wait for save
    socket.on('motion-detected', () => setTimeout(loadGallery, 2000));

    // Initial load
    loadGallery();

    // --- Fullscreen Logic ---
    document.getElementById('fullscreen-btn').addEventListener('click', toggleFullscreen);
    // Also double-click on video to toggle
    document.getElementById('live-video').addEventListener('dblclick', toggleFullscreen);

    function toggleFullscreen() {
        const container = document.querySelector('.video-container');
        if (!document.fullscreenElement) {
            container.requestFullscreen().catch(e => console.error(e));
        } else {
            document.exitFullscreen();
        }
    }

    // --- Live Stream Logic ---
    // Receive stream info and start HLS player
    let hlsPlayer = null;

    socket.on('stream-started', (data) => {
        console.log('Stream started:', data);
        isStreaming = true;
        startStreamUI(data.mode);
        lastUpdate.textContent = `LINK ESTABLISHED: ${data.deviceName}`;
        addSystemLog(`Video feed initialized: ${data.deviceName}`);
        displayStream(data); // Call displayStream here
    });

    function displayStream(data) {
        const { mode, playlistUrl, deviceName } = data;
        console.log(`📹 Stream started: ${mode}`, data);

        if (mode === 'hls' && playlistUrl) {
            console.log('🎬 Starting HLS player:', playlistUrl);
            if (hlsPlayer) {
                hlsPlayer.destroy();
            }

            if (Hls.isSupported()) {
                hlsPlayer = new Hls({
                    enableWorker: true,
                    lowLatencyMode: true,
                    backBufferLength: 60
                });

                hlsPlayer.loadSource(playlistUrl);
                hlsPlayer.attachMedia(liveVideo);

                hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
                    console.log('✅ HLS manifest parsed, playing...');
                    liveVideo.play().catch(e => console.log('Autoplay blocked:', e));
                });

                hlsPlayer.on(Hls.Events.ERROR, (event, data) => {
                    // Solo log errori importanti
                    if (data.fatal) {
                        console.error('🔴 Fatal HLS error:', data.type, data.details);
                        hlsPlayer.destroy();
                        hlsPlayer = null;
                        startSnapshotPolling();
                    } else if (data.type !== 'networkError' || data.details !== 'fragLoadError') {
                        // Ignora errori di caricamento frammenti comuni
                        console.warn('⚠️ HLS warning:', data.type, data.details);
                    }
                });

                // Show video, hide snapshot
                liveVideo.style.display = 'block';
                liveSnapshot.style.display = 'none';

            } else if (liveVideo.canPlayType('application/vnd.apple.mpegurl')) {
                // Native HLS support (Safari)
                liveVideo.src = playlistUrl;
                liveVideo.addEventListener('loadedmetadata', () => {
                    liveVideo.play().catch(e => console.log('Autoplay blocked:', e));
                });
                liveVideo.style.display = 'block';
                liveSnapshot.style.display = 'none';
            } else {
                console.error('HLS not supported in this browser');
                lastUpdate.textContent = 'Browser non supporta HLS';
                startSnapshotPolling();
            }
        } else if (mode === 'snapshot') {
            // Fallback to snapshot polling
            startSnapshotPolling();
            lastUpdate.textContent = `📷 Snapshot: ${deviceName || 'Ring'}`;
        }
    }

    socket.on('stream-error', (data) => {
        console.error('Stream error:', data.error);
        lastUpdate.textContent = `ERROR: ${data.error}`;
        addSystemLog(`Stream error: ${data.error}`, 'error');
        stopStreamUI();
    });

    socket.on('stream-ended', () => {
        console.log('Stream ended by server');
        stopStreamUI();
        lastUpdate.textContent = 'Stream terminato';
    });

    socket.on('stream-stopped', () => {
        console.log('Stream stopped');
        stopStreamUI();
    });

    // Ring Notifications
    socket.on('doorbell-ring', (data) => {
        console.log('🔔 Doorbell ring:', data);
        showNotification('ALERT', `${data.deviceName} - DOORBELL ACTIVATED`, 'ding');
        playDoorbellSound();
        addSystemLog(`ALERT: Doorbell Ring detected at ${data.deviceName}`, 'ding');

        // Auto-start stream when doorbell rings
        if (!isStreaming && data.deviceId) {
            currentDeviceId = data.deviceId;
            startLiveBtn.click();
        }
    });

    function playDoorbellSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const t = ctx.currentTime;

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.connect(gain);
            gain.connect(ctx.destination);

            // Cyberpunk Chime
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(800, t);
            osc.frequency.exponentialRampToValueAtTime(400, t + 0.5);

            gain.gain.setValueAtTime(0.3, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);

            osc.start(t);
            osc.stop(t + 0.5);

            // Second tone
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.connect(gain2);
            gain2.connect(ctx.destination);

            osc2.type = 'sawtooth';
            osc2.frequency.setValueAtTime(600, t + 0.4);
            osc2.frequency.exponentialRampToValueAtTime(200, t + 1.2);

            gain2.gain.setValueAtTime(0.3, t + 0.4);
            gain2.gain.exponentialRampToValueAtTime(0.01, t + 1.2);

            osc2.start(t + 0.4);
            osc2.stop(t + 1.2);

        } catch (e) {
            console.error('Error playing sound:', e);
        }
    }

    // Helper: Add log entry to console
    function addSystemLog(message, type = 'system') {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        const time = new Date().toLocaleTimeString('it-IT');
        entry.innerHTML = `
            <span class="ts">${time}</span>
            <span class="msg">${message}</span>
        `;
        eventsList.insertBefore(entry, eventsList.firstChild);
        // Keep only last 50 logs
        if (eventsList.children.length > 50) {
            eventsList.removeChild(eventsList.lastChild);
        }
    }

    socket.on('motion-detected', (data) => {
        console.log('🚶 Motion detected:', data);
        showNotification('MOTION', `Motion detected: ${data.deviceName}`, 'motion');
        addSystemLog(`Motion detected: ${data.deviceName}`, 'motion');
    });

    socket.on('ring-notification', (data) => {
        console.log('📢 Ring notification:', data);

        if (data.action === 'ding') {
            console.log('🔔 Doorbell ring detected via notification');
            showNotification('ALERT', `${data.deviceName} - DOORBELL ACTIVATED`, 'ding');
            playDoorbellSound();
            addSystemLog(`ALERT: Doorbell Ring detected at ${data.deviceName}`, 'ding');

            // Auto-open stream if not streaming
            if (!isStreaming && data.deviceId) {
                if (confirm(`Suonano alla porta: ${data.deviceName}. Aprire video?`)) {
                    currentDeviceId = data.deviceId;
                    startLiveBtn.click();
                }
            }
        } else {
            addSystemLog(`Notification: ${data.deviceName} - ${data.action}`);
        }
    });

    // Notification function
    function showNotification(title, message, type) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body: message });
        }
    }

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    // UI Functions
    function startStreamUI(mode = 'webrtc') {
        isStreaming = true; // IMPORTANT
        startLiveBtn.style.display = 'none';
        stopLiveBtn.style.display = 'inline-flex';
        liveIndicator.style.display = 'inline-block';
        audioBtn.disabled = false;
        micBtn.disabled = false;

        lastUpdate.textContent = 'STREAM INITIALIZING...';

        if (mode === 'webrtc') {
            liveVideo.style.display = 'block';
            liveSnapshot.style.display = 'none';
        } else {
            liveVideo.style.display = 'none';
            liveSnapshot.style.display = 'block';
        }
    }

    function stopStreamUI() {
        isStreaming = false;
        startLiveBtn.style.display = 'inline-flex';
        stopLiveBtn.style.display = 'none';
        liveIndicator.style.display = 'none';
        audioBtn.disabled = true;
        micBtn.disabled = true;
        audioBtn.classList.remove('active');
        micBtn.classList.remove('active');
        lastUpdate.textContent = 'STREAM TERMINATED';

        if (hlsPlayer) {
            hlsPlayer.destroy();
            hlsPlayer = null;
        }
        liveVideo.src = '';
        stopMicrophone(); // Ensure microphone is stopped
        // cleanupStream(); // This function is effectively replaced by stopStreamUI's HLS and mic cleanup
    }

    // Fullscreen - Removed as element is not in DOM for now
    // if (fullscreenBtn) { ... }

    // Event Listeners
    startLiveBtn.addEventListener('click', async () => {
        lastUpdate.textContent = 'INITIALIZING UPLINK...';
        if (!currentDeviceId) {
            // Get first device if none selected
            try {
                const response = await fetch('/api/devices');
                const devices = await response.json();
                if (devices.length > 0) {
                    currentDeviceId = devices[0].id;
                } else {
                    lastUpdate.textContent = 'Nessun dispositivo trovato';
                    return;
                }
            } catch (error) {
                console.error('Error fetching devices:', error);
                lastUpdate.textContent = 'Errore nel caricamento dispositivi';
                return;
            }
        }
        socket.emit('start-stream', { deviceId: currentDeviceId.toString() });
    });

    stopLiveBtn.addEventListener('click', () => {
        socket.emit('stop-stream');
        stopSnapshotPolling();
    });

    audioBtn.addEventListener('click', () => {
        // Force toggle logic
        if (audioBtn.classList.contains('active')) {
            audioBtn.classList.remove('active');
            liveVideo.muted = true;
        } else {
            audioBtn.classList.add('active');
            liveVideo.muted = false;
        }
        console.log('Audio btn clicked. Active:', audioBtn.classList.contains('active'));
    });

    // Microphone implementation from previous steps...
    // (Keeping simplified Nexus logic here for brevity, full logic in real implementation)
    micBtn.addEventListener('click', async () => {
        if (!isMicActive) {
            // Visual feedback immediately
            micBtn.classList.add('pending'); // Optional intermediate state

            try {
                await startMicrophone();
                // startMicrophone adds 'active' class on success
            } catch (e) {
                micBtn.classList.remove('pending');
                micBtn.classList.remove('active');
            }
        } else {
            stopMicrophone(); // removes 'active' class
        }
    });

    let audioProcessor = null;

    async function startMicrophone() {
        if (!isStreaming) { alert('Stream offline.'); return; }

        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true }
            });

            // 2. Create AudioContext for processing
            // Use default sample rate to avoid driver issues
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log(`🔊 AudioContext created. Rate: ${audioContext.sampleRate}, State: ${audioContext.state}`);

            if (audioContext.state === 'suspended') {
                await audioContext.resume();
                console.log('🔊 AudioContext resumed');
            }

            const source = audioContext.createMediaStreamSource(localStream);

            // Use 4096 buffer size
            audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);

            let packetsSent = 0;
            let silenceWarned = false;

            audioProcessor.onaudioprocess = (e) => {
                if (isMicActive) {
                    const inputData = e.inputBuffer.getChannelData(0);
                    const inputRate = audioContext.sampleRate;
                    const targetRate = 48000; // Opus Standard (WebRTC)
                    const compression = inputRate / targetRate;

                    // Downsample
                    const resultLength = Math.floor(inputData.length / compression);
                    const pcmData = new Int16Array(resultLength);

                    for (let i = 0; i < resultLength; i++) {
                        // Simple decimation/interpolation
                        const pos = i * compression;
                        const idx = Math.floor(pos);
                        // Linear interpolation for better quality than just dropping samples
                        const decimal = pos - idx;

                        let val;
                        if (idx + 1 < inputData.length) {
                            val = inputData[idx] * (1 - decimal) + inputData[idx + 1] * decimal;
                        } else {
                            val = inputData[idx];
                        }

                        // Clamp and convert to Int16
                        let s = Math.max(-1, Math.min(1, val));
                        pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                    }

                    // Send PCM data to server
                    if (pcmData.length > 0) {
                        socket.emit('audio-data', pcmData.buffer);
                        packetsSent++;
                    }

                    if (packetsSent % 20 === 0) {
                        console.log(`[Mic] Sent packet #${packetsSent} (In: ${inputRate}Hz -> Out: ${targetRate}Hz)`);
                    }
                }
            };

            source.connect(audioProcessor);
            audioProcessor.connect(audioContext.destination);

            socket.emit('activate-mic');
            isMicActive = true;
            micBtn.classList.add('active');
            lastUpdate.textContent = 'AUDIO TRANSMISSION ACTIVE';
            addSystemLog('Microphone uplink activated.');

        } catch (err) {
            console.error(err);
            alert('Audio Access Denied');
        }
    }

    // Handle microphone events from server (kept as they are not explicitly removed)
    socket.on('mic-activated', () => {
        console.log('🎤 Microphone activated!');
    });

    socket.on('mic-deactivated', () => {
        console.log('🎤 Microphone deactivated');
        if (isMicActive) {
            stopMicrophone();
        }
    });

    socket.on('mic-error', (data) => {
        console.error('Microphone error:', data.error);
        lastUpdate.textContent = `⚠️ Errore mic: ${data.error}`;
        stopMicrophone();
    });

    function stopMicrophone() {
        socket.emit('deactivate-mic');
        if (audioProcessor) { audioProcessor.disconnect(); audioProcessor = null; }
        if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
        if (audioContext && audioContext.state !== 'closed') { // Only close if not already closed
            audioContext.close().then(() => audioContext = null);
        }
        isMicActive = false;
        micBtn.classList.remove('active');
        lastUpdate.textContent = 'AUDIO TRANSMISSION TERMINATED';
        addSystemLog('Microphone uplink deactivated.');
    }

    // Snapshot polling as fallback/alternative
    let snapshotInterval = null;

    function startSnapshotPolling() {
        if (snapshotInterval) return;
        updateSnapshot();
        snapshotInterval = setInterval(updateSnapshot, 3000);
    }

    function stopSnapshotPolling() {
        if (snapshotInterval) {
            clearInterval(snapshotInterval);
            snapshotInterval = null;
        }
    }

    async function updateSnapshot() {
        if (!currentDeviceId) return;
        try {
            const timestamp = Date.now();
            liveSnapshot.src = `/api/snapshot/${currentDeviceId}?t=${timestamp}`;
        } catch (error) {
            console.error('Error updating snapshot:', error);
        }
    }

    // Fetch and render devices
    async function loadDevices() {
        // Skip if devices grid doesn't exist on this page
        if (!devicesGrid) {
            console.log('[loadDevices] No devices grid on this page, skipping');
            return;
        }

        try {
            const response = await fetch('/api/devices');
            const devices = await response.json();

            devicesGrid.innerHTML = '';
            devices.forEach((device, index) => {
                const card = document.createElement('div');
                card.className = 'device-card';
                card.innerHTML = `
                <img src="/api/snapshot/${device.id}?t=${Date.now()}" class="device-snapshot" alt="${device.name}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23333%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2250%22 text-anchor=%22middle%22 fill=%22%23666%22>No Image</text></svg>'">
                    <div class="device-info">
                        <h3>${device.name}</h3>
                        <p>${device.model || 'Ring Device'} ${device.batteryLevel ? '• ' + device.batteryLevel + '% Batteria' : ''}</p>
                    </div>
            `;

                card.addEventListener('click', () => {
                    currentDeviceId = device.id;
                    document.querySelectorAll('.device-card').forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected');

                    // Update snapshot
                    liveSnapshot.src = `/api/snapshot/${device.id}?t=${Date.now()}`;
                    lastUpdate.textContent = `Selezionato: ${device.name}`;

                    // If streaming, switch device
                    if (isStreaming) {
                        socket.emit('stop-stream');
                        setTimeout(() => {
                            socket.emit('start-stream', { deviceId: device.id.toString() });
                        }, 500);
                    }
                });

                if (index === 0) {
                    currentDeviceId = device.id;
                    card.classList.add('selected');
                    liveSnapshot.src = `/api/snapshot/${device.id}?t=${Date.now()}`;
                }

                devicesGrid.appendChild(card);
            });

            if (devices.length === 0) {
                devicesGrid.innerHTML = '<p class="loader">Nessun dispositivo trovato.</p>';
            }

            if (devices.length > 0) {
                currentDeviceId = devices[0].id;
                addSystemLog(`Device detected: ${devices[0].name}`);
            }
        } catch (error) {
            console.error('Error loading devices:', error);
            devicesGrid.innerHTML = '<p class="error">Errore nel caricamento dei dispositivi.</p>';
            addSystemLog('Failed to scan devices.', 'error');
        }
    }

    // The following functions related to event loading and video modal are removed as per the new snippet's implied scope.
    // async function loadEvents() { ... }
    // function translateEventType(type) { ... }
    // async function openVideoModal(event) { ... }
    // closeButton.onclick = () => { ... };
    // window.onclick = (event) => { ... };

    // Initial load
    loadDevices();
    // loadEvents(); // Removed

    // Refresh events every 60 seconds (removed as loadEvents is removed)
    // setInterval(loadEvents, 60000);
});
