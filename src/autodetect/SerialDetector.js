const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

class SerialDetector {
	constructor(config, logger, consoleOutput) {
		this.config = config;
		this.logger = logger;
		this.console = consoleOutput;
		this.serialBaudRates = config.serialBaudRates || [9600, 19200, 38400];
		this.serialListenMs = config.serialListenMs || 15000;
		this.adaptiveListen = config.adaptiveListen !== false; // default true
		this.maxConcurrent = config.maxConcurrent || 5;
	}

	async scanAllPorts() {
		let ports;
		try {
			ports = await SerialPort.list();
		} catch (error) {
			this.logger.error('Failed to enumerate serial ports', { error: error.message });
			return [];
		}

		if (ports.length === 0) {
			this.logger.info('No serial ports found');
			this.console.info('No serial ports detected.');
			return [];
		}

		this.logger.info(`Scanning ${ports.length} serial ports`);
		this.console.info(`Found ${ports.length} serial ports, scanning...`);

		// Generate all scan tasks (port × baud rate combinations)
		const tasks = [];
		for (const portInfo of ports) {
			const portPath = portInfo.path || portInfo.comName || portInfo.friendlyName || 'UNKNOWN';
			for (const baud of this.serialBaudRates) {
				tasks.push({ port: portPath, baudRate: baud });
			}
		}

		// Process in parallel with concurrency limit
		return await this._scanParallel(tasks);
	}

	async _scanParallel(tasks) {
		const results = [];
		const active = [];
		let index = 0;

		while (index < tasks.length || active.length > 0) {
			// Start new scans up to concurrency limit
			while (active.length < this.maxConcurrent && index < tasks.length) {
				const task = tasks[index++];
				this.console.info(`🔍 Scanning ${task.port} @${task.baudRate}...`);
				const promise = this._scanSinglePort(task.port, task.baudRate)
					.then(detection => ({ task, detection }))
					.catch(error => {
						this.logger.error('Serial scan error', { port: task.port, baudRate: task.baudRate, error: error.message });
						this.console.error(`❌ Error on ${task.port} @${task.baudRate}: ${error.message}`);
						return { task, detection: null };
					});
				active.push(promise);
			}

			// Wait for at least one to complete
			const completed = await Promise.race(active);
			const i = active.indexOf(completed);
			active.splice(i, 1);

			// Check if we found a detection for this port
			if (completed.detection) {
				results.push(completed.detection);
				this.logger.info('Serial instrument detected', completed.detection);
				this.console.success(`✅ ${completed.detection.protocol} detected on ${completed.task.port}${completed.detection.instrument ? ` (${completed.detection.instrument})` : ''}`);
			} else {
				this.console.warn(`⚠️ No response on ${completed.task.port} @${completed.task.baudRate}`);
			}
		}

		return results;
	}

	async _scanSinglePort(portPath, baudRate) {
		let port;
		let parser;
		let timeoutHandle;
		let adaptiveExtensionHandle;
		let hasReceivedData = false;

		return new Promise((resolve) => {
			let resolved = false;
			const safeResolve = (val) => { if (!resolved) { resolved = true; resolve(val); } };

			try {
				port = new SerialPort({
					path: portPath,
					baudRate,
					dataBits: 8,
					parity: 'none',
					stopBits: 1,
					autoOpen: true
				});

				parser = port.pipe(new ReadlineParser({ 
					delimiter: ['\r\n', '\n', '\r'], 
					includeDelimiter: false 
				}));

				let buffer = '';
				const onData = (chunk) => {
					try {
						hasReceivedData = true;
						buffer += chunk.toString();
						const detection = this._detectProtocol(buffer);
						if (detection) {
							const detected = {
								type: 'serial',
								port: portPath,
								baudRate,
								protocol: detection.protocol,
								instrument: detection.instrument || null,
								detectedAt: new Date().toISOString(),
								rawSample: detection.rawSample
							};
							cleanup();
							safeResolve(detected);
						} else if (this.adaptiveListen && hasReceivedData) {
							// Extend timeout by 5s if partial data received
							clearTimeout(timeoutHandle);
							timeoutHandle = setTimeout(() => {
								cleanup();
								safeResolve(null);
							}, 5000);
						}
					} catch (e) {
						// ignore and continue collecting
					}
				};

				const onError = (err) => {
					cleanup();
					safeResolve(null);
				};

				const onClose = () => {
					cleanup();
					safeResolve(null);
				};

				const cleanup = () => {
					clearTimeout(timeoutHandle);
					if (adaptiveExtensionHandle) clearTimeout(adaptiveExtensionHandle);
					if (parser) parser.off('data', onData);
					if (port && port.isOpen) {
						try { port.close(); } catch (e) {}
					}
				};

				parser.on('data', onData);
				port.on('error', onError);
				port.on('close', onClose);

				// Initial timeout
				timeoutHandle = setTimeout(() => {
					cleanup();
					safeResolve(null);
				}, this.serialListenMs);
			} catch (error) {
				// If we fail to open this port attempt, resolve null
				safeResolve(null);
			}
		});
	}

	_detectProtocol(buffer) {
		if (!buffer || buffer.length < 3) return null;
		const head = buffer.substring(0, 512);

		// ASTM: header typically starts with H|^&
		if (head.includes('H|^&') || head.includes('H|\\^&')) {
			const lines = head.split(/\r?\n/);
			const headerLine = lines.find(l => l.startsWith('H|^&') || l.startsWith('H|\\^&')) || lines[0];
			const instrument = this._extractInstrumentFromAstm(headerLine);
			return { protocol: 'ASTM', instrument, rawSample: headerLine.substring(0, 256) };
		}

		// HL7: begins with MSH|^~\&
		if (head.includes('MSH|^~\\&')) {
			const headerLine = head.split(/\r/).find(l => l.startsWith('MSH|^~\\&')) || head;
			const instrument = this._extractInstrumentFromHl7(headerLine);
			return { protocol: 'HL7', instrument, rawSample: headerLine.substring(0, 256) };
		}

		return null;
	}

	_extractInstrumentFromAstm(headerLine) {
		try {
			const parts = headerLine.split('|');
			return (parts[4] || parts[3] || '').trim() || null;
		} catch (e) {
			return null;
		}
	}

	_extractInstrumentFromHl7(mshLine) {
		try {
			const parts = mshLine.split('|');
			return (parts[2] || parts[3] || '').trim() || null;
		} catch (e) {
			return null;
		}
	}
}

module.exports = SerialDetector;

