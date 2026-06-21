document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  lucide.createIcons();

  // App State
  const state = {
    currentTab: 'dashboard',
    diaries: [],
    stats: null,
    apiStatus: { hasEnvKey: false },
    customApiKey: localStorage.getItem('gemini_api_key') || '',
    selectedDiary: null,
    charts: {
      trend: null,
      radar: null
    }
  };

  // UI Elements
  const els = {
    navItems: document.querySelectorAll('.nav-item'),
    tabPanes: document.querySelectorAll('.tab-pane'),
    pageTitle: document.getElementById('page-title'),
    pageSubtitle: document.getElementById('page-subtitle'),
    currentDateDisplay: document.getElementById('current-date-display'),
    apiStatusIndicator: document.getElementById('api-status-indicator'),
    
    // Dashboard
    avgEmotion: document.getElementById('avg-emotion'),
    avgStress: document.getElementById('avg-stress'),
    avgAnxiety: document.getElementById('avg-anxiety'),
    avgStability: document.getElementById('avg-stability'),
    posKeywords: document.getElementById('pos-keywords'),
    negKeywords: document.getElementById('neg-keywords'),
    
    // Write
    diaryDate: document.getElementById('diary-date'),
    diaryContent: document.getElementById('diary-content'),
    charCount: document.getElementById('char-count'),
    btnAnalyzeSave: document.getElementById('btn-analyze-save'),
    saveStatus: document.getElementById('save-status'),
    analysisPlaceholder: document.getElementById('analysis-placeholder'),
    analysisResultView: document.getElementById('analysis-result-view'),
    
    // Metrics display
    metricValEmotion: document.getElementById('metric-val-emotion'),
    metricValStress: document.getElementById('metric-val-stress'),
    metricValAnxiety: document.getElementById('metric-val-anxiety'),
    metricValStability: document.getElementById('metric-val-stability'),
    progressEmotion: document.getElementById('progress-emotion'),
    progressStress: document.getElementById('progress-stress'),
    progressAnxiety: document.getElementById('progress-anxiety'),
    progressStability: document.getElementById('progress-stability'),
    resultPosTags: document.getElementById('result-pos-tags'),
    resultNegTags: document.getElementById('result-neg-tags'),
    resultSummary: document.getElementById('result-summary'),
    resultAdvice: document.getElementById('result-advice'),
    
    // Logs
    logsTimelineList: document.getElementById('logs-timeline-list'),
    logSearchInput: document.getElementById('log-search-input'),
    logSortSelect: document.getElementById('log-sort-select'),
    
    // Settings
    settingsApiKey: document.getElementById('settings-api-key'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    btnLoadMock: document.getElementById('btn-load-mock'),
    btnClearDb: document.getElementById('btn-clear-db'),
    
    // Modal
    diaryDetailModal: document.getElementById('diary-detail-modal'),
    modalTitle: document.getElementById('modal-title'),
    modalContent: document.getElementById('modal-content'),
    modalMetricEmotion: document.getElementById('modal-metric-emotion'),
    modalMetricStress: document.getElementById('modal-metric-stress'),
    modalMetricAnxiety: document.getElementById('modal-metric-anxiety'),
    modalMetricStability: document.getElementById('modal-metric-stability'),
    modalSummary: document.getElementById('modal-summary'),
    modalAdvice: document.getElementById('modal-advice'),
    btnCloseModal: document.getElementById('btn-close-modal')
  };

  // --- INITIALIZATION ---
  function init() {
    // Set default date to today in local timezone
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    els.diaryDate.value = `${yyyy}-${mm}-${dd}`;
    els.currentDateDisplay.textContent = today.toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });

    // Populate Settings UI
    if (state.customApiKey) {
      els.settingsApiKey.value = state.customApiKey;
    }

    setupEventListeners();
    checkApiStatus();
    loadAllData();
  }

  // --- EVENT LISTENERS ---
  function setupEventListeners() {
    // Tab switching
    els.navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = item.getAttribute('data-tab');
        switchTab(tab);
      });
    });

    // Word count in textarea
    els.diaryContent.addEventListener('input', () => {
      els.charCount.textContent = els.diaryContent.value.length;
    });

    // Save & Analyze Diary
    els.btnAnalyzeSave.addEventListener('click', handleAnalyzeAndSave);

    // Save Settings
    els.btnSaveSettings.addEventListener('click', saveSettings);

    // Load Mock Data
    els.btnLoadMock.addEventListener('click', loadMockData);

    // Clear Database
    els.btnClearDb.addEventListener('click', clearDatabase);

    // Logs Filtering & Sorting
    els.logSearchInput.addEventListener('input', renderLogs);
    els.logSortSelect.addEventListener('change', renderLogs);

    // Close Modal
    els.btnCloseModal.addEventListener('click', closeModal);
    els.diaryDetailModal.addEventListener('click', (e) => {
      if (e.target === els.diaryDetailModal) closeModal();
    });

    // Date change loads existing diary if any
    els.diaryDate.addEventListener('change', loadDiaryForSelectedDate);
  }

  // --- TAB NAVIGATION ---
  function switchTab(tabId) {
    state.currentTab = tabId;
    
    // Update active nav class
    els.navItems.forEach(item => {
      if (item.getAttribute('data-tab') === tabId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Update active tab pane
    els.tabPanes.forEach(pane => {
      if (pane.id === `tab-${tabId}`) {
        pane.classList.add('active');
      } else {
        pane.classList.remove('active');
      }
    });

    // Update headers
    const titles = {
      dashboard: { title: '身心儀表板', sub: '追蹤您的日常情緒、壓力和焦慮趨勢' },
      write: { title: '撰寫今日日記', sub: '寫下生活，讓 AI 傾聽並分析您的情感特徵' },
      logs: { title: '日記時光機', sub: '翻閱過往的心情隨筆與身心變化軌跡' },
      settings: { title: '系統設定', sub: '配置您的 API 密鑰與評估數據' }
    };

    if (titles[tabId]) {
      els.pageTitle.textContent = titles[tabId].title;
      els.pageSubtitle.textContent = titles[tabId].sub;
    }

    if (tabId === 'dashboard') {
      loadAllData();
    } else if (tabId === 'logs') {
      loadLogs();
    } else if (tabId === 'write') {
      loadDiaryForSelectedDate();
    }
  }

  // --- API OPERATIONS ---
  async function checkApiStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      state.apiStatus = data;
      updateApiIndicator();
    } catch (e) {
      console.error('Failed to get API status:', e);
    }
  }

  function updateApiIndicator() {
    const indicator = els.apiStatusIndicator;
    const dot = indicator.querySelector('.status-dot');
    const text = indicator.querySelector('.status-text');

    if (state.customApiKey || state.apiStatus.hasEnvKey) {
      dot.className = 'status-dot success';
      text.textContent = 'Gemini API 已就緒';
    } else {
      dot.className = 'status-dot warning';
      text.textContent = '請至設定輸入 API 金鑰';
    }
  }

  async function loadAllData() {
    try {
      const statsRes = await fetch('/api/stats');
      const stats = await statsRes.json();
      state.stats = stats;
      
      const diariesRes = await fetch('/api/diaries');
      state.diaries = await diariesRes.json();

      updateDashboardStats();
      renderDashboardCharts();
    } catch (e) {
      console.error('Error loading dashboard data:', e);
    }
  }

  async function loadLogs() {
    try {
      const res = await fetch('/api/diaries');
      state.diaries = await res.json();
      renderLogs();
    } catch (e) {
      console.error('Error loading history logs:', e);
    }
  }

  async function loadDiaryForSelectedDate() {
    const date = els.diaryDate.value;
    if (!date) return;

    // Reset view
    els.saveStatus.textContent = '未儲存';
    els.saveStatus.className = 'editor-status';

    try {
      const res = await fetch(`/api/diaries/${date}`);
      if (res.ok) {
        const diary = await res.json();
        els.diaryContent.value = diary.content;
        els.charCount.textContent = diary.content.length;
        els.saveStatus.textContent = '已讀取過往紀錄';
        els.saveStatus.className = 'editor-status text-emotion';
        
        // Show existing analysis
        let parsedAnalysis = {};
        try {
          parsedAnalysis = JSON.parse(diary.raw_ai_response || '{}');
        } catch(e) {}
        
        if (diary.emotion_score !== undefined) {
          showAnalysisResults({
            emotion_score: diary.emotion_score,
            stress_index: diary.stress_index,
            anxiety_index: diary.anxiety_index,
            stability_index: diary.stability_index,
            positive_emotions: diary.positive_emotions || parsedAnalysis.positive_emotions,
            negative_emotions: diary.negative_emotions || parsedAnalysis.negative_emotions,
            summary: diary.summary,
            advice: diary.advice
          });
        } else {
          hideAnalysisResults();
        }
      } else {
        els.diaryContent.value = '';
        els.charCount.textContent = '0';
        hideAnalysisResults();
      }
    } catch (e) {
      console.error('Error fetching diary for date:', e);
    }
  }

  // --- DIARY WORKFLOWS ---
  async function handleAnalyzeAndSave() {
    const date = els.diaryDate.value;
    const content = els.diaryContent.value.trim();

    if (!date) {
      alert('請選擇日期！');
      return;
    }
    if (!content) {
      alert('請先輸入日記內容再進行分析！');
      return;
    }

    els.btnAnalyzeSave.disabled = true;
    els.btnAnalyzeSave.innerHTML = '<i class="floating-icon" style="width:16px;height:16px;margin:0;display:inline-block"></i> 正在分析中...';
    els.saveStatus.textContent = 'AI 正在診斷分析中...';
    els.saveStatus.className = 'editor-status warning';

    try {
      // Step 1: Analyze
      const analyzeRes = await fetch('/api/diaries/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          key: state.customApiKey
        })
      });

      if (!analyzeRes.ok) {
        const errData = await analyzeRes.json();
        throw new Error(errData.error || '分析失敗');
      }

      const analysisResult = await analyzeRes.json();

      // Step 2: Save
      const saveRes = await fetch('/api/diaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          content,
          analysis: analysisResult
        })
      });

      if (!saveRes.ok) {
        throw new Error('儲存日記失敗');
      }

      els.saveStatus.textContent = '已成功儲存與評估！';
      els.saveStatus.className = 'editor-status text-emotion';

      showAnalysisResults(analysisResult);
      checkApiStatus(); // Refresh status

    } catch (error) {
      alert('分析與儲存失敗：' + error.message);
      els.saveStatus.textContent = '儲存失敗';
      els.saveStatus.className = 'editor-status text-stress';
    } finally {
      els.btnAnalyzeSave.disabled = false;
      els.btnAnalyzeSave.innerHTML = '<i data-lucide="sparkles"></i> AI 分析並儲存日記';
      lucide.createIcons();
    }
  }

  function showAnalysisResults(result) {
    els.analysisPlaceholder.classList.add('hidden');
    els.analysisResultView.classList.remove('hidden');

    // Metrics values
    els.metricValEmotion.textContent = result.emotion_score;
    els.metricValStress.textContent = result.stress_index;
    els.metricValAnxiety.textContent = result.anxiety_index;
    els.metricValStability.textContent = result.stability_index;

    // Progress fills
    els.progressEmotion.style.width = `${result.emotion_score}%`;
    els.progressStress.style.width = `${result.stress_index}%`;
    els.progressAnxiety.style.width = `${result.anxiety_index}%`;
    els.progressStability.style.width = `${result.stability_index}%`;

    // Tags
    renderTags(els.resultPosTags, result.positive_emotions, 'pos');
    renderTags(els.resultNegTags, result.negative_emotions, 'neg');

    // Summary & Advice
    els.resultSummary.textContent = result.summary || '未提供摘要。';
    els.resultAdvice.textContent = result.advice || '未提供建議。';
  }

  function hideAnalysisResults() {
    els.analysisPlaceholder.classList.remove('hidden');
    els.analysisResultView.classList.add('hidden');
  }

  function renderTags(container, list, type) {
    container.innerHTML = '';
    const array = Array.isArray(list) ? list : (list ? list.split(',') : []);
    if (array.length === 0) {
      container.innerHTML = '<span class="text-muted" style="font-size:11px">無</span>';
      return;
    }
    array.forEach(tag => {
      if (!tag.trim()) return;
      const span = document.createElement('span');
      span.className = `keyword-badge ${type}`;
      span.textContent = tag.trim();
      container.appendChild(span);
    });
  }

  // --- DASHBOARD UI UPDATES ---
  function updateDashboardStats() {
    if (!state.stats || state.stats.totalCount === 0) {
      els.avgEmotion.textContent = '--';
      els.avgStress.textContent = '--';
      els.avgAnxiety.textContent = '--';
      els.avgStability.textContent = '--';
      els.posKeywords.innerHTML = '<p class="text-muted">尚無足夠數據</p>';
      els.negKeywords.innerHTML = '<p class="text-muted">尚無足夠數據</p>';
      return;
    }

    const { averages, emotionsDistribution } = state.stats;
    els.avgEmotion.textContent = `${averages.emotion}/100`;
    els.avgStress.textContent = `${averages.stress}/100`;
    els.avgAnxiety.textContent = `${averages.anxiety}/100`;
    els.avgStability.textContent = `${averages.stability}/100`;

    // Build Word Clouds
    buildWordCloud(els.posKeywords, emotionsDistribution.positive, 'pos');
    buildWordCloud(els.negKeywords, emotionsDistribution.negative, 'neg');
  }

  function buildWordCloud(container, distribution, type) {
    container.innerHTML = '';
    const entries = Object.entries(distribution || {}).sort((a, b) => b[1] - a[1]);
    
    if (entries.length === 0) {
      container.innerHTML = '<p class="text-muted" style="font-size:12px">尚無足夠詞彙</p>';
      return;
    }

    entries.slice(0, 10).forEach(([word, count]) => {
      const span = document.createElement('span');
      span.className = `keyword-badge ${type}`;
      span.style.transform = `scale(${1 + (count - 1) * 0.1})`;
      span.title = `出現 ${count} 次`;
      span.textContent = `${word} (${count})`;
      container.appendChild(span);
    });
  }

  function renderDashboardCharts() {
    if (!state.stats || state.stats.recentTrends.length === 0) {
      return;
    }

    const trends = state.stats.recentTrends;
    const labels = trends.map(t => t.date.substring(5)); // Show MM-DD

    // 1. Trend Line Chart
    if (state.charts.trend) {
      state.charts.trend.destroy();
    }

    const ctxTrend = document.getElementById('trendChart').getContext('2d');
    state.charts.trend = new Chart(ctxTrend, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '情緒分數',
            data: trends.map(t => t.emotion_score),
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            tension: 0.3,
            fill: true
          },
          {
            label: '壓力指數',
            data: trends.map(t => t.stress_index),
            borderColor: '#f43f5e',
            backgroundColor: 'transparent',
            tension: 0.3
          },
          {
            label: '焦慮指數',
            data: trends.map(t => t.anxiety_index),
            borderColor: '#f59e0b',
            backgroundColor: 'transparent',
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#94a3b8', font: { family: 'Outfit' } }
          }
        },
        scales: {
          y: {
            min: 0,
            max: 100,
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#94a3b8' }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#94a3b8' }
          }
        }
      }
    });

    // 2. Averages Radar Chart
    if (state.charts.radar) {
      state.charts.radar.destroy();
    }

    const avg = state.stats.averages;
    const ctxRadar = document.getElementById('radarChart').getContext('2d');
    state.charts.radar = new Chart(ctxRadar, {
      type: 'radar',
      data: {
        labels: ['平均情緒', '平均壓力', '平均焦慮', '情緒穩定度'],
        datasets: [{
          label: '心理狀態分佈',
          data: [avg.emotion, avg.stress, avg.anxiety, avg.stability],
          backgroundColor: 'rgba(139, 92, 246, 0.2)',
          borderColor: '#8b5cf6',
          borderWidth: 2,
          pointBackgroundColor: '#8b5cf6'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          r: {
            angleLines: { color: 'rgba(255, 255, 255, 0.08)' },
            grid: { color: 'rgba(255, 255, 255, 0.08)' },
            pointLabels: { color: '#94a3b8', font: { family: 'Outfit', size: 12 } },
            ticks: { display: false },
            min: 0,
            max: 100
          }
        }
      }
    });
  }

  // --- HISTORY LOGS RENDER ---
  function renderLogs() {
    const search = els.logSearchInput.value.toLowerCase();
    const sort = els.logSortSelect.value;

    let filtered = state.diaries.filter(d => {
      const matchText = d.content.toLowerCase().includes(search) || 
                        d.summary.toLowerCase().includes(search);
      const matchTags = d.positive_emotions.some(t => t.toLowerCase().includes(search)) ||
                        d.negative_emotions.some(t => t.toLowerCase().includes(search));
      return matchText || matchTags;
    });

    filtered.sort((a, b) => {
      return sort === 'desc' 
        ? b.date.localeCompare(a.date) 
        : a.date.localeCompare(b.date);
    });

    els.logsTimelineList.innerHTML = '';

    if (filtered.length === 0) {
      els.logsTimelineList.innerHTML = '<div class="text-center p-5 text-muted">無符合條件的日記紀錄。</div>';
      return;
    }

    filtered.forEach(d => {
      const item = document.createElement('div');
      item.className = 'diary-log-item';
      item.addEventListener('click', () => showDiaryDetails(d));

      const meta = document.createElement('div');
      meta.className = 'log-meta';

      const dateStr = document.createElement('div');
      dateStr.className = 'log-date';
      dateStr.innerHTML = `<i data-lucide="calendar" style="width:16px;height:16px"></i> ${d.date}`;

      const snippet = document.createElement('div');
      snippet.className = 'log-snippet';
      snippet.textContent = d.content;

      const metrics = document.createElement('div');
      metrics.className = 'log-metrics';
      metrics.innerHTML = `
        <span class="text-emotion">情緒: ${d.emotion_score}</span>
        <span class="text-stress">壓力: ${d.stress_index}</span>
        <span class="text-anxiety">焦慮: ${d.anxiety_index}</span>
      `;

      meta.appendChild(dateStr);
      meta.appendChild(snippet);
      meta.appendChild(metrics);

      const actions = document.createElement('div');
      actions.className = 'log-actions';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-icon-danger';
      deleteBtn.innerHTML = '<i data-lucide="trash-2" style="width:16px;height:16px"></i>';
      deleteBtn.title = '刪除此日記';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Stop click from opening details modal
        handleDeleteDiary(d.date);
      });

      actions.appendChild(deleteBtn);

      item.appendChild(meta);
      item.appendChild(actions);

      els.logsTimelineList.appendChild(item);
    });

    lucide.createIcons();
  }

  async function handleDeleteDiary(date) {
    if (!confirm(`確定要刪除 ${date} 的日記紀錄嗎？此動作無法復原。`)) {
      return;
    }

    try {
      const res = await fetch(`/api/diaries/${date}`, { method: 'DELETE' });
      if (res.ok) {
        loadLogs();
      } else {
        alert('刪除失敗');
      }
    } catch (e) {
      console.error(e);
    }
  }

  // --- MODAL VIEWS ---
  function showDiaryDetails(diary) {
    state.selectedDiary = diary;
    els.modalTitle.textContent = `${diary.date} 心理量測細節`;
    els.modalContent.textContent = diary.content;
    
    els.modalMetricEmotion.textContent = diary.emotion_score;
    els.modalMetricStress.textContent = diary.stress_index;
    els.modalMetricAnxiety.textContent = diary.anxiety_index;
    els.modalMetricStability.textContent = diary.stability_index;
    
    els.modalSummary.textContent = diary.summary || '無。';
    els.modalAdvice.textContent = diary.advice || '無建議。';

    els.diaryDetailModal.classList.remove('hidden');
    lucide.createIcons();
  }

  function closeModal() {
    els.diaryDetailModal.classList.add('hidden');
    state.selectedDiary = null;
  }

  // --- SETTINGS OPERATIONS ---
  function saveSettings() {
    const key = els.settingsApiKey.value.trim();
    state.customApiKey = key;
    if (key) {
      localStorage.setItem('gemini_api_key', key);
      alert('已成功將 API 金鑰儲存於本機瀏覽器！');
    } else {
      localStorage.removeItem('gemini_api_key');
      alert('已清除自訂 API 金鑰，系統將嘗試使用伺服器端環境變數配置。');
    }
    updateApiIndicator();
  }

  async function clearDatabase() {
    if (!confirm('您確定要清空所有日記紀錄嗎？這會刪除資料庫中的所有儲存檔案。')) {
      return;
    }

    try {
      const fetchAll = await fetch('/api/diaries');
      const list = await fetchAll.json();
      
      for (const d of list) {
        await fetch(`/api/diaries/${d.date}`, { method: 'DELETE' });
      }

      alert('資料庫已清空！');
      loadAllData();
    } catch (e) {
      console.error(e);
      alert('清空失敗');
    }
  }

  // Loads pre-defined Mock diary items representing typical psychological state shifts
  async function loadMockData() {
    els.btnLoadMock.disabled = true;
    els.btnLoadMock.textContent = '載入模擬資料中...';

    const mockDiaries = [
      {
        date: '2026-06-10',
        content: '今天期末考和專案發表全部卡在一起，主管又催促工作進度，整天頭痛欲裂，真的很焦慮，壓力爆棚，好想逃避這一切...',
        analysis: {
          emotion_score: 20,
          stress_index: 92,
          anxiety_index: 88,
          stability_index: 40,
          positive_emotions: ['堅持'],
          negative_emotions: ['焦慮', '壓力', '頭痛', '無力'],
          summary: '面臨多重課業與工作壓力重疊，生理與心理處於高度緊繃狀態，有強烈的逃避與無助感。',
          advice: '請先深呼吸。暫時離開書桌，進行 5-10 分鐘的腹式呼吸以緩解焦慮。建議分工並列出輕重緩急清單，降低失控感。今晚必須保證充足睡眠。'
        }
      },
      {
        date: '2026-06-11',
        content: '考完了一科，雖然表現一般般，但至少放下一個大石頭。不過專案還是有點卡關，晚上跟組員有些摩擦，心情沉悶。',
        analysis: {
          emotion_score: 35,
          stress_index: 80,
          anxiety_index: 70,
          stability_index: 48,
          positive_emotions: ['釋懷'],
          negative_emotions: ['沉悶', '摩擦', '卡關'],
          summary: '考試壓力有所釋放，但人際摩擦與專案瓶頸帶來了新的煩悶與低氣壓。',
          advice: '與組員意見分歧是必經過程，建議先給彼此沉澱時間再溝通。今天可嘗試溫水泡腳，放鬆緊繃的神經。'
        }
      },
      {
        date: '2026-06-12',
        content: '專案卡關的地方居然被我想通了！下午重新修復了程式碼，跟組員道歉並好好談談，大家達成共識。心情稍微好轉了一些，晚上還去吃了一頓好吃的。',
        analysis: {
          emotion_score: 60,
          stress_index: 60,
          anxiety_index: 45,
          stability_index: 65,
          positive_emotions: ['開心', '突破', '共識', '享受'],
          negative_emotions: ['疲憊'],
          summary: '專案突破並成功與團隊修復關係，情緒大幅回升，體會到成就感。',
          advice: '非常棒的進展！適時的犒賞自己是維持動力的關鍵。繼續保持這種主動溝通的步調。'
        }
      },
      {
        date: '2026-06-13',
        content: '週末終於到了。今天睡到了中午，下午去附近的公園散散步，吹著微風，看著綠色的植物，心情很平靜，感覺這幾天的疲憊慢慢消散了。',
        analysis: {
          emotion_score: 75,
          stress_index: 30,
          anxiety_index: 25,
          stability_index: 80,
          positive_emotions: ['平靜', '放鬆', '舒暢'],
          negative_emotions: [],
          summary: '透過週末休息與大自然接觸，成功釋放累積的壓力，身心穩定度高。',
          advice: '大自然具有很強的療癒力量。多進行類似的戶外溫和活動，有助於重整大腦認知功能，建議晚上可以記錄自己感恩的三件事。'
        }
      },
      {
        date: '2026-06-14',
        content: '跟老朋友聚餐，聊了很多以前的趣事，大家笑得很開心。原來大家都各自面臨不同的煩惱，但也都在努力生活。感受到了友情支持的力量，心裡暖暖的。',
        analysis: {
          emotion_score: 85,
          stress_index: 20,
          anxiety_index: 15,
          stability_index: 90,
          positive_emotions: ['溫暖', '開心', '支持', '充實'],
          negative_emotions: [],
          summary: '藉由社交聚會與情感交流獲得高能量的社會支持，情緒積極且溫馨。',
          advice: '維繫良好的社交連結是心理健康的重要支柱。感到疲憊時，向信任的朋友傾訴或共享時光能帶來極佳的解壓效果。'
        }
      },
      {
        date: '2026-06-15',
        content: '新的一週開始，回歸工作崗位。雖然代辦事項很多，但因為週末充飽了電，今天做起事來很有條理，心情雖然平淡，但效率很高，是充實的一天。',
        analysis: {
          emotion_score: 70,
          stress_index: 45,
          anxiety_index: 30,
          stability_index: 85,
          positive_emotions: ['充實', '平穩', '條理'],
          negative_emotions: [],
          summary: '週一開工，身心恢復良好，能從容面對工作事項，展現良好的心理韌性。',
          advice: '良好的時間管理能幫助維持目前平穩的節奏。每工作 50 分鐘記得起來伸展 5 分鐘，保持身體微循環。'
        }
      },
      {
        date: '2026-06-16',
        content: '今天專案正式上線，一切順利！主管在會議上公開表揚了我們，真的非常有成就感。這陣子的辛苦都值得了。晚上睡前打算讀本好書，平靜地迎接明天。',
        analysis: {
          emotion_score: 95,
          stress_index: 15,
          anxiety_index: 10,
          stability_index: 92,
          positive_emotions: ['成就感', '滿足', '喜悅', '平靜'],
          negative_emotions: [],
          summary: '專案圓滿成功並獲得正向肯定，心情愉悅且充滿自我效能感。',
          advice: '恭喜專案成功！這是對你努力的最佳肯定。享受此刻的喜悅，並將這個成功經驗內化為心理資本。今晚適合閱讀或冥想，維持高品質睡眠。'
        }
      }
    ];

    try {
      for (const item of mockDiaries) {
        await fetch('/api/diaries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item)
        });
      }
      alert('一週模擬心理數據載入成功！');
      loadAllData();
    } catch (e) {
      console.error(e);
      alert('模擬資料載入失敗');
    } finally {
      els.btnLoadMock.disabled = false;
      els.btnLoadMock.textContent = '載入一週模擬心理數據';
    }
  }

  // Start the application
  init();
});
