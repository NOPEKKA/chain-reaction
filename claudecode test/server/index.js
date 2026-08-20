const WebSocket = require('ws');
const http = require('http');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

// Store rooms: { roomCode: { players: { slot: { pos, heading, name, team } }, ... } }
const rooms = {};

// Broadcast interval (30fps)
const TICK_RATE = 33; // ms

setInterval(() => {
  // Broadcast game state to all connected clients
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.roomCode) {
      const roomState = rooms[client.roomCode];
      if (roomState) {
        client.send(JSON.stringify({
          type: 'gameState',
          roomCode: client.roomCode,
          players: roomState.players
        }));
      }
    }
  });
}, TICK_RATE);

wss.on('connection', (ws) => {
  console.log('[Server] Client connected');
  ws.roomCode = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const { type, roomCode, slot, pos, heading, name, team } = data;

      switch (type) {
        case 'joinRoom':
          ws.roomCode = roomCode;
          if (!rooms[roomCode]) {
            rooms[roomCode] = { players: {} };
          }
          console.log(`[${roomCode}] Player ${slot} (${name}) joined`);
          rooms[roomCode].players[slot] = {
            pos,
            heading,
            name,
            team
          };
          break;

        case 'playerUpdate':
          if (ws.roomCode && rooms[ws.roomCode]) {
            rooms[ws.roomCode].players[slot] = {
              ...rooms[ws.roomCode].players[slot],
              pos,
              heading
            };
          }
          break;

        case 'goal':
          // Broadcast goal to all players in room
          if (ws.roomCode && rooms[ws.roomCode]) {
            wss.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN && client.roomCode === ws.roomCode) {
                client.send(JSON.stringify({ type: 'goal', side: data.side }));
              }
            });
          }
          break;

        default:
          console.log('[Server] Unknown message type:', type);
      }
    } catch (e) {
      console.error('[Server] Error processing message:', e.message);
    }
  });

  ws.on('close', () => {
    if (ws.roomCode) {
      console.log(`[${ws.roomCode}] Player disconnected`);
      // Clean up empty rooms
      if (Object.keys(rooms[ws.roomCode].players).length === 0) {
        delete rooms[ws.roomCode];
      }
    }
  });

  ws.on('error', (error) => {
    console.error('[Server] WebSocket error:', error.message);
  });
});

// Health check endpoint
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', rooms: Object.keys(rooms).length }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🐟 Flopfish Server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
