const fs = require('fs');
const path = require('path');

class QueueManager {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.queueFile = config.queue.file;
    this.maxSize = config.queue.maxSize || 1000;
    this.queue = [];
    this.isProcessing = false;
    this.processInterval = null;
    
    this.loadQueue();
  }

  loadQueue() {
    try {
      const queueDir = path.dirname(this.queueFile);
      if (!fs.existsSync(queueDir)) {
        fs.mkdirSync(queueDir, { recursive: true });
      }

      if (fs.existsSync(this.queueFile)) {
        const data = fs.readFileSync(this.queueFile, 'utf8');
        this.queue = JSON.parse(data);
        this.logger.info(`Loaded ${this.queue.length} items from queue`);
      }
    } catch (error) {
      this.logger.error('Failed to load queue:', error);
      this.queue = [];
    }
  }

  saveQueue() {
    try {
      const queueDir = path.dirname(this.queueFile);
      if (!fs.existsSync(queueDir)) {
        fs.mkdirSync(queueDir, { recursive: true });
      }
      fs.writeFileSync(this.queueFile, JSON.stringify(this.queue, null, 2));
    } catch (error) {
      this.logger.error('Failed to save queue:', error);
    }
  }

  add(item) {
    if (this.queue.length >= this.maxSize) {
      this.logger.warn('Queue full, dropping oldest item');
      this.queue.shift();
    }

    this.queue.push({
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      attempts: 0,
      data: item
    });

    this.saveQueue();
    this.logger.debug(`Added item to queue. Queue size: ${this.queue.length}`);
  }

  size() {
    return this.queue.length;
  }

  async start(sendFn) {
    if (this.processInterval) return;

    this.sendFn = sendFn;
    this.processInterval = setInterval(async () => {
      await this.process();
    }, 5000); // Process queue every 5 seconds

    this.logger.info('Queue processor started');
  }

  async process() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      const failed = [];

      while (this.queue.length > 0) {
        const item = this.queue[0];

        try {
          this.logger.debug(`Processing queued item: ${item.id}`);
          const success = await this.sendFn(item.data);

          if (success) {
            this.queue.shift(); // Remove from queue on success
            this.logger.debug(`Item ${item.id} sent successfully`);
          } else {
            item.attempts++;
            
            if (item.attempts >= this.config.retry.maxRetries) {
              this.logger.error(`Item ${item.id} exceeded max retries`);
              this.queue.shift();
            } else {
              // Move to end of queue for retry
              this.queue.shift();
              this.queue.push(item);
            }
          }
        } catch (error) {
          item.attempts++;
          this.logger.error(`Error processing item ${item.id}:`, error);

          if (item.attempts >= this.config.retry.maxRetries) {
            this.queue.shift();
          } else {
            this.queue.shift();
            this.queue.push(item);
          }
        }

        // Delay between items to avoid overwhelming server
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (this.queue.length > 0) {
        this.saveQueue();
      }
    } finally {
      this.isProcessing = false;
    }
  }

  stop() {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
      this.logger.info('Queue processor stopped');
    }
    this.saveQueue();
  }

  clear() {
    this.queue = [];
    this.saveQueue();
    this.logger.info('Queue cleared');
  }
}

module.exports = QueueManager;

