const http = require('http');
const fs = require('fs');
const path = require('path');

/**
 * Simple HTTP server for Synergy Squares game using only core Node.js modules.
 * This server implements registration, login, leaderboard and real-time game logic via
 * periodic polling. No external dependencies or package installation is required.
 */

// -----------------------------------------------------------------------------
// Helpers for persistent player storage
// -----------------------------------------------------------------------------

const playersFile = path.join(__dirname, 'players.json');

/**
 * Load players from disk. Returns an array of player objects.
 */
function loadPlayers() {
  try {
    return JSON.parse(fs.readFileSync(playersFile, 'utf8'));
  } catch (err) {
    return [];
  }
}

/**
 * Save players array to disk.
 */
function savePlayers(players) {
  fs.writeFileSync(playersFile, JSON.stringify(players, null, 2));
}

let players = loadPlayers();

/**
 * Generate a unique player ID.
 */
function generatePlayerId() {
  return 'p_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function getPlayerById(id) {
  return players.find((p) => p.id === id);
}

// -----------------------------------------------------------------------------
// Game state management
// -----------------------------------------------------------------------------

let currentLevel = 1;
let squaresCount = 4;
let occupied = {}; // Map of squareIndex -> playerId
const playersOnline = {}; // Map of playerId -> { id, nickname, country, role, levelsCompleted, squareIndex }

/**
 * Build board state to send to clients.
 */
function getBoardState() {
  return {
    level: currentLevel,
    squaresCount,
    occupied: Object.assign({}, occupied),
    players: Object.values(playersOnline).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      country: p.country,
      squareIndex: p.squareIndex,
    })),
  };
}

/**
 * Check whether the current level is complete.
 */
function checkLevelCompletion() {
  const allOccupied = Object.keys(occupied).length === squaresCount;
  const activePlayers = Object.keys(playersOnline).length;
  return allOccupied && activePlayers === squaresCount;
}

/**
 * Handle completion of the level: update player stats, increase level & squares.
 */
function completeLevel() {
  // Update levelsCompleted for players occupying squares.
  Object.values(playersOnline).forEach((p) => {
    if (p.squareIndex !== null && p.squareIndex !== undefined) {
      const stored = getPlayerById(p.id);
      if (stored) {
        stored.levelsCompleted = (stored.levelsCompleted || 0) + 1;
      }
      p.levelsCompleted = (p.levelsCompleted || 0) + 1;
    }
  });
  savePlayers(players);
  currentLevel += 1;
  squaresCount *= 2;
  occupied = {};
  Object.values(playersOnline).forEach((p) => {
    p.squareIndex = null;
  });
}

// -----------------------------------------------------------------------------
// HTTP Server Implementation
// -----------------------------------------------------------------------------

/**
 * Write a JSON response with given status code and body.
 */
function writeJson(res, statusCode, body) {
  const data = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(data);
}

/**
 * Serve static files from the "public" directory.
 */
function serveStatic(req, res) {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  // Prevent directory traversal
  filePath = path.normalize(filePath).replace(/^([/\\]*\.*)*[/\\]/, '');
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.ico': 'image/x-icon',
    };
    const contentType = mimeTypes[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

/**
 * Handle incoming request: route to API endpoints or serve static content.
 */
function handleRequest(req, res) {
  const { method, url: reqUrl } = req;
  // Preflight for CORS
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }
  // API routes
  if (reqUrl.startsWith('/register') && method === 'POST') {
    return handleRegister(req, res);
  }
  if (reqUrl.startsWith('/login') && method === 'POST') {
    return handleLogin(req, res);
  }
  if (reqUrl.startsWith('/leaderboard') && method === 'GET') {
    return handleLeaderboard(req, res);
  }
  if (reqUrl.startsWith('/board') && method === 'GET') {
    return handleBoard(req, res);
  }
  if (reqUrl.startsWith('/join') && method === 'POST') {
    return handleJoin(req, res);
  }
  if (reqUrl.startsWith('/hold') && method === 'POST') {
    return handleHold(req, res);
  }
  if (reqUrl.startsWith('/release') && method === 'POST') {
    return handleRelease(req, res);
  }
  // Otherwise serve static.
  serveStatic(req, res);
}

/**
 * Parse JSON body from request.
 */
function parseJsonBody(req, callback) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    try {
      const parsed = JSON.parse(body || '{}');
      callback(null, parsed);
    } catch (err) {
      callback(err);
    }
  });
}

/**
 * Handle registration endpoint.
 */
function handleRegister(req, res) {
  parseJsonBody(req, (err, data) => {
    if (err) return writeJson(res, 400, { success: false, message: 'Invalid JSON' });
    const { nickname, email, password, country } = data;
    if (!nickname || !email || !password || !country) {
      return writeJson(res, 400, { success: false, message: 'Missing required fields' });
    }
    if (players.some((p) => p.email.toLowerCase() === email.toLowerCase())) {
      return writeJson(res, 400, { success: false, message: 'Email already registered' });
    }
    const player = {
      id: generatePlayerId(),
      nickname,
      email,
      password,
      country,
      role: 'player',
      levelsCompleted: 0,
    };
    players.push(player);
    savePlayers(players);
    const { password: pw, ...withoutPassword } = player;
    writeJson(res, 200, { success: true, player: withoutPassword });
  });
}

