const Sequelize = require('sequelize');
const db = require('../config/database');

const PgTransaction = db.define('PgTransaction', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER,
  },
  user_id: {
    type: Sequelize.INTEGER,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id',
    },
  },
  company_id: {
    type: Sequelize.STRING,
    allowNull: true,
  },
  gateway: {
    type: Sequelize.STRING(20),
    allowNull: false, // 'pg_1' or 'pg_2'
  },
  order_id: {
    type: Sequelize.STRING(150),
    allowNull: false,
    unique: true,
  },
  payment_id: {
    type: Sequelize.STRING(150),
    allowNull: true,
  },
  amount: {
    type: Sequelize.DECIMAL(12, 2),
    allowNull: false,
  },
  fee_amount: {
    type: Sequelize.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0.00,
  },
  gst_amount: {
    type: Sequelize.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0.00,
  },
  net_amount: {
    type: Sequelize.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0.00,
  },
  status: {
    type: Sequelize.STRING(30),
    allowNull: false,
    defaultValue: 'pending',
  },
  payment_url: {
    type: Sequelize.TEXT,
    allowNull: true,
  },
  return_url: {
    type: Sequelize.TEXT,
    allowNull: true,
  },
  payment_mode: {
    type: Sequelize.STRING(50),
    allowNull: true,
    defaultValue: 'CARD',
  },
  card_network: {
    type: Sequelize.STRING(50),
    allowNull: true,
  },
  card_type: {
    type: Sequelize.STRING(50),
    allowNull: true,
  },
  card_sub_type: {
    type: Sequelize.STRING(50),
    allowNull: true,
  },
  webhook_payload: {
    type: Sequelize.JSON,
    allowNull: true,
  },
  created_at: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
  },
  updated_at: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
  },
}, {
  tableName: 'pg_transactions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = PgTransaction;
