# Real-Time Device Detection with Socket.IO

This feature implements real-time device detection and status monitoring using Socket.IO for communication between agent, backend, and UI.

## 🎯 Architecture

```
Agent (Local PC)                    Backend (Server)                  UI (Dashboard)
     │                                      │                               │
     │  Socket.IO Client                    │                               │
     │ ◄────────────────────────────────►   │                               │
     │                                      │  Socket.IO                    │
     │                                      │ ◄───────────────────────────► │
     │                                      │                               │
     │  Monitors COM ports                  │  Broadcasts events            │
     │  Detects hot-plug events             │  Logs all events              │
     │  Emits device-status                  │  Forwards to UI               │
     │                                      │                               │
     └──────────────────────────────────────┴───────────────────────────────┘
```

## ✅ What Was Implemented

### 1. **Agent Side** (`LIS-analyzer-agent`)

**Added:**
- ✅ Socket.IO client (`socket.io-client`)
- ✅ Real-time hot-plug detection (checks every 5 seconds)
- ✅ Emits events when devices connect/disconnect
- ✅ Broadcasts agent status to backend
- ✅ Monitors all COM ports for new devices

**Events Emitted:**
- `device-status` - When device connects/disconnects
- `agent-status` - Periodic agent health status

**Key Files:**
- `src/agent.js` - Main agent with Socket.IO integration
- `package.json` - Added `socket.io-client` dependency

### 2. **Backend Side** (`path-backend`)

**Added:**
- ✅ Socket.IO event handlers for device/agent status
- ✅ Broadcasts events to all connected UI clients
- ✅ Logs all device/agent events

**Events Handled:**
- `device-status` → Broadcasts as `device-status-update`
- `agent-status` → Broadcasts as `agent-status-update`

**Key Files:**
- `server.js` - Socket.IO event handlers

### 3. **UI Side** (`lab-flow-genius`)

**Added:**
- ✅ Real-time device status component
- ✅ Displays connected/disconnected devices
- ✅ Shows agent status
- ✅ Shows backend connection status
- ✅ Live updates via Socket.IO

**Key Files:**
- `src/components/DeviceStatusMonitor.tsx` - Device monitoring component
- `src/pages/Dashboard.tsx` - Integrated into dashboard

## 🚀 How It Works

### When Device is Plugged In:

1. **Agent detects** new COM port (polling every 5 seconds)
2. **Agent emits** `device-status` event with:
   ```json
   {
     "type": "serial",
     "port": "COM3",
     "status": "connected",
     "detectedAt": "2025-01-15T10:00:00Z",
     "instrumentId": "CLIENT_001"
   }
   ```

3. **Backend receives** event and broadcasts to all UI clients
4. **UI updates** in real-time showing new device connected

### When Device is Unplugged:

1. **Agent detects** port is no longer available
2. **Agent emits** `device-status` event with `status: "disconnected"`
3. **Backend broadcasts** to all UI clients
4. **UI updates** showing device disconnected

### Agent Heartbeat:

Every 60 seconds (or when status changes), agent emits:
```json
{
  "instrumentId": "CLIENT_001",
  "instrumentType": "ESR_ANALYZER",
  "connectionType": "serial",
  "status": "connected",
  "timestamp": "2025-01-15T10:00:00Z"
}
```

## 🔧 Configuration

No additional configuration needed! Just run:

```bash
# Agent
cd LIS-analyzer-agent
npm install
npm start

# Backend
cd path-backend
npm start

# UI
cd lab-flow-genius
npm run dev
```

## 📊 UI Components

### Device Status Monitor Component

Displays:
- ✅ **Backend Connection Status** - Is Socket.IO connected?
- ✅ **Agent Status** - Which agents are online?
- ✅ **Device Status** - List of all detected devices with connect/disconnect times

### Real-Time Updates

- Green = Connected ✅
- Red = Disconnected ❌
- Animated pulse = Active monitoring
- Timestamps for each event

## 🛡️ Safety Features

- **Read-only monitoring** - Never sends data to devices
- **Clean disconnection** - Properly closes ports on exit
- **Reconnection handling** - Auto-reconnect on Socket.IO disconnect
- **Error handling** - Graceful degradation on errors
- **Throttled polling** - Checks every 5 seconds (not continuously)

## 📝 Events Reference

### Agent → Backend

#### `device-status`
```json
{
  "type": "serial|tcp",
  "port": "COM3",
  "status": "connected|disconnected",
  "detectedAt": "ISO timestamp",
  "instrumentId": "CLIENT_001"
}
```

#### `agent-status`
```json
{
  "instrumentId": "CLIENT_001",
  "instrumentType": "ESR_ANALYZER",
  "connectionType": "serial|tcp",
  "status": "connected|disconnected",
  "timestamp": "ISO timestamp"
}
```

### Backend → UI

#### `device-status-update`
- Same as `device-status` from agent

#### `agent-status-update`
- Same as `agent-status` from agent

## 🎮 Usage

### View Device Status

1. Open Dashboard in UI
2. Scroll to "Device Status Monitor" section
3. See real-time updates as devices connect/disconnect

### Monitor Agent Health

- Connection icon shows backend connection status
- Agent status cards show online agents
- Device list shows all plugged in devices

## 🐛 Troubleshooting

### No devices showing in UI

**Check:**
1. Agent is running: `npm start` in LIS-analyzer-agent
2. Backend is running: `npm start` in path-backend
3. UI is connected: Check "Backend Connection" card shows "Connected"
4. Check browser console for Socket.IO errors

### Devices not detected

**Check:**
1. Agent logs: `tail -f logs/agent.log`
2. Backend logs: `tail -f logs/combined.log`
3. Port exists: Device Manager → Ports (COM & LPT)

### Socket.IO connection failed

**Check:**
1. Backend URL in agent config
2. CORS settings in backend
3. Firewall blocking Socket.IO port
4. Backend Socket.IO server is running

## 📈 Next Steps

Potential enhancements:
- ✅ Device autodetection and auto-configuration
- ✅ Device history/audit log
- ✅ Multiple agents per dashboard
- ✅ Device health metrics
- ✅ Automatic reconfiguration on device change

