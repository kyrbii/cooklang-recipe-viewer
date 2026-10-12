What’s missing for production

#### Security

- Token storage: the login token sits in localStorage, where any script on the page can read it. Production should use an httpOnly cookie with CSRF protection. That requires serving the app and API from the same site.
- HTTPS only: the API needs to run behind TLS, with HSTS, and the app’s real origin in ALLOWED_ORIGINS.
- Account management: the only tools are creating an account and resetting a password from the command line. There’s no password change, no way to disable or delete a user, and no audit log.
- Rate limits: login throttling is in memory and keyed on the client address. Behind a proxy it needs the real client IP. /import also needs a limit, since every call costs Gemini money.
- AI import: it still has the DNS rebinding gap I noted earlier. You should also set a per-user quota on Gemini calls.
- Secrets and updates: the Gemini key lives in a plain .env file, which needs strict file permissions. Dependencies need regular update and vulnerability checks.

### Operations

- Process management: run the API as a service with automatic restarts. It must stay at one worker, which the write lock depends on.
- Backups: back up the recipe folder and the database, and test restoring them.
- Database migrations: the schema is created with CREATE IF NOT EXISTS, which won’t handle future changes.
- Logging and health: structured logs, a health endpoint, and some form of monitoring or alerts.
- Deployment: CI that runs the tests, lint, and build on every push, plus a reproducible deployment such as a Docker image.

### Features

- Images: the API doesn’t serve them yet, so recipes that used CookCLI images will show none.
- Recipe management: there’s no delete, rename, or move.
- Conflicts: you can overwrite or take the server version, but not merge.
- Offline: edits made offline are only kept as drafts, not queued for upload.
- Storage: the offline cache lives in localStorage, which is limited to a few megabytes.

### Testing and legal

- Frontend tests: there are no automated tests for the login flow or the editor. Only the build, lint, and unit tests run.
- Privacy and terms: user accounts and recipes need a privacy notice under GDPR. The AI import sends recipe content to Google’s Gemini, which should be stated in the privacy notice. You’ll also need a way to export or delete someone’s data on request.