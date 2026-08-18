# TM’s GAME ROOM

A responsive multiplayer browser game. The host and players can all use phones; nobody installs an app. The same room now includes **Word Link**, **Survey Showdown**, **Draw & Guess**, **TM’s Royal Race**, and **Deal or No Deal**.

Every room includes a reliable text-chat drawer, opt-in peer-to-peer WebRTC voice chat, and a Champions Board. Players can hear active speakers while keeping their own microphone off, mute or change the volume of any individual player from the player drawer, and see a live speaking ring around avatars. Mobile autoplay failures show a clear **Tap to enable voice audio** control, while opted-in microphones automatically attempt recovery after app switching, phone locking or network interruption. Microphones are off by default and require browser permission. The leaderboard compiles normalized XP, wins, games played and levels across all games in the current room, with separate per-game filters.

The room-chat drawer separates player messages from automatic game events and shows delivery confirmation on messages accepted by the server. Failed sends retry with the same message ID to prevent duplicates. Players can send queued preset reactions or hide reaction animations locally. Hosts can enable five-second slow mode, mute individual players' chat, or remove a player from the active room.

The audio control centre stores independent master, game-music, sound-effect and voice-chat levels on each device. Every game uses its own short synthesized theme plus recognizable turn, success, failure, dice, capture, banker and victory cues. Music automatically ducks while a microphone meter detects speech, and reduced-motion preferences disable pulsing communication animations.

## Registered accounts and guests

The welcome screen supports optional one-time account creation with a username and passcode. Passcodes are salted and hashed with Node's `scrypt`; only a one-way session digest is stored. Registered players permanently retain coins, XP, level, wins, per-game statistics, the latest 20 match results, cosmetics and achievements. They receive 100 starting coins, may claim 25 daily coins, and earn placement coins after completed games. The Champions Board includes a PostgreSQL-backed global ranking. Guests can create and join rooms without registering, but their progress remains temporary and they do not earn permanent coins.

Connection presence is shown beside every player: green is connected, yellow is unstable, red is reconnecting and grey is temporarily offline. The host sees the same states in the player drawer. Browsers send a lightweight eight-second presence update; slow connections and stale presence are reflected without changing authoritative game state.

Every lobby player must explicitly choose **Ready** before the host can start. Disconnected or Away players block startup, team mode still requires two ready players per team, and Royal Race still requires unique colours. A server-controlled four-second countdown begins after the host presses Start; readiness is checked again at zero so a departure cannot create a broken match. Configuration, team or Royal colour changes reset readiness.

All turn deadlines are server-authored. Each browser derives a server clock offset from room updates, so a device with an inaccurate clock still shows the same remaining time as the other players. Short animated prompts and distinct sound cues announce whose turn it is and the required action across Word Link, Survey Showdown, Draw & Guess, Royal Race and Deal or No Deal.

The Away control lets a player step out without accumulating AFK misses. Word Link, Draw & Guess and Deal or No Deal skip or safely resolve an Away player's active turn. Active players who miss three tracked gameplay opportunities are removed safely; blank Survey participation, an untouched drawing turn, Word Link timeouts and Deal timeouts all contribute to that protection. Normal gameplay input resets the AFK counter.

If a player refreshes, switches apps or briefly loses their connection, their authenticated seat is protected for 45 seconds. Their score, tokens, personal Deal case, drawing position and other room state remain on the authoritative server. Reopening the same browser session restores that seat; only an explicit Leave action or an expired reconnect window removes it from the active game. Set `RECONNECT_GRACE_MS` on the server to a value from 30000 to 60000 milliseconds to customize this window.

Joining after a match begins now opens spectator mode instead of rejecting the room code. Up to eight spectators can watch the synchronized game state, use text and voice chat, and send reactions without entering turn orders, scores, readiness checks or results. When the host returns the room to the lobby, spectators move into available player seats in arrival order up to the eight-player limit; any overflow remains in the gallery for a later seat.

If the host disconnects, control immediately moves to another connected active player so moderation and game flow remain available during the 45-second recovery window. When the original room owner reconnects, host control returns automatically. The current host can instead use **Make Host** in the player drawer to transfer ownership permanently, preventing the former owner from reclaiming it later.

Every completed match now shows a three-place podium with earned XP and permanent coin rewards. Connected players can vote for a rematch; a unanimous vote returns the group immediately. Otherwise, a server-controlled 20-second results countdown automatically returns everyone to the lobby, preserves the room code and communication session, promotes available spectators, and lets the host choose the next game without anyone rejoining.

Voice requires the secure Render `https://` address. The built-in dual-STUN configuration works on ordinary Wi-Fi and mobile networks. For maximum compatibility on restrictive networks, add `TURN_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL` to the Render service environment using credentials from a TURN provider. The microphone button shows **READY** while waiting and the number of connected players once audio links are established.

## Deal or No Deal

Two to eight players each take a turn locking one personal case from a shared 26-case Rand board. Active players then rotate, opening exactly one unowned case per turn so everyone participates in each elimination cycle. After every full rotation, the automatic banker animates through calling, deciding and private individual offers. Each active player independently chooses Deal or No Deal. A player who accepts secures that offer and continues watching through room chat or voice; the remaining players continue. When no unowned cases remain, the final offers are made and every personal case is revealed. Each player receives either the deal they accepted or the value in their personal case, and the highest payout wins. Deal results contribute normalized XP to the Champions Board.

