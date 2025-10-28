const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { createLogger } = require('../utils/logger');
const SerialDetector = require('./SerialDetector');
const TcpDetector = require('./TcpDetector');

class AutoDetectionManager {
	constructor(config = {}, logger = null) {
		this.config = config || {};
		this.logger = logger || createLogger({ logFile: path.join(process.cwd(), 'logs', 'autodetect.log') });
		this.results = [];

		// Defaults with overrides from config
		const autodetectCfg = (config.autodetect || {});
		this.autodetectConfig = {
			serialBaudRates: autodetectCfg.serialBaudRates || [9600, 19200, 38400],
			serialListenMs: autodetectCfg.serialListenMs || 15000,
			adaptiveListen: autodetectCfg.adaptiveListen !== false, // default true
			tcpTimeoutMs: autodetectCfg.tcpTimeoutMs || 5000,
			maxConcurrent: autodetectCfg.maxConcurrent || 5,
			tcpTargets: autodetectCfg.tcpTargets || []
		};
		this.outputFile = path.join(process.cwd(), 'data', 'detected_devices.json');

		// Console output wrapper
		this.console = {
			info: (msg) => console.log(chalk.cyan(msg)),
			success: (msg) => console.log(chalk.green(msg)),
			warn: (msg) => console.log(chalk.yellow(msg)),
			error: (msg) => console.log(chalk.red(msg))
		};
	}

	async scanSerialPorts() {
		const detector = new SerialDetector(this.autodetectConfig, this.logger, this.console);
		return await detector.scanAllPorts();
	}

	async scanTcpConnections() {
		const detector = new TcpDetector(this.autodetectConfig, this.logger, this.console);
		return await detector.scanAllTargets(this.autodetectConfig.tcpTargets);
	}

	async runFullScan() {
		this.results = [];
		this.logger.info('Starting parallel auto-detection scan');
		this.console.info(chalk.bold('\n=== LIS Analyzer Auto-Detection Started (Parallel Mode) ==='));

		// Run both scans in parallel
		const [serialResults, tcpResults] = await Promise.allSettled([
			this.scanSerialPorts(),
			this.scanTcpConnections()
		]);

		this.results.push(...(serialResults.status === 'fulfilled' ? serialResults.value : []));
		this.results.push(...(tcpResults.status === 'fulfilled' ? tcpResults.value : []));

		await this._saveResults();

		this.logger.info('Auto-detection completed', { 
			totalDetections: this.results.length,
			serialCount: serialResults.status === 'fulfilled' ? serialResults.value.length : 0,
			tcpCount: tcpResults.status === 'fulfilled' ? tcpResults.value.length : 0
		});
		this.console.info(chalk.bold('=== Auto-Detection Completed ===\n'));
		return this.results;
	}

	async _saveResults() {
		try {
			const outPath = this.outputFile;
			const outDir = path.dirname(outPath);
			if (!fs.existsSync(outDir)) {
				fs.mkdirSync(outDir, { recursive: true });
			}

			// Load existing results to append (no overwrite)
			let existing = [];
			if (fs.existsSync(outPath)) {
				try {
					existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
					if (!Array.isArray(existing)) existing = [];
				} catch (e) {
					existing = [];
				}
			}

			const merged = [...existing, ...this.results];
			fs.writeFileSync(outPath, JSON.stringify(merged, null, 2), 'utf8');
			this.logger.info('Detection results saved', { file: outPath, count: merged.length });
		} catch (error) {
			this.logger.error('Failed to save detection results', { error: error.message });
		}
	}
}

// CLI support
if (require.main === module) {
	(async () => {
		const configPath = path.join(__dirname, '..', '..', 'config', 'default.json');
		let config = {};
		try {
			config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
		} catch (e) {
			// ignore, use defaults
		}
		const mgr = new AutoDetectionManager(config);
		await mgr.runFullScan();
		process.exit(0);
	})();
}

module.exports = AutoDetectionManager;
