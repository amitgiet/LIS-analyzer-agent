const net = require('net');
const EventEmitter = require('events');
const AstmProtocolHandler = require('./AstmProtocolHandler');

class TcpReader extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.socket = null;
    this.buffer = '';
    this.reconnectDelay = 5000;
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
      this.logger.info('Listening for TCP connections on port:', this.config.port);

      // Create TCP server instead of client
      this.server = net.createServer((socket) => {
        this.logger.info('Instrument connected', { 
          remoteAddress: socket.remoteAddress,
          localPort: socket.localPort 
        });
        this.socket = socket;
        this.emit('connect');
        
        // Setup TCP keepalive (like astm_general-master)
        socket.setKeepAlive(true, 1000); // Start after 1 second of idleness
        socket.setNoDelay(true); // Disable Nagle algorithm for low latency

        // Use byte-level reading if protocol handler is enabled
        if (this.useProtocolHandler) {
          socket.on('data', (data) => {
            this.handleByteLevelData(data);
          });
        } else {
          // Use string-based reading (legacy mode)
          socket.on('data', (data) => {
            this.handleData(data.toString());
          });
        }

        socket.on('error', (error) => {
          this.logger.error('TCP socket error:', error.message);
          this.emit('error', error);
        });

        socket.on('close', () => {
          this.logger.warn('Instrument disconnected');
          this.socket = null;
          this.emit('disconnect');
        });

        socket.on('timeout', () => {
          this.logger.warn('TCP connection timeout');
          socket.destroy();
        });

        socket.setTimeout(60000); // 60 seconds
      });

      this.server.listen(this.config.port, () => {
        this.logger.info('TCP server listening on port:', this.config.port);
      });

      this.server.on('error', (error) => {
        this.logger.error('TCP server error:', error);
        if (error.code === 'EADDRINUSE') {
          this.logger.error(`Port ${this.config.port} is already in use!`);
        }
      });

    } catch (error) {
      this.logger.error('Failed to start TCP server:', error);
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
        if (response && this.socket && !this.socket.destroyed) {
          this.socket.write(response);
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
   * Handle string-based data (legacy mode)
   */
  handleData(data) {
    try {
      // Accumulate data into buffer
      this.buffer += data;

      // Check if message is complete (common terminators or just newlines)
      const hasTerminator = this.buffer.includes('\x03') || 
          this.buffer.includes('\x04') || 
          this.buffer.includes('\x1C') || 
          this.buffer.includes('\n');
      
      if (hasTerminator || this.buffer.length > 100) {
        const message = this.buffer.trim();
        this.buffer = '';

        if (message.length > 0) {
          this.emit('data', message);
        }
      }
    } catch (error) {
      this.logger.error('Error handling TCP data:', error);
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    
    this.logger.info(`Waiting for instrument to reconnect...`);
    // Note: For server mode, we don't need to reconnect - we just wait for connections
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
    }, this.reconnectDelay);
  }

  async disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.destroy();
      this.logger.info('Client socket disconnected');
    }
    if (this.server) {
      this.server.close(() => {
        this.logger.info('TCP server closed');
      });
    }
  }

  isConnected() {
    return this.socket && !this.socket.destroyed;
  }
}

module.exports = TcpReader;