Each compact player card shows its owner, personal case, current estimated unopened-case value, accepted-deal status and cases remaining. The current-player header and server-synchronized 30-second offer timer remain visible above the board. Banker generosity increases with round progress while a volatility discount accounts for the risk in the remaining values; late and final offers use progressively higher offer factors.

## Run locally

```bash
cd tms-game-room
npm start
```

Open `http://localhost:3000`. Other phones on the same Wi-Fi can open `http://YOUR-PC-IP:3000`. Windows Firewall may ask you to allow Node on private networks.

## Put it online

Deploy this folder to a Node-compatible host such as Render, Railway, Fly.io or a VPS. Set the start command to `npm start` and use HTTPS through the hosting provider. For restart-safe rooms, attach PostgreSQL and set its connection string as the `DATABASE_URL` environment variable. The server creates its room-state table automatically, saves mutations with a short debounce, restores active rooms after redeployment and gives restored players the normal reconnect grace period. Without `DATABASE_URL`, the app deliberately falls back to temporary in-memory rooms for local development.

Optional database settings:

- `DATABASE_SSL=false` only when using a trusted local PostgreSQL server without TLS.
- `DATABASE_POOL_SIZE=5` controls the maximum PostgreSQL connection pool.
- Active room snapshots expire after 24 hours and are deleted immediately after the final player leaves.

## Rules

- Two to eight players join with a six-character room code.
- The next word must contain at least four letters and start with the final letter of the current word.
- A repeated, malformed, mismatched or late word earns a strike.
- Three strikes eliminate a player; the last active player wins.
- Turns last 15 seconds, tightening to 10 seconds when three players remain and 7 seconds for the final two.
- Version one intentionally has no TikTok integration.

Because this first release does not use an external dictionary service, it validates the link and repetition rules but trusts players to enter real words. A host challenge/approval system or bundled dictionary can be added next.

## Survey Showdown

The host chooses free-for-all or two-team play. In team mode, players select Gold or Blue and each team must have at least two members. Five randomly selected 60-second surveys are played. After each answer-board reveal, the next survey starts automatically following a five-second results pause. The first player to reveal an answer earns its points (or earns them for the whole team). Fuzzy matching accepts aliases, plurals and minor spelling differences. The build includes 200 survey boards: 180 focused on general life and 20 mixed everyday topics.

Answer matching now passes through one server-side matcher for every player and device. At the reveal, each board answer lists its accepted aliases so close-answer decisions are transparent. The server rejects a submission timestamped at or after the authoritative deadline even if that player’s phone is lagging, preventing late answers from changing the board.

Validate the full survey pack with `node tools/validate_surveys.js`.

## Draw & Guess

Phone and mouse drawing uses coalesced pointer input and incremental network rendering for smooth curves without full-canvas flicker. Leaving the room removes that player from the active game; if the current artist leaves, the next eligible artist starts automatically.

The host selects 5 or 10 total drawing turns. If there are more players than selected turns, the game automatically increases the total so every player draws at least once before anyone repeats. Each turn lasts 60 seconds. After the word reveal, the next artist starts automatically following a five-second results pause. Only the drawer receives the secret word; other authenticated players receive a masked word and the synchronized canvas.

The enlarged canvas uses a fixed 1200×900 backing surface and normalized pointer coordinates for accurate mouse, stylus, and multi-direction finger drawing at any responsive display size. Scoring stays on a clear 0–100 game scale: each correct guess earns 5 points, up to 4 speed points, and a 1-point first-guesser bonus. The artist earns 1 point for each correct guesser, and every player’s game score is capped at 100.

The canvas keeps its native 4:3 proportions on every display, captures a stroke outside its visible edge, rejects secondary and palm-sized touch contacts, and groups compact network batches from one physical gesture under a single undo action. Reconnecting and late-arriving spectators receive the complete current stroke history. Clearing the canvas requires confirmation. Common aliases such as “phone” for “telephone” and “soccer ball” for “football” are accepted while tiny fragments are rejected. If the drawer enabled voice, their outgoing microphone track pauses automatically for the active drawing turn and restores afterward so the secret answer is not spoken accidentally.

## TM’s Royal Race

An original 2–4 player cross-and-circle race game with four tokens per colour. Players choose Gold, Blue, Green or Red. The authoritative server generates dice rolls and validates releases, legal moves, captures, safe cells, bonus rolls, exact home-lane movement, timed turns and final placements. Moving tokens advance one square at a time; caught tokens visibly retrace the board square-by-square before returning to base. The 900×900 logical board and touch targets scale together for accurate phone and desktop input. This project uses original TM branding and does not include Ludo King artwork or branding.

The premium presentation uses an animated tumbling dice, gold-star safe cells, enlarged crown-marked dimensional tokens, and strong active-player colour highlighting. Tokens traverse every intermediate board cell with a smooth hop instead of teleporting to the destination. The final exact roll moves directly from the last track square into the crown; there are no hidden home-lane steps. Each player may run the 30-second timer down three times; the third expiration removes them from the race. Capturing, rolling a six, or bringing any token home awards a bonus turn.

## Compact active-game screens

During a live game, the full player list is replaced by a small Players button that opens a name drawer on demand. Draw & Guess removes the spectator overlay and gives the canvas more screen space. Survey Showdown keeps a large, phone-friendly answer box near the bottom controls. These changes keep active games centered and reduce unnecessary page scrolling.
