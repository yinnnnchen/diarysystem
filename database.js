const { getFirestore } = require('firebase-admin/firestore');

let db = null;

const COLLECTION = 'diaries';


// ==============================
// 初始化資料庫
// ==============================
// 注意：這個函式必須在 server.js 裡的 initializeApp(...) 執行「之後」
// 才能呼叫，否則 getFirestore() 會找不到已初始化的 Firebase App。
// server.js 目前的呼叫順序已經是正確的（先 initializeApp，才 db.init()）。

function init() {
  db = getFirestore();
  console.log('Firestore 資料庫已連接');
  return Promise.resolve();
}


// ==============================
// 文件 ID 規則：同一個使用者同一天只會有一篇日記
// ==============================

function diaryDocId(user_id, date) {
  return `${user_id}_${date}`;
}


// ==============================
// 儲存 / 更新日記
// ==============================

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


// ==============================
// 查詢某一天
// ==============================

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


// ==============================
// 查詢該使用者全部日記
// ==============================

async function getAllDiaries(user_id) {

  // 只用單一欄位的相等過濾（where user_id == ...），不額外加 orderBy，
  // 這樣不需要在 Firestore 主控台建立複合索引（composite index）。
  // 排序改成拿到資料後在程式裡做。
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


// ==============================
// 刪除
// ==============================

async function deleteDiary(user_id, date) {

  const docRef = db.collection(COLLECTION).doc(diaryDocId(user_id, date));
  const snap = await docRef.get();

  if (!snap.exists) {
    return { changes: 0 };
  }

  await docRef.delete();

  return { changes: 1 };
}


module.exports = {
  init,
  saveDiary,
  getDiaryByDate,
  getAllDiaries,
  deleteDiary
};