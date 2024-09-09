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

// 페이지 뷰 카운트 증가
app.post('/pageview', async (req, res) => {
  const date = new Date().toISOString().split('T')[0];
  const { type } = req.body; // 'web' 또는 'mobile'

  if (!['web', 'mobile'].includes(type)) {
    return res.status(400).json({ message: 'Invalid type, must be either "web" or "mobile".' });
  }

  try {
    const statsCollection = db.collection('stats');

    // 페이지 뷰 카운트 증가
    const updateField = type === 'web' ? { webViews: 1 } : { mobileViews: 1 };
    await statsCollection.updateOne(
      { date },
      { $inc: updateField },
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

// 통계 조회 (평균 방문 시간 관련 코드 제거)
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

    // 통계 데이터 조회
    const stats = await statsCollection.find(query).toArray();

    res.status(200).json({ stats });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ message: 'Server error', error });
  }
});

// CSV 다운로드 (평균 방문 시간 관련 코드 제거)
app.get('/download', async (req, res) => {
  const { startDate, endDate, type } = req.query;

  if (type && !['web', 'mobile'].includes(type)) {
    return res.status(400).json({ message: 'Invalid type, must be either "web" or "mobile".' });
  }

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

    // 엑셀 (CSV) 파일 생성: 한글 헤더 사용
    const fields = [
      { label: '날짜', value: 'date' },
      { label: '웹 페이지 뷰', value: 'webViews' },
      { label: '웹 클릭 수', value: 'webClicks' },
      { label: '모바일 페이지 뷰', value: 'mobileViews' },    
      { label: '모바일 클릭 수', value: 'mobileClicks' }
    ];
    const opts = { fields };
    const parser = new Parser(opts);
    const csv = parser.parse(stats);

    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.header('Content-Disposition', `attachment; filename="stats_data_${startDate}_to_${endDate}.csv"`);
    res.send(Buffer.from('\uFEFF' + csv, 'utf8')); // UTF-8 BOM 추가
  } catch (error) {
    console.error('Error generating CSV:', error);
    res.status(500).json({ message: 'Server error', error });
  }
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
