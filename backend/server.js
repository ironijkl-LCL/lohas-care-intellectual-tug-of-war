// backend/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// 本地高速預設題庫 (避免等待 Dify API 響應)
const DEFAULT_QUESTIONS = [
  { id: 1, question: "7 x 8", options: ["56", "48", "64", "52"], answer: "56" },
  { id: 2, question: "28 - 17", options: ["11", "9", "12", "14"], answer: "11" },
  { id: 3, question: "15 + 29", options: ["44", "42", "34", "54"], answer: "44" },
  { id: 4, question: "81 ÷ 9", options: ["9", "8", "7", "6"], answer: "9" },
  { id: 5, question: "12 x 4", options: ["48", "44", "52", "36"], answer: "48" },
  { id: 6, question: "63 - 28", options: ["35", "37", "45", "25"], answer: "35" },
  { id: 7, question: "9 x 6", options: ["54", "48", "56", "62"], answer: "54" },
  { id: 8, question: "100 - 43", options: ["57", "67", "53", "47"], answer: "57" }
];

let gameState = {
  redScore: 0,
  blueScore: 0,
  ropePosition: 50,
  targetDiff: 200,
  questions: DEFAULT_QUESTIONS
};

// 異步向 Dify 抓取題目
async function fetchDifyQuestions(difficulty = 'easy', count = 10) {
  const difyApiKey = process.env.DIFY_API_KEY;
  if (!difyApiKey) return null;

  try {
    const response = await axios.post(
      'https://api.dify.ai/v1/workflows/run',
      { inputs: { difficulty, count }, response_mode: 'blocking', user: 'game-server' },
      { headers: { 'Authorization': `Bearer ${difyApiKey}`, 'Content-Type': 'application/json' }, timeout: 5000 }
    );
    const resultText = response.data?.data?.outputs?.result || response.data?.data?.outputs?.text;
    return JSON.parse(resultText);
  } catch (error) {
    console.warn('⚠️ Dify API 逾時或失敗，繼續使用快取題庫');
    return null;
  }
}

// REST API：先秒回本地題目，背景再向 Dify 抓新題目
app.get('/api/start-game', async (req, res) => {
  gameState.redScore = 0;
  gameState.blueScore = 0;
  gameState.ropePosition = 50;

  // 1. 先用快取題目（打亂順序），達到 0 秒延遲
  gameState.questions = [...DEFAULT_QUESTIONS].sort(() => Math.random() - 0.5);
  io.emit('game_init', gameState);
  res.json({ success: true, message: "遊戲已秒速重置", gameState });

  // 2. 背景異步向 Dify 抓取新 AI 題目（抓到後自動悄悄更新）
  const newQuestions = await fetchDifyQuestions();
  if (newQuestions && Array.isArray(newQuestions)) {
    gameState.questions = newQuestions;
    console.log('✅ Dify AI 新題目已背景載入完成');
  }
});

io.on('connection', (socket) => {
  socket.emit('game_update', gameState);

  socket.on('join_team', (team) => { socket.team = team; });

  socket.on('submit_answer', ({ isCorrect, responseTimeSec }) => {
    if (!isCorrect || !socket.team) return;
    const speedBonus = Math.max(0, Math.floor((1.5 - responseTimeSec) * 10));
    const points = 10 + speedBonus;

    if (socket.team === 'red') gameState.redScore += points;
    else if (socket.team === 'blue') gameState.blueScore += points;

    const diff = gameState.redScore - gameState.blueScore;
    gameState.ropePosition = Math.min(100, Math.max(0, 50 + (diff / gameState.targetDiff) * 50));

    io.emit('game_update', gameState);

    if (gameState.ropePosition >= 100) io.emit('game_over', { winner: 'red' });
    else if (gameState.ropePosition <= 0) io.emit('game_over', { winner: 'blue' });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 伺服器運行於埠號 ${PORT}`));
