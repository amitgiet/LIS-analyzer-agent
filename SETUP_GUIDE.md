# Client Agent - Setup Guide

Complete guide for deploying the client-agent to connect instruments to path-backend.

## 🎯 **Purpose**

The client-agent runs on a **Windows PC** connected to your lab instrument (via USB/Serial or TCP). It:
- Reads ASTM/HL7 data from the instrument
- Converts to JSON format
- Sends via HTTP to your remote path-backend server
- Retries automatically if network fails
- Queues messages when offline

---

## 📋 **Prerequisites**

- Windows PC (7/10/11) connected to instrument
- Node.js 16+ installed
- Instrument connected via COM port or TCP
- Network access to your path-backend server

---

## 🚀 **Quick Setup (5 Minutes)**

### **Step 1: Copy Agent Files**

Copy `UniversaLIS/client-agent` folder to your lab PC:

```bash
# On your development machine
# Copy the entire client-agent folder to USB/Network share

# On lab PC
# Extract to: C:\Program Files\LIS Agent\
```

### **Step 2: Configure for Your Server**

Edit `config/default.json`:

```json
{
  "server": {
    "url": "http://YOUR-REMOTE-SERVER-IP:3000",
    "endpoints": {
      "reports": "/api/instruments/results",
      "heartbeat": "/api/instruments/heartbeat"
    },
    "timeout": 30000
  },
  "instrument": {
    "id": "ESR_ANALYZER_LAB1",
    "type": "ESR_ANALYZER",
    "location": "Main Lab"
  },
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

**Replace:**
- `YOUR-REMOTE-SERVER-IP` - Your path-backend server IP
- `COM3` - Your instrument's COM port (check Device Manager)
- `9600` - Your instrument's baud rate (check instrument manual)

### **Step 3: Install Dependencies**

```bash
cd C:\Program Files\LIS Agent\client-agent
npm install
```

### **Step 4: Install as Windows Service**

```bash
npm run install-service
```

This installs the agent to run automatically on Windows boot.

### **Step 5: Start the Service**

```bash
net start lis-client-agent
```

Or start from Services:
```bash
services.msc
# Find "LIS Client Agent"
# Right-click → Start
```

---

## 🔧 **Configuration Details**

### **Server Configuration**

```json
"server": {
  "url": "http://123.45.67.89:3000",  // Your path-backend server
  "endpoints": {
    "reports": "/api/instruments/results",
    "heartbeat": "/api/instruments/heartbeat"
  },
  "timeout": 30000  // 30 seconds
}
```

### **Instrument Configuration**

```json
"instrument": {
  "id": "ESR_ANALYZER_LAB1",        // Unique identifier
  "type": "ESR_ANALYZER",           // Instrument type
  "location": "Main Lab"            // Lab location
}
```

### **Serial Connection (USB/RS-232)**

```json
"connection": {
  "type": "serial",
  "serial": {
    "port": "COM3",          // Check Device Manager
    "baudRate": 9600,        // Common: 9600, 115200
    "dataBits": 8,
    "parity": "none",
    "stopBits": 1
  }
}
```

**Find COM Port:**
1. Connect instrument to USB
2. Open Device Manager
3. Look under "Ports (COM & LPT)"
4. Note the COM port (e.g., "COM3")

### **TCP Connection**

```json
"connection": {
  "type": "tcp",
  "tcp": {
    "host": "192.168.1.100",  // Instrument's IP address
    "port": 4000               // Instrument's TCP port
  }
}
```

### **Retry Configuration**

```json
"retry": {
  "maxRetries": 5,              // Retry 5 times if fails
  "delayMs": 5000,              // Wait 5 seconds between retries
  "exponentialBackoff": true   // Increase delay each retry
}
```

### **Queue Configuration**

```json
"queue": {
  "enabled": true,              // Enable offline queue
  "file": "./data/queue.json",  // Queue storage file
  "maxSize": 1000               // Max queued messages
}
```

---

## 🧪 **Testing**

### **Test 1: Check Service is Running**

```bash
net start lis-client-agent
# Should show: "The LIS Client Agent service was started successfully"
```

### **Test 2: View Logs**

```bash
# Logs are in the client-agent folder
cd C:\Program Files\LIS Agent\client-agent\logs
type agent.log

