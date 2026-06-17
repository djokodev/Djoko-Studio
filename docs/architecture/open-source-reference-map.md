# Open-Source Technical Reference Map

## Purpose

Djoko Studio uses selected open-source projects as references by product area.
The goal is to learn from proven architectures, vocabulary, and tradeoffs while
still keeping Djoko Studio on its own product path.

This document is the first place future contributors should check before making
major decisions in the areas listed below.

## License and copying rule

These projects are references for learning and design inspiration only.

- Do not copy code directly into Djoko Studio.
- If a future task wants to reuse or adapt code, license review is required
  first.
- VDO.Ninja is AGPL-3.0, so special care is required before copying or
  modifying any of its code.
- OBS Studio is GPL-2.0-or-later, so special care is required before copying
  or modifying any of its code.
- Jitsi Meet is Apache-2.0, but it should still be treated as a reference
  unless a task explicitly approves reuse.

## Reference map

| DNA STUDIO area | Reference project | GitHub repository | What to study | When to consult it | What not to copy blindly |
| --- | --- | --- | --- | --- | --- |
| Remote guest / WebRTC host-guest | VDO.Ninja | [steveseguin/vdo.ninja](https://github.com/steveseguin/vdo.ninja) | Guest invitation flow, publisher/viewer roles, peer connection lifecycle, STUN/TURN fallback, director flow, remote camera feed handling, and WebRTC URL/session ergonomics. | Before implementing or modifying host/guest WebRTC, signaling, guest links, peer connection handling, media device flows, remote preview, or guest connection recovery. | Do not copy the large URL-flag surface or implementation code directly. Djoko Studio should keep a simpler product UX. |
| Studio model / sources / scenes / outputs | OBS Studio | [obsproject/obs-studio](https://github.com/obsproject/obs-studio) | Source abstraction, scene/source composition, output pipeline, source lifecycle, audio/video track separation, recording vs. streaming concepts, and plugin-friendly architecture. | Before implementing source models, scene/layout models, local or remote source abstractions, recording outputs, export outputs, track handling, or audio/video composition. | Do not copy the full desktop-app surface, plugin system, or streaming-centric UI without a task-specific reason. Djoko Studio remains browser-first and interview-focused. |
| Multi-participant rooms / SFU / moderation | Jitsi Meet and Jitsi Videobridge | [jitsi/jitsi-meet](https://github.com/jitsi/jitsi-meet) and [jitsi/jitsi-videobridge](https://github.com/jitsi/jitsi-videobridge) | Multi-participant room behavior, SFU architecture, participant state, reconnect behavior, moderation, conference lifecycle, scalable WebRTC routing, and bandwidth-aware multi-user media. | Before implementing room state, multi-participant media routing, reconnect logic, moderation controls, conference lifecycle, or bandwidth adaptation. | Do not copy the full conference UI or server topology blindly. Keep Djoko Studio's room model simpler unless a future ADR says otherwise. |

## How to use this map

- Read the relevant reference project before designing a new major feature in
  that area.
- Prefer studying architecture, state flow, and naming patterns over copying
  implementation details.
- Keep Djoko Studio's own product constraints and ADRs as the final source of
  truth.
