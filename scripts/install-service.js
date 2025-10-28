const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'LIS Client Agent',
  description: 'Laboratory Information System Client Agent - Forwards instrument data to central LIS server',
  script: path.join(__dirname, '..', 'src', 'agent.js'),
  nodeOptions: [
    '--harmony',
    '--max_old_space_size=4096'
  ]
});

svc.on('install', () => {
  console.log('✅ LIS Client Agent service installed successfully!');
  console.log('Starting service...');
  svc.start();
});

svc.on('start', () => {
  console.log('✅ Service started successfully!');
  console.log('Service is running. Check logs at ./logs/agent.log');
});

svc.on('error', (err) => {
  console.error('Service error:', err);
});

console.log('Installing LIS Client Agent as Windows Service...');
svc.install();