/**
 * Handle login endpoint.
 */
function handleLogin(req, res) {
  parseJsonBody(req, (err, data) => {
    if (err) return writeJson(res, 400, { success: false, message: 'Invalid JSON' });
    const { email, password } = data;
    const user = players.find((p) => p.email.toLowerCase() === (email || '').toLowerCase());
    if (!user || user.password !== password) {
      return writeJson(res, 401, { success: false, message: 'Invalid credentials' });
    }
    const { password: pw, ...withoutPassword } = user;
    writeJson(res, 200, { success: true, player: withoutPassword });
  });
}

/**
 * Handle leaderboard endpoint.
 */
function handleLeaderboard(req, res) {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const countryFilter = urlObj.searchParams.get('country');
  let filtered = players;
  if (countryFilter) {
    filtered = players.filter((p) => p.country.toLowerCase() === countryFilter.toLowerCase());
  }
  const board = filtered
    .map((p) => ({
      id: p.id,
      nickname: p.nickname,
      country: p.country,
      levelsCompleted: p.levelsCompleted || 0,
    }))
    .sort((a, b) => b.levelsCompleted - a.levelsCompleted);
  writeJson(res, 200, { players: board });
}

/**
 * Handle board state request.
 */
function handleBoard(req, res) {
  writeJson(res, 200, getBoardState());
}

/**
 * Helper to register players as online. Called from hold/release endpoints.
 * Adds a player to playersOnline if not already, with default fields.
 */
function ensureOnline(playerId) {
  const stored = getPlayerById(playerId);
  if (!stored) return null;
  if (!playersOnline[playerId]) {
    playersOnline[playerId] = {
      id: stored.id,
      nickname: stored.nickname,
      country: stored.country,
      role: stored.role,
      levelsCompleted: stored.levelsCompleted || 0,
      squareIndex: null,
    };
  }
  return playersOnline[playerId];
}

/**
 * Handle hold square endpoint.
 */
function handleHold(req, res) {
  parseJsonBody(req, (err, data) => {
    if (err) return writeJson(res, 400, { success: false, message: 'Invalid JSON' });
    const { playerId, squareIndex } = data;
    if (!playerId || typeof squareIndex !== 'number') {
      return writeJson(res, 400, { success: false, message: 'Missing parameters' });
    }
    const player = ensureOnline(playerId);
    if (!player) {
      return writeJson(res, 400, { success: false, message: 'Unknown player' });
    }
    // Validate square and players count.
    if (squareIndex < 0 || squareIndex >= squaresCount) {
      return writeJson(res, 400, { success: false, message: 'Invalid square index' });
    }
    // If not enough players online to match squares, deny.
    if (Object.keys(playersOnline).length !== squaresCount) {
      return writeJson(res, 403, { success: false, message: 'Not enough players to start level' });
    }
    // Already holds another square
    if (player.squareIndex !== null && player.squareIndex !== undefined) {
      return writeJson(res, 403, { success: false, message: 'Player already holds a square' });
    }
    // Square occupied by someone else
    if (occupied[squareIndex]) {
      return writeJson(res, 403, { success: false, message: 'Square already occupied' });
    }
    // Assign square
    occupied[squareIndex] = player.id;
    player.squareIndex = squareIndex;
    // Check completion
    let levelCompleted = false;
    if (checkLevelCompletion()) {
      levelCompleted = true;
      completeLevel();
    }
    writeJson(res, 200, { success: true, board: getBoardState(), levelCompleted });
  });
}

/**
 * Handle release square endpoint.
 */
function handleRelease(req, res) {
  parseJsonBody(req, (err, data) => {
    if (err) return writeJson(res, 400, { success: false, message: 'Invalid JSON' });
    const { playerId } = data;
    if (!playerId) return writeJson(res, 400, { success: false, message: 'Missing playerId' });
    const player = playersOnline[playerId];
    if (!player) return writeJson(res, 400, { success: false, message: 'Player not online' });
    const idx = player.squareIndex;
    if (idx !== null && idx !== undefined) {
      delete occupied[idx];
      player.squareIndex = null;
    }
    writeJson(res, 200, { success: true, board: getBoardState() });
  });
}

/**
 * Handle join endpoint: register a player as online.
 * Expects { playerId } JSON body. Adds player to playersOnline with squareIndex null.
 */
function handleJoin(req, res) {
  parseJsonBody(req, (err, data) => {
    if (err) return writeJson(res, 400, { success: false, message: 'Invalid JSON' });
    const { playerId } = data;
    if (!playerId) return writeJson(res, 400, { success: false, message: 'Missing playerId' });
    const player = ensureOnline(playerId);
    if (!player) return writeJson(res, 400, { success: false, message: 'Unknown player' });
    // When joining a new level, ensure playersOnline count resets occupancy if too many.
    // Nothing else to do.
    writeJson(res, 200, { success: true, board: getBoardState() });
  });
}

// Create HTTP server
const server = http.createServer(handleRequest);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Synergy Squares server running at http://localhost:${PORT}`);
});
