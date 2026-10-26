'use strict';
const http = require('http');
const config = require('./config');
require('./db');
const { handler } = require('./http');
require('./routes/auth'); require('./routes/public'); require('./routes/billing'); require('./routes/rides');
require('./routes/orders'); require('./routes/vendor'); require('./routes/social'); require('./routes/admin');
const dispatch = require('./dispatch');
require('./seed').ensureBase();
require('./demo');
const paystack = require('./paystack');

const server = http.createServer(handler);
server.listen(config.port, () => {
  dispatch.resume();
  console.log(`\n  RiderGo running at ${config.appUrl}`);
  console.log(`  Paystack: ${paystack.live() ? 'LIVE keys detected' : 'MOCK mode (set PAYSTACK_SECRET_KEY in .env for real payments)'}`);
  if (config.jwtSecret.startsWith('dev-only')) console.log('  ! Set JWT_SECRET in .env before deploying\n');
});
module.exports = server;
