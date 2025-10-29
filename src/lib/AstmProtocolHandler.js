const EventEmitter = require('events');

/**
 * ASTM Protocol Handler - Handles low-level ASTM protocol communication
 * Based on enhancements from astm_general-master
 * 
 * Protocol Control Characters:
 * ENQ (0x05) - Enquiry - Start of transmission
 * ACK (0x06) - Acknowledge - Message received correctly
 * NAK (0x15) - Negative Acknowledge - Message error, request retransmission
 * STX (0x02) - Start of Text - Start of frame
 * ETX (0x03) - End of Text - End of frame
 * ETB (0x17) - End of Transmission Block - End of intermediate frame
 * CR (0x0D) - Carriage Return
 * LF (0x0A) - Line Feed
 * EOT (0x04) - End of Transmission - End of entire message
 */
class AstmProtocolHandler extends EventEmitter {
  constructor(logger, options = {}) {
    super();
    this.logger = logger;
    this.alarmTime = options.alarmTime || 10000; // 10 seconds timeout
    this.nextExpectedFrameNumber = 1; // First frame after ENQ-STX is always 1 (not 0)
    this.currentFrameNumber = null;
    this.messageBuffer = Buffer.alloc(0);
    this.currentMessage = '';
    this.isReceivingMessage = false;
    this.checksum = 0;
    this.receivedChecksum = '';
    this.expectingChecksum = false;
    this.timeoutTimer = null;
    
    // Control characters
    this.ENQ = 0x05;
    this.ACK = 0x06;
    this.NAK = 0x15;
    this.STX = 0x02;
    this.ETX = 0x03;
    this.ETB = 0x17;
    this.CR = 0x0D;
    this.LF = 0x0A;
    this.EOT = 0x04;
  }

  /**
   * Process incoming byte from instrument
   * Returns response byte (ACK/NAK) or null if no response needed
   */
  processByte(byte) {
    const byteValue = Buffer.isBuffer(byte) ? byte[0] : byte.charCodeAt(0);
    
    try {
      // Reset timeout on any byte received
      this.resetTimeout();

      switch (byteValue) {
        case this.ENQ:
          return this.handleENQ();
        
        case this.STX:
          return this.handleSTX();
        
        case this.ETX:
          return this.handleETX();
        
        case this.ETB:
          return this.handleETB();
        
        case this.CR:
          this.handleCR(byteValue);
          break;
        
        case this.LF:
          return this.handleLF();
        
        case this.EOT:
          return this.handleEOT();
        
        default:
          this.handleDataByte(byteValue);
          break;
      }
    } catch (error) {
      this.logger.error('Error processing byte:', error);
      this.resetState();
      return Buffer.from([this.NAK]);
    }
    
    return null;
  }

  /**
   * Handle ENQ - Start of new message transmission
   */
  handleENQ() {
    this.logger.debug('ENQ received - Starting new message');
    this.resetState();
    this.isReceivingMessage = true;
    this.nextExpectedFrameNumber = 1;
    this.startTimeout();
    return Buffer.from([this.ACK]); // Send ACK
  }

  /**
   * Handle STX - Start of frame
   */
  handleSTX() {
    this.logger.debug('STX received');
    this.checksum = 0; // Reset checksum (STX is not included in checksum)
    this.currentFrameNumber = null;
    this.expectingChecksum = false;
    this.receivedChecksum = '';
  }

  /**
   * Handle ETX - End of frame (last frame)
   */
  handleETX() {
    this.logger.debug('ETX received');
    this.checksum = (this.checksum + this.ETX) % 256; // ETX is included in checksum
    this.expectingChecksum = true;
    this.logger.debug(`Calculated checksum: ${this.checksum.toString(16).toUpperCase().padStart(2, '0')}`);
    return null; // Wait for checksum bytes
  }

  /**
   * Handle ETB - End of transmission block (intermediate frame)
   */
  handleETB() {
    this.logger.debug('ETB received - End of intermediate frame');
    this.checksum = (this.checksum + this.ETB) % 256; // ETB is included in checksum
    this.expectingChecksum = true;
    this.logger.debug(`Calculated checksum: ${this.checksum.toString(16).toUpperCase().padStart(2, '0')}`);
    return null; // Wait for checksum bytes
  }

  /**
   * Handle CR - Carriage return
   */
  handleCR(byteValue) {
    this.checksum = (this.checksum + this.CR) % 256;
    if (!this.expectingChecksum) {
      // CR is part of data if we're not expecting checksum
      this.messageBuffer = Buffer.concat([this.messageBuffer, Buffer.from([this.CR])]);
    }
  }

