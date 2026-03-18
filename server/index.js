const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// ─── Constants ───────────────────────────────────────────────────────────────
const ROLES = ['retailer', 'wholesaler', 'distributor', 'factory'];
const ROLE_LABELS = {
  retailer: 'Retailer',
  wholesaler: 'Wholesaler',
  distributor: 'Distributor',
  factory: 'Factory'
};
const HOLDING_COST = 0.5;
const BACKLOG_COST = 1.0;
const INITIAL_INVENTORY = 12;
const INITIAL_PIPELINE = 4;
const DEFAULT_WEEKS = 35;
const DEFAULT_DEMAND = { type: 'step', base: 4, step: 8, stepWeek: 5 };

// ─── Game State Store ────────────────────────────────────────────────────────
const games = new Map();

function generateRoomCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (games.has(code));
  return code;
}

function createTeam(teamName) {
  const positions = {};
  for (const role of ROLES) {
    positions[role] = {
      playerId: null,
      playerName: null,
      inventory: INITIAL_INVENTORY,
      backlog: 0,
      lastOrder: 0,
      lastShipment: 0,
      lastReceived: 0,
      incomingOrder: 0,
      cumulativeCost: 0,
      totalOrdered: 0,
      totalReceived: 0,
      submitted: false,
      currentOrder: null,
      // Two-slot shipping pipeline: [arrives next week, arrives in 2 weeks]
      shippingPipeline: [INITIAL_PIPELINE, INITIAL_PIPELINE],
      // History for charts
      history: {
        inventory: [],
        backlog: [],
        orders: [],
        costs: [],
        effectiveInventory: [],
        received: []
      }
    };
  }
  return { name: teamName, positions };
}

function getDemand(game, week) {
  const d = game.settings.demand;
  if (d.type === 'custom' && Array.isArray(d.values)) {
    return d.values[Math.min(week - 1, d.values.length - 1)] || d.base || 4;
  }
  // Step function
  return week < d.stepWeek ? d.base : d.step;
}

function createGame(settings = {}) {
  const code = generateRoomCode();
  const game = {
    code,
    status: 'lobby', // lobby | playing | finished
    week: 0,
    settings: {
      totalWeeks: settings.totalWeeks || DEFAULT_WEEKS,
      demand: settings.demand || { ...DEFAULT_DEMAND },
      teamCount: settings.teamCount || 1
    },
    teams: {},
    players: new Map(), // socketId -> { teamName, role, name }
    teacherSocketId: null
  };

  // Create default teams
  const count = game.settings.teamCount || 1;
  for (let i = 1; i <= count; i++) {
    const teamName = `Team ${i}`;
    game.teams[teamName] = createTeam(teamName);
  }

  games.set(code, game);
  return game;
}

// ─── Game Logic ──────────────────────────────────────────────────────────────

