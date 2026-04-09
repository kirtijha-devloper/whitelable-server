'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = {
      employeeAccessRoles: await queryInterface.describeTable('EmployeeAccessRoles').catch(() => null),
      users: await queryInterface.describeTable('Users'),
    };

    if (!tables.employeeAccessRoles) {
      await queryInterface.createTable('EmployeeAccessRoles', {
        id: {
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
          type: Sequelize.INTEGER,
        },
        name: {
          allowNull: false,
          type: Sequelize.STRING,
          unique: true,
        },
        slug: {
          allowNull: false,
          type: Sequelize.STRING,
          unique: true,
        },
        description: {
          allowNull: true,
          type: Sequelize.TEXT,
        },
        permissions: {
          allowNull: false,
          type: Sequelize.JSON,
          defaultValue: [],
          comment: 'Action-based permissions granted to employees assigned to this access role.',
        },
        status: {
          allowNull: false,
          type: Sequelize.STRING,
          defaultValue: 'active',
        },
        createdAt: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.fn('NOW'),
        },
        updatedAt: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.fn('NOW'),
        },
      });
    }

    if (!tables.users.employee_access_role_id) {
      await queryInterface.addColumn('Users', 'employee_access_role_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'EmployeeAccessRoles',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
    }
  },

  async down(queryInterface) {
    const users = await queryInterface.describeTable('Users');
    if (users.employee_access_role_id) {
      await queryInterface.removeColumn('Users', 'employee_access_role_id');
    }

    const employeeAccessRoles = await queryInterface.describeTable('EmployeeAccessRoles').catch(() => null);
    if (employeeAccessRoles) {
      await queryInterface.dropTable('EmployeeAccessRoles');
    }
  },
};
