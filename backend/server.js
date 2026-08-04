let lobbyCountdown = 30;
let lobbyTimer = null;
let isGameStarted = false;
let players = { red: 0, blue: 0 };

function startLobbyCountdown() {
  if (lobbyTimer) return; // 避免重複啟動

  lobbyCountdown = 30;
  isGameStarted = false;

  lobbyTimer = setInterval(() => {
    lobbyCountdown--;
    
    // 廣播給所有玩家等候區倒數與隊伍人數
    io.emit('lobby_update', {
      countdown: lobbyCountdown,
      redCount: players.red,
      blueCount: players.blue,
      isWaiting: !isGameStarted
    });

    if (lobbyCountdown <= 0) {
      clearInterval(lobbyTimer);
      lobbyTimer = null;
      isGameStarted = true;

      // 倒數結束：廣播正式開戰，並發出第 1 題
      io.emit('battle_start');
      broadcastCurrentQuestion(null);
    }
  }, 1000);
}

io.on('connection', (socket) => {
  socket.on('join_team', (team) => {
    socket.team = team;
    if (team === 'red') players.red++;
    if (team === 'blue') players.blue++;

    // 只要有第一個玩家加入，立刻觸發 30 秒等候區倒數！
    startLobbyCountdown();
  });

  socket.on('disconnect', () => {
    if (socket.team === 'red') players.red = Math.max(0, players.red - 1);
    if (socket.team === 'blue') players.blue = Math.max(0, players.blue - 1);
  });
});
