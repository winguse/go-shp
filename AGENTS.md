# AGENTS.md

## Project Structure
- `chrome-extension/`: Contains the frontend code for the browser extension. Provides the UI and proxy functionality for users.
- `server/`: Go code for the Secure HTTP Proxy (SHP) backend. Handles the proxy server operations.
- `client/`: Go code for the Secure HTTP Proxy (SHP) client. A CLI client alternative to the Chrome extension.
- `utils/`: Go utilities shared across the project.
- `auth/`: Handles OAuth authentication and validation for the server.

## Proxy Behavior
- The project implements an HTTP2 proxy.
- To prevent proxy detection, it acts as a reverse proxy unless a correct authentication header is provided.
- For Chrome extension compatibility, authentication is only requested when the client targets a special authentication URL path.
- The authentication is powered by OAuth backend (e.g. Google OAuth) integration.

## Extension Notes
- Configuration is largely YAML-based, utilizing domains filtering for Direct vs Proxy connection.
- A modern UI approach is preferred for user-facing aspects (TailwindCSS, improved charts).