function processRound(game) {
  game.week++;
  const week = game.week;
  const customerDemand = getDemand(game, week);

  for (const [teamName, team] of Object.entries(game.teams)) {
    const pos = team.positions;

    // Step 1: Receive incoming shipments (front of shipping pipeline)
    for (const role of ROLES) {
      const p = pos[role];
      const received = p.shippingPipeline[0];
      p.shippingPipeline[0] = p.shippingPipeline[1];
      p.shippingPipeline[1] = 0;
      p.inventory += received;
      p.lastReceived = received;
      p.totalReceived += received;
    }

    // Step 2: Resolve orders cascade (orders are instant, downstream → upstream)
    // Each position sees its incoming order, then we resolve its outgoing order
    // (submitted or auto-order = incoming order), which becomes the next upstream's
    // incoming order. This ensures auto-orders use CURRENT demand, not stale values.
    for (let i = 0; i < ROLES.length; i++) {
      const p = pos[ROLES[i]];
      // Set incoming order
      if (i === 0) {
        p.incomingOrder = customerDemand; // Retailer gets customer demand
      } else {
        p.incomingOrder = pos[ROLES[i - 1]].currentOrder; // Instant from downstream
      }
      // Auto-order if player didn't submit
      if (p.currentOrder === null) {
        p.currentOrder = p.incomingOrder;
      }
    }

    // Step 3: Ship to downstream (fulfill incoming orders + backlog)
    for (let i = 0; i < ROLES.length; i++) {
      const role = ROLES[i];
      const p = pos[role];
      const totalDemand = p.incomingOrder + p.backlog;
      const shipped = Math.min(totalDemand, p.inventory);
      p.inventory -= shipped;
      p.backlog = totalDemand - shipped;
      p.lastShipment = shipped;

      // Put shipped units into downstream's shipping pipeline (2-week delay)
      if (i > 0) {
        const downstream = ROLES[i - 1];
        pos[downstream].shippingPipeline[1] = shipped;
      }
    }

    // Step 4: Record orders and handle factory production
    for (let i = 0; i < ROLES.length; i++) {
      const p = pos[ROLES[i]];
      p.lastOrder = p.currentOrder;
      p.totalOrdered += p.currentOrder;
    }
    // Factory production goes into its own shipping pipeline (2-week delay)
    pos.factory.shippingPipeline[1] = pos.factory.currentOrder;

    // Step 6: Calculate costs
    for (const role of ROLES) {
      const p = pos[role];
      const holdingCost = p.inventory * HOLDING_COST;
      const backlogCost = p.backlog * BACKLOG_COST;
      p.cumulativeCost += holdingCost + backlogCost;

      // Record history
      p.history.inventory.push(p.inventory);
      p.history.backlog.push(p.backlog);
      p.history.orders.push(p.lastOrder);
      p.history.costs.push(p.cumulativeCost);
      p.history.effectiveInventory.push(p.inventory - p.backlog);
      p.history.received.push(p.lastReceived);
    }

    // Reset submission state for next round
    for (const role of ROLES) {
      pos[role].submitted = false;
      pos[role].currentOrder = null;
    }
  }

  // Check if game is over
  if (game.week >= game.settings.totalWeeks) {
    game.status = 'finished';
  }
}

function getGameSummary(game) {
  const summary = { teams: {} };
  for (const [teamName, team] of Object.entries(game.teams)) {
    const teamSummary = { positions: {}, totalCost: 0 };
    const orderVariances = [];

    for (const role of ROLES) {
      const p = team.positions[role];
      teamSummary.positions[role] = {
        playerName: p.playerName || role,
        cumulativeCost: p.cumulativeCost,
        avgInventory: p.history.inventory.length > 0
          ? p.history.inventory.reduce((a, b) => a + b, 0) / p.history.inventory.length
          : 0,
        avgBacklog: p.history.backlog.length > 0
          ? p.history.backlog.reduce((a, b) => a + b, 0) / p.history.backlog.length
          : 0,
        maxOrder: p.history.orders.length > 0 ? Math.max(...p.history.orders) : 0,
        orderVariance: variance(p.history.orders)
      };
      teamSummary.totalCost += p.cumulativeCost;
      orderVariances.push(variance(p.history.orders));
    }

    // Bullwhip ratio: variance of factory orders / variance of customer demand
    const demandHistory = [];
    for (let w = 1; w <= game.week; w++) {
      demandHistory.push(getDemand(game, w));
    }
    const demandVar = variance(demandHistory);
    teamSummary.bullwhipRatio = demandVar > 0
      ? (variance(team.positions.factory.history.orders) / demandVar).toFixed(2)
      : 'N/A';

    // Optimal cost: if everyone ordered exactly customer demand
    let optimalCost = 0;
    const optSim = simulateOptimal(game);
    teamSummary.optimalCost = optSim;

    summary.teams[teamName] = teamSummary;
  }
  return summary;
}

function variance(arr) {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / arr.length;
}

