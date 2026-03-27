'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Add the new unified column
    await queryInterface.addColumn('PosMachines', 'assigned_to', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'Users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    // 2. Migrate existing data:
    //    - franchise assignments  -> assigned_to = franchaise_id
    //    - merchant assignments   -> assigned_to = assigned_user_id
    //    If both are set (edge case), merchant takes priority.
    await queryInterface.sequelize.query(`
      UPDATE "PosMachines"
      SET "assigned_to" = COALESCE("assigned_user_id", "franchaise_id")
      WHERE "assigned_user_id" IS NOT NULL OR "franchaise_id" IS NOT NULL;
    `);

    // 3. Drop old columns and their FK constraints if they exist
    const table = await queryInterface.describeTable('PosMachines');

    if (table.franchaise_id) {
      try {
        await queryInterface.removeConstraint('PosMachines', 'fk_franchaise_id');
      } catch (_) { /* constraint may not exist */ }
      await queryInterface.removeColumn('PosMachines', 'franchaise_id');
    }

    if (table.assigned_user_id) {
      try {
        await queryInterface.removeConstraint('PosMachines', 'fk_assigned_user_id');
      } catch (_) { /* constraint may not exist */ }
      await queryInterface.removeColumn('PosMachines', 'assigned_user_id');
    }
  },

  async down(queryInterface, Sequelize) {
    // Re-add old columns
    await queryInterface.addColumn('PosMachines', 'franchaise_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('PosMachines', 'assigned_user_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });

    // Best-effort restore: copy assigned_to back into assigned_user_id
    await queryInterface.sequelize.query(`
      UPDATE "PosMachines"
      SET "assigned_user_id" = "assigned_to"
      WHERE "assigned_to" IS NOT NULL;
    `);

    // Remove the unified column
    await queryInterface.removeColumn('PosMachines', 'assigned_to');
  },
};
