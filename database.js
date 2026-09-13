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

module.exports = {
  init,
  saveDiary,
  getDiaryByDate,
  getAllDiaries,
  deleteDiary
};