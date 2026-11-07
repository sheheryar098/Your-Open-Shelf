-- Initial schema
-- Conventions: timestamps are timestamptz (UTC); ids are uuid unless the table is an append-only log.

-- ---------------------------------------------------------------------------
-- Countries and shipping routes
-- ---------------------------------------------------------------------------
CREATE TABLE countries (
  code              char(2) PRIMARY KEY,
  name              text NOT NULL,
  status            text NOT NULL DEFAULT 'waitlist'
                    CHECK (status IN ('open', 'limited', 'waitlist', 'unavailable')),
  currency          char(3),
  status_note       text,            -- shown to visitors, e.g. why a country is unavailable
  prohibited_items_notice text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shipping_routes (
  id                    bigserial PRIMARY KEY,
  origin_country        char(2) NOT NULL REFERENCES countries(code),
  destination_country   char(2) NOT NULL REFERENCES countries(code),
  enabled               boolean NOT NULL DEFAULT false,
  tracking_available    boolean NOT NULL DEFAULT true,
  tracking_required     boolean NOT NULL DEFAULT true,
  carrier_guidance      text,
  min_delivery_days     int CHECK (min_delivery_days >= 0),
  max_delivery_days     int CHECK (max_delivery_days >= 0),
  postage_estimate_min  numeric(10, 2),
  postage_estimate_max  numeric(10, 2),
  postage_currency      char(3),
  max_weight_grams      int,
  customs_required      boolean NOT NULL DEFAULT false,
  customs_notice        text,
  restricted_content_notes text,
  risk_level            text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
  support_notes         text,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (origin_country, destination_country),
  CHECK (max_delivery_days IS NULL OR min_delivery_days IS NULL OR max_delivery_days >= min_delivery_days)
);

-- ---------------------------------------------------------------------------
-- Users, sessions, verification
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text NOT NULL,
  password_hash       text NOT NULL,
  display_name        text NOT NULL,
  role                text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'moderator', 'admin')),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  status_reason       text,
  email_verified_at   timestamptz,
  country_code        char(2) REFERENCES countries(code),
  preferred_language  text NOT NULL DEFAULT 'en',
  timezone            text NOT NULL DEFAULT 'UTC',
  bio                 text,
  avatar_file_id      uuid,
  can_list            boolean NOT NULL DEFAULT true,
  can_request         boolean NOT NULL DEFAULT true,
  restriction_reason  text,
  plan                text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'plus')),
  ship_scope          text NOT NULL DEFAULT 'domestic' CHECK (ship_scope IN ('domestic', 'international')),
  ship_countries      char(2)[] NOT NULL DEFAULT '{}',   -- empty = every supported route
  notification_prefs  jsonb NOT NULL DEFAULT '{}'::jsonb,
  terms_version       text,
  terms_accepted_at   timestamptz,
  age_confirmed_at    timestamptz,
  last_login_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE sessions (
  id_hash     text PRIMARY KEY,           -- sha256 of the cookie token; raw token never stored
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  ip          text,
  user_agent  text
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE email_tokens (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Files (listing photos, avatars, proof of postage, dispute evidence)
-- ---------------------------------------------------------------------------
CREATE TABLE files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid REFERENCES users(id),
  kind        text NOT NULL CHECK (kind IN ('listing_photo', 'avatar', 'proof_of_postage', 'evidence')),
  storage_key text NOT NULL UNIQUE,
  mime        text NOT NULL,
  size_bytes  int NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Private addresses. Never joined into public queries.
-- ---------------------------------------------------------------------------
CREATE TABLE addresses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label           text,
  recipient_name  text NOT NULL,
  line1           text NOT NULL,
  line2           text,
  city            text NOT NULL,
  region          text,
  postal_code     text,
  country_code    char(2) NOT NULL REFERENCES countries(code),
  phone           text,
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX addresses_user ON addresses (user_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Catalog (shared metadata) and listings (member-owned copies)
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id        serial PRIMARY KEY,
  slug      text NOT NULL UNIQUE,
  name      text NOT NULL,
  parent_id int REFERENCES categories(id),
  sort      int NOT NULL DEFAULT 0
);

CREATE TABLE books (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  isbn13            char(13) UNIQUE,
  isbn10            char(10),
  title             text NOT NULL,
  subtitle          text,
  authors           text[] NOT NULL DEFAULT '{}',
  publisher         text,
  publication_year  int,
  language          text,
  edition           text,
  description       text,
  source            text NOT NULL DEFAULT 'member' CHECK (source IN ('member', 'lookup', 'admin')),
  search_vector     tsvector,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX books_search ON books USING gin (search_vector);
CREATE INDEX books_title_lower ON books (lower(title));

CREATE FUNCTION books_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '') || ' ' || coalesce(NEW.subtitle, '')), 'A') ||
    setweight(to_tsvector('simple', array_to_string(NEW.authors, ' ')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.publisher, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW.isbn13, '') || ' ' || coalesce(NEW.isbn10, '')), 'A');
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER books_search_trg BEFORE INSERT OR UPDATE ON books
  FOR EACH ROW EXECUTE FUNCTION books_search_update();

