For PG:
npm install express sequelize pg pg-hstore

refer for sequelize: https://medium.com/@mtalhanasir96/building-your-first-rest-api-with-node-js-express-and-sequelize-b041f9910b8a

PG Setup:
psql -d postgres
\l
CREATE DATABASE your_database_name;

psql -d pos_abheepay
\c pos_abheepay
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

npx sequelize model:generate - name Todo - attributes task:string
npx sequelize db:migrate

handle async:
npm install express-async-handler

add new column in sequalize:
npx sequelize-cli migration:generate --name add_column_in_pos_machine
