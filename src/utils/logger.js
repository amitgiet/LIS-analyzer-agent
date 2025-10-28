const fs = require('fs');
const path = require('path');
const winston = require('winston');

function ensureDirectoryFor(filePath) {
	try {
		const dir = path.dirname(filePath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
	} catch (error) {
		// If we can't create the directory, fallback to console-only logging
		// Do not throw to avoid crashing critical processes
	}
}

function createLogger(options = {}) {
	const {
		level = 'info',
		logFile = path.join(process.cwd(), 'logs', 'autodetect.log'),
		maxSize = '10m',
		maxFiles = 5,
		serviceName = 'LIS-Autodetect'
	} = options;

	ensureDirectoryFor(logFile);

	const logger = winston.createLogger({
		level,
		format: winston.format.combine(
			winston.format.timestamp(),
			winston.format.errors({ stack: true }),
			winston.format.splat(),
			winston.format.json()
		),
		defaultMeta: { service: serviceName },
		transports: [
			new winston.transports.File({ filename: logFile, maxsize: maxSize, maxFiles })
		]
	});

	// Always add console in development and when running interactively
	logger.add(new winston.transports.Console({
		format: winston.format.combine(
			winston.format.colorize(),
			winston.format.printf(({ level, message, timestamp, ...meta }) => {
				const base = `${timestamp} [${serviceName}] ${level}: ${message}`;
				const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
				return base + rest;
			})
		)
	}));

	return logger;
}

module.exports = {
	createLogger
};
