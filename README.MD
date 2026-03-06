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

## SMS / OTP Configuration

The application uses the Bulk9 DLT SMS gateway for sending login OTPs and other
notifications. To enable this functionality set the following environment
variables (for example, in a `.env` file):

```env
BULK9_API_KEY=your_bulk9_api_key_here
# optional, defaults to ABHEPY if omitted
BULK9_SENDER_ID=ABHEPY
```

If the API key is not configured the SMS helper will throw an error; the
system will fall back to email-only OTP delivery where appropriate.
