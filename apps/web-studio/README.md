# Web Studio

`apps/web-studio` is the React + TypeScript + Vite frontend for Djoko Studio.
It now includes the first host-facing session creation flow.

## What this screen does

- shows the DNA Studio / Djoko Studio title and short product description
- lets a host enter a session title, host user ID, and studio ID
- calls `POST /v1/sessions` on the API
- displays the session ID, title, status, guest invite token, and guest invite URL
- shows loading and error states during the request

## What is not implemented yet

- auth
- full authorization
- WebRTC media
- browser recording
- upload
- export

## API configuration

The app reads `VITE_API_BASE_URL` from the frontend environment.

If `VITE_API_BASE_URL` is not set, the app falls back to:

```text
http://localhost:8080
```

Example local setup:

```bash
cd apps/web-studio
VITE_API_BASE_URL=http://localhost:8080 npm run dev
```

If you do not set the variable, the app still talks to the local API fallback.

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
