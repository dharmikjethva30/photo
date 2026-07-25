-- Runs once, on first initialisation of the data volume.
--
-- These extensions must exist before the first goose migration: face embeddings
-- are `vector(512)` and the schema will not apply without pgvector.

-- pgvector — 512-d ArcFace embeddings, HNSW indexes with vector_cosine_ops.
CREATE EXTENSION IF NOT EXISTS vector;

-- pgcrypto — gen_random_uuid(), and digest()/hmac() for the invite-token and
-- consumed-identity hashes (we never store a raw provider subject or a raw
-- refresh token; both are hashed at rest).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Every timestamp in this schema is timestamptz. Photos arrive from members in
-- different timezones and the feed is ordered by capture time, so a naive
-- timestamp anywhere is a bug waiting to happen. Pin the session default so a
-- misconfigured client cannot silently shift interpretation.
ALTER DATABASE photu SET timezone TO 'UTC';
