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

      // Transform parsed data into backend format
      const payload = this.transformToBackendFormat(parsedData);

      if (!payload) {
        this.logger.warn('Failed to transform data to backend format');
        return;
      }

      // Send to server or queue
      this.sendOrQueue(payload);

    } catch (error) {
      this.logger.error('Error handling data:', error);
    }
  }

  transformToBackendFormat(parsedData) {
    try {
      // Handle HL7 format
      if (parsedData.recordType === 'HL7') {
        return this.transformHL7ToBackendFormat(parsedData);
      }

      // Handle ASTM format
      if (parsedData.recordType === 'ASTM') {
        return this.transformASTMToBackendFormat(parsedData);
      }

      this.logger.warn('Unknown record type:', parsedData.recordType);
      return null;
    } catch (error) {
      this.logger.error('Error transforming to backend format:', error);
      return null;
    }
  }

  transformASTMToBackendFormat(parsedData) {
    // Extract patient data from records
    const patientRecord = parsedData.records.find(r => r.type === 'patient');
    const orderRecord = parsedData.records.find(r => r.type === 'order');
    const resultRecords = parsedData.records.filter(r => r.type === 'result');
    const headerRecord = parsedData.records.find(r => r.type === 'header');

    if (!orderRecord || !resultRecords || resultRecords.length === 0) {
      this.logger.warn('Incomplete ASTM data: missing order or results');
      return null;
    }

    // Extract specimen ID with proper fallback
    const specimenId = orderRecord?.specimenId || parsedData.sampleId || '';
    
    if (!specimenId) {
      this.logger.warn('Missing specimen ID in ASTM message');
      return null;
    }

    // Transform to backend expected format
    const payload = {
      PracticePatientID: patientRecord?.practiceId || '',
      LabPatientID: patientRecord?.labId || '',
      PatientName: patientRecord?.name || '',
      DOB: patientRecord?.dob || '',
      Sex: patientRecord?.sex || '',
      Orders: [{
        SpecimenID: specimenId,
        UniversalTestID: orderRecord?.testId || '',
        Priority: orderRecord?.priority || '',
        CollectionDate: headerRecord?.timestamp || new Date().toISOString().split('T')[0].replace(/-/g, ''),
        CollectionTime: new Date().toTimeString().split(' ')[0].replace(/:/g, ''),
        Results: resultRecords.map(r => ({
          UniversalTestID: r.testId || '',
          ResultValue: r.value || '',
          Unit: r.unit || '',
          RefRange: r.referenceRange || '',
          Abnormal: r.flag || '',
          InstrumentID: this.config.instrument.id
        }))
      }]
    };

    this.logger.debug('Transformed ASTM payload:', { specimenId, resultCount: resultRecords.length });
    return payload;
  }

  transformHL7ToBackendFormat(parsedData) {
    // Extract data from HL7 segments
    const mshSegment = parsedData.segments.find(s => s.type === 'MSH');
    const pidSegment = parsedData.segments.find(s => s.type === 'PID');
    const obrSegment = parsedData.segments.find(s => s.type === 'OBR');
    const obxSegments = parsedData.segments.filter(s => s.type === 'OBX');

    if (!pidSegment || !obrSegment || obxSegments.length === 0) {
      this.logger.warn('Incomplete HL7 data: missing required segments');
      return null;
    }

    // Extract patient data from PID segment
    const patientFields = pidSegment.fields || [];
    const patientName = (patientFields[5] || '').replace('^', ' ').trim();
    const patientId = patientFields[2] || '';
    const dob = patientFields[7] || '';
    const sex = patientFields[8] || '';

    // Extract specimen ID from OBR segment (field 3)
    const specimenId = obrSegment.fields[3] || '';
    
    if (!specimenId) {
      this.logger.warn('Missing specimen ID in HL7 message');
      return null;
    }

    // Transform to backend expected format
    const payload = {
      PracticePatientID: patientId.split('^')[0] || '',
      LabPatientID: patientId || '',
      PatientName: patientName,
      DOB: dob || '',
      Sex: sex || '',
      Orders: [{
        SpecimenID: specimenId,
        UniversalTestID: obrSegment.fields[4] || '',
        Priority: obrSegment.fields[5] || '',
        CollectionDate: new Date().toISOString().split('T')[0].replace(/-/g, ''),
        CollectionTime: new Date().toTimeString().split(' ')[0].replace(/:/g, ''),
        Results: obxSegments.map(obx => {
          const fields = obx.fields || [];
          return {
            UniversalTestID: fields[3] || '',
            ResultValue: fields[5] || '',
            Unit: fields[6] || '',
            RefRange: fields[5] || '',
            Abnormal: fields[8] || '',
            InstrumentID: this.config.instrument.id
          };
        })
      }]
    };

    this.logger.debug('Transformed HL7 payload:', { specimenId, resultCount: obxSegments.length });
    return payload;
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
      // Backend expects an array of patient results
      const response = await this.httpClient.post(endpoint, [payload]);
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
      this.logger.debug('Heartbeat sent successfully');
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

