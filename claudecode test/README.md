# 🐟⚽ Flopfish FC

A quirky multiplayer football game where a beached fish must flop to win!

## Project Structure

```
flopfish-fc/
├── index.html           # Menu UI + game screen
├── main.js              # Game logic (Three.js, physics, AI)
├── assets/
│   ├── menu-bg.png      # FISHBALL title screen
│   ├── fish.glb         # Koi model
│   ├── minnow.glb       # Minnow model
│   ├── guppy.glb        # Guppy model
│   ├── bass.glb         # Bass model
│   ├── ronaldo.glb      # Ronaldo AI opponent
│   └── sounds/
│       ├── breath1-9.mp3 # Fish breathing sounds
├── server/              # WebSocket server (Stage 2)
│   ├── server.js
│   ├── package.json
│   ├── README.md
│   └── .gitignore
├── .gitignore
├── .claude/
│   └── launch.json      # Dev server config
└── README.md            # This file
```

## Features

✅ **Single-player + Local AI**
- 2 game modes: Versus (6v6) + Co-op (3v1 Ronaldo)
- Beached fish physics (flopping movement)
- Smart AI opponents
- 4 fish skins
- Volume control
- Name customization

✅ **Online multiplayer (Firebase)**
- Real cross-device play via room codes (no server to host!)
- Host simulates ball/bots/score; each player streams their own fish
- Falls back to offline-with-bots automatically if Firebase isn't configured

⏳ **Optional: self-hosted WebSocket server** (`server/`, Render/Railway)

## Quick Start

### Frontend Only (Local)
```bash
npx http-server -p 5599 -c-1
# Open: http://localhost:5599
```

### Enable Online Multiplayer (Firebase — free, no server)
1. Go to https://console.firebase.google.com → **Create Project**
2. **Build → Realtime Database → Create Database** → pick a nearby region → **Start in test mode**
3. Copy the `databaseURL` it shows you
4. Paste it into `firebase-config.js` (replace the `YOUR_...` value)
5. Reload the game. Create a room, share the 4-digit code, friends **Join** with it.

> Until you fill in `firebase-config.js`, the game runs offline against bots — nothing breaks.

### With Server (LAN)
```bash
# Terminal 1: Start frontend server
npx http-server -p 5599 -c-1

# Terminal 2: Start backend server
cd server
npm install
npm start
# WebSocket: ws://localhost:8080
```

## Deploy to Render

See `server/README.md` for full deployment guide.

## How to Play

1. **Title** → START
2. **Home** → Enter name → Create Room
3. **Lobby** → Pick your slot (red/blue/fish)
4. **Game**
   - **A/D** or **←/→** = Turn
   - **Space** (hold) = Charge flop
   - **F** = Fullscreen
   - **Esc** = Menu

## Tech Stack

- **Frontend:** HTML5, Three.js (CDN), Web Audio
- **Backend:** Node.js, WebSocket (ws)
- **Hosting:** Vercel (frontend) + Render (server)
- **VCS:** GitHub

## Controls & Audio

- 🔊 Adjustable volume slider
- 🫧 Fish breathing sounds (9 variants)
- 🏃 Footstep/kick audio
- ⚽ Goal sound effect

## File Sizes

- Frontend: ~150KB (HTML + CSS + inline JS)
- Models: ~4MB (GLB files)
- Sounds: ~90KB (MP3s)
- Server: <1MB (Node.js)

## Next Steps

1. **Initialize Git**
   ```bash
   git init
   git add .
   git commit -m "Flopfish FC - Initial commit"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

2. **Deploy Frontend**
   - Vercel: Connect GitHub repo
   - Or: Any static host (GitHub Pages, Netlify)

3. **Deploy Backend**
   - Render.com (see `server/README.md`)

4. **Test Online**
   - Invite friends with room code
   - Play across devices!

## License

MIT

---

Made with 🐟 and ⚽
