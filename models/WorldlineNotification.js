const Sequelize = require('sequelize');
const db = require('../config/database');

const WorldlineNotification = db.define('WorldlineNotification', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.BIGINT
  },
  txn_id: {
    type: Sequelize.STRING(100),
    allowNull: false,
    unique: true,
    field: 'txn_id'
  },
  rrn: {
    type: Sequelize.STRING(100),
    allowNull: true,
    field: 'rrn'
  },
  mid: {
    type: Sequelize.STRING(100),
    allowNull: true,
    field: 'mid'
  },
  tid: {
    type: Sequelize.STRING(100),
    allowNull: true,
    field: 'tid'
  },
  amount: {
    type: Sequelize.DECIMAL(12, 2),
    allowNull: true,
    field: 'amount'
  },
  status: {
    type: Sequelize.STRING(50),
    allowNull: true,
    field: 'status'
  },
  card_scheme: {
    type: Sequelize.STRING(50),
    allowNull: true,
    field: 'card_scheme'
  },
  txn_date: {
    type: Sequelize.STRING(30),
    allowNull: true,
    field: 'txn_date'
  },
  txn_time: {
    type: Sequelize.STRING(30),
    allowNull: true,
    field: 'txn_time'
  },
  masked_card_number: {
    type: Sequelize.STRING(50),
    allowNull: true,
    field: 'masked_card_number'
  },
  txn_type: {
    type: Sequelize.STRING(50),
    allowNull: true,
    field: 'txn_type'
  },
  app_code: {
    type: Sequelize.STRING(50),
    allowNull: true,
    field: 'app_code'
  },
  urn: {
    type: Sequelize.STRING(100),
    allowNull: true,
    field: 'urn'
  },
  billing_number: {
    type: Sequelize.STRING(100),
    allowNull: true,
    field: 'billing_number'
  },
  event_json: {
    type: Sequelize.JSON,
    allowNull: false,
    field: 'event_json'
  },
  source: {
    type: Sequelize.STRING(50),
    allowNull: false,
    defaultValue: 'worldline',
    field: 'source'
  },
  user_id: {
    type: Sequelize.INTEGER,
    allowNull: true,
    defaultValue: null,
    field: 'user_id'
  },
  company_id: {
    type: Sequelize.STRING(255),
    allowNull: true,
    field: 'company_id',
    comment: 'Company / white-label tenant identifier'
  },
  pos_machine_id: {
    type: Sequelize.INTEGER,
    allowNull: true,
    defaultValue: null,
    field: 'pos_machine_id'
  },
  processed: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'processed'
  },
  processing_status: {
    type: Sequelize.STRING(30),
    allowNull: false,
    defaultValue: 'pending',
    field: 'processing_status'
  },
  processing_error: {
    type: Sequelize.TEXT,
    allowNull: true,
    field: 'processing_error'
  },
  processed_at: {
    type: Sequelize.DATE,
    allowNull: true,
    field: 'processed_at'
  },
  createdAt: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    field: 'createdAt'
  },
  updatedAt: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    field: 'updatedAt'
  }
}, {
  tableName: 'worldline_notifications',
  timestamps: true,
  underscored: false
});

WorldlineNotification.associate = function (models) {
  WorldlineNotification.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user',
    constraints: false
  });

  WorldlineNotification.belongsTo(models.Company, {
    foreignKey: 'company_id',
    targetKey: 'company_id',
    as: 'company',
    constraints: false
  });

  WorldlineNotification.belongsTo(models.PosMachine, {
    foreignKey: 'pos_machine_id',
    as: 'posMachine',
    constraints: false
  });
};

module.exports = WorldlineNotification;