function simulateOptimal(game) {
  // Simulate what would happen if everyone ordered exactly customer demand each week
  let totalCost = 0;
  const weeks = game.week;
  // With step demand and initial conditions, calculate costs
  // Simplified: run the simulation with perfect ordering
  const inv = [INITIAL_INVENTORY, INITIAL_INVENTORY, INITIAL_INVENTORY, INITIAL_INVENTORY];
  const backlog = [0, 0, 0, 0];
  const shipPipe = ROLES.map(() => [INITIAL_PIPELINE, INITIAL_PIPELINE]);

  for (let w = 1; w <= weeks; w++) {
    const demand = getDemand(game, w);

    for (let i = 0; i < 4; i++) {
      // Receive shipment
      const received = shipPipe[i][0];
      shipPipe[i][0] = shipPipe[i][1];
      shipPipe[i][1] = 0;
      inv[i] += received;

      // Fulfill demand + backlog
      const totalDemand = demand + backlog[i];
      const shipped = Math.min(totalDemand, inv[i]);
      inv[i] -= shipped;
      backlog[i] = totalDemand - shipped;

      // Ship to downstream pipeline
      if (i > 0) {
        shipPipe[i - 1][1] = shipped;
      }

      // Order exactly demand (factory produces)
      if (i === 3) {
        shipPipe[i][1] = demand;
      }

      // Cost
      totalCost += inv[i] * HOLDING_COST + backlog[i] * BACKLOG_COST;
    }
  }

  return Math.round(totalCost * 100) / 100;
}

function getGameState(game) {
  const teams = {};
  for (const [teamName, team] of Object.entries(game.teams)) {
    teams[teamName] = {
      name: team.name,
      positions: {}
    };
    for (const role of ROLES) {
      const p = team.positions[role];
      teams[teamName].positions[role] = {
        playerName: p.playerName,
        playerId: p.playerId ? true : false, // Don't expose socket IDs
        inventory: p.inventory,
        backlog: p.backlog,
        lastOrder: p.lastOrder,
        lastShipment: p.lastShipment,
        incomingOrder: p.incomingOrder,
        cumulativeCost: p.cumulativeCost,
        submitted: p.submitted,
        shippingPipeline: [...p.shippingPipeline],
        history: p.history
      };
    }
  }
  return {
    code: game.code,
    status: game.status,
    week: game.week,
    settings: game.settings,
    teams,
    customerDemand: game.week > 0 ? getDemand(game, game.week) : getDemand(game, 1)
  };
}

function getPlayerState(game, teamName, role) {
  const team = game.teams[teamName];
  if (!team) return null;
  const p = team.positions[role];
  if (!p) return null;

  // Compute upstream backlog (what your supplier owes you)
  const roleIndex = ROLES.indexOf(role);
  let upstreamBacklog = 0;
  if (roleIndex < ROLES.length - 1) {
    // Your upstream is the next role in the chain
    upstreamBacklog = team.positions[ROLES[roleIndex + 1]].backlog;
  }
  // For factory, upstream backlog = 0 (produces internally)

  const pendingOrders = p.totalOrdered - p.totalReceived
    - p.shippingPipeline[0] - p.shippingPipeline[1];

  return {
    code: game.code,
    status: game.status,
    week: game.week,
    teamName,
    role,
    roleLabel: ROLE_LABELS[role],
    inventory: p.inventory,
    backlog: p.backlog,
    incomingOrder: p.incomingOrder,
    lastOrder: p.lastOrder,
    lastShipment: p.lastShipment,
    lastReceived: p.lastReceived,
    cumulativeCost: p.cumulativeCost,
    totalOrdered: p.totalOrdered,
    totalReceived: p.totalReceived,
    upstreamBacklog: Math.max(0, upstreamBacklog),
    pendingOrders: Math.max(0, pendingOrders),
    submitted: p.submitted,
    shippingPipeline: [...p.shippingPipeline],
    history: p.history,
    customerDemand: role === 'retailer' ? getDemand(game, Math.max(1, game.week)) : undefined
  };
}

