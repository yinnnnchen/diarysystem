const fs = require('fs');
const path = require('path');

let db = null;
let isSqlite = false;
const JSON_DB_PATH = path.join(__dirname, 'diaries.json');
const SQLITE_DB_PATH = path.join(__dirname, 'diaries.db');

// Initialize database
function init() {
  try {
    const sqlite3 = require('sqlite3').verbose();
    db = new sqlite3.Database(SQLITE_DB_PATH, (err) => {
      if (err) {
        console.error('Failed to open SQLite database, falling back to JSON file storage:', err.message);
        setupJsonFallback();
      } else {
        console.log('SQLite database connected successfully.');
        isSqlite = true;
        createTables();
      }
    });
  } catch (e) {
    console.warn('sqlite3 module not available, falling back to JSON file storage.');
    setupJsonFallback();
  }
}

function setupJsonFallback() {
  isSqlite = false;
  if (!fs.existsSync(JSON_DB_PATH)) {
    fs.writeFileSync(JSON_DB_PATH, JSON.stringify([], null, 2), 'utf8');
  }
  console.log(`JSON database initialized at ${JSON_DB_PATH}`);
}

function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS diaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT UNIQUE,
      content TEXT,
      emotion_score INTEGER,
      stress_index INTEGER,
      anxiety_index INTEGER,
      stability_index INTEGER,
      positive_emotions TEXT,
      negative_emotions TEXT,
      summary TEXT,
      advice TEXT,
      raw_ai_response TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating SQLite tables:', err.message);
    }
  });
}

// Save or update a diary entry
function saveDiary(diaryData) {
  return new Promise((resolve, reject) => {
    const {
      date,
      content,
      emotion_score,
      stress_index,
      anxiety_index,
      stability_index,
      positive_emotions,
      negative_emotions,
      summary,
      advice,
      raw_ai_response
    } = diaryData;

    const posEmotionsStr = Array.isArray(positive_emotions) ? positive_emotions.join(',') : positive_emotions;
    const negEmotionsStr = Array.isArray(negative_emotions) ? negative_emotions.join(',') : negative_emotions;

    if (isSqlite) {
      db.get('SELECT id FROM diaries WHERE date = ?', [date], (err, row) => {
        if (err) return reject(err);

        if (row) {
          // Update
          db.run(`
            UPDATE diaries SET
              content = ?,
              emotion_score = ?,
              stress_index = ?,
              anxiety_index = ?,
              stability_index = ?,
              positive_emotions = ?,
              negative_emotions = ?,
              summary = ?,
              advice = ?,
              raw_ai_response = ?
            WHERE date = ?
          `, [
            content, emotion_score, stress_index, anxiety_index, stability_index,
            posEmotionsStr, negEmotionsStr, summary, advice, raw_ai_response, date
          ], function(err) {
            if (err) return reject(err);
            resolve({ id: row.id, ...diaryData, action: 'updated' });
          });
        } else {
          // Insert
          db.run(`
            INSERT INTO diaries (
              date, content, emotion_score, stress_index, anxiety_index, stability_index,
              positive_emotions, negative_emotions, summary, advice, raw_ai_response
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            date, content, emotion_score, stress_index, anxiety_index, stability_index,
            posEmotionsStr, negEmotionsStr, summary, advice, raw_ai_response
          ], function(err) {
            if (err) return reject(err);
            resolve({ id: this.lastID, ...diaryData, action: 'inserted' });
          });
        }
      });
    } else {
      // JSON File storage
      try {
        const data = JSON.parse(fs.readFileSync(JSON_DB_PATH, 'utf8'));
        const index = data.findIndex(item => item.date === date);
        const newRecord = {
          id: index >= 0 ? data[index].id : Date.now(),
          date,
          content,
          emotion_score: Number(emotion_score),
          stress_index: Number(stress_index),
          anxiety_index: Number(anxiety_index),
          stability_index: Number(stability_index),
          positive_emotions: posEmotionsStr,
          negative_emotions: negEmotionsStr,
          summary,
          advice,
          raw_ai_response,
          created_at: index >= 0 ? data[index].created_at : new Date().toISOString()
        };

        if (index >= 0) {
          data[index] = newRecord;
        } else {
          data.push(newRecord);
        }
        
        fs.writeFileSync(JSON_DB_PATH, JSON.stringify(data, null, 2), 'utf8');
        resolve({ ...newRecord, action: index >= 0 ? 'updated' : 'inserted' });
      } catch (err) {
        reject(err);
      }
    }
  });
}

// Get diary by date
function getDiaryByDate(date) {
  return new Promise((resolve, reject) => {
    if (isSqlite) {
      db.get('SELECT * FROM diaries WHERE date = ?', [date], (err, row) => {
        if (err) return reject(err);
        if (row) {
          row.positive_emotions = row.positive_emotions ? row.positive_emotions.split(',') : [];
          row.negative_emotions = row.negative_emotions ? row.negative_emotions.split(',') : [];
        }
        resolve(row || null);
      });
    } else {
      try {
        const data = JSON.parse(fs.readFileSync(JSON_DB_PATH, 'utf8'));
        const record = data.find(item => item.date === date);
        if (record) {
          const clone = { ...record };
          clone.positive_emotions = clone.positive_emotions ? clone.positive_emotions.split(',') : [];
          clone.negative_emotions = clone.negative_emotions ? clone.negative_emotions.split(',') : [];
          resolve(clone);
        } else {
          resolve(null);
        }
      } catch (err) {
        reject(err);
      }
    }
  });
}

// Get all diaries sorted by date
function getAllDiaries() {
  return new Promise((resolve, reject) => {
    if (isSqlite) {
      db.all('SELECT * FROM diaries ORDER BY date ASC', [], (err, rows) => {
        if (err) return reject(err);
        rows.forEach(row => {
          row.positive_emotions = row.positive_emotions ? row.positive_emotions.split(',') : [];
          row.negative_emotions = row.negative_emotions ? row.negative_emotions.split(',') : [];
        });
        resolve(rows);
      });
    } else {
      try {
        const data = JSON.parse(fs.readFileSync(JSON_DB_PATH, 'utf8'));
        const sorted = data.sort((a, b) => a.date.localeCompare(b.date));
        const formatted = sorted.map(record => {
          const clone = { ...record };
          clone.positive_emotions = clone.positive_emotions ? clone.positive_emotions.split(',') : [];
          clone.negative_emotions = clone.negative_emotions ? clone.negative_emotions.split(',') : [];
          return clone;
        });
        resolve(formatted);
      } catch (err) {
        reject(err);
      }
    }
  });
}

// Delete diary by date
function deleteDiary(date) {
  return new Promise((resolve, reject) => {
    if (isSqlite) {
      db.run('DELETE FROM diaries WHERE date = ?', [date], function(err) {
        if (err) return reject(err);
        resolve({ changes: this.changes });
      });
    } else {
      try {
        let data = JSON.parse(fs.readFileSync(JSON_DB_PATH, 'utf8'));
        const initialLength = data.length;
        data = data.filter(item => item.date !== date);
        fs.writeFileSync(JSON_DB_PATH, JSON.stringify(data, null, 2), 'utf8');
        resolve({ changes: initialLength - data.length });
      } catch (err) {
        reject(err);
      }
    }
  });
}

module.exports = {
  init,
  saveDiary,
  getDiaryByDate,
  getAllDiaries,
  deleteDiary
};
