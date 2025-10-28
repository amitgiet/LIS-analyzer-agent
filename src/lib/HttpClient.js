const axios = require('axios');
const https = require('https');

class HttpClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.baseURL = config.server.url;
    this.apiKey = config.security.apiKey;
    this.timeout = config.server.timeout || 30000;

    // Setup axios instance with default config
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'LIS-Client-Agent/1.0'
      },
      validateStatus: (status) => status < 500, // Don't throw on 4xx
    });

    // Add API key if configured
    if (this.apiKey) {
      this.client.defaults.headers.common['Authorization'] = `Bearer ${this.apiKey}`;
    }

    // Setup SSL verification
    if (!config.security.verifySsl) {
      https.globalAgent.options.rejectUnauthorized = false;
    }

    // Request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        this.logger.debug('HTTP request:', {
          method: config.method,
          url: config.url,
          baseURL: config.baseURL
        });
        return config;
      },
      (error) => {
        this.logger.error('HTTP request error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        this.logger.debug('HTTP response:', {
          status: response.status,
          url: response.config.url
        });
        return response;
      },
      (error) => {
        this.logger.error('HTTP response error:', {
          message: error.message,
          code: error.code,
          status: error.response?.status
        });
        return Promise.reject(error);
      }
    );
  }

  async get(endpoint, config = {}) {
    try {
      const response = await this.client.get(endpoint, config);
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async post(endpoint, data, config = {}) {
    try {
      const response = await this.client.post(endpoint, data, config);
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async put(endpoint, data, config = {}) {
    try {
      const response = await this.client.put(endpoint, data, config);
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async delete(endpoint, config = {}) {
    try {
      const response = await this.client.delete(endpoint, config);
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  handleError(error) {
    if (error.response) {
      // Server responded with error status
      const errorMessage = {
        status: error.response.status,
        statusText: error.response.statusText,
        message: error.response.data?.message || 'Server error',
        url: error.config.url
      };
      return new Error(JSON.stringify(errorMessage));
    } else if (error.request) {
      // Request made but no response
      return new Error('No response from server. Network error or server unreachable.');
    } else {
      // Error in request setup
      return error;
    }
  }

  isServerReachable() {
    return this.client.get('/health')
      .then(() => true)
      .catch(() => false);
  }
}

module.exports = HttpClient;