# Or tail the log
powershell Get-Content agent.log -Wait -Tail 20
```

**Good logs should show:**
```
✓ Starting LIS Client Agent...
✓ Instrument connected successfully
✓ Agent started successfully
✓ Heartbeat sent successfully
```

### **Test 3: Verify Connection to Server**

```bash
# Test from lab PC
curl http://YOUR-SERVER-IP:3000/health

# Should return: {"status":"OK",...}
```

### **Test 4: Run Instrument Test**

Run a test on your instrument. Check logs:

```bash
# Should see:
"Received raw data..."
"Parsed message:"
"Data sent to server successfully"
```

### **Test 5: Check Server Received Data**

On your path-backend server:

```bash
# Check database for incoming results
mysql> SELECT * FROM instrument_result_log ORDER BY received_at DESC LIMIT 5;
```

---

## 🐛 **Troubleshooting**

### **"COM Port Not Found"**

**Problem:** Instrument COM port incorrect

**Solution:**
1. Check Device Manager for correct COM port
2. Update `config/default.json` with correct port
3. Restart service

### **"Cannot Connect to Server"**

**Problem:** Network issue or server unreachable

**Test:**
```bash
# From lab PC
ping YOUR-SERVER-IP
telnet YOUR-SERVER-IP 3000
```

**Solutions:**
- Check server firewall allows port 3000
- Verify server is running
- Check network connectivity
- Try using IP instead of domain name

### **"Queue Growing Large"**

**Problem:** Messages not being sent to server

**Check:**
```bash
# View queue
cd client-agent/data
type queue.json
```

**Solutions:**
- Verify server is running
- Check network connectivity
- Review logs for errors
- Clear queue if needed: `del data\queue.json`

### **"No Data Being Received"**

**Problem:** Instrument not sending or wrong port

**Check:**
1. Verify instrument is on and connected
2. Check COM port in Device Manager
3. Verify serial settings (baud rate, parity, etc.)
4. Try different COM ports

---

## 🔄 **Updating Configuration**

### **Change Server URL**

1. Stop service: `net stop lis-client-agent`
2. Edit `config/default.json`
3. Change `server.url` to new address
4. Start service: `net start lis-client-agent`

### **Change COM Port**

1. Stop service
2. Edit `config/default.json`
3. Change `connection.serial.port`
4. Start service

### **View Current Config**

```bash
cd client-agent
type config\default.json
```

---

## 📊 **Monitoring**

### **Check Service Status**

```bash
net start lis-client-agent
# Check if running

sc query lis-client-agent
# Shows detailed service status
```

### **View Logs**

```bash
cd client-agent\logs
type agent.log | findstr "ERROR"
# View only errors
```

### **Check Queue Size**

```bash
# Check queue file size
cd client-agent\data
dir queue.json
```

### **Monitor Real-Time**

```bash
powershell Get-Content C:\Program Files\LIS Agent\client-agent\logs\agent.log -Wait -Tail 50
```

---

## 🛡️ **Security Notes**

### **Production Checklist**

- [ ] Use HTTPS (SSL certificate) for server URL
- [ ] Add API key authentication
- [ ] Configure Windows Firewall
- [ ] Enable Windows automatic updates
- [ ] Set strong service account password
- [ ] Backup configuration files

### **Enable HTTPS**

```json
"server": {
  "url": "https://your-server.com",  // Use HTTPS
  "security": {
    "verifySsl": true                // Verify SSL certificate
  }
}
```

### **Add API Key**

```json
"security": {
  "apiKey": "your-secret-key-here",
  "verifySsl": true
}
```

Then configure path-backend to require this API key.

---

## 📝 **Log Locations**

- **Agent Log:** `logs/agent.log`
- **Queue File:** `data/queue.json`
- **Service Logs:** Windows Event Viewer → Application Log

---

## 🔄 **Uninstall**

```bash
# Uninstall service
npm run uninstall-service

# Or manual uninstall
sc delete lis-client-agent
```

---

## ✅ **Success Indicators**

**Service is working when you see:**

✅ Service running: `sc query lis-client-agent` shows "RUNNING"  
✅ Logs show: "Instrument connected successfully"  
✅ Logs show: "Data sent to server successfully"  
✅ Server receives data in `instrument_result_log` table  
✅ No errors in logs  

---

## 📞 **Support**

**Check logs first:**
```bash
type logs\agent.log
```

**Common issues:**
- COM port issues → Check Device Manager
- Network issues → Test with ping/telnet
- Server issues → Check server logs

---

**Version:** 1.0.0  
**Last Updated:** October 2024

