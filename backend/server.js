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

// 🎲 演算法自動生成 100 題心算題目（保留你完美的演算法邏輯）
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

// 狀態管理：新增全場當前題號指標 currentQuestionIndex
let currentQuestionIndex = 0;
let gameState = {
  redScore: 0,
  blueScore: 0,
  ropePosition: 50,
  targetDiff: 200,
  questions: generate100Questions()
};

// 廣播全場最新題目給所有玩家
function broadcastCurrentQuestion(winnerTeam = null) {
  if (currentQuestionIndex < gameState.questions.length) {
    const q = gameState.questions[currentQuestionIndex];
    io.emit('new_question', {
      questionIndex: currentQuestionIndex,
      question: q.question,
      options: q.options,
      winnerTeam: winnerTeam // 告知全場上一題是哪個隊伍搶答成功
    });
  } else {
    // 100 題全數完成，判定最高分者勝
    const winner = gameState.redScore > gameState.blueScore ? 'red' : 'blue';
    io.emit('game_over', { winner });
  }
}

// 🎮 API：重置並重新生成 100 題全新的搶答對戰
app.get('/api/start-game', (req, res) => {
  currentQuestionIndex = 0;
  gameState.redScore = 0;
  gameState.blueScore = 0;
  gameState.ropePosition = 50;
  gameState.questions = generate100Questions();

  // 1. 廣播分數與繩索歸零
  io.emit('game_update', gameState);
  
  // 2. 廣播第 0 題給全場玩家
  broadcastCurrentQuestion(null);

  res.json({ success: true, message: "搶答對戰已重置，載入全新 100 題心算！", totalQuestions: gameState.questions.length });
});

io.on('connection', (socket) => {
  // 新玩家連線：傳送當前比分與全場最新的題目
  socket.emit('game_update', gameState);
  if (gameState.questions[currentQuestionIndex]) {
    const q = gameState.questions[currentQuestionIndex];
    socket.emit('new_question', {
      questionIndex: currentQuestionIndex,
      question: q.question,
      options: q.options,
      winnerTeam: null
    });
  }

  socket.on('join_team', (team) => {
    socket.team = team;
  });

  // ⚡ 全場即時搶答核心觸發器 (Claim Handler)
  socket.on('submit_claim', ({ selectedOption, responseTimeSec }, ack) => {
    if (!socket.team) return;

    const currentQ = gameState.questions[currentQuestionIndex];
    if (!currentQ) return;

    // 檢查是否搶答正確
    const isCorrect = (String(selectedOption) === currentQ.answer);

    if (isCorrect) {
      // 1. 計算搶答速度加分 (反應越快分數越高)
      const speedBonus = Math.max(0, Math.floor((3.0 - responseTimeSec) * 5));
      const points = 10 + speedBonus;

      if (socket.team === 'red') gameState.redScore += points;
      else if (socket.team === 'blue') gameState.blueScore += points;

      // 2. 計算拔河繩索位移 (Rope Shift)
      const diff = gameState.redScore - gameState.blueScore;
      gameState.ropePosition = Math.min(100, Math.max(0, 50 + (diff / gameState.targetDiff) * 50));

      // 3. 廣播比分更新給全場
      io.emit('game_update', gameState);

      // 4. 勝負檢查（若拔到兩端極限）
      if (gameState.ropePosition >= 100) {
        io.emit('game_over', { winner: 'red' });
        return;
      } else if (gameState.ropePosition <= 0) {
        io.emit('game_over', { winner: 'blue' });
        return;
      }

      // 5. 搶答成功！題目全場推進至下一題，並通知大家「這題被 xxx 隊搶走了」
      const winnerTeam = socket.team;
      currentQuestionIndex++;
      broadcastCurrentQuestion(winnerTeam);

      // 回覆發起者：搶答成功
      if (ack) ack({ isCorrect: true });
    } else {
      // 答錯：只回覆發起者 (前端會凍結 1 秒懲罰)，不影響全場，題目繼續留給其他人搶！
      if (ack) ack({ isCorrect: false });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 全場搶答伺服器運行於埠號 ${PORT}`));
