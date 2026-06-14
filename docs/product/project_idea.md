# Djoko Studio Project Idea

Djoko Studio is a resilient web-based interview recording platform.

## Source of Truth

- `docs/product/project_idea.md` is the canonical product idea document.
- `docs/product/assets/djoko_studio_project_idea.pdf` is only a human-readable export.
- When this Markdown file and the PDF differ, the Markdown file wins.

## Product Vision

Djoko Studio is not just a video call tool.

It is a local-first remote interview recording studio designed to protect the final recording against unstable network conditions.

The live call may adapt to network quality, but the final recording must remain safe, recoverable, and high quality.

## Problem Statement

Remote interview tools often assume stable connectivity. In real-world conditions, that assumption breaks down:

- the call may drop unexpectedly
- uploads may stall or fail
- a browser refresh can interrupt the session
- a participant may close the page too early
- the host may not know whether the guest upload is complete
- live quality can degrade enough to hurt the final result

Djoko Studio exists to answer a simple question:

How can a creator reliably record a remote interview even when the network is unstable?

## Positioning

Djoko Studio is not trying to be a full Riverside clone or a general-purpose meeting app.

It is positioned as a focused product with a narrower promise:

- desktop web first
- local-first recording
- 1 host + 1 guest in the early MVP
- guest joins without an account
- chunked, resumable uploads
- automatic recovery after network failure
- final 1080p export ready for YouTube-style publishing

The differentiation is reliability first, feature breadth second.

## Target Users

The initial users are people who record spoken or visual content remotely:

- creators
- entrepreneurs
- podcasters
- interviewers
- trainers
- independent journalists
- solo video makers

These users care about completing the recording safely, not only about the live call quality.

## Main Use Cases

### Remote Interview

- 1 host with an account
- 1 guest joining without an account through an invitation link
- desktop web first
- live video call
- local recording on both sides
- upload progress tracking
- final 1080p export

### Solo Recording

- the host records alone
- useful for intros, personal videos, YouTube capsules, trainings, or tests

## Product Principles

### Local-First Recording

Recording should not depend entirely on the server. Media should be captured locally in the browser first, then uploaded progressively.

### Reliability Before Polish

The system should prioritize protecting the recording over maximizing live-call polish.

### Separate Media Tracks

Audio and video should be separated by participant so post-production stays flexible and recovery stays practical.

### Simple User Flow

The product should feel straightforward:

1. create a studio
2. invite a guest or start solo
3. record locally
4. upload progressively
5. recover automatically if something fails
6. edit later when available
7. export the final result

### Preserve the Raw Source

Raw media should remain available and preserved even after edits and exports.

## MVP Global Overview

The MVP is organized in three steps:

1. v0.1 proves the recording reliability core.
2. v0.2 adds transcription-based editing.
3. v0.3 adds screen sharing for richer interviews and demos.

The overall product direction is to build confidence in the final media artifact first, then expand editing and presentation features.

## v0.1 - Recording Core

### Goal

Prove the core reliability promise: a remote interview recording flow that survives unstable networks without losing the recording in normal failure scenarios.

### Features

- host account
- personal studio space
- recording sessions
- guest invitation link
- guest joins without an account
- desktop web first
- 1 host + 1 guest only
- solo recording mode
- live video call
- local recording in the browser
- separate tracks for host audio, host video, guest audio, and guest video
- chunked upload
- local persistence before upload
- automatic upload retry
- automatic recovery after network failure
- upload resume after refresh or temporary connection loss
- host visibility into guest upload progress
- warning before page close if upload is incomplete
- host dashboard
- private-by-default recordings
- raw tracks download
- final 1080p YouTube-ready export

### Notes

This version is about proving the recording path, the upload path, and the recovery path before adding richer editing or collaboration features.

## v0.2 - Editing Core

### Goal

Add transcription-based editing so the host can work from text instead of only a timeline.

### Features

- automatic transcription
- subtitles export
- text-based editing
- logical cut timeline
- non-destructive editing
- final edited video render
- transcript export

### Notes

Original files must remain preserved. Editing should create derived outputs without destroying the source media or transcript history.

## v0.3 - Screen Share Core

### Goal

Add screen sharing for interviews involving demos, products, presentations, documents, and software walkthroughs.

### Features

- screen sharing during the call
- screen visible live to the other participant
- screen share integrated into the final video
- automatic layout switching
- screen share start and stop segments

### Notes

A separate raw screen-share track is out of scope for v0.3.

## Out-of-Scope Items

The early MVP does not include:

- mobile app
- multi-guest sessions
- livestreaming
- chat
- teleprompter
- media board
- Magic Clips
- vertical social clips
- direct YouTube/TikTok/LinkedIn publishing
- team workspaces
- billing implementation
- full Riverside clone

## Quality Constraints

- final export target: 1080p stable
- YouTube 16:9 format
- recording reliability has priority over live polish
- live quality may adapt to network conditions
- the final local recording should remain higher quality than the live stream when possible
- no recorded data should be lost in normal unstable-network scenarios
- uploads must be resumable
- raw media should be preserved
- Markdown is the canonical source of truth

## Reliability Goals

The system should be designed to survive:

- temporary network loss
- interrupted upload
- browser refresh
- user trying to close the page before upload is complete
- guest upload not yet completed
- slow connection
- worker failure during processing

The goal is to avoid data loss in normal unstable-network scenarios.

This is not a claim of perfect safety under every possible failure mode.

## Business Ambition

Djoko Studio can start as a personal tool and later evolve into a SaaS product for individual creators.

Possible pricing direction:

- free tier with limits
- starter plan around 5 USD/month
- pricing informed by real cost drivers such as:
  - recording hours
  - media storage
  - transcription
  - video processing
  - exports

Billing is out of scope for now.

## Why This Project Is Useful for Architecture and System Design Learning

Djoko Studio is a strong learning project because it forces careful thinking about:

- local-first browser workflows
- WebRTC tradeoffs
- resumable uploads
- media storage and recovery
- background processing
- transcript generation
- non-destructive editing
- export pipelines
- observability
- failure handling
- data modeling
- scalability

It is a good case study for building a product where the user cares most about protecting the final artifact.

## Future Architecture Questions to Answer Later

These decisions should be handled later through ADRs:

- Which frontend technology should be used?
- Which backend language/framework should be used?
- Should the first WebRTC version be peer-to-peer?
- When would an SFU become necessary?
- Which database should store metadata?
- Which storage should hold media files?
- Which queue/worker system should process videos?
- Which upload protocol should support resumable chunks?
- How should local browser storage work?
- How should migrations be handled safely?
- How should deployment be structured?
