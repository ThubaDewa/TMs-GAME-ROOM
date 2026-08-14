# TM’s GAME ROOM — Word Link

A responsive 2–8 player browser game. The host and players can all use phones; nobody installs an app. The same room now includes **Word Link** and **Survey Showdown**.

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