CREATE TABLE listings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id               uuid NOT NULL REFERENCES books(id),
  owner_id              uuid NOT NULL REFERENCES users(id),
  format                text NOT NULL CHECK (format IN (
                          'paperback', 'hardcover', 'textbook', 'childrens', 'picture_book', 'graphic_novel',
                          'manga', 'reference', 'large_print', 'poetry', 'cookbook', 'art_photography',
                          'religious_cultural', 'boxed_set', 'other')),
  language              text NOT NULL,
  condition             text NOT NULL CHECK (condition IN ('like_new', 'very_good', 'good', 'acceptable')),
  condition_notes       text NOT NULL DEFAULT '',
  edition_notes         text,
  category_id           int REFERENCES categories(id),
  weight_grams          int CHECK (weight_grams IS NULL OR weight_grams > 0),
  origin_country        char(2) NOT NULL REFERENCES countries(code),
  ship_scope            text NOT NULL DEFAULT 'domestic' CHECK (ship_scope IN ('domestic', 'international')),
  ship_countries        char(2)[] NOT NULL DEFAULT '{}',
  credit_cost           int NOT NULL DEFAULT 1 CHECK (credit_cost = 1),  -- one credit per standard book
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN (
                          'draft', 'active', 'reserved', 'unavailable', 'paused', 'exchanged', 'removed', 'under_review')),
  status_reason         text,
  possession_confirmed_at timestamptz,
  confirmed_available_at  timestamptz,
  published_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listings_status ON listings (status, published_at DESC);
CREATE INDEX listings_owner ON listings (owner_id, status);
CREATE INDEX listings_book ON listings (book_id);

CREATE TABLE listing_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  file_id     uuid NOT NULL REFERENCES files(id),
  position    int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listing_photos_listing ON listing_photos (listing_id, position);

-- ---------------------------------------------------------------------------
-- Exchanges. A request is an exchange in the "requested" state.
-- ---------------------------------------------------------------------------
CREATE TABLE exchanges (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id          uuid NOT NULL REFERENCES listings(id),
  requester_id        uuid NOT NULL REFERENCES users(id),
  sender_id           uuid NOT NULL REFERENCES users(id),
  route_id            bigint NOT NULL REFERENCES shipping_routes(id),
  origin_country      char(2) NOT NULL,
  destination_country char(2) NOT NULL,
  credit_cost         int NOT NULL,
  status              text NOT NULL CHECK (status IN (
                        'requested', 'accepted', 'shipped', 'delivered', 'completed',
                        'declined', 'expired', 'cancelled', 'disputed', 'refunded')),
  request_key         text NOT NULL UNIQUE,     -- idempotency key from the request form
  requested_at        timestamptz NOT NULL,
  respond_by          timestamptz NOT NULL,
  accepted_at         timestamptz,
  dispatch_by         timestamptz,
  shipped_at          timestamptz,
  auto_confirm_at     timestamptz,
  delivered_at        timestamptz,
  delivery_confirmed_by text CHECK (delivery_confirmed_by IN ('recipient', 'carrier', 'support', 'auto')),
  completion_due_at   timestamptz,
  completed_at        timestamptz,
  closed_at           timestamptz,
  close_reason        text,
  cancel_kind         text CHECK (cancel_kind IN (
                        'requester_cancelled', 'sender_declined', 'sender_cancelled',
                        'sender_no_response', 'sender_no_dispatch', 'support_cancelled')),
  status_before_dispute text,
  respond_reminder_at timestamptz,
  dispatch_reminder_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (requester_id <> sender_id)
);
-- A copy can have at most one live reservation at a time.
CREATE UNIQUE INDEX exchanges_one_live_per_listing ON exchanges (listing_id)
  WHERE status IN ('requested', 'accepted', 'shipped', 'delivered', 'disputed');
