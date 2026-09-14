import {
    auth,
    googleProvider,
    db
} from "./firebase.js";

import {
    signInWithPopup,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
    doc,
    setDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
  try {
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    } else {
      console.warn('lucide 未載入，圖示將不會顯示（不影響其他功能）');
    }
  } catch (e) {
    console.warn('lucide.createIcons() 失敗:', e);
  }

  // App State
  const state = {
    currentTab: 'dashboard',
    diaries: [],
    stats: null,
    apiStatus: { hasEnvKey: false },
    customApiKey: localStorage.getItem('gemini_api_key') || '',
    selectedDiary: null,
    currentUser: null,
    charts: {
      trend: null,
      radar: null
    }
  };

  async function getAuthHeaders() {
  if (!state.currentUser) {
    throw new Error('請先登入 Google 帳號');
  }
  const token =
    await state.currentUser.getIdToken();
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

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

 function init() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  els.diaryDate.value =
    `${yyyy}-${mm}-${dd}`;
  els.currentDateDisplay.textContent =
    today.toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });

  if (state.customApiKey) {
    els.settingsApiKey.value =
      state.customApiKey;
  }
  setupEventListeners();
  setupGoogleLogin();
  setupFirebaseAuth();
  setupThemeToggle();
  setupMobileMenu();
  checkApiStatus();
}

function setupThemeToggle() {
  const toggleBtn = document.getElementById('btn-theme-toggle');
  const root = document.documentElement;

  function applyMetaThemeColor(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', theme === 'light' ? '#f4f3fb' : '#0b0f19');
    }
  }

  applyMetaThemeColor(root.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

  toggleBtn?.addEventListener('click', () => {
    const current = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const next = current === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    try {
      localStorage.setItem('theme', next);
    } catch (e) {
      // localStorage may be unavailable (private mode etc.); theme just
      // won't persist across reloads, which is a harmless degradation.
    }
    applyMetaThemeColor(next);

    // Chart.js bakes colors into the chart instance at creation time,
    // so re-draw the dashboard charts to pick up the new theme's colors.
    if (state.stats) {
      renderDashboardCharts();
    }
  });
}

