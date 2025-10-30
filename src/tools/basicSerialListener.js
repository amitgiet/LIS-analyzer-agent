const { SerialPort } = require('serialport');

// Basic standalone serial listener for quick testing
// Usage: PORT=COM6 BAUD=9600 node src/tools/basicSerialListener.js

const PORT = process.env.PORT || process.env.SERIAL_PORT || 'COM6';
const BAUD = parseInt(process.env.BAUD || process.env.BAUD_RATE || '9600', 10);

const port = new SerialPort({
  path: PORT,
  baudRate: BAUD,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  autoOpen: true
});

let buffer = '';

port.on('open', () => {
  console.log(`[basicSerialListener] Opened ${PORT} @ ${BAUD} baud`);
});

port.on('data', (data) => {
  // Accumulate as binary string to preserve control chars
  buffer += data.toString('binary');

  // Heuristic: flush on ETX/EOT or newline
  if (buffer.includes('\x03') || buffer.includes('\x04') || buffer.includes('\n')) {
    const raw = buffer;
    buffer = '';
    // Print a preview with control characters escaped
    const preview = raw
      .replace(/\x02/g, '<STX>')
      .replace(/\x03/g, '<ETX>')
      .replace(/\x04/g, '<EOT>')
      .replace(/\x17/g, '<ETB>')
      .replace(/\r/g, '<CR>')
      .replace(/\n/g, '<LF>');
    console.log('[basicSerialListener] Received message preview:', preview.slice(0, 500));
  }
});

port.on('error', (e) => {
  console.error('[basicSerialListener] Serial error:', e && e.message ? e.message : e);
});

process.on('SIGINT', () => {
  try {
    if (port && port.isOpen) {
      port.close(() => process.exit(0));
    } else {
      process.exit(0);
    }
  } catch (_) {
    process.exit(0);
  }
});


