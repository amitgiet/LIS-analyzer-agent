# LIS Analyzer Agent – AutoDetection Module

This module scans available COM ports and configured TCP targets to passively detect laboratory analyzers speaking ASTM or HL7. It is safe for medical environments: read-only, time-bounded, single-connection at a time.

## Safety Rules
- Read-only: the agent never sends data to instruments
- Only one connection open at a time
- Each attempt auto-times out (serial: 10s, tcp: 5s by default)
- All ports are closed after each attempt
- Results saved to `data/detected_devices.json` (append-only)
- Existing configuration is never overwritten automatically

## Usage

### CLI Scan
```bash
cd LIS-analyzer-agent
npm run autodetect
```

### Programmatic
```js
const AutoDetectionManager = require('./src/autodetect/AutoDetectionManager');
const config = require('./config/default.json');

async function main() {
  const mgr = new AutoDetectionManager(config);
  const results = await mgr.runFullScan();
  console.log(results);
}

main();
```

## Output
- Logs: `logs/autodetect.log`
- Results: `data/detected_devices.json`

Example detection entry:
```json
{
  "type": "serial",
  "port": "COM3",
  "baudRate": 9600,
  "protocol": "ASTM",
  "instrument": "Sysmex XP-100",
  "detectedAt": "2025-10-28T12:45:00Z",
  "rawSample": "H|^&|..."
}
```

## Configuration
Configure in `config/default.json`:
```json
{
  "autodetect": {
    "serialBaudRates": [9600, 19200, 38400],
    "serialListenMs": 10000,
    "tcpTimeoutMs": 5000,
    "tcpTargets": [
      { "host": "192.168.1.45", "ports": [5001, 5002] }
    ]
  }
}
```

## Dependencies
- serialport
- net (built-in)
- fs, path (built-in)
- chalk
- winston

## Notes
- ASTM detection: looks for `H|^&` in header
- HL7 detection: looks for `MSH|^~\&`
- Instrument names are extracted from ASTM H or HL7 MSH lines when possible