CREATE INDEX exchanges_requester ON exchanges (requester_id, status);
CREATE INDEX exchanges_sender ON exchanges (sender_id, status);
CREATE INDEX exchanges_due ON exchanges (status, respond_by, dispatch_by, auto_confirm_at, completion_due_at);

-- Delivery address snapshot; visible to the sender only once the request is accepted.
CREATE TABLE exchange_addresses (
  exchange_id     uuid PRIMARY KEY REFERENCES exchanges(id) ON DELETE CASCADE,
  recipient_name  text NOT NULL,
  line1           text NOT NULL,
  line2           text,
  city            text NOT NULL,
  region          text,
  postal_code     text,
  country_code    char(2) NOT NULL,
  phone           text,
  redacted_at     timestamptz
);

CREATE TABLE exchange_events (
  id          bigserial PRIMARY KEY,
  exchange_id uuid NOT NULL REFERENCES exchanges(id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  actor_type  text NOT NULL CHECK (actor_type IN ('member', 'system', 'staff')),
  actor_id    uuid,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exchange_events_exchange ON exchange_events (exchange_id, id);

CREATE TABLE shipments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange_id     uuid NOT NULL UNIQUE REFERENCES exchanges(id) ON DELETE CASCADE,
  carrier         text NOT NULL,
  tracking_number text,
  tracking_url    text,
  dispatch_date   date NOT NULL,
  proof_file_id   uuid REFERENCES files(id),
  status          text NOT NULL DEFAULT 'dispatched'
                  CHECK (status IN ('dispatched', 'in_transit', 'delivered', 'returned', 'lost')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shipments_tracking ON shipments (lower(tracking_number));

CREATE TABLE messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange_id uuid NOT NULL REFERENCES exchanges(id) ON DELETE CASCADE,
  sender_id   uuid NOT NULL REFERENCES users(id),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  hidden_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_exchange ON messages (exchange_id, created_at);

-- ---------------------------------------------------------------------------
-- Credits: summary table plus append-only ledger
-- ---------------------------------------------------------------------------
CREATE TABLE credit_accounts (
  user_id     uuid PRIMARY KEY REFERENCES users(id),
  available   int NOT NULL DEFAULT 0 CHECK (available >= 0),
  reserved    int NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE credit_ledger (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id),
  event_type      text NOT NULL CHECK (event_type IN (
                    'credit_earned', 'credit_reserved', 'credit_spent', 'credit_released',
                    'credit_refunded', 'credit_admin_adjustment', 'credit_reversed')),
  available_delta int NOT NULL,
  reserved_delta  int NOT NULL,
  exchange_id     uuid REFERENCES exchanges(id),
  reason          text NOT NULL CHECK (length(reason) > 0),
  actor_type      text NOT NULL CHECK (actor_type IN ('system', 'member', 'admin')),
  actor_id        uuid REFERENCES users(id),
  idempotency_key text NOT NULL UNIQUE,
  reverses_id     bigint UNIQUE REFERENCES credit_ledger(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (available_delta <> 0 OR reserved_delta <> 0),
  CHECK (event_type <> 'credit_admin_adjustment' OR actor_id IS NOT NULL)
);
CREATE INDEX credit_ledger_user ON credit_ledger (user_id, id DESC);
CREATE INDEX credit_ledger_exchange ON credit_ledger (exchange_id);

CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER credit_ledger_append_only BEFORE UPDATE OR DELETE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- Wish list, reviews
-- ---------------------------------------------------------------------------
CREATE TABLE wishlist_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id           uuid NOT NULL REFERENCES books(id),
  format            text,
  language          text,
  last_notified_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, book_id)
);
CREATE INDEX wishlist_book ON wishlist_items (book_id);

CREATE TABLE reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange_id uuid NOT NULL REFERENCES exchanges(id),
  reviewer_id uuid NOT NULL REFERENCES users(id),
  reviewee_id uuid NOT NULL REFERENCES users(id),
  rating      int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  tags        text[] NOT NULL DEFAULT '{}',
  comment     text CHECK (comment IS NULL OR length(comment) <= 1000),
  hidden_at   timestamptz,
  hidden_reason text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exchange_id, reviewer_id)
);
CREATE INDEX reviews_reviewee ON reviews (reviewee_id) WHERE hidden_at IS NULL;

