# Djoko Studio Project Idea

Djoko Studio is a web-based interview recording platform designed to stay reliable when network conditions are unstable.

## Source of truth

- `docs/product/project_idea.md` is the canonical product idea document.
- `docs/product/assets/djoko_studio_project_idea.pdf` is a human-readable PDF export only.
- Do not treat the PDF as the authoritative source for product requirements.

## Vision

Build a local-first interview studio for creators who need a dependable way to record remote conversations, keep the raw media safe, and produce a clean final video even when connectivity is poor.

## Problem

Existing interview and meeting tools work well when the network is stable, but they can fail badly in difficult conditions:

- calls may drop unexpectedly
- participants may be removed from the session
- recordings can be lost or incomplete
- uploads can fail or stall
- the host may not know whether the guest finished uploading
- final quality can depend too much on live connection quality

Djoko Studio solves a focused problem:

How can a creator reliably record a remote interview even when the network is unstable?

## Positioning

Djoko Studio is not trying to be a full clone of Riverside or Zoom.
Its initial position is narrower and sharper:

- desktop web first
- local-first recording
- 1 host + 1 guest for the MVP
- guest joins without an account
- separate audio and video tracks
- chunked upload with resume
- automatic recovery after network failure
- 1080p YouTube-ready export

The product differentiates itself by being strong on reliability rather than breadth of features.

## Target Users

Initial users include:

- content creators
- podcasters
- interviewers
- entrepreneurs
- trainers
- independent journalists
- African creators working with remote guests
- people recording solo videos or interviews without relying on restrictive free tiers

The MVP supports two main use cases:

1. Remote interview
   - 1 host with an account
   - 1 guest joining by invitation link
2. Solo recording
   - the host records alone
   - useful for intros, short videos, training content, and personal messages

## Product Principles

### Local-first recording

Recording must not depend entirely on the server. Each participant records locally in the browser, and the files are uploaded progressively later.

### Resilience over convenience

The system should handle:

- temporary network loss
- interrupted uploads
- automatic reconnects
- page refreshes
- accidental page closes
- slow networks
- resumed uploads later in the same session

The priority is protecting the recorded data.

### Separate tracks

Each participant should have separate audio and video tracks so that post-production stays flexible and recovery is easier.

### Simplicity of use

The user experience should stay simple:

1. create a studio
2. invite a guest
3. start recording
4. end the session
5. let synchronization finish
6. edit later through transcription
7. download the final video or the raw tracks

### Technical ambition

The project is intentionally ambitious so it can serve as a real learning ground for:

- software architecture
- system design
- WebRTC
- database design
- media storage
- resilient upload flows
- background workers
- video processing
- transcription
- deployment
- observability
- migrations
- scalability

## MVP v0.1 Recording Core

### Goal

Deliver the core promise of the product: a reliable remote interview recording flow with local recording, progressive upload, automatic resume, separate tracks, and a stable 1080p export.

### In scope

- host account
- personal studio space
- recording sessions
- invitation link for the guest
- live call with 1 host and 1 guest
- solo recording mode
- local recording in the browser
- separate audio and video tracks
- chunked upload
- local persistence before upload
- automatic upload retry
- recovery screen for unfinished uploads
- automatic reconnect
- visible recording and upload indicators
- host visibility into guest upload progress
- warning before closing the page
- host dashboard
- final 1080p YouTube-ready export
- download of raw tracks
- private-by-default recordings

### Out of scope

- multi-guest sessions
- mobile-first support
- livestreaming
- chat
- transcript editing
- screen share
- payments
- publishing integrations

## MVP v0.2 Editing Core

### Goal

Add transcription-based editing so the host can cut video by editing text.

### In scope

- automatic transcription
- automatic subtitles
- text-based editing
- logical editing timeline
- final edited video render
- transcript and subtitle export

### Out of scope

- advanced clip generation
- silence removal
- advanced audio cleanup
- direct publishing
- vertical formats
- stylized captions

## MVP v0.3 Screen Share Core

### Goal

Add screen sharing so interviews can include demos, products, presentations, and documents.

### In scope

- screen sharing during the call
- live visibility for the other participant
- screen share in the final video
- layout switching based on screen share state
- screen share start and stop segments

### Out of scope

- separate raw screen-share track
- live annotation
- remote control
- multi-screen support
- advanced slide presentation features

## Quality Constraints

- target final export: 1080p stable
- YouTube-friendly 16:9 layout
- local quality should be higher than live quality
- live call should adapt to network conditions
- recording reliability has priority over live polish
- the system must be resilient to network interruptions, refreshes, partial uploads, and worker failures

## Business Ambition

Djoko Studio can start as a personal product and grow into a SaaS offering.

Possible future packaging:

- Free: limited hours, limited storage, limited exports
- Starter: more hours, no watermark, 1080p exports, limited transcription
- Pro: more storage, more hours, advanced transcription, text editing, screen share

Pricing should reflect real costs:

- recording time
- media storage
- transcription
- video processing
- exports

## Why This Project Is Good For Architecture Learning

Djoko Studio is a strong architecture and system design exercise because it requires real production thinking:

- frontend and backend design
- WebRTC
- resilient upload flows
- browser local storage
- object storage
- relational data modeling
- asynchronous workers
- processing pipelines
- observability
- security
- migrations
- scalability

It is more than a CRUD app. It forces careful thinking about reliability, media handling, and distributed system tradeoffs.
