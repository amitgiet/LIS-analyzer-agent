# Client Agent Configuration Guide

## Overview

The LIS Client Agent connects to laboratory instruments via COM port or TCP/IP and forwards test results to the central LIS server.

## Basic Configuration

### Step 1: Identify Your Connection Type

**Option A: USB/Serial Connection**
- Instrument connected via USB cable
- Shows as COM port in Device Manager (e.g., COM3)
- Most common for legacy instruments

**Option B: Network/TCP Connection**
- Instrument has Ethernet port
- Configured with IP address and port
- Most common for modern instruments

### Step 2: Configure the Agent

Edit `config/default.json`:

#### For USB/Serial Instruments:

```json
{
  "connection": {
    "type": "serial",
    "serial": {
      "port": "COM3",          // Find in Device Manager
      "baudRate": 9600,         // Check instrument manual
      "dataBits": 8,
      "parity": "none",
      "stopBits": 1
    }
  },
  "instrument": {
    "id": "LAB_ESR_001",       // Unique ID for this instrument
    "type": "ESR_ANALYZER"     // Instrument type
  }
}
```

#### For TCP/IP Instruments:

```json
{
  "connection": {
    "type": "tcp",
    "tcp": {
      "host": "192.168.1.100",  // Instrument IP
      "port": 4000               // Instrument port
    }
  }
}
```

### Step 3: Configure Server URL

```json
{
  "server": {
    "url": "http://your-server.com:5001"
  }
}
```

### Step 4: Security Settings

```json
{
  "security": {
    "apiKey": "your-secret-key",  // Get from server admin
    "verifySsl": true             // Use false only in dev
  }
}
```

## Advanced Configuration

### Retry Settings

Control how the agent handles failures:

```json
{
  "retry": {
    "maxRetries": 5,              // Max retry attempts
    "delayMs": 5000,              // Delay between retries (ms)
    "exponentialBackoff": true    // Double delay on each retry
  }
}
```

### Queue Settings

Configure message queue:

```json
{
  "queue": {
    "enabled": true,              // Enable offline queue
    "file": "./data/queue.json",  // Queue file location
    "maxSize": 1000                // Max queued messages
  }
}
```

### Logging

```json
{
  "logging": {
    "level": "info",              // debug, info, warn, error
    "file": "./logs/agent.log",
    "maxSize": "10m",             // Rotate when file grows
    "maxFiles": 5                 // Keep last 5 log files
  }
}
```

### Heartbeat

Agent sends status to server periodically:

```json
{
  "heartbeat": {
    "enabled": true,
    "intervalMs": 60000           // Send every 60 seconds
  }
}
```

## Finding COM Port

### Windows

1. Open Device Manager
2. Expand "Ports (COM & LPT)"
3. Find your instrument (e.g., "USB Serial Port (COM3)")
4. Note the COM number

### Linux

```bash
ls /dev/tty* | grep USB
```

## Common Baud Rates

- 9600 - Most common
- 19200 - Faster instruments
- 38400 - High-speed instruments
- 115200 - Maximum speed

Check your instrument manual for the correct rate.

## Testing Configuration

### 1. Test COM Port Access

```bash
# On Windows PowerShell
[System.IO.Ports.SerialPort]::getportnames()
```

### 2. Test Server Connection

```bash
curl http://your-server.com:5001/health
```

### 3. Run Agent in Test Mode

```bash
npm start
```

Watch the console output for connection status.

## Troubleshooting

### Agent won't connect to instrument

**Problem:** Can't open COM port
**Solutions:**
- Check COM port number in Device Manager
- Ensure no other app is using the port
- Verify USB cable is connected
- Try different USB port

### Data not reaching server

**Problem:** Network error
**Solutions:**
- Verify server URL is correct
- Check firewall allows outbound HTTPS
- Test server accessibility: `ping your-server.com`
- Review logs: `tail -f logs/agent.log`

### Queue keeps growing

**Problem:** Can't send data
**Solutions:**
- Check network connection
- Verify server is running
- Check API key is correct
- Review server logs for errors

### Instrument disconnects

**Problem:** Connection drops
**Solutions:**
- Check USB cable quality
- Try different COM port
- Verify instrument is powered on
- Check instrument settings

## Example Configurations

### ESR Analyzer via USB

```json
{
  "instrument": {
    "id": "LAB_ESR_001",
    "type": "ESR_ANALYZER",
    "location": "Lab Room 1"
  },
  "connection": {
    "type": "serial",
    "serial": {
      "port": "COM3",
      "baudRate": 9600
    }
  },
  "server": {
    "url": "https://lis.company.com"
  }
}
```

### Chemistry Analyzer via TCP

```json
{
  "instrument": {
    "id": "LAB_CHEM_002",
    "type": "CHEMISTRY_ANALYZER",
    "location": "Lab Room 2"
  },
  "connection": {
    "type": "tcp",
    "tcp": {
      "host": "192.168.1.50",
      "port": 4000
    }
  },
  "server": {
    "url": "https://lis.company.com"
  }
}
```

## Multiple Instruments

You can run multiple agents on the same PC:

1. Create separate folders for each agent
2. Configure different COM ports
3. Configure different instrument IDs
4. Install each as separate service

## Production Deployment Checklist

- [ ] Configure correct server URL
- [ ] Set API key for authentication
- [ ] Verify COM port number
- [ ] Test connection to instrument
- [ ] Test connection to server
- [ ] Install as Windows Service
- [ ] Configure auto-start on boot
- [ ] Set up log rotation
- [ ] Configure queue size limits
- [ ] Test failover scenarios

## Support

For additional help:
- Check logs: `./logs/agent.log`
- Review server documentation
- Contact system administrator

