class Heartbeat {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.interval = config.heartbeat.intervalMs || 60000;
    this.timer = null;
    this.callback = null;
  }

  start(callback) {
    this.callback = callback;
    
    // Send first heartbeat immediately
    this.sendHeartbeat();

    // Then send periodically
    this.timer = setInterval(() => {
      this.sendHeartbeat();
    }, this.interval);

    this.logger.info(`Heartbeat started (interval: ${this.interval}ms)`);
  }

  async sendHeartbeat() {
    if (this.callback) {
      try {
        await this.callback();
        this.logger.debug('Heartbeat sent');
      } catch (error) {
        this.logger.debug('Heartbeat failed:', error.message);
      }
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info('Heartbeat stopped');
    }
  }
}

module.exports = Heartbeat;

