# Company Name API

This endpoint allows administrators to manage a list of company names.  Other parts of the system (e.g. POS machine records) may reference these names but the table is maintained independently.

## Routes

### Authentication
All routes require a valid JWT token via `Authorization: Bearer <token>`.

| Method | URL                 | Body                          | Description                         |
|--------|---------------------|-------------------------------|-------------------------------------|
| POST   | `/api/company-name` | `{ name: "Acme Corp" }`     | Create a new company name (admin only) |
| GET    | `/api/company-name` | -                             | List all company names               |
| PUT    | `/api/company-name/:id` | `{ name: "New Name" }`  | Update a name (admin only)           |
| DELETE | `/api/company-name/:id` | -                         | Remove a name (admin only)           |

Responses follow the standard JSON format used throughout the API.
