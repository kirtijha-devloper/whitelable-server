/**
 * DirectLoginToken model
 *
 * Stores a hashed, short-lived token that allows an authenticated admin
 * to impersonate (direct-login as) any merchant or franchisee.
 *
 * One active token per admin at any time.
 * Re-generating invalidates the previous token immediately.
 *
 * used_user_ids – JSON array of target user IDs already logged-in via this
 * token.  Prevents the same (token, user_id) pair being replayed multiple
 * times (e.g. double-click, page-reload on the target tab).
 */
const Sequelize = require('sequelize');
const db = require('../config/database');

const DirectLoginToken = db.define('DirectLoginToken', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER
  },
  admin_id: {
    type: Sequelize.INTEGER,
    allowNull: false,
    comment: 'User.id of the admin who owns this token'
  },
  token_hash: {
    type: Sequelize.STRING(64),
    allowNull: false,
    unique: true,
    comment: 'SHA-256 hex digest of the raw random token'
  },
  expires_at: {
    type: Sequelize.DATE,
    allowNull: false,
    comment: 'Hard expiry – token is rejected after this timestamp'
  },
  used_user_ids: {
    type: Sequelize.TEXT,
    allowNull: true,
    defaultValue: '[]',
    comment: 'JSON array of target user IDs already consumed via this token'
  },
  createdAt: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
  },
  updatedAt: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
  }
}, {
  timestamps: true,
  tableName: 'DirectLoginTokens',
  indexes: [
    { fields: ['admin_id'] },
    { fields: ['token_hash'] },
    { fields: ['expires_at'] }
  ]
});

module.exports = DirectLoginToken;
