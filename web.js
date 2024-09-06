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

// 페이지 뷰 및 세션 시작 기록
app.post('/pageview', async (req, res) => {
  const date = new Date().toISOString().split('T')[0];
  const entryTime = new Date();
  const { type } = req.body; // 'web' 또는 'mobile'

  if (!['web', 'mobile'].includes(type)) {
    return res.status(400).json({ message: 'Invalid type, must be either "web" or "mobile".' });
  }

  try {
    const statsCollection = db.collection('stats');
    const sessionsCollection = db.collection('sessions');

    // 페이지 뷰 카운트 증가
    const updateField = type === 'web' ? { webViews: 1 } : { mobileViews: 1 };
    await statsCollection.updateOne(
      { date },
      { $inc: updateField },
      { upsert: true }
    );

    // 방문 세션 기록
    const session = await sessionsCollection.insertOne({ entryTime, date, type });

    res.status(200).json({ message: 'Page view counted', date, sessionId: session.insertedId });
  } catch (error) {
    console.error('Error recording page view:', error);
    res.status(500).json({ message: 'Server error', error });
  }
});
// 세션 종료 및 체류 시간 기록
app.post('/track-time', async (req, res) => {
  const { sessionId } = req.body;
  const exitTime = new Date();

  try {
    const sessionsCollection = db.collection('sessions');

    // 세션 종료 시간과 체류 시간 계산
    const session = await sessionsCollection.findOne({ _id: new ObjectId(sessionId) });

    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    // 체류 시간 계산 (초 단위)
    const duration = (exitTime.getTime() - new Date(session.entryTime).getTime()) / 1000;
    
    await sessionsCollection.updateOne(
      { _id: new ObjectId(sessionId) },
      { $set: { exitTime, duration } }
    );

    res.status(200).json({ message: 'Exit recorded', sessionId, duration });
  } catch (error) {
    console.error('Error recording exit time:', error);
    res.status(500).json({ message: 'Server error', error });
  }
});



// 모든 클릭, 페이지 뷰 및 평균 방문 시간 조회
app.get('/stats', async (req, res) => {
  const { startDate, endDate, type } = req.query;
  const query = {};

  if (startDate && endDate) {
    query.date = {
      $gte: startDate,
      $lte: endDate,
    };
  }

  if (type && !['web', 'mobile'].includes(type)) {
    return res.status(400).json({ message: 'Invalid type, must be either "web" or "mobile".' });
  }

  try {
    const statsCollection = db.collection('stats');
    const sessionsCollection = db.collection('sessions');

    // 통계 데이터 조회
    const stats = await statsCollection.find(query).toArray();

    // 날짜별 평균 방문 시간 계산
    for (let stat of stats) {
      const sessions = await sessionsCollection.find({ date: stat.date, type: type, exitTime: { $exists: true } }).toArray();
      const totalDuration = sessions.reduce((sum, session) => sum + (session.duration || 0), 0);
      stat.averageDuration = (sessions.length > 0) ? Math.round(totalDuration / sessions.length) : 0; // 평균 방문 시간 계산
    }

    res.status(200).json({ stats });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ message: 'Server error', error });
  }
});

// 클릭 이벤트 처리
app.post('/click', async (req, res) => {
  const date = new Date().toISOString().split('T')[0];
  const { buttonId, type } = req.body; // 'web' 또는 'mobile'

  // 요청의 유효성을 검사하는 부분
  if (!['web', 'mobile'].includes(type) || !buttonId) {
    return res.status(400).json({ message: 'Invalid request: buttonId and type must be provided.' });
  }

  try {
    const statsCollection = db.collection('stats');
    const updateField = type === 'web' ? { webClicks: 1 } : { mobileClicks: 1 };

    // 클릭 카운트 증가
    await statsCollection.updateOne(
      { date },
      { $inc: updateField },
      { upsert: true }
    );

    // 클릭 기록 저장
    const clicksCollection = db.collection('clicks');
    await clicksCollection.insertOne({ date, buttonId, type });

    res.status(200).json({ message: `${type.charAt(0).toUpperCase() + type.slice(1)} click counted`, date });
  } catch (error) {
    console.error('Error recording click:', error);
    res.status(500).json({ message: 'Server error', error });
  }
});


// 특정 날짜 범위의 데이터를 엑셀 파일로 다운로드
app.get('/download', async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ message: 'Invalid request: startDate and endDate must be provided.' });
  }

  try {
    const statsCollection = db.collection('stats');
    const sessionsCollection = db.collection('sessions');
    const query = {
      date: {
        $gte: startDate,
        $lte: endDate,
      },
    };

    const stats = await statsCollection.find(query).toArray();

    // 날짜별 평균 방문 시간 계산
    for (let stat of stats) {
      const sessions = await sessionsCollection.find({ date: stat.date, exitTime: { $exists: true } }).toArray();
      const totalDuration = sessions.reduce((sum, session) => sum + (session.duration || 0), 0);
      stat.averageDuration = (sessions.length > 0) ? Math.round(totalDuration / sessions.length) : 0; // 평균 방문 시간 계산
    }

    // CSV 파일 생성
    const fields = [
      { label: '날짜', value: 'date' },
      { label: '웹 페이지 뷰', value: 'webViews' },
      { label: '모바일 페이지 뷰', value: 'mobileViews' },
      { label: '웹 클릭 수', value: 'webClicks' },
      { label: '모바일 클릭 수', value: 'mobileClicks' },
      { label: '평균 방문 시간 (초)', value: 'averageDuration' },
    ];
    const opts = { fields };
    const parser = new Parser(opts);
    const csv = parser.parse(stats);

    // CSV 파일 다운로드
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
