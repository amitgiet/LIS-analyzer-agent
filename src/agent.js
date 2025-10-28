const path = require('path');
const dotenv = require('dotenv');
const winston = require('winston');
const ComReader = require('./lib/ComReader');
const TcpReader = require('./lib/TcpReader');
const MessageParser = require('./lib/MessageParser');
const HttpClient = require('./lib/HttpClient');
const QueueManager = require('./lib/QueueManager');
const Heartbeat = require('./lib/Heartbeat');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Load configuration
const config = require('../config/default.json');

class LISAgent {
  constructor() {
    this.config = config;
    this.logger = this.setupLogger();
    this.reader = null;
    this.parser = new MessageParser(this.logger);
    this.httpClient = new HttpClient(config, this.logger);
    this.queueManager = new QueueManager(config, this.logger);
    this.heartbeat = new Heartbeat(config, this.logger);
    this.isRunning = false;
  }

  setupLogger() {
    return winston.createLogger({
      level: config.logging.level || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({
          filename: config.logging.file,
          maxsize: config.logging.maxSize,
          maxFiles: config.logging.maxFiles
        }),
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      ]
    });
  }

  async start() {
    try {
      this.logger.info('Starting LIS Client Agent...', {
        instrumentId: this.config.instrument.id,
        connectionType: this.config.connection.type
      });

      // Initialize connection based on type
      if (this.config.connection.type === 'serial') {
        this.reader = new ComReader(this.config.connection.serial, this.logger);
      } else if (this.config.connection.type === 'tcp') {
        this.reader = new TcpReader(this.config.connection.tcp, this.logger);
      } else {
        throw new Error(`Unknown connection type: ${this.config.connection.type}`);
      }

      // Setup data handler
      this.reader.on('data', (rawData) => {
        this.handleData(rawData);
      });

      this.reader.on('error', (error) => {
        this.logger.error('Reader error:', error);
      });

      this.reader.on('disconnect', () => {
        this.logger.warn('Instrument disconnected');
        this.attemptReconnect();
      });

      // Start reader
      await this.reader.connect();
      
      this.logger.info('Instrument connected successfully');

      // Start queue processor
      this.queueManager.start(async (data) => {
        return await this.sendToServer(data);
      });

      // Start heartbeat
      if (this.config.heartbeat.enabled) {
        this.heartbeat.start(this.sendHeartbeat.bind(this));
      }

      // Start processing queued items
      this.processQueue();

      this.isRunning = true;
      this.logger.info('Agent started successfully');

    } catch (error) {
      this.logger.error('Failed to start agent:', error);
      process.exit(1);
    }
  }

  handleData(rawData) {
    try {
      this.logger.debug('Received raw data:', { size: rawData.length });

      // Parse the message
      const parsedData = this.parser.parse(rawData);
      
      if (!parsedData) {
        this.logger.warn('Failed to parse message');
        return;
      }

      this.logger.info('Parsed message:', { 
        recordType: parsedData.recordType,
        sampleId: parsedData.sampleId 
      });

      // Add metadata
      const payload = {
        instrumentId: this.config.instrument.id,
        instrumentType: this.config.instrument.type,
        timestamp: new Date().toISOString(),
        data: parsedData
      };

      // Send to server or queue
      this.sendOrQueue(payload);

    } catch (error) {
      this.logger.error('Error handling data:', error);
    }
  }

  async sendOrQueue(payload) {
    try {
      const sent = await this.sendToServer(payload);
      if (!sent) {
        // Queue for retry
        this.queueManager.add(payload);
        this.logger.warn('Message queued for retry');
      }
    } catch (error) {
      this.logger.error('Failed to send or queue:', error);
      this.queueManager.add(payload);
    }
  }

  async sendToServer(payload) {
    try {
      const endpoint = this.config.server.endpoints?.reports || '/api/instruments/results';
      const response = await this.httpClient.post(endpoint, payload);
      this.logger.info('Data sent to server successfully');
      return true;
    } catch (error) {
      this.logger.error('Failed to send to server:', error.message);
      return false;
    }
  }

  async sendHeartbeat() {
    try {
      const status = {
        instrumentId: this.config.instrument.id,
        status: 'online',
        timestamp: new Date().toISOString(),
        queueSize: this.queueManager.size()
      };
      const endpoint = this.config.server.endpoints?.heartbeat || '/api/instruments/heartbeat';
      await this.httpClient.post(endpoint, status);
    } catch (error) {
      this.logger.debug('Heartbeat failed:', error.message);
    }
  }

  async processQueue() {
    const queueSize = this.queueManager.size();
    if (queueSize > 0) {
      this.logger.info(`Processing queue: ${queueSize} items`);
      await this.queueManager.process();
    }
  }

  attemptReconnect() {
    this.logger.info('Attempting to reconnect in 10 seconds...');
    setTimeout(() => {
      if (!this.isRunning) return;
      this.start();
    }, 10000);
  }

  async stop() {
    this.logger.info('Stopping agent...');
    this.isRunning = false;
    
    if (this.reader) {
      await this.reader.disconnect();
    }
    
    this.heartbeat.stop();
    this.queueManager.stop();
    
    this.logger.info('Agent stopped');
  }
}

// Start agent
const agent = new LISAgent();
agent.start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  await agent.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await agent.stop();
  process.exit(0);
});

module.exports = LISAgent;