// ─── Socket.IO ───────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  // Teacher: create game
  socket.on('create-game', (settings, callback) => {
    // Auto-cleanup: end any existing game this teacher is running
    for (const [oldCode, oldGame] of games) {
      if (oldGame.teacherSocketId === socket.id) {
        io.to(`game:${oldCode}`).emit('game-ended');
        for (const [sid] of oldGame.players) {
          const ps = io.sockets.sockets.get(sid);
          if (ps) ps.leave(`game:${oldCode}`);
        }
        socket.leave(`game:${oldCode}`);
        socket.leave(`teacher:${oldCode}`);
        games.delete(oldCode);
        console.log(`Auto-cleaned old game: ${oldCode}`);
      }
    }

    const game = createGame(settings);
    game.teacherSocketId = socket.id;
    socket.join(`game:${game.code}`);
    socket.join(`teacher:${game.code}`);
    console.log(`Game created: ${game.code}`);
    callback({ success: true, code: game.code, state: getGameState(game) });
  });

  // Teacher: rejoin game
  socket.on('teacher-join', (code, callback) => {
    const game = games.get(code);
    if (!game) return callback({ success: false, error: 'Game not found' });
    game.teacherSocketId = socket.id;
    socket.join(`game:${game.code}`);
    socket.join(`teacher:${game.code}`);
    callback({ success: true, state: getGameState(game) });
  });

  // Teacher: add team
  socket.on('add-team', (code, callback) => {
    const game = games.get(code);
    if (!game) return callback({ success: false, error: 'Game not found' });
    const teamNum = Object.keys(game.teams).length + 1;
    const teamName = `Team ${teamNum}`;
    game.teams[teamName] = createTeam(teamName);
    io.to(`game:${code}`).emit('game-state', getGameState(game));
    callback({ success: true });
  });

  // Teacher: remove team
  socket.on('remove-team', ({ code, teamName }, callback) => {
    const game = games.get(code);
    if (!game) return callback({ success: false, error: 'Game not found' });
    if (Object.keys(game.teams).length <= 1) {
      return callback({ success: false, error: 'Must have at least one team' });
    }
    // Disconnect players in that team
    for (const role of ROLES) {
      const p = game.teams[teamName].positions[role];
      if (p.playerId) {
        game.players.delete(p.playerId);
        const playerSocket = io.sockets.sockets.get(p.playerId);
        if (playerSocket) {
          playerSocket.emit('kicked', { reason: 'Team removed' });
          playerSocket.leave(`game:${code}`);
        }
      }
    }
    delete game.teams[teamName];
    io.to(`game:${code}`).emit('game-state', getGameState(game));
    callback({ success: true });
  });

  // Student: join game
  socket.on('join-game', ({ code, name }, callback) => {
    const game = games.get(code);
    if (!game) return callback({ success: false, error: 'Game not found' });
    if (game.status === 'finished') return callback({ success: false, error: 'Game is finished' });

    // Register as unassigned player
    game.players.set(socket.id, { name, teamName: null, role: null });
    socket.join(`game:${code}`);

    // Notify teacher
    io.to(`teacher:${code}`).emit('player-joined', {
      socketId: socket.id,
      name,
      unassigned: true
    });
    io.to(`teacher:${code}`).emit('game-state', getGameState(game));

    callback({ success: true, waiting: true, name });
  });

  // Student: rejoin game (reconnect after page reload)
  socket.on('rejoin-game', ({ code, name, teamName, role }, callback) => {
    const game = games.get(code);
    if (!game) return callback({ success: false, error: 'Game not found' });

    const team = game.teams[teamName];
    if (!team) return callback({ success: false, error: 'Team not found' });

    const pos = team.positions[role];
    if (!pos) return callback({ success: false, error: 'Role not found' });

    // Verify this player name matches the assigned name
    if (pos.playerName !== name) {
      return callback({ success: false, error: 'Role assigned to a different player' });
    }

    // Remove old socket entry if it exists
    if (pos.playerId && pos.playerId !== socket.id) {
      game.players.delete(pos.playerId);
    }

    // Re-register with new socket id
    pos.playerId = socket.id;
    game.players.set(socket.id, { name, teamName, role });
    socket.join(`game:${code}`);

    // Send current state back
    socket.emit('assigned', { teamName, role, roleLabel: ROLE_LABELS[role] });
    const playerState = getPlayerState(game, teamName, role);
    socket.emit('player-state', playerState);

    // Notify teacher
    io.to(`teacher:${code}`).emit('game-state', getGameState(game));

    callback({
      success: true,
      reassigned: true,
      status: game.status,
      teamName,
      role,
      roleLabel: ROLE_LABELS[role],
      playerState
    });
  });

  // Teacher: assign player to role
  socket.on('assign-player', ({ code, socketId, teamName, role }, callback) => {
    const game = games.get(code);
    if (!game) return callback({ success: false, error: 'Game not found' });
    if (!game.teams[teamName]) return callback({ success: false, error: 'Team not found' });
    if (!ROLES.includes(role)) return callback({ success: false, error: 'Invalid role' });

    const team = game.teams[teamName];
    const pos = team.positions[role];

    // If role is already taken, unassign the current player
    if (pos.playerId && pos.playerId !== socketId) {
      const oldPlayer = game.players.get(pos.playerId);
      if (oldPlayer) {
        oldPlayer.teamName = null;
        oldPlayer.role = null;
        const oldSocket = io.sockets.sockets.get(pos.playerId);
        if (oldSocket) {
          oldSocket.emit('unassigned');
        }
      }
    }

    // Unassign player from previous role if they had one
    const player = game.players.get(socketId);
    if (!player) return callback({ success: false, error: 'Player not found' });

    if (player.teamName && player.role) {
      const oldTeam = game.teams[player.teamName];
      if (oldTeam) {
        oldTeam.positions[player.role].playerId = null;
        oldTeam.positions[player.role].playerName = null;
      }
    }

    // Assign to new role
    pos.playerId = socketId;
    pos.playerName = player.name;
    player.teamName = teamName;
    player.role = role;

    // Notify the player
    const playerSocket = io.sockets.sockets.get(socketId);
    if (playerSocket) {
      playerSocket.emit('assigned', { teamName, role, roleLabel: ROLE_LABELS[role] });
      playerSocket.emit('player-state', getPlayerState(game, teamName, role));
    }

    io.to(`game:${code}`).emit('game-state', getGameState(game));
    callback({ success: true });
  });

  // Teacher: start game
  socket.on('start-game', (code, callback) => {
    const game = games.get(code);
    if (!game) return callback({ success: false, error: 'Game not found' });

    // Check all teams have all 4 roles assigned
    for (const [teamName, team] of Object.entries(game.teams)) {
      for (const role of ROLES) {
        if (!team.positions[role].playerId) {
          return callback({
            success: false,
            error: `${teamName}: ${ROLE_LABELS[role]} is not assigned`
          });
        }
      }
    }

    game.status = 'playing';
    game.week = 0;

    // Set initial incoming orders
    for (const team of Object.values(game.teams)) {
      for (const role of ROLES) {
        team.positions[role].incomingOrder = getDemand(game, 1);
      }
    }

    io.to(`game:${code}`).emit('game-started');
    io.to(`game:${code}`).emit('game-state', getGameState(game));

    // Send individual player states
    for (const [sid, player] of game.players) {
      if (player.teamName && player.role) {
        const ps = io.sockets.sockets.get(sid);
        if (ps) {
          ps.emit('player-state', getPlayerState(game, player.teamName, player.role));
        }
      }
    }

    callback({ success: true });
  });

  // Student: submit order
  socket.on('submit-order', ({ code, quantity }, callback) => {
    const game = games.get(code);
    if (!game) return callback({ success: false, error: 'Game not found' });
    if (game.status !== 'playing') return callback({ success: false, error: 'Game not in progress' });

    const player = game.players.get(socket.id);
    if (!player || !player.teamName || !player.role) {
      return callback({ success: false, error: 'Not assigned to a role' });
    }

    const qty = Math.floor(Number(quantity));
    if (isNaN(qty) || qty < 0) {
      return callback({ success: false, error: 'Order must be a non-negative integer' });
    }

    const team = game.teams[player.teamName];
    const pos = team.positions[player.role];
    pos.currentOrder = qty;
    pos.submitted = true;

    io.to(`teacher:${code}`).emit('game-state', getGameState(game));
    io.to(`teacher:${code}`).emit('order-submitted', {
      teamName: player.teamName,
      role: player.role,
      playerName: player.name
    });

    callback({ success: true });
  });

  // Teacher: advance round
  socket.on('advance-round', (code, callback) => {
    const game = games.get(code);
    if (!game) return callback({ success: false, error: 'Game not found' });
    if (game.status !== 'playing') return callback({ success: false, error: 'Game not in progress' });

    processRound(game);

    // Send updated state to everyone
    io.to(`game:${code}`).emit('game-state', getGameState(game));

    // Send individual player states
    for (const [sid, player] of game.players) {
      if (player.teamName && player.role) {
        const ps = io.sockets.sockets.get(sid);
        if (ps) {
          ps.emit('player-state', getPlayerState(game, player.teamName, player.role));
        }
      }
    }

    if (game.status === 'finished') {
      const summary = getGameSummary(game);
      io.to(`game:${code}`).emit('game-over', summary);
    }

    callback({ success: true, week: game.week, finished: game.status === 'finished' });
  });

  // Teacher: update settings
  socket.on('update-settings', ({ code, settings }, callback) => {
    const game = games.get(code);
    if (!game) return callback({ success: false, error: 'Game not found' });
    if (game.status !== 'lobby') return callback({ success: false, error: 'Cannot change settings during game' });

    if (settings.totalWeeks) game.settings.totalWeeks = settings.totalWeeks;
    if (settings.demand) game.settings.demand = settings.demand;

    io.to(`game:${code}`).emit('game-state', getGameState(game));
    callback({ success: true });
  });

  // Teacher: reset game
  socket.on('reset-game', (code, callback) => {
    const game = games.get(code);
    if (!game) return callback({ success: false, error: 'Game not found' });

    game.status = 'lobby';
    game.week = 0;

    // Reset all teams
    for (const [teamName, team] of Object.entries(game.teams)) {
      for (const role of ROLES) {
        const p = team.positions[role];
        p.inventory = INITIAL_INVENTORY;
        p.backlog = 0;
        p.lastOrder = 0;
        p.lastShipment = 0;
        p.incomingOrder = 0;
        p.cumulativeCost = 0;
        p.submitted = false;
        p.currentOrder = null;
        p.shippingPipeline = [INITIAL_PIPELINE, INITIAL_PIPELINE];
        p.lastReceived = 0;
        p.totalOrdered = 0;
        p.totalReceived = 0;
        p.history = { inventory: [], backlog: [], orders: [], costs: [], effectiveInventory: [], received: [] };
      }
    }

    io.to(`game:${code}`).emit('game-reset');
    io.to(`game:${code}`).emit('game-state', getGameState(game));
    callback({ success: true });
  });

  // Teacher: end game (kick all players, delete game)
  socket.on('end-game', (code, callback) => {
    const game = games.get(code);
    if (!game) return callback?.({ success: true });

    // Notify all players to reset
    io.to(`game:${code}`).emit('game-ended');

    // Remove all player sockets from the room
    for (const [sid] of game.players) {
      const ps = io.sockets.sockets.get(sid);
      if (ps) ps.leave(`game:${code}`);
    }

    games.delete(code);
    callback?.({ success: true });
  });

  // Get game summary
  socket.on('get-summary', (code, callback) => {
    const game = games.get(code);
    if (!game) return callback({ success: false, error: 'Game not found' });
    callback({ success: true, summary: getGameSummary(game) });
  });

  // Get unassigned players
  socket.on('get-players', (code, callback) => {
    const game = games.get(code);
    if (!game) return callback({ success: false, error: 'Game not found' });

    const players = [];
    for (const [sid, player] of game.players) {
      players.push({
        socketId: sid,
        name: player.name,
        teamName: player.teamName,
        role: player.role,
        connected: io.sockets.sockets.has(sid)
      });
    }
    callback({ success: true, players });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`Disconnected: ${socket.id}`);
    // Find and mark player as disconnected (but keep their assignment)
    for (const [code, game] of games) {
      const player = game.players.get(socket.id);
      if (player) {
        io.to(`teacher:${code}`).emit('player-disconnected', {
          socketId: socket.id,
          name: player.name,
          teamName: player.teamName,
          role: player.role
        });
        // Don't remove — they might reconnect
        break;
      }
    }
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', games: games.size });
});

// Serve built React frontend in production
const path = require('path');
const clientBuildPath = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientBuildPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Beer Game server running on port ${PORT}`);
});
