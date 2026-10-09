const { getFirestore } = require('firebase-admin/firestore');

let db = null;

const COLLECTION = 'diaries';

function init() {
  db = getFirestore();
  console.log('Firestore 資料庫已連接');
  return Promise.resolve();
}


function diaryDocId(user_id, date) {
  return `${user_id}_${date}`;
}


async function saveDiary(diaryData) {

  const { user_id, date } = diaryData;

  if (!user_id) {
    throw new Error('user_id is required');
  }

  if (!date) {
    throw new Error('date is required');
  }

  const docRef = db.collection(COLLECTION).doc(diaryDocId(user_id, date));
  const existing = await docRef.get();

  const record = {
    ...diaryData,

    positive_emotions:
      Array.isArray(diaryData.positive_emotions)
        ? diaryData.positive_emotions
        : [],

    negative_emotions:
      Array.isArray(diaryData.negative_emotions)
        ? diaryData.negative_emotions
        : [],

    crisis_alert: !!diaryData.crisis_alert,

    advice_completed:
      existing.exists && existing.data().advice_completed !== undefined
        ? existing.data().advice_completed
        : false,

    created_at:
      existing.exists
        ? existing.data().created_at
        : new Date().toISOString(),

    updated_at: new Date().toISOString()
  };

  await docRef.set(record, { merge: true });

  return {
    id: docRef.id,
    ...record,
    action: existing.exists ? 'updated' : 'inserted'
  };
}

async function getDiaryByDate(user_id, date) {

  const docRef = db.collection(COLLECTION).doc(diaryDocId(user_id, date));
  const snap = await docRef.get();

  if (!snap.exists) {
    return null;
  }

  return {
    id: snap.id,
    ...snap.data()
  };
}

async function getAllDiaries(user_id) {
  const snapshot = await db
    .collection(COLLECTION)
    .where('user_id', '==', user_id)
    .get();

  const diaries = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  diaries.sort((a, b) => a.date.localeCompare(b.date));

  return diaries;
}

async function deleteDiary(user_id, date) {

  const docRef = db.collection(COLLECTION).doc(diaryDocId(user_id, date));
  const snap = await docRef.get();

  if (!snap.exists) {
    return { changes: 0 };
  }

  await docRef.delete();

  return { changes: 1 };
}

// 取得某段日期區間內的日記（用於週報 / 月報 / 情緒關聯分析）
// startDate / endDate 皆為 'YYYY-MM-DD' 字串，並包含起訖日
async function getDiariesInRange(user_id, startDate, endDate) {
  const snapshot = await db
    .collection(COLLECTION)
    .where('user_id', '==', user_id)
    .where('date', '>=', startDate)
    .where('date', '<=', endDate)
    .get();

  const diaries = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  diaries.sort((a, b) => a.date.localeCompare(b.date));

  return diaries;
}

// 更新「建議是否已採納」狀態，用於個人化建議追蹤
async function updateAdviceStatus(user_id, date, completed) {
  const docRef = db.collection(COLLECTION).doc(diaryDocId(user_id, date));
  const snap = await docRef.get();

  if (!snap.exists) {
    return null;
  }

  const record = {
    advice_completed: !!completed,
    advice_completed_at: completed ? new Date().toISOString() : null,
    updated_at: new Date().toISOString()
  };

  await docRef.set(record, { merge: true });

  return {
    id: docRef.id,
    ...snap.data(),
    ...record
  };
}

module.exports = {
  init,
  saveDiary,
  getDiaryByDate,
  getAllDiaries,
  getDiariesInRange,
  updateAdviceStatus,
  deleteDiary
};