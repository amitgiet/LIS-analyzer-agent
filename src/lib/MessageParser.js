class MessageParser {
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * Calculate ASTM checksum for a buffer
   * Checksum includes all bytes from STX (not including STX) to ETX/ETB
   * @param {Buffer} data - Buffer containing ASTM frame data
   * @returns {number} Checksum value (0-255)
   */
  calculateChecksum(data) {
    let checksum = 0;
    let startCounting = false;
    
    for (const byte of data) {
      if (byte === 0x02) { // STX
        startCounting = true;
        continue; // STX is NOT included in checksum
      }
      
      if (startCounting) {
        checksum = (checksum + byte) % 256;
      }
      
      if (byte === 0x03 || byte === 0x17) { // ETX or ETB
        startCounting = false;
        // ETX/ETB ARE included in checksum
      }
    }
    
    return checksum;
  }

  /**
   * Validate checksum in ASTM message
   * @param {string} message - Complete ASTM message
   * @returns {boolean} True if checksum is valid
   */
  validateASTMChecksum(message) {
    try {
      // Extract checksum from message (2 hex digits after ETX/ETB, before CR)
      // Format: ...ETX<checksum>CRLF
      const etxIndex = message.lastIndexOf('\x03');
      const etbIndex = message.lastIndexOf('\x17');
      
      let frameEndIndex = -1;
      if (etxIndex > etbIndex) {
        frameEndIndex = etxIndex;
      } else if (etbIndex > -1) {
        frameEndIndex = etbIndex;
      }
      
      if (frameEndIndex === -1) {
        this.logger.warn('No ETX or ETB found in message');
        return false;
      }
      
      // Extract checksum (2 hex characters after ETX/ETB)
      const checksumStart = frameEndIndex + 1;
      const checksumEnd = checksumStart + 2;
      
      if (checksumEnd > message.length) {
        this.logger.warn('Checksum not found in message');
        return false;
      }
      
      const receivedChecksum = message.substring(checksumStart, checksumEnd).toUpperCase();
      
      // Calculate checksum for the frame
      const frameData = Buffer.from(message.substring(0, frameEndIndex + 1), 'binary');
      const calculatedChecksum = this.calculateChecksum(frameData);
      const calculatedHex = calculatedChecksum.toString(16).toUpperCase().padStart(2, '0');
      
      const isValid = calculatedHex === receivedChecksum;
      
      if (!isValid) {
        this.logger.warn(
          `ASTM checksum mismatch: calculated=${calculatedHex}, received=${receivedChecksum}`
        );
      }
      
      return isValid;
    } catch (error) {
      this.logger.error('Error validating ASTM checksum:', error);
      return false;
    }
  }

  parse(rawMessage) {
    try {
      // Detect message format
      if (this.isASTM(rawMessage)) {
        return this.parseASTM(rawMessage);
      } else if (this.isHL7(rawMessage)) {
        return this.parseHL7(rawMessage);
      } else {
        this.logger.warn('Unknown message format');
        return null;
      }
    } catch (error) {
      this.logger.error('Error parsing message:', error);
      return null;
    }
  }

  isASTM(message) {
    // ASTM messages typically start with STX (0x02) or with record types H|, P|, O|, R|, L|
    return message.startsWith('\x02') || 
           /^[HPORL]\|/.test(message.trim());
  }

  isHL7(message) {
    // HL7 messages start with MSH segment or are wrapped in MLLP (VT/FS)
    return message.trim().startsWith('MSH') || 
           message.includes('\x0B') && message.includes('\x1C');
  }

  parseASTM(rawMessage) {
    try {
      // Validate checksum if present
      const hasChecksum = rawMessage.includes('\x03') || rawMessage.includes('\x17');
      if (hasChecksum && !this.validateASTMChecksum(rawMessage)) {
        this.logger.warn('ASTM message checksum validation failed');
        // Continue parsing anyway, but log warning
      }

      // Remove STX/ETX wrappers
      let message = rawMessage;
      if (message.startsWith('\x02')) {
        message = message.substring(1);
      }
      if (message.endsWith('\x03')) {
        message = message.substring(0, message.length - 1);
      }

      // Remove checksum (2 hex digits after ETX/ETB and before CR)
      // This is already handled in validation, but clean it up for parsing
      message = message.replace(/\x03[0-9A-Fa-f]{2}\x0D/g, '\x03\x0D');
      message = message.replace(/\x17[0-9A-Fa-f]{2}\x0D/g, '\x17\x0D');

      // ASTM messages use \r (carriage return) as line separator
      const lines = message.split(/\r/).filter(line => line.trim());
      const records = [];
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length < 2) continue;
        
        const fields = trimmed.split('|');
        
        // Extract record type from the first field
        // Format can be "1H|..." (sequence + record type) or "P|..." (just record type)
        let recordType;
        const firstField = fields[0];
        
        if (/^\d+[HPORL]$/.test(firstField)) {
          // Case: "1H", "2P", etc. - extract the letter
          recordType = firstField.charAt(firstField.length - 1);
        } else if (/^[HPORL]$/.test(firstField)) {
          // Case: "H", "P", "O", "R", "L" - use as is
          recordType = firstField;
        } else {
          // Unknown format
          this.logger.warn(`Cannot identify record type from: ${firstField}`);
          recordType = firstField;
        }
        
        switch(recordType) {
          case 'H': // Header
            records.push(this.parseASTMHeader(fields));
            break;
          case 'P': // Patient
            records.push(this.parseASTMPatient(fields));
            break;
          case 'O': // Order
            records.push(this.parseASTMOrder(fields));
            break;
          case 'R': // Result
            records.push(this.parseASTMResult(fields));
            break;
          case 'L': // Terminator
            records.push(this.parseASTMTerminator(fields));
            break;
          default:
            this.logger.warn(`Unknown record type: ${recordType}`);
        }
      }

      return {
        recordType: 'ASTM',
        records: records,
        sampleId: this.extractSampleId(records),
        results: this.extractResults(records)
      };
    } catch (error) {
      this.logger.error('ASTM parsing error:', error);
      return null;
    }
  }

  parseASTMHeader(fields) {
    return {
      type: 'header',
      sendingApp: fields[3],
      sendingFacility: fields[4] || '',
      receivingApp: fields[5] || '',
      timestamp: fields[12] || ''
    };
  }

  parseASTMPatient(fields) {
    return {
      type: 'patient',
      sequence: fields[1] || '',
      practiceId: fields[2] || '',
      labId: fields[3] || '',
      patientId: fields[4] || '',
      name: fields[5] || '',
      dob: fields[7] || '',
      sex: fields[8] || ''
    };
  }

  parseASTMOrder(fields) {
    return {
      type: 'order',
      sequence: fields[1] || '',
      specimenId: fields[2] || '',
      testId: fields[3] || '',
      priority: fields[4] || ''
    };
  }

  parseASTMResult(fields) {
    return {
      type: 'result',
      sequence: fields[1] || '',
      testId: fields[2] || '',
      value: fields[3] || '',
      unit: fields[4] || '',
      referenceRange: fields[5] || '',
      flag: fields[6] || ''
    };
  }

  parseASTMTerminator(fields) {
    return {
      type: 'terminator',
      sequence: fields[1] || '',
      status: fields[2] || ''
    };
  }

  parseHL7(rawMessage) {
    try {
      // Remove MLLP wrappers if present
      let message = rawMessage;
      if (message.includes('\x0B') && message.includes('\x1C')) {
        const startIdx = message.indexOf('\x0B');
        const endIdx = message.indexOf('\x1C');
        message = message.substring(startIdx + 1, endIdx);
      }

      const segments = message.split('\r').filter(s => s.trim());
      const parsed = {
        recordType: 'HL7',
        segments: []
      };

      for (const segment of segments) {
        const fields = segment.split('|');
        const segmentType = fields[0];

        parsed.segments.push({
          type: segmentType,
          fields: fields
        });
      }

      // Extract sample ID from OBR segment
      const obrSegment = parsed.segments.find(s => s.type === 'OBR');
      if (obrSegment && obrSegment.fields.length > 3) {
        parsed.sampleId = obrSegment.fields[3];
      }

      // Extract results from OBX segments
      const obxSegments = parsed.segments.filter(s => s.type === 'OBX');
      parsed.results = obxSegments.map(seg => ({
        testCode: seg.fields[3] || '',
        value: seg.fields[5] || '',
        unit: seg.fields[6] || '',
        flag: seg.fields[8] || ''
      }));

      return parsed;
    } catch (error) {
      this.logger.error('HL7 parsing error:', error);
      return null;
    }
  }

  extractSampleId(records) {
    // Try to find specimen ID from order record
    const orderRecord = records.find(r => r.type === 'order');
    if (orderRecord && orderRecord.specimenId) {
      return orderRecord.specimenId;
    }

    // Try patient ID
    const patientRecord = records.find(r => r.type === 'patient');
    if (patientRecord && patientRecord.practiceId) {
      return patientRecord.practiceId;
    }

    return null;
  }

  extractResults(records) {
    const results = records.filter(r => r.type === 'result');
    return results.map(r => ({
      testCode: r.testId || '',
      value: r.value || '',
      unit: r.unit || '',
      referenceRange: r.referenceRange || '',
      flag: r.flag || ''
    }));
  }
}

module.exports = MessageParser;

