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

    // 若傳入有明確指定 advice_completed 則採用傳入值；否則保留既有值
    advice_completed:
      diaryData.advice_completed !== undefined
        ? !!diaryData.advice_completed
        : (existing.exists && existing.data().advice_completed !== undefined
            ? existing.data().advice_completed
            : false),

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
// 提示：此查詢在 Firebase Console 需要 user_id + date 的複合索引 (Composite Index)
async function getDiariesInRange(user_id, startDate, endDate) {
  try {
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
  } catch (error) {
    // 若尚未建立複合索引 (FAILED_PRECONDITION / Error code 9)，降級為在記憶體中篩選
    if (error.code === 9 || error.message?.includes('index')) {
      console.warn('[Firestore] 複合索引尚未建立，啟動記憶體篩選降級方案:', error.message);
      const allDiaries = await getAllDiaries(user_id);
      return allDiaries.filter(d => d.date >= startDate && d.date <= endDate);
    }
    throw error;
  }
}

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

async function clearAllDiaries(user_id) {
  const snapshot = await db
    .collection(COLLECTION)
    .where('user_id', '==', user_id)
    .get();
  if (snapshot.empty) {
    return 0;
  }
  // Firestore batch 單次上限 500 筆，採分批提交
  const BATCH_SIZE = 450;
  let totalDeleted = 0;
  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + BATCH_SIZE);
    chunk.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    totalDeleted += chunk.length;
  }
  return totalDeleted;
}

module.exports = {
  init,
  saveDiary,
  getDiaryByDate,
  getAllDiaries,
  getDiariesInRange,
  updateAdviceStatus,
  deleteDiary,
  clearAllDiaries
};