-- ---------------------------------------------------------------------------
-- Notifications & email outbox
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);

CREATE TABLE email_outbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email    text NOT NULL,
  subject     text NOT NULL,
  body_text   text NOT NULL,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  attempts    int NOT NULL DEFAULT 0,
  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_outbox_status ON email_outbox (status, created_at);

-- ---------------------------------------------------------------------------
-- Trust and safety: disputes, reports, support
-- ---------------------------------------------------------------------------
CREATE TABLE disputes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange_id     uuid NOT NULL REFERENCES exchanges(id),
  opened_by       uuid NOT NULL REFERENCES users(id),
  issue_type      text NOT NULL CHECK (issue_type IN (
                    'no_dispatch_evidence', 'tracking_not_updating', 'delivered_not_received', 'customs_hold',
                    'returned_to_sender', 'damaged', 'wrong_book', 'condition_mismatch', 'other')),
  description     text NOT NULL,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'awaiting_info', 'under_review', 'resolved')),
  assigned_to     uuid REFERENCES users(id),
  outcome         text CHECK (outcome IN ('release_to_sender', 'refund_requester')),
  decision_reason text,
  decided_by      uuid REFERENCES users(id),
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX disputes_one_open_per_exchange ON disputes (exchange_id) WHERE status <> 'resolved';

CREATE TABLE dispute_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id  uuid NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES users(id),
  body        text NOT NULL,
  file_id     uuid REFERENCES files(id),
  internal    boolean NOT NULL DEFAULT false,   -- staff-only notes
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     uuid NOT NULL REFERENCES users(id),
  target_type     text NOT NULL CHECK (target_type IN ('listing', 'member', 'review', 'message')),
  target_id       uuid NOT NULL,
  reason          text NOT NULL CHECK (reason IN (
                    'inaccurate', 'prohibited', 'counterfeit', 'not_owned', 'harassment',
                    'off_platform_payment', 'spam', 'review_abuse', 'other')),
  details         text,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  handled_by      uuid REFERENCES users(id),
  handled_at      timestamptz,
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_status ON reports (status, created_at);

CREATE TABLE support_tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id),
  contact_email text,                 -- for visitors who are not signed in
  exchange_id uuid REFERENCES exchanges(id),
  category    text NOT NULL CHECK (category IN (
                'account_security', 'credit_balance', 'request_cancellation', 'sender_not_shipped',
                'tracking_delivery', 'damaged_incorrect', 'customs_returned', 'harassment_safety',
                'privacy_data', 'payment_subscription', 'general')),
  subject     text NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'awaiting_member', 'in_progress', 'resolved', 'closed')),
  priority    text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_to uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR contact_email IS NOT NULL)
);
CREATE INDEX support_tickets_status ON support_tickets (status, priority, created_at);

CREATE TABLE ticket_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES users(id),
  body        text NOT NULL,
  internal    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Admin audit log (append-only) and site content
-- ---------------------------------------------------------------------------
CREATE TABLE admin_audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,
  target_type text NOT NULL,
  target_id   text,
  reason      text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_logs_target ON admin_audit_logs (target_type, target_id);
CREATE TRIGGER admin_audit_logs_append_only BEFORE UPDATE OR DELETE ON admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message     text NOT NULL,
  level       text NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning')),
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE job_runs (
  name        text PRIMARY KEY,
  last_run_at timestamptz NOT NULL
);
