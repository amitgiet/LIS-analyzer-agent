const net = require('net');
const EventEmitter = require('events');

class TcpReader extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.socket = null;
    this.buffer = '';
    this.reconnectDelay = 5000;
  }

  async connect() {
    try {
      this.logger.info('Connecting to TCP instrument:', this.config.host, this.config.port);

      this.socket = net.createConnection({
        host: this.config.host,
        port: this.config.port
      }, () => {
        this.logger.info('TCP connected to instrument');
        this.emit('connect');
      });

      this.socket.on('data', (data) => {
        this.handleData(data.toString());
      });

      this.socket.on('error', (error) => {
        this.logger.error('TCP error:', error);
        this.emit('error', error);
        this.scheduleReconnect();
      });

      this.socket.on('close', () => {
        this.logger.warn('TCP connection closed');
        this.emit('disconnect');
        this.scheduleReconnect();
      });

      this.socket.on('timeout', () => {
        this.logger.warn('TCP connection timeout');
        this.socket.destroy();
      });

    } catch (error) {
      this.logger.error('Failed to connect to TCP instrument:', error);
      throw error;
    }
  }

  handleData(data) {
    try {
      // Accumulate data into buffer
      this.buffer += data;

      // Check if message is complete (common terminators)
      if (this.buffer.includes('\x03') || 
          this.buffer.includes('\x04') || 
          this.buffer.includes('\x1C')) { // MLLP end
        
        const message = this.buffer.trim();
        this.buffer = '';

        if (message.length > 0) {
          this.logger.debug('Complete TCP message received:', message.substring(0, 100));
          this.emit('data', message);
        }
      }
    } catch (error) {
      this.logger.error('Error handling TCP data:', error);
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    
    this.logger.info(`Reconnecting in ${this.reconnectDelay}ms...`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (error) {
        this.logger.error('Reconnection failed:', error);
      }
    }, this.reconnectDelay);
  }

  async disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.destroy();
      this.logger.info('TCP disconnected');
    }
  }

  isConnected() {
    return this.socket && !this.socket.destroyed;
  }
}

module.exports = TcpReader;

