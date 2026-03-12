'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // mark whether the notification has been fully handled by the worker
    await queryInterface.addColumn('razorpay_notifications', 'processed', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'true when the webhook has been processed (charges/user resolved)'
    });

    // timestamp when the record was marked processed
    await queryInterface.addColumn('razorpay_notifications', 'processed_at', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'UTC time when processed flag was set'
    });

    // status enum for later admin workflows
    await queryInterface.addColumn('razorpay_notifications', 'processing_status', {
      type: Sequelize.STRING(30),
      allowNull: false,
      defaultValue: 'pending',
      comment: "one of 'pending','completed','needs_admin','failed'"
    });

    // human-readable error/note when processing was deferred or failed
    await queryInterface.addColumn('razorpay_notifications', 'processing_error', {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: 'Optional note explaining why processing was deferred or failed'
    });

    // user who manually flagged or re-processed the notification (admin id)
    await queryInterface.addColumn('razorpay_notifications', 'processed_by', {
      type: Sequelize.INTEGER,
      allowNull: true,
      comment: 'FK → Users.id (admin) who marked this notification as processed'
    });

    // optional note or reason for manual processing
    await queryInterface.addColumn('razorpay_notifications', 'process_note', {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: 'Free-text note recorded when processing manually'
    });

    // indexes to speed up queries for unprocessed rows or by resolver
    await queryInterface.addIndex('razorpay_notifications', ['processed'], {
      name: 'idx_razorpay_notifications_processed'
    });
    await queryInterface.addIndex('razorpay_notifications', ['processed_by'], {
      name: 'idx_razorpay_notifications_processed_by'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('razorpay_notifications', 'idx_razorpay_notifications_processed_by');
    await queryInterface.removeIndex('razorpay_notifications', 'idx_razorpay_notifications_processed');
    await queryInterface.removeColumn('razorpay_notifications', 'process_note');
    await queryInterface.removeColumn('razorpay_notifications', 'processed_by');
    await queryInterface.removeColumn('razorpay_notifications', 'processing_error');
    await queryInterface.removeColumn('razorpay_notifications', 'processing_status');
    await queryInterface.removeColumn('razorpay_notifications', 'processed_at');
    await queryInterface.removeColumn('razorpay_notifications', 'processed');
  }
};