// backend/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// 🎲 心算 100 題生成器
function generate100Questions() {
  const questions = [];
  const operators = ['+', '-', '*', '/'];

  for (let i = 1; i <= 100; i++) {
    const op = operators[Math.floor(Math.random() * operators.length)];
    let num1, num2, answer, qText;

    switch (op) {
      case '+':
        num1 = Math.floor(Math.random() * 50) + 10;
        num2 = Math.floor(Math.random() * 50) + 10;
        answer = num1 + num2;
        qText = `${num1} + ${num2}`;
        break;
      case '-':
        num1 = Math.floor(Math.random() * 80) + 20;
        num2 = Math.floor(Math.random() * num1) + 1;
        answer = num1 - num2;
        qText = `${num1} - ${num2}`;
        break;
      case '*':
        num1 = Math.floor(Math.random() * 12) + 2;
        num2 = Math.floor(Math.random() * 12) + 2;
        answer = num1 * num2;
        qText = `${num1} × ${num2}`;
        break;
      case '/':
        num2 = Math.floor(Math.random() * 9) + 2;
        answer = Math.floor(Math.random() * 10) + 2;
        num1 = num2 * answer;
        qText = `${num1} ÷ ${num2}`;
        break;
    }

    const options = new Set([String(answer)]);
    while (options.size < 4) {
      const offset = (Math.floor(Math.random() * 5) + 1) * (Math.random() < 0.5 ? 1 : -1);
      const wrongAns = answer + offset;
      if (wrongAns >= 0) options.add(String(wrongAns));
    }

    questions.push({
      id: i,
      question: qText,
      options: Array.from(options).sort(() => Math.random() - 0.5),
      answer: String(answer)
    });
  }

  return questions;
}

let currentQuestionIndex = 0;
let gameState = {
  redScore: 0,
  blueScore: 0,
  ropePosition: 50,
  targetDiff: 200,
  questions: generate100Questions()
};

// 👥 紀錄所有連線玩家的隊伍陣營 Mapping { socket.id: 'red' | 'blue' }
const playerTeams = {};

// 計算兩隊當前真實線上人數並向全場廣播
function broadcastLobbyUpdate() {
  let redCount = 0;
  let blueCount = 0;

  for (const socketId in playerTeams) {
    if (playerTeams[socketId] === 'red') redCount++;
    if (playerTeams[socketId] === 'blue') blueCount++;
  }

  io.emit('lobby_update', { redCount, blueCount });
}

function broadcastCurrentQuestion(winnerTeam = null) {
  if (currentQuestionIndex < gameState.questions.length) {
    const q = gameState.questions[currentQuestionIndex];
    io.emit('new_question', {
      questionIndex: currentQuestionIndex,
      question: q.question,
      options: q.options,
      winnerTeam: winnerTeam
    });
  } else {
    const winner = gameState.redScore > gameState.blueScore ? 'red' : 'blue';
    io.emit('game_over', { winner });
  }
}

app.get('/api/start-game', (req, res) => {
  currentQuestionIndex = 0;
  gameState.redScore = 0;
  gameState.blueScore = 0;
  gameState.ropePosition = 50;
  gameState.questions = generate100Questions();

  io.emit('game_update', gameState);
  broadcastCurrentQuestion(null);

  res.json({ success: true, message: "遊戲已重置" });
});

io.on('connection', (socket) => {
  // 傳送當前比分與人數給新連線的玩家
  socket.emit('game_update', gameState);
  broadcastLobbyUpdate();

  if (gameState.questions[currentQuestionIndex]) {
    const q = gameState.questions[currentQuestionIndex];
    socket.emit('new_question', {
      questionIndex: currentQuestionIndex,
      question: q.question,
      options: q.options,
      winnerTeam: null
    });
  }

  // 玩家選擇加入隊伍
  socket.on('join_team', (team) => {
    socket.team = team;
    playerTeams[socket.id] = team;
    broadcastLobbyUpdate(); // 廣播最新真實人數
  });

  // 搶答判定
  socket.on('submit_claim', ({ selectedOption, responseTimeSec }, ack) => {
    if (!socket.team) return;

    const currentQ = gameState.questions[currentQuestionIndex];
    if (!currentQ) return;

    const isCorrect = (String(selectedOption) === currentQ.answer);

    if (isCorrect) {
      const speedBonus = Math.max(0, Math.floor((3.0 - responseTimeSec) * 5));
      const points = 10 + speedBonus;

      if (socket.team === 'red') gameState.redScore += points;
      else if (socket.team === 'blue') gameState.blueScore += points;

      const diff = gameState.redScore - gameState.blueScore;
      gameState.ropePosition = Math.min(100, Math.max(0, 50 + (diff / gameState.targetDiff) * 50));

      io.emit('game_update', gameState);

      if (gameState.ropePosition >= 100) {
        io.emit('game_over', { winner: 'red' });
        return;
      } else if (gameState.ropePosition <= 0) {
        io.emit('game_over', { winner: 'blue' });
        return;
      }

      const winnerTeam = socket.team;
      currentQuestionIndex++;
      broadcastCurrentQuestion(winnerTeam);

      if (ack) ack({ isCorrect: true });
    } else {
      if (ack) ack({ isCorrect: false });
    }
  });

  // 玩家斷線或離開網頁時，自動扣除該隊人數
  socket.on('disconnect', () => {
    delete playerTeams[socket.id];
    broadcastLobbyUpdate(); // 廣播最新真實人數
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 伺服器運行於埠號 ${PORT}`));
