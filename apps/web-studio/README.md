# Web Studio

`apps/web-studio` is the React + TypeScript + Vite frontend for Djoko Studio.
It now includes the first host-facing session creation flow and the first guest-facing session join flow.

## What this app does

- shows the DNA Studio / Djoko Studio title and short product description
- keeps the existing host session creation screen on the default route
- supports guest join URLs like `http://localhost:5173/guest/{invite_token}`
- reads the invite token from the `/guest/{invite_token}` path segment
- looks up the session with `GET /v1/guest/sessions/{invite_token}`
- lets a guest enter a display name and join with `POST /v1/guest/sessions/{invite_token}/join`
- displays basic session details after lookup
- displays joined participant details after a successful join
- shows loading and error states for lookup and join

## What is not implemented yet

- auth
- full authorization
- WebRTC media
- browser recording
- camera or microphone access
- upload
- export

## API configuration

The app reads `VITE_API_BASE_URL` from the frontend environment.

If `VITE_API_BASE_URL` is not set, the app falls back to:

```text
http://localhost:8080
```

The API client uses that base URL for host create, guest lookup, and guest join requests.

Example local setup:

```bash
cd apps/web-studio
VITE_API_BASE_URL=http://localhost:8080 npm run dev
```

If you do not set the variable, the app still talks to the local API fallback.

## Routes

- default route: host session creation screen
- `/guest/{invite_token}`: guest session join screen

## Install

```bash
cd apps/web-studio
npm install
```

## Run locally

```bash
cd apps/web-studio
npm run dev
```

## Build

```bash
cd apps/web-studio
npm run build
```
