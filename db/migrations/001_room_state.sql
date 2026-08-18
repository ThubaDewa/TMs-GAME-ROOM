CREATE TABLE IF NOT EXISTS tm_game_rooms (
	code VARCHAR(6) PRIMARY KEY,
	phase TEXT NOT NULL,
	state JSONB NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS tm_game_rooms_expires_at_idx
	ON tm_game_rooms (expires_at);
