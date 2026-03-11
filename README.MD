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

When both SMS and email delivery are possible (e.g. login OTP), the same
random code is used for both channels so the user sees identical values in
their message and email.

## Razorpay Webhook Credentials

The server authenticates incoming Razorpay (and Everlife) webhooks using HTTP
basic auth.  The credentials are stored in environment variables – you must
provide **both** pairs even if only one source is active:

```env
WEBHOOK_USERNAME=razorpay
WEBHOOK_PASSWORD=secret
WEBHOOK_USERNAME_EVERLIFE=razorpay
WEBHOOK_PASSWORD_EVERLIFE=secret
```

These credentials are checked by middleware in `utils/razorpay/auth.js` and
attached to the request object as `req.webhookSource` (either `razorpay` or
`everlife`).  The same `/api/razorpay/webhook` endpoint handles events from
both sources, and notifications are tagged in the database accordingly.
