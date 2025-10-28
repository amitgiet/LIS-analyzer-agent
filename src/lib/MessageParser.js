class MessageParser {
  constructor(logger) {
    this.logger = logger;
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
    // ASTM messages typically start with STX (0x02) or have specific record types (H, P, O, R, L)
    return message.startsWith('\x02') || 
           /^[H|P|O|R|L]\|/.test(message.trim());
  }

  isHL7(message) {
    // HL7 messages start with MSH segment or are wrapped in MLLP (VT/FS)
    return message.trim().startsWith('MSH') || 
           message.includes('\x0B') && message.includes('\x1C');
  }

  parseASTM(rawMessage) {
    try {
      // Remove STX/ETX wrappers
      let message = rawMessage;
      if (message.startsWith('\x02')) {
        message = message.substring(1);
      }
      if (message.endsWith('\x03')) {
        message = message.substring(0, message.length - 1);
      }

      const lines = message.split(/\r?\n/).filter(line => line.trim());
      const records = [];

      for (const line of lines) {
        if (line.length < 4 || line[0] !== '|') continue;
        
        const recordType = line[1];
        const fields = line.split('|');
        
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