  /**
   * Handle LF - Line feed (expecting ACK response)
   */
  handleLF() {
    this.logger.debug('LF received');
    this.resetTimeout(); // Reset timeout as we're responding
    
    // If we just received checksum, validate it
    if (this.expectingChecksum && this.receivedChecksum.length === 2) {
      const checksumValid = this.validateChecksum();
      
      if (!checksumValid) {
        this.logger.warn('Checksum validation failed - sending NAK');
        this.resetState();
        return Buffer.from([this.NAK]);
      }
      
      this.logger.debug('Checksum validated successfully');
      
      // If this was ETX (last frame), mark message as complete
      // Otherwise, we continue receiving more frames
      if (this.messageBuffer.includes(Buffer.from([this.ETX]))) {
        // This was the last frame
      } else {
        // More frames coming
        this.nextExpectedFrameNumber++;
        if (this.nextExpectedFrameNumber > 7) {
          this.nextExpectedFrameNumber = 0;
        }
      }
    }
    
    this.expectingChecksum = false;
    return Buffer.from([this.ACK]); // Send ACK
  }

  /**
   * Handle EOT - End of transmission
   */
  handleEOT() {
    this.logger.debug('EOT received - Message complete');
    this.resetTimeout();
    
    // Validate final checksum if we were expecting one
    if (this.expectingChecksum && this.receivedChecksum.length === 2) {
      const checksumValid = this.validateChecksum();
      if (!checksumValid) {
        this.logger.warn('Final checksum validation failed');
        this.resetState();
        return Buffer.from([this.NAK]);
      }
    }
    
    // Complete message received
    const completeMessage = this.messageBuffer.toString();
    this.emit('message', completeMessage);
    
    this.resetState();
    return Buffer.from([this.ACK]); // Send ACK
  }

  /**
   * Handle data byte
   */
  handleDataByte(byteValue) {
    // Check if this is a frame number (byte after STX should be a digit 0-7)
    if (this.currentFrameNumber === null && this.messageBuffer.length === 0) {
      // We might have just received STX, check if this is frame number
      const char = String.fromCharCode(byteValue);
      if (/^[0-7]$/.test(char)) {
        const frameNumber = parseInt(char, 10);
        if (frameNumber === this.nextExpectedFrameNumber) {
          this.currentFrameNumber = frameNumber;
          this.logger.debug(`Frame number ${frameNumber} received (expected)`);
          // Frame number is NOT included in checksum, so don't add it
          return; // Don't add to message buffer
        } else {
          this.logger.warn(
            `Unexpected frame number: ${frameNumber}, expected: ${this.nextExpectedFrameNumber}`
          );
          // Continue anyway, but log warning
          this.currentFrameNumber = frameNumber;
          return; // Still don't add to message buffer
        }
      }
    }

    // Handle checksum bytes (2 hex digits after ETX/ETB)
    if (this.expectingChecksum) {
      const char = String.fromCharCode(byteValue);
      if (/^[0-9A-Fa-f]$/.test(char)) {
        this.receivedChecksum += char.toUpperCase();
        if (this.receivedChecksum.length === 2) {
          // Both checksum bytes received, will be validated on LF
          this.logger.debug(`Received checksum: ${this.receivedChecksum}`);
        }
      } else {
        this.logger.warn(`Invalid checksum character: ${char}`);
        this.expectingChecksum = false;
      }
      return; // Don't add checksum to message buffer
    }

    // Regular data byte - add to checksum and buffer
    this.checksum = (this.checksum + byteValue) % 256;
    this.messageBuffer = Buffer.concat([this.messageBuffer, Buffer.from([byteValue])]);
    this.currentFrameNumber = null; // Reset after first byte after STX
  }

  /**
   * Validate checksum
   */
  validateChecksum() {
    const calculated = this.checksum.toString(16).toUpperCase().padStart(2, '0');
    const received = this.receivedChecksum.toUpperCase();
    
    const isValid = calculated === received;
    
    if (!isValid) {
      this.logger.warn(
        `Checksum mismatch: calculated=${calculated}, received=${received}`
      );
    }
    
    return isValid;
  }

  /**
   * Start timeout alarm
   */
  startTimeout() {
    this.resetTimeout();
    this.timeoutTimer = setTimeout(() => {
      this.logger.warn('Timeout: No response received from instrument in expected time');
      this.handleTimeout();
    }, this.alarmTime);
  }

  /**
   * Reset timeout alarm
   */
  resetTimeout() {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  /**
   * Handle timeout - message incomplete
   */
  handleTimeout() {
    this.logger.warn('Message timeout - data may be incomplete');
    this.emit('timeout', this.messageBuffer.toString());
    this.resetState();
  }

  /**
   * Reset state for new message
   */
  resetState() {
    this.messageBuffer = Buffer.alloc(0);
    this.checksum = 0;
    this.receivedChecksum = '';
    this.expectingChecksum = false;
    this.isReceivingMessage = false;
    this.currentFrameNumber = null;
    this.nextExpectedFrameNumber = 1;
    this.resetTimeout();
  }

  /**
   * Send ACK manually (for external use)
   */
  sendACK() {
    return Buffer.from([this.ACK]);
  }

  /**
   * Send NAK manually (for external use)
   */
  sendNAK() {
    return Buffer.from([this.NAK]);
  }

  /**
   * Check if currently receiving a message
   */
  isReceiving() {
    return this.isReceivingMessage;
  }
}

module.exports = AstmProtocolHandler;

