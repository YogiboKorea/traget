require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
const { Parser } = require('json2csv');
const cors = require('cors');

const app = express();
const PORT = 3004;

// CORS 허용 설정
app.use(cors({
  origin: '*'  // 필요에 따라 특정 도메인으로 제한 가능
}));

const url = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = 'clicks';
let db;

// MongoDB 연결
MongoClient.connect(url, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(client => {
    console.log('Connected to MongoDB');
    db = client.db(dbName);
  })
  .catch(error => {
    console.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  });

// JSON 파싱 미들웨어
app.use(express.json());

// 정적 파일 제공
app.use(express.static(path.join(__dirname, 'public')));

// 페이지 뷰 처리 엔드포인트 추가
app.post('/pageview', async (req, res) => {
  const date = new Date().toISOString().split('T')[0];

  try {
    const statsCollection = db.collection('stats');

    // 페이지 뷰 카운트 증가
    await statsCollection.updateOne(
      { date },
      { $inc: { pageViews: 1 } },
      { upsert: true }
    );

    res.status(200).json({ message: 'Page view counted', date });
  } catch (error) {
    console.error('Error recording page view:', error);
    res.status(500).json({ message: 'Server error', error });
  }
});

// 클릭 이벤트 처리
app.post('/click', async (req, res) => {
  const date = new Date().toISOString().split('T')[0];
  const { buttonId } = req.body;

  try {
    const statsCollection = db.collection('stats');

    // 클릭 카운트 증가
    await statsCollection.updateOne(
      { date },
      { $inc: { clicks: 1 } },
      { upsert: true }
    );

    // 클릭 기록 저장
    const clicksCollection = db.collection('clicks');
    await clicksCollection.insertOne({ date, buttonId });

    res.status(200).json({ message: 'Click counted', date });
  } catch (error) {
    console.error('Error recording click:', error);
    res.status(500).json({ message: 'Server error', error });
  }
});

// 모든 클릭, 페이지 뷰 및 평균 방문 시간 조회
app.get('/stats', async (req, res) => {
  const { startDate, endDate } = req.query;
  const query = {};

  if (startDate && endDate) {
    query.date = {
      $gte: startDate,
      $lte: endDate,
    };
  }

  try {
    const statsCollection = db.collection('stats');
    const sessionsCollection = db.collection('sessions');

    // 통계 데이터 조회
    const stats = await statsCollection.find(query).toArray();

    // 날짜별 평균 방문 시간 계산
    for (let stat of stats) {
      const sessions = await sessionsCollection.find({ date: stat.date, exitTime: { $exists: true } }).toArray();
      const totalDuration = sessions.reduce((sum, session) => sum + (session.duration || 0), 0);
      stat.averageDuration = (sessions.length > 0) ? Math.round(totalDuration / sessions.length) : 0; // 평균 방문 시간 계산 및 정수로 변환
    }

    res.status(200).json({ stats });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ message: 'Server error', error });
  }
});

// 특정 날짜 범위의 데이터를 엑셀 파일로 다운로드
app.get('/download', async (req, res) => {
  const { startDate, endDate } = req.query;

  try {
    const statsCollection = db.collection('stats');
    const sessionsCollection = db.collection('sessions');
    const query = {};

    if (startDate && endDate) {
      query.date = {
        $gte: startDate,
        $lte: endDate
      };
    }

    const stats = await statsCollection.find(query).toArray();

    // 날짜별 평균 방문 시간 계산
    for (let stat of stats) {
      const sessions = await sessionsCollection.find({ date: stat.date, exitTime: { $exists: true } }).toArray();
      const totalDuration = sessions.reduce((sum, session) => sum + (session.duration || 0), 0);
      stat.averageDuration = (sessions.length > 0) ? Math.round(totalDuration / sessions.length) : 0; // 평균 방문 시간 계산 및 정수로 변환
    }

    // 엑셀 (CSV) 파일 생성: 한글 헤더 사용
    const fields = [
      { label: '날짜', value: 'date' },
      { label: '페이지 뷰', value: 'pageViews' },
      { label: '이벤트 클릭 수', value: 'clicks' },
      { label: '평균 방문 시간 (초)', value: 'averageDuration' }
    ];
    const opts = { fields };
    const parser = new Parser(opts);
    const csv = parser.parse(stats);

    res.header('Content-Type', 'text/csv');
    res.attachment(`stats_data_${startDate}_to_${endDate}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Error generating CSV:', error);
    res.status(500).json({ message: 'Server error', error });
  }
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
