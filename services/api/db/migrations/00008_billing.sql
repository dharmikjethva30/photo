-- +goose Up
-- Purchases and the anti-abuse ledger.

CREATE TABLE purchases (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform             purchase_platform NOT NULL,
  product_id           text NOT NULL,

  -- The store's transaction identifier.
  store_transaction_id text NOT NULL,
  -- 'pending' covers Apple's Ask-to-Buy / deferred purchases, which must be shown
  -- to the user as awaiting approval rather than as a generic failure.
  state                purchase_state NOT NULL DEFAULT 'pending',

  price_minor          integer,
  currency             char(3),

  -- The raw verified payload, kept for dispute handling and for re-verification
  -- after a receipt-format change.
  receipt              jsonb,
  verified_at          timestamptz,
  refunded_at          timestamptz,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- Replay defence. A receipt shared between accounts, or resubmitted, cannot
  -- mint a second entitlement. This is the constraint that makes client-submitted
  -- receipts safe to accept at all.
  CONSTRAINT purchases_store_txn_uk UNIQUE (platform, store_transaction_id)
);

CREATE INDEX purchases_user_idx ON purchases (user_id, created_at DESC);

CREATE TRIGGER purchases_set_updated_at
BEFORE UPDATE ON purchases
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Close the entitlement -> purchase link deferred from migration 00003.
ALTER TABLE album_entitlements
  ADD CONSTRAINT album_entitlements_purchase_fk
  FOREIGN KEY (purchase_id) REFERENCES purchases (id) ON DELETE RESTRICT;

-- One entitlement per purchase.
CREATE UNIQUE INDEX album_entitlements_purchase_uk
  ON album_entitlements (purchase_id)
  WHERE purchase_id IS NOT NULL;

-- Free-slot consumption survives account deletion.
--
-- Without this, "delete account and sign up again" resets the free-album counter,
-- because entitlements are keyed on user_id and cascade away with the user.
--
-- Only an HMAC of provider:subject is retained — never the subject itself — so the
-- row cannot be reversed into an identity.
--
-- HONEST CAVEAT: retaining a keyed hash derived from a deleted user's provider
-- subject IS still processing of personal data after deletion. It needs a
-- documented legitimate-interest basis (fraud prevention) and its own retention
-- limit. Also note Apple's Hide My Email and phone-number recycling make this
-- imperfect by nature — do not over-engineer it against a £1.49 product.
CREATE TABLE consumed_identity_ledger (
  identity_hmac  bytea PRIMARY KEY,
  free_slots_used smallint NOT NULL DEFAULT 0,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT consumed_identity_slots_range CHECK (free_slots_used BETWEEN 0 AND 3)
);

-- +goose Down
DROP TABLE IF EXISTS consumed_identity_ledger;
DROP INDEX IF EXISTS album_entitlements_purchase_uk;
ALTER TABLE album_entitlements DROP CONSTRAINT IF EXISTS album_entitlements_purchase_fk;
DROP TRIGGER IF EXISTS purchases_set_updated_at ON purchases;
DROP TABLE IF EXISTS purchases;
