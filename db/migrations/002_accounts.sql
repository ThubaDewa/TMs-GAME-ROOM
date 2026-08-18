CREATE TABLE IF NOT EXISTS tm_accounts (
	id TEXT PRIMARY KEY,
	username TEXT NOT NULL,
	username_key TEXT NOT NULL UNIQUE,
	password_salt TEXT NOT NULL,
	password_hash TEXT NOT NULL,
	session_hash TEXT UNIQUE,
	coin_balance BIGINT NOT NULL DEFAULT 100,
	total_xp BIGINT NOT NULL DEFAULT 0,
	wins INTEGER NOT NULL DEFAULT 0,
	games_played INTEGER NOT NULL DEFAULT 0,
	last_daily_claim DATE,
	cosmetics JSONB NOT NULL DEFAULT '{"avatar":"neon"}'::jsonb,
	achievements JSONB NOT NULL DEFAULT '{}'::jsonb,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tm_account_game_stats (
	account_id TEXT NOT NULL REFERENCES tm_accounts(id) ON DELETE CASCADE,
	game TEXT NOT NULL,
	games INTEGER NOT NULL DEFAULT 0,
	wins INTEGER NOT NULL DEFAULT 0,
	xp BIGINT NOT NULL DEFAULT 0,
	PRIMARY KEY (account_id,game)
);

CREATE TABLE IF NOT EXISTS tm_match_history (
	id BIGSERIAL PRIMARY KEY,
	match_id TEXT NOT NULL,
	room_code VARCHAR(6) NOT NULL,
	account_id TEXT NOT NULL REFERENCES tm_accounts(id) ON DELETE CASCADE,
	game TEXT NOT NULL,
	mode TEXT NOT NULL,
	score BIGINT NOT NULL DEFAULT 0,
	rank INTEGER NOT NULL,
	xp INTEGER NOT NULL DEFAULT 0,
	coins INTEGER NOT NULL DEFAULT 0,
	is_winner BOOLEAN NOT NULL DEFAULT FALSE,
	played_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	UNIQUE (match_id,account_id)
);

CREATE INDEX IF NOT EXISTS tm_accounts_total_xp_idx ON tm_accounts (total_xp DESC,wins DESC);
CREATE INDEX IF NOT EXISTS tm_match_history_account_idx ON tm_match_history (account_id,played_at DESC);
