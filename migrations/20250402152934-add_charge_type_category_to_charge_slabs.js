module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ChargeSlabs', 'charge_type_category', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('ChargeSlabs', 'charge_type_category');
  }
};