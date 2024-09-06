// server.js
require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
const { Parser } = require('json2csv');

const app = express();
const PORT = 3000;

// MongoDB 연결 설정
const url = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = 'clicks';
let db;

// MongoDB 연결
MongoClient.connect(url, { useNewUrlParser: true, useUnifiedTopology: true })
  .then((client) => {
    console.log('Connected to MongoDB');
    db = client.db(dbName);
  })
  .catch((error) => {
    console.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  });

// JSON 파싱 미들웨어
app.use(express.json());

// 정적 파일 제공
app.use(express.static(path.join(__dirname, 'public')));

// 페이지 진입 기록
app.post('/pageview', async (req, res) => {
  const date = new Date().toISOString().split('T')[0];
  const entryTime = new Date();

  try {
    const statsCollection = db.collection('stats');

    // 페이지 진입 시 페이지 뷰 카운트 증가
    await statsCollection.updateOne(
      { date },
      { $inc: { pageViews: 1 } },
      { upsert: true }
    );

    // 방문 기록 저장 (진입 시간 기록)
    const sessionsCollection = db.collection('sessions');
    const session = await sessionsCollection.insertOne({ entryTime, date });

    // 현재 날짜의 평균 방문 시간 계산
    const sessions = await sessionsCollection.find({ date, exitTime: { $exists: true } }).toArray();
    const totalDuration = sessions.reduce((sum, session) => sum + (session.duration || 0), 0);
    const averageDuration = (sessions.length > 0) ? Math.round(totalDuration / sessions.length) : 0;

    res.status(200).json({ message: 'Page view counted', date, sessionId: session.insertedId, averageDuration });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// 페이지 이탈 기록 및 체류 시간 저장
app.post('/track-time', async (req, res) => {
  const { sessionId, duration } = req.body; // 체류 시간 (초 단위)
  const exitTime = new Date();

  try {
    const sessionsCollection = db.collection('sessions');

    // 방문 기록 업데이트 (이탈 시간 기록 및 머무름 시간 계산)
    await sessionsCollection.updateOne(
      { _id: new ObjectId(sessionId) },
      { $set: { exitTime, duration } }
    );

    res.status(200).json({ message: '체류 시간이 기록되었습니다.' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// 클릭 이벤트 처리
app.post('/click', async (req, res) => {
  const date = new Date().toISOString().split('T')[0];

  try {
    const statsCollection = db.collection('stats');

    // 클릭 카운트 증가
    await statsCollection.updateOne(
      { date },
      { $inc: { clicks: 1 } },
      { upsert: true }
    );

    res.status(200).json({ message: 'Click counted', date });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// 모든 클릭, 페이지 뷰 및 평균 방문 시간 조회
app.get('/stats', async (req, res) => {
  try {
    const statsCollection = db.collection('stats');
    const sessionsCollection = db.collection('sessions');

    // 모든 통계 데이터 조회
    const stats = await statsCollection.find().toArray();

    // 날짜별 평균 방문 시간 계산
    for (let stat of stats) {
      const sessions = await sessionsCollection.find({ date: stat.date, exitTime: { $exists: true } }).toArray();
      const totalDuration = sessions.reduce((sum, session) => sum + (session.duration || 0), 0);
      stat.averageDuration = (sessions.length > 0) ? Math.round(totalDuration / sessions.length) : 0; // 평균 방문 시간 계산 및 정수로 변환
    }

    res.status(200).json({ stats });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// 특정 날짜 범위의 데이터를 엑셀 파일로 다운로드
app.get('/download', async (req, res) => {
  const { startDate, endDate } = req.query;

  try {
    const statsCollection = db.collection('stats');
    const query = {};

    if (startDate && endDate) {
      query.date = {
        $gte: startDate,
        $lte: endDate
      };
    }

    const stats = await statsCollection.find(query).toArray();
    
    // 엑셀 (CSV) 파일 생성
    const fields = ['date', 'pageViews', 'clicks', 'averageDuration'];
    const opts = { fields };
    const parser = new Parser(opts);
    const csv = parser.parse(stats);

    res.header('Content-Type', 'text/csv');
    res.attachment(`stats_data_${startDate}_to_${endDate}.csv`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
