const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { RingApi } = require('ring-client-api');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

// Debug Crash
process.on('uncaughtException', (err) => {
  console.error('CRITICAL SERVER CRASH:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const { FFmpegStreamer } = require('./src/ffmpeg-streamer');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const port = process.env.PORT || 3000;

const ringApi = new RingApi({
  refreshToken: process.env.RING_REFRESH_TOKEN,
  debug: true,
  // Polling configuration for reliable notifications
  cameraStatusPollingSeconds: 20,
  cameraDingsPollingSeconds: 5, // Poll for ding/motion events every 5 seconds
  locationModePollingSeconds: 20
});

// Store active SIP sessions
const activeSessions = new Map();

// Snapshot auto-refresh system
const snapshotCache = new Map();
const SNAPSHOT_INTERVAL = 1500; // 1.5 seconds - Faster FPS // 3 secondi

app.use(express.static('public'));
app.use(express.json());

// API: Get all devices
app.get('/api/devices', async (req, res) => {
  try {
    const cameras = await ringApi.getCameras();
    const devices = cameras.map(c => ({
      id: c.id,
      name: c.name,
      model: c.model,
      batteryLevel: c.batteryLevel,
      isDoorbell: c.isDoorbell
    }));
    res.json(devices);
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

// API: Get recent events
app.get('/api/events', async (req, res) => {
  try {
    const cameras = await ringApi.getCameras();
    let allEvents = [];

    for (const camera of cameras) {
      try {
        const events = await camera.getEvents({ limit: 10 });
        allEvents.push(...events.events.map(e => ({
          id: e.ding_id_str,
          deviceId: camera.id,
          deviceName: camera.name,
          type: e.kind,
          createdAt: e.created_at,
          hasVideo: e.has_recording
        })));
      } catch (err) {
        console.error(`Error fetching events for ${camera.name}:`, err.message);
      }
    }

    allEvents.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(allEvents.slice(0, 20));
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// API: Get snapshot for a device
app.get('/api/snapshot/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const cameras = await ringApi.getCameras();
    const targetCamera = cameras.find(c => c.id.toString() === deviceId);

    if (!targetCamera) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const snapshot = await targetCamera.getSnapshot();
    res.set('Content-Type', 'image/jpeg');
    res.send(snapshot);
  } catch (error) {
    console.error('Error fetching snapshot:', error);
    res.status(500).json({ error: 'Failed to fetch snapshot' });
  }
});

// API: Get video URL for an event
app.get('/api/video/:deviceId/:eventId', async (req, res) => {
  try {
    const { deviceId, eventId } = req.params;
    const cameras = await ringApi.getCameras();
    const targetCamera = cameras.find(c => c.id.toString() === deviceId);

    if (!targetCamera) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const videoUrl = await targetCamera.getRecordingUrl(eventId);
    res.json({ url: videoUrl });
  } catch (error) {
    console.error('Error fetching video URL:', error);
    res.status(500).json({ error: 'Failed to fetch video URL' });
  }
});

// API: List saved snapshots (newest first)
app.get('/api/snapshots-list', (req, res) => {
  const snapshotsDir = path.join(__dirname, 'public', 'snapshots');
  if (!fs.existsSync(snapshotsDir)) {
    return res.json([]);
  }

  fs.readdir(snapshotsDir, (err, files) => {
    if (err) {
      console.error('Error reading snapshots dir:', err);
      return res.status(500).json({ error: 'Failed to list snapshots' });
    }

    // Filter images and sort by time (newest first)
    const images = files
      .filter(f => f.endsWith('.jpg'))
      .map(f => ({
        filename: f,
        path: `/snapshots/${f}`,
        time: fs.statSync(path.join(snapshotsDir, f)).mtimeMs
      }))
      .sort((a, b) => b.time - a.time)
      .slice(0, 3); // Return top 3

    res.json(images);
  });
});

// Helper: Save snapshot to disk (for events)
async function saveEventSnapshot(camera, eventType, suffix = '') {
  try {
    const snapshotsDir = path.join(__dirname, 'public', 'snapshots');
    if (!fs.existsSync(snapshotsDir)) {
      fs.mkdirSync(snapshotsDir, { recursive: true });
    }

    const snapshot = await camera.getSnapshot();
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const filename = `${camera.name}_${eventType}_${timestamp}${suffix}.jpg`.replace(/\s+/g, '_');
    const filepath = path.join(snapshotsDir, filename);

    fs.writeFileSync(filepath, snapshot);
    console.log(`[Snapshot] Saved event image: ${filename}`);
  } catch (error) {
    console.error(`[Snapshot] Failed to save event image:`, error.message);
  }
}

// API: Get cached snapshot (for monitoring page)
app.get('/api/snapshot-cached/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  const cached = snapshotCache.get(deviceId);

  if (cached) {
    res.json({
      deviceId,
      image: cached.data,
      timestamp: cached.timestamp
    });
  } else {
    res.status(404).json({ error: 'No snapshot available yet. Wait a few seconds.' });
  }
});

// Auto-refresh snapshot system
async function startSnapshotAutoRefresh() {
  try {
    const cameras = await ringApi.getCameras();
    console.log(`[Snapshot] Starting auto-refresh for ${cameras.length} camera(s)...`);

    cameras.forEach(camera => {
      // Funzione di refresh
      const refreshSnapshot = async () => {
        try {
          const snapshot = await camera.getSnapshot();
          const base64 = snapshot.toString('base64');

          // Salva in cache
          snapshotCache.set(camera.id.toString(), {
            data: base64,
            timestamp: Date.now()
          });

          // Push a tutti i client connessi
          io.emit('snapshot-update', {
            deviceId: camera.id,
            deviceName: camera.name,
            image: base64,
            timestamp: Date.now()
          });

          console.log(`[Snapshot] Updated: ${camera.name}`);
        } catch (error) {
          console.error(`[Snapshot] Error for ${camera.name}:`, error.message);
        }
      };

      // Prima esecuzione immediata
      refreshSnapshot();

      // Refresh ogni 3 secondi
      setInterval(refreshSnapshot, SNAPSHOT_INTERVAL);
    });

    console.log(`✅ Snapshot auto-refresh active (every ${SNAPSHOT_INTERVAL}ms)`);
  } catch (error) {
    console.error('[Snapshot] Setup error:', error);
  }
}

// Setup Ring notifications (doorbell events)
async function setupRingNotifications() {
  try {
    const cameras = await ringApi.getCameras();
    console.log(`Setting up notifications for ${cameras.length} cameras`);

    cameras.forEach(camera => {
      console.log(`[Setup] Configuring notifications for: ${camera.name}`);

      // Subscribe to doorbell presses
      camera.onDoorbellPressed.subscribe(ding => {
        console.log(`🔔 DOORBELL PRESSED: ${camera.name}`, ding);

        // Save 1 snapshot for doorbell
        saveEventSnapshot(camera, 'DOORBELL');

        io.emit('doorbell-ring', {
          deviceId: camera.id,
          deviceName: camera.name,
          timestamp: new Date().toISOString(),
          type: 'ding'
        });
      });

      // Subscribe to motion events
      camera.onMotionDetected.subscribe(async (motion) => {
        if (motion) {
          console.log(`🚶 Motion detected: ${camera.name}`);

          // Save 3 snapshots for motion (sequence)
          console.log('[Snapshot] Starting motion burst (3 images)...');
          saveEventSnapshot(camera, 'MOTION', '_1');

          setTimeout(() => saveEventSnapshot(camera, 'MOTION', '_2'), 1500); // +1.5s
          setTimeout(() => saveEventSnapshot(camera, 'MOTION', '_3'), 3000); // +3.0s

          io.emit('motion-detected', {
            deviceId: camera.id,
            deviceName: camera.name,
            timestamp: new Date().toISOString(),
            type: 'motion'
          });
        }
      });

      // Subscribe to doorbell press events (più affidabile per i campanelli)
      camera.onDoorbellPressed.subscribe((timestamp) => {
        console.log(`🔔 DOORBELL PRESSED: ${camera.name} at ${timestamp}`);
        io.emit('doorbell-ring', {
          deviceId: camera.id,
          deviceName: camera.name,
          timestamp: timestamp || new Date().toISOString(),
          type: 'ding'
        });
      });

      // Subscribe to Ding events (Required for notifications to fire)
      if (camera.subscribeToDingEvents) {
        console.log(`[Notifications] Subscribing to Ding events for ${camera.name}...`);
        camera.subscribeToDingEvents()
          .then(() => console.log(`✅ Ding events subscription active for ${camera.name}`))
          .catch(e => console.error('❌ Ding subscription failed:', e));
      }

      // Subscribe to new notifications (cattura TUTTO)
      camera.onNewNotification.subscribe(notification => {
        console.log(`📢 NEW NOTIFICATION from ${camera.name}:`);
        console.log(`[DEBUG] Full notification object:`, JSON.stringify(notification, null, 2));
        console.log(`[DEBUG] Action: ${notification.action}`);
        console.log(`[DEBUG] Kind: ${notification.kind}`);

        io.emit('ring-notification', {
          deviceId: camera.id,
          deviceName: camera.name,
          action: notification.action,
          kind: notification.kind,
          timestamp: new Date().toISOString()
        });
      });
    });

    console.log('✅ Ring notifications setup complete');
  } catch (error) {
    console.error('Error setting up Ring notifications:', error);
  }
}

// Manual Event Polling (Fallback for unreliable push notifications)
const lastSeenEvents = new Map(); // Track last seen event per camera

async function startEventPolling() {
  console.log('🔄 Starting manual event polling (every 10 seconds)...');

  const pollEvents = async () => {
    try {
      const cameras = await ringApi.getCameras();

      for (const camera of cameras) {
        try {
          const events = await camera.getEvents({ limit: 5 });

          // Debug: Log what we got
          console.log(`[POLL] ${camera.name}: Got ${events?.events?.length || 0} events`);

          if (events && events.events && events.events.length > 0) {
            const latestEvent = events.events[0];
            const eventId = latestEvent.ding_id_str || latestEvent.id;
            const lastSeen = lastSeenEvents.get(camera.id);

            // Debug: Log event details - handle timestamp safely
            let eventTime;
            if (latestEvent.created_at) {
              const ts = latestEvent.created_at;
              eventTime = typeof ts === 'string'
                ? new Date(ts)
                : (ts > 1e12 ? new Date(ts) : new Date(ts * 1000));
            } else {
              eventTime = new Date();
            }
            const ageSeconds = (Date.now() - eventTime.getTime()) / 1000;
            const safeAge = isNaN(ageSeconds) ? 0 : ageSeconds;
            const eventKind = latestEvent.kind || 'unknown';
            console.log(`[POLL] Latest: ${eventKind} ID:${eventId} Age:${safeAge.toFixed(0)}s LastSeen:${lastSeen || 'none'}`);

            // Only emit if this is a NEW event
            if (eventId && eventId !== lastSeen) {
              lastSeenEvents.set(camera.id, eventId);

              // Skip first run (initialization)
              if (lastSeen !== undefined) {
                // Only process events less than 120 seconds old (increased from 60)
                if (safeAge < 120) {
                  console.log(`📢 [POLL] NEW EVENT DETECTED: ${eventKind} at ${camera.name}`);
                  console.log(`[POLL] Event ID: ${eventId}, Age: ${safeAge.toFixed(0)}s`);

                  if (eventKind === 'ding') {
                    console.log(`🔔 [POLL] Emitting doorbell-ring for ${camera.name}`);
                    saveEventSnapshot(camera, 'DOORBELL');
                    io.emit('doorbell-ring', {
                      deviceId: camera.id,
                      deviceName: camera.name,
                      timestamp: eventTime.toISOString(),
                      type: 'ding',
                      source: 'polling'
                    });
                  } else if (eventKind === 'motion') {
                    console.log(`🏃 [POLL] Emitting motion-detected for ${camera.name}`);
                    saveEventSnapshot(camera, 'MOTION', '_1');
                    setTimeout(() => saveEventSnapshot(camera, 'MOTION', '_2'), 1500);
                    setTimeout(() => saveEventSnapshot(camera, 'MOTION', '_3'), 3000);
                    io.emit('motion-detected', {
                      deviceId: camera.id,
                      deviceName: camera.name,
                      timestamp: eventTime.toISOString(),
                      type: 'motion',
                      source: 'polling'
                    });
                  } else {
                    // Log other event types (on_demand, etc.) but don't emit notifications
                    console.log(`[POLL] Event type '${eventKind}' not notifiable (live view/other)`);
                  }
                } else {
                  console.log(`[POLL] Event too old (${safeAge.toFixed(0)}s), ignoring`);
                }
              } else {
                console.log(`[POLL] First run - setting baseline event ID: ${eventId}`);
              }
            }
          }
        } catch (err) {
          console.error(`[POLL] Error for ${camera.name}:`, err.message);
        }
      }
    } catch (error) {
      console.error('[POLL] Error polling events:', error.message);
    }
  };

  // Initial run to set baseline
  await pollEvents();

  // Poll every 3 seconds (Ferrari Mode - was 10s)
  setInterval(pollEvents, 3000);
  console.log('✅ Event polling active (Ferrari Mode: every 3s)');
}

// Socket.IO for client connections - FFmpeg HLS Streaming
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Store FFmpeg streamer per socket
  let streamer = null;

  // Start HLS stream (Primary Method)
  socket.on('start-stream', async (data) => {
    const { deviceId } = data;
    console.log(`[HLS] Start requested for device: ${deviceId}`);

    try {
      // Get camera
      const cameras = await ringApi.getCameras();
      const camera = cameras.find(c => c.id.toString() === deviceId);

      if (!camera) {
        socket.emit('stream-error', { error: 'Device not found' });
        return;
      }

      // Cleanup previous session
      if (streamer) {
        await streamer.stop();
      }

      // Create FFmpeg streamer
      streamer = new FFmpegStreamer(camera);

      // Callback for stream end
      streamer.setOnStreamEnd(() => {
        socket.emit('stream-ended');
      });

      // Start stream - gets HLS playlist URL
      const result = await streamer.start();

      socket.emit('stream-started', {
        deviceId,
        deviceName: camera.name,
        mode: 'hls',
        playlistUrl: result.playlistUrl
      });

      // Track active session
      activeSessions.set(socket.id, streamer);

    } catch (error) {
      console.error('[HLS] Error starting:', error);
      socket.emit('stream-error', { error: error.message });
    }
  });

  // Activate microphone for two-way audio
  socket.on('activate-mic', async () => {
    console.log('[Mic] Activate requested');

    if (!streamer) {
      socket.emit('mic-error', { error: 'No active stream' });
      return;
    }

    try {
      const success = await streamer.activateMicrophone();
      if (success) {
        socket.emit('mic-activated');
      } else {
        socket.emit('mic-error', { error: 'Failed to activate microphone' });
      }
    } catch (error) {
      console.error('[Mic] Error:', error);
      socket.emit('mic-error', { error: error.message });
    }
  });

  // Deactivate microphone
  socket.on('deactivate-mic', async () => {
    console.log('[Mic] Deactivate requested');

    if (streamer) {
      await streamer.deactivateMicrophone();
    }
    socket.emit('mic-deactivated');
  });

  // Receive audio data from browser and send to Ring
  let audioPacketCount = 0;
  socket.on('audio-data', (data) => {
    // Debug log to confirm delivery
    // console.log('Audio packet reached server'); 

    if (streamer) {
      if (!streamer.canSendAudio()) {
        if (audioPacketCount % 100 === 0) console.warn('[Audio] Streamer CANNOT send audio (stream not ready)');
      }
    } else {
      if (audioPacketCount % 100 === 0) console.warn('[Audio] No streamer instance');
    }

    if (streamer && streamer.canSendAudio()) {
      audioPacketCount++;
      const audioBuffer = Buffer.from(data);

      if (audioPacketCount % 20 === 0) {
        console.log(`[Audio] Server received packet #${audioPacketCount} | Size: ${audioBuffer.length} bytes`);
      }

      streamer.sendAudioData(audioBuffer);
    } else {
      if (audioPacketCount % 50 === 0) {
        console.log(`[Audio] Dropped packet #${audioPacketCount} - Stream not ready or Mic not active`);
      }
      audioPacketCount++;
    }
  });

  // Stop stream
  socket.on('stop-stream', async () => {
    if (streamer) {
      await streamer.stop();
      streamer = null;
      activeSessions.delete(socket.id);
    }
    socket.emit('stream-stopped');
  });

  // Handle disconnect - cleanup
  socket.on('disconnect', async () => {
    console.log('Client disconnected:', socket.id);
    if (streamer) {
      await streamer.stop();
      activeSessions.delete(socket.id);
    }
  });
});

// Start server
httpServer.listen(port, async () => {
  console.log(`Ring Web App listening at http://localhost:${port}`);

  // Setup Ring notifications after server starts
  await setupRingNotifications();

  // Setup snapshot auto-refresh
  await startSnapshotAutoRefresh();

  // Start manual event polling (fallback for push notifications)
  await startEventPolling();
});
