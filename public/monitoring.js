const socket = io();

// Init Global Notifications
if (window.setupGlobalNotifications) {
    window.setupGlobalNotifications(socket);
}

let snapshotCount = 0;
const cameras = new Map();

// Initialize
socket.on('connect', () => {
    console.log('Connected to server');
    loadCameras();
});

// Load camera list
async function loadCameras() {
    try {
        const response = await fetch('/api/devices');
        const devices = await response.json();

        const grid = document.getElementById('cameras-grid');
        grid.innerHTML = '';

        devices.forEach(device => {
            cameras.set(device.id.toString(), device);
            const card = createCameraCard(device);
            grid.appendChild(card);

            // Load initial cached snapshot
            loadCachedSnapshot(device.id);
        });
    } catch (error) {
        console.error('Error loading cameras:', error);
    }
}

// Create camera card HTML
function createCameraCard(device) {
    const card = document.createElement('div');
    card.className = 'camera-card';
    card.id = `camera-${device.id}`;

    card.innerHTML = `
        <div class="camera-header">
            <h3>${device.name}</h3>
            <span class="timestamp" id="timestamp-${device.id}">--:--:--</span>
        </div>
        <div class="snapshot-container">
            <img id="snapshot-${device.id}" 
                 src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='480'%3E%3Crect fill='%23222' width='640' height='480'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' fill='%23666' font-size='20'%3ECaricamento...%3C/text%3E%3C/svg%3E"
                 alt="${device.name}"
                 onclick="openFullscreen('${device.id}')">
            <div class="loading-overlay" id="loading-${device.id}">
                <div class="spinner"></div>
            </div>
        </div>
        <div class="camera-footer">
            <button onclick="saveSnapshot('${device.id}', '${device.name}')">
                💾 Salva
            </button>
            <span class="counter" id="counter-${device.id}">0</span>
        </div>
    `;

    return card;
}

// Load cached snapshot
async function loadCachedSnapshot(deviceId) {
    try {
        const response = await fetch(`/api/snapshot-cached/${deviceId}`);
        if (response.ok) {
            const data = await response.json();
            updateSnapshot(data.deviceId, data.image, data.timestamp);
        }
    } catch (error) {
        console.log(`No cached snapshot for ${deviceId} yet`);
    }
}

// Socket.IO: Snapshot update
socket.on('snapshot-update', (data) => {
    updateSnapshot(data.deviceId, data.image, data.timestamp);
});

// Update snapshot image
function updateSnapshot(deviceId, base64Image, timestamp) {
    const img = document.getElementById(`snapshot-${deviceId}`);
    const timestampEl = document.getElementById(`timestamp-${deviceId}`);
    const counterEl = document.getElementById(`counter-${deviceId}`);
    const loadingEl = document.getElementById(`loading-${deviceId}`);

    if (img) {
        // Smooth transition
        loadingEl.style.display = 'flex';

        setTimeout(() => {
            img.src = `data:image/jpeg;base64,${base64Image}`;
            loadingEl.style.display = 'none';

            // Update timestamp
            const date = new Date(timestamp);
            timestampEl.textContent = date.toLocaleTimeString('it-IT');

            // Increment counter
            const currentCount = parseInt(counterEl.textContent) || 0;
            counterEl.textContent = currentCount + 1;

            // Update global stats
            snapshotCount++;
            document.getElementById('snapshot-count').textContent = snapshotCount;
            document.getElementById('last-update').textContent = date.toLocaleTimeString('it-IT');
        }, 200);
    }
}

// Save snapshot
function saveSnapshot(deviceId, deviceName) {
    const img = document.getElementById(`snapshot-${deviceId}`);
    const link = document.createElement('a');
    link.download = `${deviceName}_${Date.now()}.jpg`;
    link.href = img.src;
    link.click();
}

// Open fullscreen
function openFullscreen(deviceId) {
    const img = document.getElementById(`snapshot-${deviceId}`);
    if (img.requestFullscreen) {
        img.requestFullscreen();
    }
}
