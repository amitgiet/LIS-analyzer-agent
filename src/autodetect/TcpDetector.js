const net = require('net');

class TcpDetector {
	constructor(config, logger, consoleOutput) {
		this.config = config;
		this.logger = logger;
		this.console = consoleOutput;
		this.tcpTimeoutMs = config.tcpTimeoutMs || 5000;
		this.maxConcurrent = config.maxConcurrent || 5;
	}

	async scanAllTargets(tcpTargets) {
		if (!Array.isArray(tcpTargets) || tcpTargets.length === 0) {
			return [];
		}

		// Flatten targets into individual { host, port } pairs
		const tasks = [];
		for (const target of tcpTargets) {
			const host = target.host;
			const ports = Array.isArray(target.ports) ? target.ports : [];
			for (const port of ports) {
				tasks.push({ host, port });
			}
		}

		if (tasks.length === 0) {
			return [];
		}

		this.logger.info(`Scanning ${tasks.length} TCP targets`);
		this.console.info(`Scanning ${tasks.length} TCP targets...`);

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
				this.console.info(`🔍 Connecting ${task.host}:${task.port} ...`);
				const promise = this._scanSingleTcp(task.host, task.port)
					.then(detection => ({ task, detection }))
					.catch(error => {
						this.logger.error('TCP scan error', { host: task.host, port: task.port, error: error.message });
						this.console.error(`❌ Error on ${task.host}:${task.port}: ${error.message}`);
						return { task, detection: null };
					});
				active.push(promise);
			}

			// Wait for at least one to complete
			const completed = await Promise.race(active);
			const i = active.indexOf(completed);
			active.splice(i, 1);

			// Check if we found a detection
			if (completed.detection) {
				results.push(completed.detection);
				this.logger.info('TCP instrument detected', completed.detection);
				this.console.success(`✅ ${completed.detection.protocol} detected on ${completed.task.host}:${completed.task.port}${completed.detection.instrument ? ` (${completed.detection.instrument})` : ''}`);
			} else {
				this.console.warn(`⚠️ No response on ${completed.task.host}:${completed.task.port}`);
			}
		}

		return results;
	}

	async _scanSingleTcp(host, port) {
		return new Promise((resolve) => {
			let resolved = false;
			const safeResolve = (val) => { if (!resolved) { resolved = true; resolve(val); } };

			const socket = new net.Socket();
			socket.setTimeout(this.tcpTimeoutMs);

			let buffer = '';

			socket.on('connect', () => {
				// Passive: do not send anything
			});

			socket.on('data', (data) => {
				try {
					buffer += data.toString();
					const detection = this._detectProtocol(buffer);
					if (detection) {
						const detected = {
							type: 'tcp',
							host,
							port,
							protocol: detection.protocol,
							instrument: detection.instrument || null,
							detectedAt: new Date().toISOString(),
							rawSample: detection.rawSample
						};
						socket.destroy();
						safeResolve(detected);
					}
				} catch (e) {
					// ignore and continue collecting
				}
			});

			socket.on('timeout', () => {
				socket.destroy();
				safeResolve(null);
			});

			socket.on('error', () => {
				socket.destroy();
				safeResolve(null);
			});

			socket.on('close', () => {
				safeResolve(null);
			});

			try {
				socket.connect(port, host);
			} catch (e) {
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

module.exports = TcpDetector;

