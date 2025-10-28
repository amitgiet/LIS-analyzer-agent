# LIS Client Agent

A lightweight Node.js application that runs on client PCs to forward laboratory instrument data to a central LIS server.

## Features

- ✅ Reads data from COM ports (USB/RS-232)
- ✅ Reads data from TCP/IP connections
- ✅ Parses ASTM and HL7 messages
- ✅ Forwards data to central server via HTTPS
- ✅ Automatic retry with queuing
- ✅ Heartbeat monitoring
- ✅ Runs as Windows Service
- ✅ Comprehensive logging

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure

Edit `config/default.json`:

```json
{
  "server": {
    "url": "http://your-server.com:5001"
  },
  "instrument": {
    "id": "CLIENT_001",
    "type": "ESR_ANALYZER"
  },
  "connection": {
    "type": "serial",
    "serial": {
      "port": "COM3",
      "baudRate": 9600
    }
  }
}
```

### 3. Run Manually

```bash
npm start
```

### 4. Install as Windows Service (Recommended)

```bash
npm run install-service
```

This installs the agent as a Windows service that starts automatically on boot.

### 5. Uninstall Service

```bash
npm run uninstall-service
```

## Configuration

### Connection Types

**Serial (USB/RS-232):**
```json
{
  "connection": {
    "type": "serial",
    "serial": {
      "port": "COM3",
      "baudRate": 9600,
      "dataBits": 8,
      "parity": "none",
      "stopBits": 1
    }
  }
}
```

**TCP/IP:**
```json
{
  "connection": {
    "type": "tcp",
    "tcp": {
      "host": "192.168.1.100",
      "port": 4000
    }
  }
}
```

### Retry & Queue Settings

```json
{
  "retry": {
    "maxRetries": 5,
    "delayMs": 5000,
    "exponentialBackoff": true
  },
  "queue": {
    "enabled": true,
    "file": "./data/queue.json",
    "maxSize": 1000
  }
}
```

### Security

```json
{
  "security": {
    "apiKey": "your-secret-key",
    "verifySsl": true
  }
}
```

## Architecture

```
Instrument (COM/TCP)
    ↓
Agent reads data
    ↓
Parse ASTM/HL7
    ↓
HTTP POST to Central Server
    ↓
Queue on failure → Retry later
```

## Logging

Logs are stored in `./logs/agent.log`

Check logs:
```bash
tail -f logs/agent.log
```

## Monitoring

The agent sends heartbeat to server every 60 seconds by default.

To change interval:
```json
{
  "heartbeat": {
    "intervalMs": 60000
  }
}
```

## Troubleshooting

### COM port not found
- Check device manager for correct COM port number
- Ensure no other application is using the port
- Check USB cable connection

### Cannot connect to server
- Verify server URL is correct
- Check firewall allows outbound HTTPS
- Test with: `curl http://your-server.com:5001/health`

### Queue growing large
- Check network connectivity
- Verify server is running
- Check logs for error messages

## File Structure

```
client-agent/
├── src/
│   ├── agent.js              # Main entry point
│   └── lib/
│       ├── ComReader.js      # COM port reader
│       ├── TcpReader.js      # TCP reader
│       ├── MessageParser.js  # ASTM/HL7 parser
│       ├── HttpClient.js     # HTTP client
│       ├── QueueManager.js   # Retry queue
│       └── Heartbeat.js      # Health monitoring
├── config/
│   └── default.json          # Configuration
├── logs/
│   └── agent.log             # Log file
├── data/
│   └── queue.json            # Message queue
└── scripts/
    ├── install-service.js    # Service installer
    └── uninstall-service.js  # Service uninstaller
```

## Development

### Run in Development Mode

```bash
npm start
```

### View Logs

```bash
tail -f logs/agent.log
```

### Test with Mock Data

```bash
# Connect a mock instrument to the specified COM port
# Agent will automatically read and forward data
```

## Production Deployment

1. Install dependencies: `npm install`
2. Configure `config/default.json`
3. Install as service: `npm run install-service`
4. Monitor logs: `logs/agent.log`

## Support

For issues, check:
- Log files in `./logs/`
- Queue file in `./data/`
- Server logs

## License

MIT

