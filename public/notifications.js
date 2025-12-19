/**
 * Global Notification System
 * Handles real-time alerts (Toasts) across all pages
 */

// Show Toast Notification
function showToast(title, message, type = 'info') {
    let container = document.querySelector('.toast-container');

    // Lazy init container (safer than top-level)
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        if (document.body) {
            document.body.appendChild(container);
        } else {
            console.error('Document body not ready for toasts');
            return;
        }
    }

    const toast = document.createElement('div');

    let icon = 'ℹ️';
    if (type === 'alert') icon = '🔔';
    if (type === 'warning') icon = '⚠️';
    if (type === 'success') icon = '✅';

    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div class="toast-icon">${icon}</div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
    `;

    container.appendChild(toast);

    // Play sound for alerts
    if (type === 'alert' || type === 'warning') {
        playNotificationSound();
    }

    // Auto remove
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// Simple beep sound & Audio Context Management
window.globalAudioCtx = new (window.AudioContext || window.webkitAudioContext)();

// Try to auto-resume on load if previously enabled
// Try to auto-resume on load if previously enabled
if (localStorage.getItem('audioEnabled') === 'true') {
    // 1. Immediately update UI to show "Active" (Visual Persistence)
    // We need to wait for DOM to be ready for the button query
    setTimeout(() => {
        if (window.updateAudioButtonUI) window.updateAudioButtonUI(true);
    }, 100);

    // 2. Try to resume Audio Context
    setTimeout(() => {
        window.globalAudioCtx.resume().then(() => {
            console.log('✅ Audio Context auto-resumed successfully');
        }).catch(e => {
            console.warn('⚠️ Audio auto-resume blocked by browser. Waiting for user interaction...');

            // 3. Fallback: Resume on FIRST user interaction (click or key)
            const resumeOnInteract = () => {
                window.globalAudioCtx.resume().then(() => {
                    console.log('✅ Audio Context resumed after user interaction');
                });
                document.removeEventListener('click', resumeOnInteract);
                document.removeEventListener('keydown', resumeOnInteract);
                document.removeEventListener('touchstart', resumeOnInteract);
            };

            document.addEventListener('click', resumeOnInteract);
            document.addEventListener('keydown', resumeOnInteract);
            document.addEventListener('touchstart', resumeOnInteract);
        });
    }, 500);
}

function playNotificationSound() {
    // Check global preference first
    if (localStorage.getItem('audioEnabled') !== 'true') return;

    // Always try to resume before playing
    if (window.globalAudioCtx.state === 'suspended') {
        window.globalAudioCtx.resume();
    }

    // Check if running (browser might still block it without gesture)
    if (window.globalAudioCtx.state !== 'running') return;

    const ctx = window.globalAudioCtx;
    const now = ctx.currentTime + 0.05; // 50ms delay to ensure proper scheduling

    // Classic doorbell "DING-DONG" pattern
    const playTone = (freq, startTime, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        // Sine wave for bell-like sound
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);

        // Attack-decay envelope for bell sound
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.3, startTime + 0.02);  // Quick attack
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);  // Slow decay

        osc.start(startTime);
        osc.stop(startTime + duration);
    };

    // DING (high note) - E5 (659 Hz)
    playTone(659, now, 0.4);

    // DONG (low note) - C5 (523 Hz) after 0.4s
    playTone(523, now + 0.4, 0.5);
}

// Global UI Updater for Audio Button (used by app.js too)
window.updateAudioButtonUI = function (active) {
    const btns = document.querySelectorAll('#audio-enable-btn');
    btns.forEach(btn => {
        if (active) {
            btn.textContent = 'AUDIO ACTIVE';
            btn.style.borderColor = '#00ff00';
            btn.style.color = '#00ff00';
            btn.style.opacity = '0.7';
        } else {
            btn.textContent = 'AUDIO OFF';
            btn.style.borderColor = '#ff4444';
            btn.style.color = '#ff4444';
            btn.style.opacity = '0.7';
        }
    });
};

// --- Socket.IO Global Listeners (Shared Logic) ---
window.setupGlobalNotifications = function (socket) {
    if (!socket) {
        console.error('❌ Socket not provided to setupGlobalNotifications');
        return;
    }

    console.log('🔔 Global Notifications Initialized');
    console.log('[DEBUG] Socket ID:', socket.id);
    console.log('[DEBUG] Socket connected:', socket.connected);

    // Debug: monitor socket connection
    socket.on('connect', () => {
        console.log('✅ [Notifications] Socket connected with ID:', socket.id);
    });

    socket.on('disconnect', (reason) => {
        console.log('❌ [Notifications] Socket disconnected:', reason);
    });

    // Doorbell Ring
    socket.on('doorbell-ring', (data) => {
        console.log('🔔 === DOORBELL EVENT RECEIVED ===', data);
        console.log('[DEBUG] Calling showToast now...');
        showToast('🔔 DOORBELL ALERT', `Someone is at ${data.deviceName}`, 'alert');
        console.log('[DEBUG] showToast called successfully');

        // Se siamo nella pagina eventi, ricarica la tabella
        if (typeof loadEvents === 'function') loadEvents();
    });

    // Motion Detected
    socket.on('motion-detected', (data) => {
        console.log('🏃 === MOTION EVENT RECEIVED ===', data);
        console.log('[DEBUG] Calling showToast now...');
        showToast('🏃 MOTION DETECTED', `Movement at ${data.deviceName}`, 'warning');
        console.log('[DEBUG] showToast called successfully');

        if (typeof loadEvents === 'function') loadEvents();
    });

    // Generic Notification (catch-all)
    socket.on('ring-notification', (data) => {
        console.log('📢 === RING NOTIFICATION RECEIVED ===', data);

        // Only show toast for non-ding/motion events (avoid duplicates)
        if (data.action !== 'ding' && data.action !== 'motion') {
            showToast('📢 NOTIFICATION', `${data.deviceName}: ${data.action}`, 'info');
        }

        if (typeof loadEvents === 'function') loadEvents();
    });

    console.log('[DEBUG] All notification listeners registered');
};
