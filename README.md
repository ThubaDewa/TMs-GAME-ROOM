# TM’s GAME ROOM — Word Link

A responsive multiplayer browser game. The host and players can all use phones; nobody installs an app. The same room now includes **Word Link**, **Survey Showdown**, **Draw & Guess**, and **TM’s Royal Race**.

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
- The next word must start with the final letter of the current word.
- A repeated, malformed, mismatched or late word earns a strike.
- Three strikes eliminate a player; the last active player wins.
- Version one intentionally has no TikTok integration.

Because this first release does not use an external dictionary service, it validates the link and repetition rules but trusts players to enter real words. A host challenge/approval system or bundled dictionary can be added next.

## Survey Showdown

The host chooses free-for-all or two-team play. In team mode, players select Gold or Blue and each team must have at least two members. Five randomly selected 30-second surveys are played. The first player to reveal an answer earns its points (or earns them for the whole team). Fuzzy matching accepts aliases, plurals and minor spelling differences. The build includes 200 survey boards: 180 focused on general life and 20 mixed everyday topics.

Validate the full survey pack with `node tools/validate_surveys.js`.

## Draw & Guess

The host selects 5 or 10 total drawing turns. If there are more players than selected turns, the game automatically increases the total so every player draws at least once before anyone repeats. Each turn lasts 60 seconds. Only the drawer receives the secret word; other authenticated players receive a masked word and the synchronized canvas.

The canvas uses a fixed 1200×675 backing surface and normalized pointer coordinates for accurate mouse, stylus, and multi-direction finger drawing at any responsive display size. Correct guesses earn 100 base points plus up to 400 time points. The first correct guess earns another 100 points, and the drawer receives 50 points for every correct guesser.

## TM’s Royal Race

An original 2–4 player cross-and-circle race game with four tokens per colour. Players choose Gold, Blue, Green or Red. The authoritative server generates dice rolls and validates releases, legal moves, captures, safe cells, bonus rolls, exact home-lane movement, timed turns and final placements. Moving tokens advance one square at a time; caught tokens visibly retrace the board square-by-square before returning to base. The 900×900 logical board and touch targets scale together for accurate phone and desktop input. This project uses original TM branding and does not include Ludo King artwork or branding.

The premium presentation uses an animated tumbling dice, gold-star safe cells, crown-marked dimensional tokens, active-player colour highlighting, muted inactive players, and a compact two-column mobile player strip. Tokens traverse every intermediate board cell with a smooth hop instead of teleporting to the destination. Each player may run the 30-second timer down three times; the third expiration removes them from the race. Capturing, rolling a six, or bringing any token home awards a bonus turn.
