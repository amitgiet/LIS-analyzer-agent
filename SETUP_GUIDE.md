# LIS Analyzer Agent - Setup & Configuration Guide

## Overview

The LIS Analyzer Agent runs on your local PC to connect instruments (via COM/TCP ports) to your centralized LIS backend. It listens for ASTM/HL7 messages from instruments and forwards them to the backend server.

---

## Complete Flow

```
┌─────────────────────────┐
│  1. Patient Registered  │ → Backend creates patient record
└──────────┬──────────────┘
           │
┌──────────▼──────────────┐
│ 2. Sample Collected    │ → Backend generates unique barcode
│    with barcode label   │
└──────────┬──────────────┘
           │
┌──────────▼──────────────┐
│ 3. Test Order Created   │ → Backend links barcode to tests
│    for sample barcode   │
└──────────┬──────────────┘
           │
┌──────────▼──────────────┐
│ 4. Sample sent to       │ → Physical sample sent to instrument
│    instrument           │
└──────────┬──────────────┘
           │
┌──────────▼──────────────┐
│ 5. Instrument reads     │ → Machine scans barcode, runs tests
│    barcode & tests      │
└──────────┬──────────────┘
           │
┌──────────▼──────────────┐
│ 6. Instrument sends     │ → ASTM/HL7 message with results
│    results via COM/TCP  │
└──────────┬──────────────┘
           │
┌──────────▼──────────────┐
│ 7. Agent listens on      │ → Agent connected to COM port or TCP
│    COM/TCP port          │
└──────────┬──────────────┘
           │
┌──────────▼──────────────┐
│ 8. Agent parses message │ → Converts ASTM/HL7 to structured data
└──────────┬──────────────┘
           │
┌──────────▼──────────────┐
│ 9. Agent transforms data│ → Converts to backend format
└──────────┬──────────────┘
           │
┌──────────▼──────────────┐
│ 10. Agent sends to       │ → HTTP POST to backend
│     backend server       │
└──────────┬──────────────┘
           │
┌──────────▼──────────────┐
│ 11. Backend matches      │ → Finds sample by barcode
│     by barcode           │
└──────────┬──────────────┘
           │
┌──────────▼──────────────┐
│ 12. Backend maps tests   │ → Maps instrument test codes
└──────────┬──────────────┘
           │
┌──────────▼──────────────┐
│ 13. Backend saves results│ → Inserts into database
└──────────┬──────────────┘
           │
┌──────────▼──────────────┐
│ 14. Backend updates      │ → Marks tests as completed
│     order status         │
└──────────┬──────────────┘
           │
┌──────────▼──────────────┐
│ 15. Backend sends        │ → WebSocket notification
│     WebSocket notification│
└──────────────────────────┘
```

---

## Setup Instructions

### 1. Backend Configuration

#### Register Your Instrument

Run this SQL in your backend database:

```sql
-- Replace with your actual instrument details
INSERT INTO instruments (
  instrument_id, 
  name, 
  manufacturer, 
  model, 
  instrument_type, 
  connection_type, 
  status
) VALUES (
  'YOUR_INSTRUMENT_ID',     -- Must match agent config
  'Your Instrument Name',
  'Manufacturer Name',
  'Model Number',
  'hematology',             -- or 'chemistry', 'immunology', etc.
  'serial',                 -- or 'tcp'
  'active'
);
```

#### Create Test Mappings

Map your instrument's test codes to your internal test catalog:

```sql
-- Map instrument test code 'ESR' to internal test with ID 1
INSERT INTO instrument_test_mapping (
  instrument_id, 
  instrument_test_code, 
  test_id
)
SELECT 
  i.id,
  'ESR',        -- Your instrument test code
  t.id          -- Your internal test ID
FROM instruments i, tests t
WHERE i.instrument_id = 'YOUR_INSTRUMENT_ID'
AND t.id = 1;    -- Your internal test ID
```

### 2. Agent Installation

```bash
cd LIS-analyzer-agent
npm install
```

### 3. Agent Configuration

Edit `config/default.json`:

```json
{
  "server": {
    "url": "http://YOUR_BACKEND_SERVER:3000",
    "endpoints": {
      "reports": "/api/instruments/results",
      "heartbeat": "/api/instruments/heartbeat"
    },
    "timeout": 30000
  },
  "instrument": {
    "id": "YOUR_INSTRUMENT_ID",        // Must match database!
    "type": "YOUR_INSTRUMENT_TYPE",
    "location": "Lab Name"
  },
  "connection": {
    "type": "serial",                   // or "tcp"
    "serial": {
      "port": "COM3",                   // Your COM port
      "baudRate": 9600,
      "dataBits": 8,
      "parity": "none",
      "stopBits": 1
    }
  }
}
```

### 4. Run the Agent

#### Development Mode

```bash
npm start
```

#### Production Mode (Windows Service)

```bash
npm run install-service
```

The agent will:
- Connect to your instrument via COM/TCP
- Listen for ASTM/HL7 messages
- Parse and forward to backend
- Retry on failures
- Send heartbeat every 60 seconds

---

## Message Format Examples

### ASTM Format (Common)

**Raw Message:**
```
H|\^&||||||||
P|1||12345|SMITH^JOHN||19800515|M||
O|1|SAMP001|ESR||R
R|1||^WESTERGREN|15|mm/hr|0-15|N
L|1|F
```

