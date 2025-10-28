const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'LIS Client Agent',
  script: path.join(__dirname, '..', 'src', 'agent.js')
});

svc.on('uninstall', () => {
  console.log('✅ LIS Client Agent service uninstalled successfully!');
  process.exit(0);
});

console.log('Uninstalling LIS Client Agent service...');
svc.uninstall();

