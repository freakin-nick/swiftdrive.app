'use strict';
const { q } = require('./db');
const sse = require('./sse');

/** Persist a notification and push it live to the user's open app. */
function notify(userId, title, body, type = 'info', data = {}) {
  if (!userId) return;
  const id = q.insert('notifications', { user_id: userId, title, body, type, data: JSON.stringify(data), created_at: Date.now() });
  sse.emit(userId, 'notification', { id, title, body, type, data });
}
/** Tell a user's apps to refresh a ride/order (carries the new status for animations). */
function push(userId, event, data) { if (userId) sse.emit(userId, event, data); }

module.exports = { notify, push };