**Parsed to Backend Format:**
```json
{
  "PracticePatientID": "12345",
  "LabPatientID": "12345",
  "PatientName": "SMITH JOHN",
  "DOB": "19800515",
  "Sex": "M",
  "Orders": [{
    "SpecimenID": "SAMP001",
    "UniversalTestID": "ESR",
    "Priority": "R",
    "Results": [{
      "UniversalTestID": "WESTERGREN",
      "ResultValue": "15",
      "Unit": "mm/hr",
      "RefRange": "0-15",
      "Abnormal": "N",
      "InstrumentID": "YOUR_INSTRUMENT_ID"
    }]
  }]
}
```

### HL7 Format (Alternative)

**Raw Message:**
```
MSH|^~\&|INSTRUMENT|LAB|LIS|BACKEND|20240101120000||ORU^R01|12345|P|2.3
PID|1||12345||SMITH^JOHN||19800515|M
OBR|1|||SAMP001|ESR|R|||20240101120000
OBX|1|NM|ESR^WESTERGREN|15|mm/hr|0-15|N|||F
```

---

## Barcode Matching Logic

The backend matches results using this priority:

### 1. Exact Barcode Match (Primary)
```sql
SELECT * FROM samples 
WHERE barcode = 'SAMP001' 
OR external_specimen_id = 'SAMP001'
```

### 2. Patient ID Match (Fallback)
```sql
SELECT s.* FROM samples s
JOIN patients p ON s.patient_id = p.id
WHERE p.patient_id = '12345'
AND s.status IN ('collected', 'in_process')
```

### 3. Failure Handling
- If no match found → Logged to `instrument_result_log` table
- Status set to `failed`
- Error message: "No matching sample found"
- Can be reviewed manually via UI

---

## Multiple Instruments

### Option 1: Separate Agent Instances (Recommended)

Run one agent per instrument on the same PC:

```bash
# Create separate config files
config/instrument1.json
config/instrument2.json

# Run multiple instances
node src/agent.js --config config/instrument1.json &
node src/agent.js --config config/instrument2.json &
```

### Option 2: Modify Agent for Multiple Ports

Modify `agent.js` to support multiple readers:

```javascript
// In constructor
this.readers = [];

// In start()
if (Array.isArray(this.config.connection.serial)) {
  this.config.connection.serial.forEach(serial => {
    const reader = new ComReader(serial, this.logger);
    this.readers.push(reader);
  });
}
```

---

## Troubleshooting

### Agent Won't Connect to COM Port

**Problem:** `COM port not found` error

**Solutions:**
1. Check Windows Device Manager for correct COM port number
2. Ensure no other application is using the port
3. Check USB cable connection
4. Verify baud rate settings match instrument

### Agent Can't Connect to Backend

**Problem:** `Failed to send to server` error

**Solutions:**
1. Verify backend is running: `curl http://localhost:3000/health`
2. Check firewall allows outbound HTTP
3. Verify server URL in config is correct
4. Check backend logs: `tail -f path-backend/logs/combined.log`

### Results Not Matching

**Problem:** Backend shows "No matching sample found"

**Solutions:**
1. Verify barcode in message matches database
2. Check `instrument_result_log` table for details
3. Ensure sample status is 'collected' or 'in_process'
4. Verify `SpecimenID` in agent transformation matches sample barcode

### Test Mapping Not Working

**Problem:** "No test mapping found" error

**Solutions:**
1. Verify instrument is registered in database
2. Check `instrument_test_mapping` table has entries
3. Verify `instrument_test_code` matches exactly
4. Ensure mapping is active: `is_active = TRUE`

---

## Monitoring

### View Agent Logs

```bash
tail -f logs/agent.log
```

### Check Queue Size

Queue file: `data/queue.json`

### Backend Logs

```bash
tail -f path-backend/logs/combined.log
```

### Database Logs

```sql
-- Check pending results
SELECT * FROM instrument_result_log 
WHERE processed = FALSE 
ORDER BY received_at DESC;

-- Check matched results
SELECT * FROM instrument_result_log 
WHERE processing_status = 'matched' 
ORDER BY received_at DESC;

-- Check failed results
SELECT * FROM instrument_result_log 
WHERE processing_status = 'failed' 
ORDER BY received_at DESC;
```

---

## Production Deployment

### 1. Install as Windows Service

```bash
npm run install-service
```

### 2. Monitor with PM2 (Optional)

```bash
npm install -g pm2
pm2 start src/agent.js --name lis-agent
pm2 logs lis-agent
```

### 3. Set Up Log Rotation

Already configured in `config/default.json`:
- Max file size: 10MB
- Max files: 5
- Auto-rotation enabled

---

## Security Considerations

1. **API Authentication:** Backend endpoint is currently public
   - Consider adding API key authentication
   - Update `HttpClient.js` to send API key in headers

2. **Network Security:** 
   - Use HTTPS in production
   - Set `verifySsl: true` in config

3. **Firewall Rules:**
   - Allow agent → backend (outbound port 3000)
   - Block instrument → internet (isolate network)

---

## Success Indicators

✅ Agent logs: "Instrument connected successfully"  
✅ Heartbeat logs: "Heartbeat sent successfully"  
✅ Backend logs: "Results processed: X matched"  
✅ Database: `instrument_result_log.processing_status = 'matched'`  
✅ Web UI: Results appear in patient reports  

---

## Support

For issues:
1. Check logs in `./logs/agent.log`
2. Check queue in `./data/queue.json`
3. Check backend logs
4. Check database `instrument_result_log` table

