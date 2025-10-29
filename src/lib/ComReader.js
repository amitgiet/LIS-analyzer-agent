const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const EventEmitter = require('events');
const AstmProtocolHandler = require('./AstmProtocolHandler');

class ComReader extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.port = null;
    this.parser = null;
    this.buffer = '';
    this.useProtocolHandler = config.useProtocolHandler !== false; // Default true
    this.protocolHandler = null;
    
    if (this.useProtocolHandler) {
      this.protocolHandler = new AstmProtocolHandler(logger, {
        alarmTime: config.alarmTime || 10000
      });
      this.setupProtocolHandler();
    }
  }

  setupProtocolHandler() {
    this.protocolHandler.on('message', (message) => {
      this.logger.info('Complete ASTM message received via protocol handler');
      this.emit('data', message);
    });
    
    this.protocolHandler.on('timeout', (partialMessage) => {
      this.logger.warn('Protocol handler timeout - incomplete message', {
        partialLength: partialMessage.length
      });
      // Emit partial message anyway, let parser decide
      if (partialMessage.length > 0) {
        this.emit('data', partialMessage);
      }
    });
  }

  async connect() {
    try {
      this.logger.info('Connecting to COM port:', this.config.port);

      this.port = new SerialPort({
        path: this.config.port,
        baudRate: this.config.baudRate || 9600,
        dataBits: this.config.dataBits || 8,
        parity: this.config.parity || 'none',
        stopBits: this.config.stopBits || 1,
        autoOpen: true
      });

      // Setup parser for line-based reading
      this.parser = this.port.pipe(new ReadlineParser({ 
        delimiter: '\r\n',
        includeDelimiter: false
      }));

      this.port.on('open', () => {
        this.logger.info('COM port opened successfully:', this.config.port);
        this.emit('connect');
      });

      // Use byte-level reading if protocol handler is enabled
      if (this.useProtocolHandler) {
        this.port.on('data', (data) => {
          this.handleByteLevelData(data);
        });
      } else {
        // Use line-based reading (legacy mode)
        this.parser = this.port.pipe(new ReadlineParser({ 
          delimiter: '\r\n',
          includeDelimiter: false
        }));
        
        this.parser.on('data', (data) => {
          this.handleData(data.toString());
        });
      }

      this.port.on('error', (error) => {
        this.logger.error('COM port error:', error);
        this.emit('error', error);
      });

      this.port.on('close', () => {
        this.logger.warn('COM port closed');
        this.emit('disconnect');
      });

    } catch (error) {
      this.logger.error('Failed to connect to COM port:', error);
      throw error;
    }
  }

  /**
   * Handle byte-level data with protocol handler
   */
  handleByteLevelData(data) {
    try {
      // Process each byte through protocol handler
      for (let i = 0; i < data.length; i++) {
        const byte = data.slice(i, i + 1);
        const response = this.protocolHandler.processByte(byte);
        
        // Send ACK/NAK response if needed
        if (response && this.port && this.port.isOpen) {
          this.port.write(response);
          if (response[0] === 0x06) {
            this.logger.debug('Sent ACK');
          } else if (response[0] === 0x15) {
            this.logger.warn('Sent NAK - message error detected');
          }
        }
      }
    } catch (error) {
      this.logger.error('Error handling byte-level data:', error);
    }
  }

  /**
   * Handle line-based data (legacy mode)
   */
  handleData(data) {
    try {
      // Accumulate data into buffer
      this.buffer += data;

      // Check if message is complete (ETX or EOT character)
      if (this.buffer.includes('\x03') || this.buffer.includes('\x04')) {
        const message = this.buffer.trim();
        this.buffer = '';

        if (message.length > 0) {
          this.logger.debug('Complete message received:', message.substring(0, 100));
          this.emit('data', message);
        }
      }
    } catch (error) {
      this.logger.error('Error handling data:', error);
    }
  }

  async disconnect() {
    if (this.port && this.port.isOpen) {
      await new Promise((resolve) => {
        this.port.close(resolve);
      });
      this.logger.info('COM port disconnected');
    }
  }

  isConnected() {
    return this.port && this.port.isOpen;
  }
}

module.exports = ComReader;

