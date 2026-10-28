# Eventra

Shared campus calendar for booking events and venues. Only @nmamit.in and @nitte.edu.in emails can sign up, and each email is verified with a 6-digit code.

## Run locally
```bash
npm install
cp .env.example .env     # then edit JWT_SECRET
npm start                # http://localhost:3000
```
Without SMTP settings, verification codes print in the terminal and show on screen (development only).

## Stack
Node.js, Express, SQLite (better-sqlite3), vanilla HTML/CSS/JS.

## Structure
- `server.js` API, auth, database, conflict checks
- `public/` index.html, style.css, script.js
- `prompts/` prompts used to build this project
