# TM’s GAME ROOM

A responsive multiplayer browser game. The host and players can all use phones; nobody installs an app. The same room now includes **Word Link**, **Survey Showdown**, **Draw & Guess**, **TM’s Royal Race**, and **Deal or No Deal**.

Every room includes a reliable text-chat drawer, opt-in peer-to-peer WebRTC voice chat with microphone mute/off controls, and a Champions Board. The leaderboard compiles normalized XP, wins, games played and levels across all games in the current room, with separate per-game filters. Microphones are off by default and require browser permission.

Voice requires the secure Render `https://` address. The built-in dual-STUN configuration works on ordinary Wi-Fi and mobile networks. For maximum compatibility on restrictive networks, add `TURN_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL` to the Render service environment using credentials from a TURN provider. The microphone button shows **READY** while waiting and the number of connected players once audio links are established.

## Deal or No Deal

Two to eight players each take a turn locking one personal case from a shared 26-case Rand board. Active players then rotate, opening exactly one unowned case per turn so everyone participates in each elimination cycle. After every full rotation, the automatic banker animates through calling, deciding and private individual offers. Each active player independently chooses Deal or No Deal. A player who accepts secures that offer and continues watching through room chat or voice; the remaining players continue. When no unowned cases remain, the final offers are made and every personal case is revealed. Each player receives either the deal they accepted or the value in their personal case, and the highest payout wins. Deal results contribute normalized XP to the Champions Board.

## Run locally

```bash
cd tms-game-room
npm start
```

Open `http://localhost:3000`. Other phones on the same Wi-Fi can open `http://YOUR-PC-IP:3000`. Windows Firewall may ask you to allow Node on private networks.

## Put it online

Deploy this folder to a Node-compatible host such as Render, Railway, Fly.io or a VPS. Set the start command to `npm start`. The current release stores rooms in memory, so use one server instance. For a permanent public launch, add Redis/database persistence and HTTPS through the hosting provider.

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

Validate the full survey pack with `node tools/validate_surveys.js`.

## Draw & Guess

Phone and mouse drawing uses coalesced pointer input and incremental network rendering for smooth curves without full-canvas flicker. Leaving the room removes that player from the active game; if the current artist leaves, the next eligible artist starts automatically.

The host selects 5 or 10 total drawing turns. If there are more players than selected turns, the game automatically increases the total so every player draws at least once before anyone repeats. Each turn lasts 60 seconds. After the word reveal, the next artist starts automatically following a five-second results pause. Only the drawer receives the secret word; other authenticated players receive a masked word and the synchronized canvas.

The enlarged canvas uses a fixed 1200×900 backing surface and normalized pointer coordinates for accurate mouse, stylus, and multi-direction finger drawing at any responsive display size. Scoring stays on a clear 0–100 game scale: each correct guess earns 5 points, up to 4 speed points, and a 1-point first-guesser bonus. The artist earns 1 point for each correct guesser, and every player’s game score is capped at 100.

## TM’s Royal Race

An original 2–4 player cross-and-circle race game with four tokens per colour. Players choose Gold, Blue, Green or Red. The authoritative server generates dice rolls and validates releases, legal moves, captures, safe cells, bonus rolls, exact home-lane movement, timed turns and final placements. Moving tokens advance one square at a time; caught tokens visibly retrace the board square-by-square before returning to base. The 900×900 logical board and touch targets scale together for accurate phone and desktop input. This project uses original TM branding and does not include Ludo King artwork or branding.

The premium presentation uses an animated tumbling dice, gold-star safe cells, enlarged crown-marked dimensional tokens, and strong active-player colour highlighting. Tokens traverse every intermediate board cell with a smooth hop instead of teleporting to the destination. The final exact roll moves directly from the last track square into the crown; there are no hidden home-lane steps. Each player may run the 30-second timer down three times; the third expiration removes them from the race. Capturing, rolling a six, or bringing any token home awards a bonus turn.

## Compact active-game screens

During a live game, the full player list is replaced by a small Players button that opens a name drawer on demand. Draw & Guess removes the spectator overlay and gives the canvas more screen space. Survey Showdown keeps a large, phone-friendly answer box near the bottom controls. These changes keep active games centered and reduce unnecessary page scrolling.
