-- +goose Up
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text,
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE studios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  visibility text NOT NULL DEFAULT 'private',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  host_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_token_hash text NOT NULL UNIQUE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CONSTRAINT sessions_status_check CHECK (status IN ('draft', 'waiting', 'live', 'ended', 'cancelled')),
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  role text NOT NULL CONSTRAINT participants_role_check CHECK (role IN ('host', 'guest')),
  display_name text,
  join_token_hash text UNIQUE,
  status text NOT NULL DEFAULT 'invited' CONSTRAINT participants_status_check CHECK (status IN ('invited', 'joined', 'left')),
  joined_at timestamptz,
  left_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT participants_session_role_key UNIQUE (session_id, role)
);

CREATE TABLE recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CONSTRAINT recordings_status_check CHECK (status IN ('pending', 'recording', 'uploaded', 'processing', 'ready', 'failed')),
  started_at timestamptz,
  ended_at timestamptz,
  raw_media_ready_at timestamptz,
  export_ready_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recording_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id uuid NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES participants(id) ON DELETE SET NULL,
  track_kind text NOT NULL CONSTRAINT recording_tracks_track_kind_check CHECK (track_kind IN ('host', 'guest')),
  media_kind text NOT NULL CONSTRAINT recording_tracks_media_kind_check CHECK (media_kind IN ('audio', 'video')),
  status text NOT NULL DEFAULT 'pending' CONSTRAINT recording_tracks_status_check CHECK (status IN ('pending', 'uploading', 'uploaded', 'processing', 'ready', 'failed')),
  storage_object_key text,
  content_type text,
  byte_size bigint,
  checksum text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recording_tracks_recording_track_media_key UNIQUE (recording_id, track_kind, media_kind)
);

CREATE TABLE uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_track_id uuid NOT NULL UNIQUE REFERENCES recording_tracks(id) ON DELETE CASCADE,
  protocol text NOT NULL DEFAULT 'tus',
  status text NOT NULL DEFAULT 'pending' CONSTRAINT uploads_status_check CHECK (status IN ('pending', 'uploading', 'paused', 'completed', 'failed')),
  upload_session_id text NOT NULL,
  expected_byte_size bigint,
  received_byte_size bigint NOT NULL DEFAULT 0,
  chunk_size integer,
  checksum text,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id uuid NOT NULL UNIQUE REFERENCES recordings(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CONSTRAINT exports_status_check CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  format text NOT NULL DEFAULT 'mp4' CONSTRAINT exports_format_check CHECK (format = 'mp4'),
  width integer NOT NULL DEFAULT 1920,
  height integer NOT NULL DEFAULT 1080,
  storage_object_key text,
  byte_size bigint,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX studios_owner_user_id_idx ON studios(owner_user_id);
CREATE INDEX sessions_studio_id_idx ON sessions(studio_id);
CREATE INDEX sessions_host_user_id_idx ON sessions(host_user_id);
CREATE INDEX sessions_status_idx ON sessions(status);
CREATE INDEX recording_tracks_participant_id_idx ON recording_tracks(participant_id);

-- +goose Down
DROP TABLE IF EXISTS exports;
DROP TABLE IF EXISTS uploads;
DROP TABLE IF EXISTS recording_tracks;
DROP TABLE IF EXISTS recordings;
DROP TABLE IF EXISTS participants;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS studios;
DROP TABLE IF EXISTS users;
