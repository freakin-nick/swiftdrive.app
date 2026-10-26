'use strict';
// Server-Sent Events hub: realtime push to a user's open apps (no dependencies).
const clients = new Map(); // userId -> Set<res>

function add(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
  res.on('close', () => { const s = clients.get(userId); if (s) { s.delete(res); if (!s.size) clients.delete(userId); } });
}
function emit(userId, event, data = {}) {
  const s = clients.get(userId);
  if (!s) return false;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of s) { try { res.write(msg); } catch {} }
  return true;
}
const isOnline = (userId) => clients.has(userId);
setInterval(() => { for (const s of clients.values()) for (const r of s) { try { r.write(': ping\n\n'); } catch {} } }, 25000).unref();

module.exports = { add, emit, isOnline };
