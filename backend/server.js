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

// 🎲 演算法自動生成 100 題心算題目（加、減、乘、除）
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
        num2 = Math.floor(Math.random() * num1) + 1; // 確保結果為正數
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
        num1 = num2 * answer; // 確保整除
        qText = `${num1} ÷ ${num2}`;
        break;
    }

    // 自動產生 3 個干擾項答案
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

let gameState = {
  redScore: 0,
  blueScore: 0,
  ropePosition: 50,
  targetDiff: 200,
  questions: generate100Questions()
};

// 重置並重新生成 100 題
app.get('/api/start-game', (req, res) => {
  gameState.redScore = 0;
  gameState.blueScore = 0;
  gameState.ropePosition = 50;
  gameState.questions = generate100Questions(); // 每次點擊重新生成全新的 100 題

  io.emit('game_init', gameState);
  res.json({ success: true, message: "遊戲已重置，已載入全新 100 題！", totalQuestions: gameState.questions.length });
});

io.on('connection', (socket) => {
  socket.emit('game_update', gameState);

  socket.on('join_team', (team) => {
    socket.team = team;
  });

  socket.on('submit_answer', ({ isCorrect, responseTimeSec }) => {
    if (!isCorrect || !socket.team) return;

    // 速度加分機制
    const speedBonus = Math.max(0, Math.floor((1.5 - responseTimeSec) * 10));
    const points = 10 + speedBonus;

    if (socket.team === 'red') gameState.redScore += points;
    else if (socket.team === 'blue') gameState.blueScore += points;

    const diff = gameState.redScore - gameState.blueScore;
    gameState.ropePosition = Math.min(100, Math.max(0, 50 + (diff / gameState.targetDiff) * 50));

    io.emit('game_update', gameState);

    // 勝負判定（拉鋸到兩端）
    if (gameState.ropePosition >= 100) io.emit('game_over', { winner: 'red' });
    else if (gameState.ropePosition <= 0) io.emit('game_over', { winner: 'blue' });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 伺服器運行於埠號 ${PORT}`));
