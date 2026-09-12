/**
 * SharedTokenCache model
 *
 * Stores gateway-issued bearer tokens so they survive server restarts
 * and can be shared across multiple processes/instances.
 *
 * One row per `service_key` (e.g. 'ndia5', '7pay').
 * On ?force=true or natural expiry, the row is UPSERTED (old replaced).
 */
const Sequelize = require('sequelize');
const db = require('../config/database');

const SharedTokenCache = db.define('SharedTokenCache', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER,
  },
  service_key: {
    type: Sequelize.STRING(50),
    allowNull: false,
    unique: true,
    comment: 'Identifier for the service (e.g. ndia5, 7pay)',
  },
  token: {
    type: Sequelize.TEXT,
    allowNull: false,
    comment: 'Raw bearer token returned by the gateway',
  },
  expires_at: {
    type: Sequelize.DATE,
    allowNull: false,
    comment: 'Timestamp when this token expires (set by us, ~23h TTL)',
  },
  fetched_at: {
    type: Sequelize.DATE,
    allowNull: false,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    comment: 'Timestamp when this token was last fetched from the gateway',
  },
  source: {
    type: Sequelize.STRING(20),
    allowNull: true,
    comment: 'How it was fetched: live | force_refresh',
  },
}, {
  tableName: 'shared_token_cache',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
});

module.exports = SharedTokenCache;
