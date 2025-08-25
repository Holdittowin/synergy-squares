/*
 * Client-side logic for Synergy Squares.
 * Handles authentication, socket events, UI updates, and leaderboards.
 */

// Store global state.
let currentPlayer = null;
let isHolding = false;
let heldSquareIndex = null;
let pollInterval = null;

// DOM elements.
const authDiv = document.getElementById('auth');
const gameDiv = document.getElementById('game');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const authMessage = document.getElementById('authMessage');
const logoutBtn = document.getElementById('logoutBtn');
const welcomeSpan = document.getElementById('welcome');
const levelInfo = document.getElementById('levelInfo');
const playersInfo = document.getElementById('playersInfo');
const boardDiv = document.getElementById('board');
const completionMessage = document.getElementById('completionMessage');
const globalTable = document.getElementById('globalTable');
const countryTable = document.getElementById('countryTable');

// Load player from sessionStorage if available.
const storedPlayer = sessionStorage.getItem('player');
if (storedPlayer) {
  currentPlayer = JSON.parse(storedPlayer);
  showGame();
  startGame();
} else {
  showAuth();
}

/**
 * Display authentication UI and hide game UI.
 */
function showAuth() {
  authDiv.classList.remove('hidden');
  gameDiv.classList.add('hidden');
}

/**
 * Display game UI and hide authentication UI.
 */
function showGame() {
  authDiv.classList.add('hidden');
  gameDiv.classList.remove('hidden');
  if (currentPlayer) {
    welcomeSpan.textContent = `Welcome, ${currentPlayer.nickname} (${currentPlayer.country})`;
  }
}

/**
 * Show an authentication message.
 */
function setAuthMessage(msg) {
  authMessage.textContent = msg;
}

/**
 * Handle login form submission.
 */
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        currentPlayer = data.player;
        sessionStorage.setItem('player', JSON.stringify(currentPlayer));
        setAuthMessage('');
        showGame();
        startGame();
      } else {
        setAuthMessage(data.message || 'Login failed');
      }
    })
    .catch((err) => {
      setAuthMessage('Error during login');
      console.error(err);
    });
});

/**
 * Handle registration form submission.
 */
registerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const nickname = document.getElementById('regNickname').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const country = document.getElementById('regCountry').value.trim();
  fetch('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname, email, password, country }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        currentPlayer = data.player;
        sessionStorage.setItem('player', JSON.stringify(currentPlayer));
        setAuthMessage('');
        showGame();
        startGame();
      } else {
        setAuthMessage(data.message || 'Registration failed');
      }
    })
    .catch((err) => {
      setAuthMessage('Error during registration');
      console.error(err);
    });
});

/**
 * Start the game by polling the board periodically.
 */
function startGame() {
  // First, join the game to mark this player as online.
  fetch('/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: currentPlayer.id }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        updateBoard(data.board);
        loadLeaderboards();
        // Start polling after successful join.
        if (pollInterval) clearInterval(pollInterval);
        fetchBoard();
        pollInterval = setInterval(fetchBoard, 1000);
      } else {
        console.error('Join failed', data.message);
      }
    })
    .catch((err) => console.error('Error joining game', err));
}

/**
 * Fetch the current board state from the server and update UI.
 */
function fetchBoard() {
  fetch('/board')
    .then((res) => res.json())
    .then((board) => {
      updateBoard(board);
    })
    .catch((err) => console.error('Error fetching board', err));
}

/**
 * Render the board and status.
 */
function updateBoard(board) {
  // Update level info and players info.
  levelInfo.textContent = `Level: ${board.level} (squares: ${board.squaresCount})`;
  playersInfo.textContent = `Players online: ${board.players.length} / ${board.squaresCount}`;
  // Set grid template columns based on number of squares. We'll try to make a square grid.
  const n = board.squaresCount;
  const cols = Math.ceil(Math.sqrt(n));
  boardDiv.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  // Clear existing squares.
  boardDiv.innerHTML = '';
  // Create squares.
  for (let i = 0; i < n; i++) {
    const sq = document.createElement('div');
    sq.classList.add('square');
    const occupantId = board.occupied[i];
    if (occupantId) {
      sq.classList.add('occupied');
      // Find occupant's nickname.
      const occupant = board.players.find((p) => p.id === occupantId);
      sq.textContent = occupant ? occupant.nickname : 'Occupied';
    }
    // Add pointer event listeners if this client is allowed to interact.
    if (!occupantId && currentPlayer && board.players.length === board.squaresCount) {
      sq.addEventListener('pointerdown', () => {
        if (!isHolding && currentPlayer) {
          isHolding = true;
          heldSquareIndex = i;
          // Attempt to hold square via POST
          fetch('/hold', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerId: currentPlayer.id, squareIndex: i }),
          })
            .then((res) => res.json())
            .then((data) => {
              if (data.success) {
                updateBoard(data.board);
                if (data.levelCompleted) {
                  completionMessage.textContent = `Level ${board.level} completed! Starting next level with ${data.board.squaresCount} squares...`;
                  setTimeout(() => {
                    completionMessage.textContent = '';
                    loadLeaderboards();
                  }, 3000);
                }
              } else {
                console.warn('Hold failed', data.message);
              }
            })
            .catch((err) => console.error('Error holding square', err));
        }
      });
    }
    boardDiv.appendChild(sq);
  }
  // Always listen for pointerup/cancel on window to release hold.
  window.onpointerup = window.onpointercancel = () => {
    if (isHolding && currentPlayer) {
      fetch('/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: currentPlayer.id }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            updateBoard(data.board);
          }
        })
        .catch((err) => console.error('Error releasing square', err));
      isHolding = false;
      heldSquareIndex = null;
    }
  };
}

/**
 * Fetch and display leaderboards.
 */
function loadLeaderboards() {
  // Global leaderboard.
  fetch('/leaderboard')
    .then((res) => res.json())
    .then((data) => {
      renderLeaderboardTable(globalTable, data.players);
    })
    .catch((err) => console.error('Error loading global leaderboard', err));
  // Leaderboard for player's country.
  if (currentPlayer && currentPlayer.country) {
    const country = encodeURIComponent(currentPlayer.country);
    fetch(`/leaderboard?country=${country}`)
      .then((res) => res.json())
      .then((data) => {
        renderLeaderboardTable(countryTable, data.players);
      })
      .catch((err) => console.error('Error loading country leaderboard', err));
  }
}

/**
 * Render a leaderboard table given an array of {nickname, country, levelsCompleted}.
 */
function renderLeaderboardTable(table, players) {
  table.innerHTML = '';
  if (!players || players.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.textContent = 'No players';
    row.appendChild(cell);
    table.appendChild(row);
    return;
  }
  // Header
  const header = document.createElement('tr');
  ['#', 'Nickname', 'Country', 'Levels'].forEach((text) => {
    const th = document.createElement('th');
    th.textContent = text;
    header.appendChild(th);
  });
  table.appendChild(header);
  // Rows
  players.forEach((p, idx) => {
    const row = document.createElement('tr');
    [idx + 1, p.nickname, p.country, p.levelsCompleted].forEach((val) => {
      const td = document.createElement('td');
      td.textContent = val;
      row.appendChild(td);
    });
    table.appendChild(row);
  });
}

/**
 * Handle logout: clear session and reload page.
 */
logoutBtn.addEventListener('click', () => {
  sessionStorage.removeItem('player');
  // Stop polling
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  currentPlayer = null;
  window.location.reload();
});
