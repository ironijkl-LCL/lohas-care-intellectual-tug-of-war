// backend/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // 開發期允許所有前端來源連線
    methods: ['GET', 'POST']
  }
});

// 初始化 Firebase Admin (如果有提供環境變數)
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('✅ Firebase Admin 初始化成功');
  } catch (err) {
    console.error('⚠️ Firebase 初始化失敗:', err.message);
  }
}

// 遊戲全域狀態
let gameState = {
  redScore: 0,
  blueScore: 0,
  ropePosition: 50, // 50 為正中央，0 為藍隊勝，100 為紅隊勝
  targetDiff: 200,  // 勝負分差門檻
  questions: []
};

// 1. 從 Dify.ai Workflow 抓取動態題目
async function getQuestionsFromDify(difficulty = 'easy', count = 10) {
  const difyApiKey = process.env.DIFY_API_KEY;
  if (!difyApiKey) {
    console.warn('⚠️ 未設定 DIFY_API_KEY，使用預設備用題目');
    return [
      { id: 1, question: "7 x 8", options: ["56", "48", "64", "52"], answer: "56" },
      { id: 2, question: "28 - 17", options: ["11", "9", "12", "14"], answer: "11" }
    ];
  }

  try {
    const response = await axios.post(
      'https://api.dify.ai/v1/workflows/run',
      {
        inputs: { difficulty, count },
        response_mode: 'blocking',
        user: 'game-server'
      },
      {
        headers: {
          'Authorization': `Bearer ${difyApiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const resultText = response.data?.data?.outputs?.result || response.data?.data?.outputs?.text;
    return JSON.parse(resultText);
  } catch (error) {
    console.error('❌ 呼叫 Dify API 失敗:', error.message);
    return [
      { id: 1, question: "3 x 6", options: ["18", "12", "20", "15"], answer: "18" }
    ];
  }
}

// REST API 路由：手動觸發初始化遊戲題目
app.get('/api/start-game', async (req, res) => {
  const { difficulty = 'easy', count = 10 } = req.query;
  gameState.redScore = 0;
  gameState.blueScore = 0;
  gameState.ropePosition = 50;
  gameState.questions = await getQuestionsFromDify(difficulty, Number(count));
  
  // 廣播最新狀態與題目給所有連線玩家
  io.emit('game_init', gameState);
  res.json({ success: true, gameState });
});

// 2. Socket.io 即時連線邏輯
io.on('connection', (socket) => {
  console.log(`🔌 玩家已連線: ${socket.id}`);

  // 傳送當前狀態給新連線的玩家
  socket.emit('game_update', gameState);

  // 玩家加入隊伍 ('red' 或 'blue')
  socket.on('join_team', (team) => {
    socket.team = team;
    console.log(`👤 玩家 ${socket.id} 加入了 ${team} 隊`);
  });

  // 玩家提交答案
  socket.on('submit_answer', ({ isCorrect, responseTimeSec }) => {
    if (!isCorrect || !socket.team) return;

    // 計算得分 (基礎 10 分 + 速度加成)
    const speedBonus = Math.max(0, Math.floor((1.5 - responseTimeSec) * 10));
    const points = 10 + speedBonus;

    if (socket.team === 'red') {
      gameState.redScore += points;
    } else if (socket.team === 'blue') {
      gameState.blueScore += points;
    }

    // 計算繩子新位置 (0% ~ 100%)
    const diff = gameState.redScore - gameState.blueScore;
    gameState.ropePosition = Math.min(100, Math.max(0, 50 + (diff / gameState.targetDiff) * 50));

    // 即時廣播給所有大螢幕與手機端
    io.emit('game_update', gameState);

    // 檢查是否達標獲勝
    if (gameState.ropePosition >= 100) {
      io.emit('game_over', { winner: 'red' });
    } else if (gameState.ropePosition <= 0) {
      io.emit('game_over', { winner: 'blue' });
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ 玩家斷開連線: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 伺服器已啟動于埠號 ${PORT}`);
});