// --- MOBILE NAV DRAWER ---
function setupMobileMenu() {
  const menuBtn = document.getElementById('btn-mobile-menu');
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');

  function closeMenu() {
    sidebar?.classList.remove('open');
    backdrop?.classList.remove('open');
    document.body.classList.remove('no-scroll');
  }

  function openMenu() {
    sidebar?.classList.add('open');
    backdrop?.classList.add('open');
    document.body.classList.add('no-scroll');
  }

  menuBtn?.addEventListener('click', () => {
    if (sidebar?.classList.contains('open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  backdrop?.addEventListener('click', closeMenu);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  // Selecting a section closes the drawer too (mobile UX)
  els.navItems.forEach(item => {
    item.addEventListener('click', closeMenu);
  });
}

function getChartThemeColors() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  return {
    text: isLight ? '#6b6478' : '#94a3b8',
    grid: isLight ? 'rgba(30, 27, 46, 0.08)' : 'rgba(255, 255, 255, 0.05)',
    gridStrong: isLight ? 'rgba(30, 27, 46, 0.12)' : 'rgba(255, 255, 255, 0.08)'
  };
}

function setupGoogleLogin() {
    const loginButton =
        document.getElementById("btn-google-login");
    const logoutButton =
        document.getElementById("btn-google-logout");
    const userEmail =
        document.getElementById("user-email");
    loginButton?.addEventListener("click", async () => {
        try {
            const result =
                await signInWithPopup(auth, googleProvider);
            console.log("Google 登入成功");
            console.log("UID:", result.user.uid);
            console.log("Email:", result.user.email);
        } catch (error) {
            console.error("Google 登入失敗:", error);
            alert(
                "Google 登入失敗：" +
                error.message
            );
        }
    });

    logoutButton?.addEventListener("click", async () => {
        try {
            await signOut(auth);
            console.log("已登出");
        } catch (error) {
            console.error("登出失敗:", error);
        }
    });
}

function setupFirebaseAuth() {

  onAuthStateChanged(auth, async (user) => {

    const loginButton =
      document.getElementById("btn-google-login");

    const logoutButton =
      document.getElementById("btn-google-logout");

    const userEmail =
      document.getElementById("user-email");


    if (user) {

      state.currentUser = user;

      console.log("Firebase 登入成功");
      console.log("UID:", user.uid);
      console.log("Email:", user.email);
      console.log("Name:", user.displayName);


      if (userEmail) {

        userEmail.textContent =
          user.email ||
          user.displayName ||
          "已登入";

      }


      loginButton?.classList.add("hidden");
      logoutButton?.classList.remove("hidden");


      try {

        await setDoc(
          doc(db, "users", user.uid),
          {
            name: user.displayName || "",
            email: user.email || "",
            photoURL: user.photoURL || "",
            lastLoginAt: serverTimestamp()
          },
          {
            merge: true
          }
        );


        console.log(
          "Firestore 使用者資料已建立"
        );


        // 登入完成後再載入自己的日記
        await loadAllData();

      } catch (error) {

        console.error(
          "Firestore 使用者資料建立失敗:",
          error
        );

      }

    } else {

      state.currentUser = null;

      console.log(
        "目前沒有 Firebase 使用者"
      );


      if (userEmail) {
        userEmail.textContent = "尚未登入";
      }


      loginButton?.classList.remove("hidden");
      logoutButton?.classList.add("hidden");

    }

  });

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
    els.diaryContent?.addEventListener('input', () => {
      els.charCount.textContent = els.diaryContent.value.length;
    });

    // Save & Analyze Diary
    els.btnAnalyzeSave?.addEventListener('click', handleAnalyzeAndSave);

    // Save Settings
    els.btnSaveSettings?.addEventListener('click', saveSettings);

    // Clear Database
    els.btnClearDb?.addEventListener('click', clearDatabase);

    // Logs Filtering & Sorting
    els.logSearchInput?.addEventListener('input', renderLogs);
    els.logSortSelect?.addEventListener('change', renderLogs);

    // Close Modal
    els.btnCloseModal?.addEventListener('click', closeModal);
    els.diaryDetailModal?.addEventListener('click', (e) => {
      if (e.target === els.diaryDetailModal) closeModal();
    });

    // Date change loads existing diary if any
    els.diaryDate?.addEventListener('change', loadDiaryForSelectedDate);
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
      const statsRes = await fetch('/api/stats', {
  headers: await getAuthHeaders()
});
      const stats = await statsRes.json();
      state.stats = stats;
      
      const diariesRes = await fetch('/api/diaries', {
  headers: await getAuthHeaders()
});
      state.diaries = await diariesRes.json();

      updateDashboardStats();
      renderDashboardCharts();
    } catch (e) {
      console.error('Error loading dashboard data:', e);
    }
  }

  async function loadLogs() {
    try {
      const res = await fetch('/api/diaries', {
  headers: await getAuthHeaders()
});
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
      const res = await fetch(`/api/diaries/${date}`, {
  headers: await getAuthHeaders()
});
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
        headers: await getAuthHeaders(),
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
         headers: await getAuthHeaders(),
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

    const themeColors = getChartThemeColors();

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
            labels: { color: themeColors.text, font: { family: 'Outfit' } }
          }
        },
        scales: {
          y: {
            min: 0,
            max: 100,
            grid: { color: themeColors.grid },
            ticks: { color: themeColors.text }
          },
          x: {
            grid: { display: false },
            ticks: { color: themeColors.text }
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
            angleLines: { color: themeColors.gridStrong },
            grid: { color: themeColors.gridStrong },
            pointLabels: { color: themeColors.text, font: { family: 'Outfit', size: 12 } },
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
     const res = await fetch(`/api/diaries/${date}`, {
  method: 'DELETE',
  headers: await getAuthHeaders()
});
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
      const authHeaders = await getAuthHeaders();
      const fetchAll = await fetch('/api/diaries', { headers: authHeaders });
      const list = await fetchAll.json();
      
      for (const d of list) {
        await fetch(`/api/diaries/${d.date}`, { method: 'DELETE', headers: authHeaders });
      }

      alert('資料庫已清空！');
      loadAllData();
    } catch (e) {
      console.error(e);
      alert('清空失敗');
    }
  }

  // Start the application
  init();
});