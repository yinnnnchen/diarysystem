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
  function safeCreateIcons() {
    try {
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
    } catch (e) {
      console.warn('lucide.createIcons() 執行錯誤:', e);
    }
  }

  safeCreateIcons();

  // App State
  const state = {
    currentTab: 'dashboard',
    diaries: [],
    stats: null,
    apiStatus: { hasEnvKey: false },
    selectedDiary: null,
    currentUser: null,
    currentReport: null,
    isRecording: false,
    charts: {
      trend: null,
      radar: null,
      weekday: null
    }
  };

  async function getAuthHeaders() {
    if (!state.currentUser) {
      throw new Error('請先登入 Google 帳號');
    }
    const token = await state.currentUser.getIdToken();
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  // HTML 轉義函式（防止 PDF 匯出時的 HTML 注入 / XSS）
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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
    logEmotionFilter: document.getElementById('log-emotion-filter'),
    btnExportJson: document.getElementById('btn-export-json'),
    btnExportCsv: document.getElementById('btn-export-csv'),

    // Settings
    btnClearDb: document.getElementById('btn-clear-db'),
    btnEnableReminder: document.getElementById('btn-enable-reminder'),
    reminderStatus: document.getElementById('reminder-status'),

    // Write - voice & advice tracking
    btnVoiceInput: document.getElementById('btn-voice-input'),
    adviceCompleteRow: document.getElementById('advice-complete-row'),
    adviceCompleteCheckbox: document.getElementById('advice-complete-checkbox'),
    crisisBanner: document.getElementById('crisis-banner'),
    crisisBannerBody: document.getElementById('crisis-banner-body'),

    // Report tab
    reportPeriodSelect: document.getElementById('report-period-select'),
    btnGenerateReport: document.getElementById('btn-generate-report'),
    reportPlaceholder: document.getElementById('report-placeholder'),
    reportContent: document.getElementById('report-content'),
    reportOverview: document.getElementById('report-overview'),
    reportTrendInsight: document.getElementById('report-trend-insight'),
    reportStressors: document.getElementById('report-stressors'),
    reportHighlights: document.getElementById('report-highlights'),
    reportRecommendation: document.getElementById('report-recommendation'),
    reportMetaCount: document.getElementById('report-meta-count'),
    reportMetaRange: document.getElementById('report-meta-range'),
    btnExportReportPdf: document.getElementById('btn-export-report-pdf'),
    streakBadge: document.getElementById('streak-badge'),
    calendarHeatmap: document.getElementById('calendar-heatmap'),
    
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
    els.diaryDate.value = `${yyyy}-${mm}-${dd}`;
    els.currentDateDisplay.textContent = today.toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });

    setupEventListeners();
    setupGoogleLogin();
    setupFirebaseAuth();
    setupThemeToggle();
    setupMobileMenu();
    setupVoiceInput();
    setupReminder();
    checkApiStatus();
    registerServiceWorker();
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => {
          console.warn('Service worker 註冊失敗（不影響主要功能）:', err);
        });
      });
    }
  }

  function setupThemeToggle() {
    const toggleBtn = document.getElementById('btn-theme-toggle');
    const root = document.documentElement;

    function applyMetaThemeColor(theme) {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) {
        meta.setAttribute('content', theme === 'light' ? '#eef0ec' : '#0e171c');
      }
    }

    applyMetaThemeColor(root.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

    toggleBtn?.addEventListener('click', () => {
      const current = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      const next = current === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      try {
        localStorage.setItem('theme', next);
      } catch (e) {}
      applyMetaThemeColor(next);

      if (state.stats) {
        renderDashboardCharts();
      }
    });
  }

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

    els.navItems.forEach(item => {
      item.addEventListener('click', closeMenu);
    });
  }

  function localDateStr(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function withAlpha(hex, alpha) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
    const n = parseInt(full, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function getChartThemeColors() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    return {
      text: cssVar('--color-text-muted'),
      grid: isLight ? 'rgba(26, 42, 48, 0.08)' : 'rgba(232, 227, 214, 0.06)',
      gridStrong: isLight ? 'rgba(26, 42, 48, 0.12)' : 'rgba(232, 227, 214, 0.1)'
    };
  }

  function setupGoogleLogin() {
    const loginButton = document.getElementById("btn-google-login");
    const logoutButton = document.getElementById("btn-google-logout");

    loginButton?.addEventListener("click", async () => {
      try {
        await signInWithPopup(auth, googleProvider);
        console.log("Google 登入成功");
      } catch (error) {
        console.error("Google 登入失敗:", error);
        alert("Google 登入失敗：" + error.message);
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
      const loginButton = document.getElementById("btn-google-login");
      const logoutButton = document.getElementById("btn-google-logout");
      const userEmail = document.getElementById("user-email");

      if (user) {
        state.currentUser = user;

        if (userEmail) {
          userEmail.textContent = user.email || user.displayName || "已登入";
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
            { merge: true }
          );

          await loadAllData();
          // 登入完成後檢查今日提醒（解決時序死鎖問題）
          maybeShowDailyReminder();
        } catch (error) {
          console.error("Firestore 使用者資料建立失敗:", error);
        }
      } else {
        // 使用者登出：徹底清空狀態與圖表，防止個人隱私數據殘留
        state.currentUser = null;
        state.diaries = [];
        state.stats = null;
        state.currentReport = null;
        state.selectedDiary = null;

        if (state.charts.trend) { state.charts.trend.destroy(); state.charts.trend = null; }
        if (state.charts.radar) { state.charts.radar.destroy(); state.charts.radar = null; }
        if (state.charts.weekday) { state.charts.weekday.destroy(); state.charts.weekday = null; }

        updateDashboardStats();
        renderLogs();
        hideAnalysisResults();

        if (els.diaryContent) els.diaryContent.value = '';
        if (els.charCount) els.charCount.textContent = '0';
        if (els.saveStatus) {
          els.saveStatus.textContent = '未登入';
          els.saveStatus.className = 'editor-status';
        }

        if (els.reportPlaceholder && els.reportContent) {
          els.reportPlaceholder.classList.remove('hidden');
          els.reportContent.classList.add('hidden');
        }

        if (userEmail) {
          userEmail.textContent = "尚未登入";
        }

        loginButton?.classList.remove("hidden");
        logoutButton?.classList.add("hidden");
      }
    });
  }

  function setupEventListeners() {
    els.navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = item.getAttribute('data-tab');
        switchTab(tab);
      });
    });

    els.diaryContent?.addEventListener('input', () => {
      els.charCount.textContent = els.diaryContent.value.length;
    });

    els.btnAnalyzeSave?.addEventListener('click', handleAnalyzeAndSave);
    els.btnClearDb?.addEventListener('click', clearDatabase);

    els.logSearchInput?.addEventListener('input', renderLogs);
    els.logSortSelect?.addEventListener('change', renderLogs);
    els.logEmotionFilter?.addEventListener('change', renderLogs);

    els.btnExportJson?.addEventListener('click', () => exportDiaries('json'));
    els.btnExportCsv?.addEventListener('click', () => exportDiaries('csv'));

    els.btnCloseModal?.addEventListener('click', closeModal);
    els.diaryDetailModal?.addEventListener('click', (e) => {
      if (e.target === els.diaryDetailModal) closeModal();
    });

    els.diaryDate?.addEventListener('change', loadDiaryForSelectedDate);
    els.adviceCompleteCheckbox?.addEventListener('change', handleAdviceToggle);
    els.btnGenerateReport?.addEventListener('click', handleGenerateReport);
    els.btnExportReportPdf?.addEventListener('click', exportReportAsPdf);
  }

  function switchTab(tabId) {
    state.currentTab = tabId;
    
    els.navItems.forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-tab') === tabId);
    });

    els.tabPanes.forEach(pane => {
      pane.classList.toggle('active', pane.id === `tab-${tabId}`);
    });

    const titles = {
      dashboard: { title: '身心儀表板', sub: '追蹤您的日常情緒、壓力和焦慮趨勢' },
      write: { title: '撰寫今日日記', sub: '寫下生活，讓 AI 傾聽並分析您的情感特徵' },
      logs: { title: '日記時光機', sub: '翻閱過往的心情隨筆與身心變化軌跡' },
      report: { title: 'AI 心理報告', sub: '彙整一段期間的日記，看見整體的心理狀態變化' },
      settings: { title: '系統設定', sub: '管理您的日記資料與通知設定' }
    };

    if (titles[tabId]) {
      els.pageTitle.textContent = titles[tabId].title;
      els.pageSubtitle.textContent = titles[tabId].sub;
    }

    if (state.currentUser) {
      if (tabId === 'dashboard') {
        loadAllData();
      } else if (tabId === 'logs') {
        loadLogs();
      } else if (tabId === 'write') {
        loadDiaryForSelectedDate();
      }
    }
  }

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
    if (!indicator) return;
    const dot = indicator.querySelector('.status-dot');
    const text = indicator.querySelector('.status-text');

    if (state.apiStatus.hasEnvKey) {
      dot.className = 'status-dot success';
      text.textContent = 'Gemini API 已就緒（後端金鑰）';
    } else {
      dot.className = 'status-dot warning';
      text.textContent = '伺服器尚未設定 API 金鑰，請聯絡管理員';
    }
  }

  async function loadAllData() {
    if (!state.currentUser) return;
    try {
      const headers = await getAuthHeaders();
      const statsRes = await fetch('/api/stats', { headers });
      state.stats = await statsRes.json();
      
      const diariesRes = await fetch('/api/diaries', { headers });
      state.diaries = await diariesRes.json();

      updateDashboardStats();
      renderDashboardCharts();
    } catch (e) {
      console.error('Error loading dashboard data:', e);
    }
  }

  async function loadLogs() {
    if (!state.currentUser) return;
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
    if (!state.currentUser) return;
    const date = els.diaryDate.value;
    if (!date) return;

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
            advice: diary.advice,
            advice_completed: diary.advice_completed,
            crisis_alert: diary.crisis_alert,
            crisis_resources: null
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

  async function handleAnalyzeAndSave() {
    if (!state.currentUser) {
      alert('請先登入 Google 帳號！');
      return;
    }
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
    els.saveStatus.textContent = 'AI 正在分析中...';
    els.saveStatus.className = 'editor-status warning';

    try {
      const authHeaders = await getAuthHeaders();
      const analyzeRes = await fetch('/api/diaries/analyze', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ content })
      });

      if (!analyzeRes.ok) {
        const errData = await analyzeRes.json();
        const crisisNote = errData.crisis_alert
          ? '\n\n如果你現在感到很痛苦，請撥打安心專線 1925（24 小時）或生命線 1995，你並不孤單。'
          : '';
        throw new Error((errData.error || '分析失敗') + crisisNote);
      }

      const analysisResult = await analyzeRes.json();

      const saveRes = await fetch('/api/diaries', {
        method: 'POST',
        headers: authHeaders,
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
      checkApiStatus();
      loadAllData(); // 儲存後立即更新統計圖表
    } catch (error) {
      alert('分析與儲存失敗：' + error.message);
      els.saveStatus.textContent = '儲存失敗';
      els.saveStatus.className = 'editor-status text-stress';
    } finally {
      els.btnAnalyzeSave.disabled = false;
      els.btnAnalyzeSave.innerHTML = '<i data-lucide="sparkles"></i> AI 分析並儲存日記';
      safeCreateIcons();
    }
  }

  function showAnalysisResults(result) {
    els.analysisPlaceholder.classList.add('hidden');
    els.analysisResultView.classList.remove('hidden');

    els.metricValEmotion.textContent = result.emotion_score;
    els.metricValStress.textContent = result.stress_index;
    els.metricValAnxiety.textContent = result.anxiety_index;
    els.metricValStability.textContent = result.stability_index;

    els.progressEmotion.style.width = `${result.emotion_score}%`;
    els.progressStress.style.width = `${result.stress_index}%`;
    els.progressAnxiety.style.width = `${result.anxiety_index}%`;
    els.progressStability.style.width = `${result.stability_index}%`;

    renderTags(els.resultPosTags, result.positive_emotions, 'pos');
    renderTags(els.resultNegTags, result.negative_emotions, 'neg');

    els.resultSummary.textContent = result.summary || '未提供摘要。';
    els.resultAdvice.textContent = result.advice || '未提供建議。';

    if (els.adviceCompleteRow) {
      els.adviceCompleteRow.classList.remove('hidden');
      els.adviceCompleteCheckbox.checked = !!result.advice_completed;
    }

    showCrisisBanner(result.crisis_alert, result.crisis_resources);
  }

  function hideAnalysisResults() {
    els.analysisPlaceholder.classList.remove('hidden');
    els.analysisResultView.classList.add('hidden');
    els.adviceCompleteRow?.classList.add('hidden');
    showCrisisBanner(false);
  }

  function showCrisisBanner(active, resources) {
    if (!els.crisisBanner) return;
    if (!active) {
      els.crisisBanner.classList.add('hidden');
      return;
    }
    const res = resources || {
      message: '我們注意到這篇日記的內容可能反映出強烈的情緒困擾。你並不孤單，專業的協助隨時都在。',
      hotlines: [
        { name: '衛福部安心專線', phone: '1925', available: '24 小時' },
        { name: '生命線協談專線', phone: '1995', available: '24 小時' },
        { name: '張老師專線', phone: '1980', available: '9:00-21:00' }
      ]
    };
    els.crisisBannerBody.innerHTML = `
      <p>${escapeHtml(res.message)}</p>
      <ul class="crisis-hotline-list">
        ${res.hotlines.map(h => `<li><strong>${escapeHtml(h.name)}</strong>：<a href="tel:${h.phone}">${escapeHtml(h.phone)}</a>（${escapeHtml(h.available)}）</li>`).join('')}
      </ul>
    `;
    els.crisisBanner.classList.remove('hidden');
  }

  async function handleAdviceToggle() {
    const date = els.diaryDate.value;
    if (!date) return;
    try {
      const res = await fetch(`/api/diaries/${date}/advice-status`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ completed: els.adviceCompleteCheckbox.checked })
      });
      if (!res.ok) throw new Error('更新失敗');
    } catch (e) {
      console.error('更新建議完成狀態失敗:', e);
      els.adviceCompleteCheckbox.checked = !els.adviceCompleteCheckbox.checked;
      alert('無法更新建議完成狀態，請稍後再試。');
    }
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

  function updateDashboardStats() {
    if (!state.stats || state.stats.totalCount === 0) {
      els.avgEmotion.textContent = '--';
      els.avgStress.textContent = '--';
      els.avgAnxiety.textContent = '--';
      els.avgStability.textContent = '--';
      els.posKeywords.innerHTML = '<p class="text-muted">尚無足夠數據</p>';
      els.negKeywords.innerHTML = '<p class="text-muted">尚無足夠數據</p>';
      renderStreakBadge(0);
      renderCalendarHeatmap([]);
      return;
    }

    const { averages, emotionsDistribution } = state.stats;
    els.avgEmotion.textContent = `${averages.emotion}/100`;
    els.avgStress.textContent = `${averages.stress}/100`;
    els.avgAnxiety.textContent = `${averages.anxiety}/100`;
    els.avgStability.textContent = `${averages.stability}/100`;

    buildWordCloud(els.posKeywords, emotionsDistribution.positive, 'pos');
    buildWordCloud(els.negKeywords, emotionsDistribution.negative, 'neg');
    renderStreakBadge(state.stats.streak || 0);
    renderCalendarHeatmap(state.diaries);
  }

  function renderStreakBadge(streak) {
    if (!els.streakBadge) return;
    if (streak > 0) {
      els.streakBadge.innerHTML = `<i data-lucide="flame" style="width:16px;height:16px"></i> 連續紀錄 ${streak} 天`;
      els.streakBadge.classList.add('active');
    } else {
      els.streakBadge.innerHTML = `<i data-lucide="flame" style="width:16px;height:16px"></i> 尚未開始連續紀錄`;
      els.streakBadge.classList.remove('active');
    }
    safeCreateIcons();
  }

  function renderCalendarHeatmap(diaries) {
    if (!els.calendarHeatmap) return;

    const byDate = {};
    (diaries || []).forEach(d => { byDate[d.date] = d; });

    const totalDays = 84;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const end = new Date(today);
    end.setDate(end.getDate() + (6 - end.getDay()));
    const start = new Date(end);
    start.setDate(start.getDate() - totalDays + 1);

    const cells = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const dateStr = localDateStr(cursor);
      const entry = byDate[dateStr];
      const isFuture = cursor > today;
      cells.push({ date: dateStr, score: entry ? entry.emotion_score : null, isFuture });
      cursor.setDate(cursor.getDate() + 1);
    }

    function levelFor(score) {
      if (score === null || score === undefined) return 0;
      if (score < 30) return 1;
      if (score < 50) return 2;
      if (score < 70) return 3;
      return 4;
    }

    let html = '<div class="heatmap-grid">';
    cells.forEach(c => {
      const level = c.isFuture ? -1 : levelFor(c.score);
      const title = c.isFuture
        ? ''
        : (c.score !== null ? `${c.date}｜情緒分數 ${Number(c.score) || 0}` : `${c.date}｜無紀錄`);
      html += `<div class="heatmap-cell ${c.isFuture ? 'future' : `level-${level}`}" title="${title}"></div>`;
    });
    html += '</div>';

    els.calendarHeatmap.innerHTML = html;
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
    const labels = trends.map(t => t.date.substring(5));

    if (state.charts.trend) {
      state.charts.trend.destroy();
    }

    const themeColors = getChartThemeColors();
    const ctxTrend = document.getElementById('trendChart')?.getContext('2d');
    if (ctxTrend) {
      state.charts.trend = new Chart(ctxTrend, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: '情緒分數',
              data: trends.map(t => t.emotion_score),
              borderColor: cssVar('--color-emotion'),
              backgroundColor: withAlpha(cssVar('--color-emotion'), 0.1),
              tension: 0.3,
              fill: true
            },
            {
              label: '壓力指數',
              data: trends.map(t => t.stress_index),
              borderColor: cssVar('--color-stress'),
              backgroundColor: 'transparent',
              tension: 0.3
            },
            {
              label: '焦慮指數',
              data: trends.map(t => t.anxiety_index),
              borderColor: cssVar('--color-anxiety'),
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
              labels: { color: themeColors.text, font: { family: 'Noto Sans TC' } }
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
    }

    if (state.charts.radar) {
      state.charts.radar.destroy();
    }

    const avg = state.stats.averages;
    const ctxRadar = document.getElementById('radarChart')?.getContext('2d');
    if (ctxRadar) {
      state.charts.radar = new Chart(ctxRadar, {
        type: 'radar',
        data: {
          labels: ['平均情緒', '平均壓力', '平均焦慮', '情緒穩定度'],
          datasets: [{
            label: '心理狀態分佈',
            data: [avg.emotion, avg.stress, avg.anxiety, avg.stability],
            backgroundColor: withAlpha(cssVar('--color-primary'), 0.2),
            borderColor: cssVar('--color-primary'),
            borderWidth: 2,
            pointBackgroundColor: cssVar('--color-primary')
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
              pointLabels: { color: themeColors.text, font: { family: 'Noto Sans TC', size: 12 } },
              ticks: { display: false },
              min: 0,
              max: 100
            }
          }
        }
      });
    }
  }

  function renderLogs() {
    const search = els.logSearchInput.value.toLowerCase();
    const sort = els.logSortSelect.value;
    const emotionRange = els.logEmotionFilter ? els.logEmotionFilter.value : 'all';

    let filtered = state.diaries.filter(d => {
      const matchText = (d.content || '').toLowerCase().includes(search) || 
                        (d.summary || '').toLowerCase().includes(search);
      const matchTags = (d.positive_emotions || []).some(t => t.toLowerCase().includes(search)) ||
                        (d.negative_emotions || []).some(t => t.toLowerCase().includes(search));
      const matchSearch = matchText || matchTags;

      let matchEmotion = true;
      if (emotionRange === 'low') matchEmotion = d.emotion_score < 40;
      else if (emotionRange === 'mid') matchEmotion = d.emotion_score >= 40 && d.emotion_score <= 70;
      else if (emotionRange === 'high') matchEmotion = d.emotion_score > 70;
      else if (emotionRange === 'crisis') matchEmotion = !!d.crisis_alert;

      return matchSearch && matchEmotion;
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
      dateStr.innerHTML = `<i data-lucide="calendar" style="width:16px;height:16px"></i> ${escapeHtml(d.date)}`;

      const snippet = document.createElement('div');
      snippet.className = 'log-snippet';
      snippet.textContent = d.content;

      const metrics = document.createElement('div');
      metrics.className = 'log-metrics';
      metrics.innerHTML = `
        <span class="text-emotion">情緒: ${Number(d.emotion_score) || 0}</span>
        <span class="text-stress">壓力: ${Number(d.stress_index) || 0}</span>
        <span class="text-anxiety">焦慮: ${Number(d.anxiety_index) || 0}</span>
        ${d.advice_completed ? '<span class="text-stability" title="已採納建議"><i data-lucide=\'check-circle\' style=\'width:12px;height:12px\'></i> 已採納建議</span>' : ''}
        ${d.crisis_alert ? '<span class="crisis-tag">⚠ 危機提示</span>' : ''}
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
        e.stopPropagation();
        handleDeleteDiary(d.date);
      });

      actions.appendChild(deleteBtn);
      item.appendChild(meta);
      item.appendChild(actions);

      els.logsTimelineList.appendChild(item);
    });

    safeCreateIcons();
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
        await loadLogs();
        await loadAllData(); // 刪除後同步刷新身心儀表板
      } else {
        alert('刪除失敗');
      }
    } catch (e) {
      console.error(e);
    }
  }

  function showDiaryDetails(diary) {
    state.selectedDiary = diary;
    els.modalTitle.textContent = `${diary.date} 情緒分析細節`;
    els.modalContent.textContent = diary.content;
    
    els.modalMetricEmotion.textContent = diary.emotion_score;
    els.modalMetricStress.textContent = diary.stress_index;
    els.modalMetricAnxiety.textContent = diary.anxiety_index;
    els.modalMetricStability.textContent = diary.stability_index;
    
    els.modalSummary.textContent = diary.summary || '無。';
    els.modalAdvice.textContent = diary.advice || '無建議。';

    els.diaryDetailModal.classList.remove('hidden');
    safeCreateIcons();
  }

  function closeModal() {
    els.diaryDetailModal.classList.add('hidden');
    state.selectedDiary = null;
  }

  async function clearDatabase() {
    if (!confirm('您確定要清空所有日記紀錄嗎？這會刪除資料庫中的所有儲存檔案。')) {
      return;
    }

    try {
      const authHeaders = await getAuthHeaders();
      const fetchAll = await fetch('/api/diaries', { headers: authHeaders });
      const list = await fetchAll.json();
      
      // 使用 Promise.all 併發刪除，避免逐次串行發送造成網路壅塞與延遲
      await Promise.all(
        list.map(d => fetch(`/api/diaries/${d.date}`, { method: 'DELETE', headers: authHeaders }))
      );

      alert('資料庫已清空！');
      await loadAllData();
      await loadLogs();
    } catch (e) {
      console.error(e);
      alert('清空失敗');
    }
  }

  function exportDiaries(format) {
    if (!state.diaries || state.diaries.length === 0) {
      alert('目前沒有可匯出的日記資料。');
      return;
    }

    const cols = [
      'date', 'content', 'emotion_score', 'stress_index',
      'anxiety_index', 'stability_index', 'positive_emotions',
      'negative_emotions', 'summary', 'advice', 'advice_completed', 'crisis_alert'
    ];

    let blob, filename;

    if (format === 'json') {
      const data = state.diaries.map(d => {
        const obj = {};
        cols.forEach(c => { obj[c] = d[c]; });
        return obj;
      });
      blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      filename = `diary_export_${localDateStr()}.json`;
    } else {
      // 防範 CSV 公式注入（Formula Injection）
      const esc = (v) => {
        if (v === undefined || v === null) return '';
        let s = Array.isArray(v) ? v.join('; ') : String(v);
        if (/^[=+\-@\t\r]/.test(s)) {
          s = "'" + s;
        }
        return `"${s.replace(/"/g, '""')}"`;
      };
      const header = cols.join(',');
      const rows = state.diaries.map(d => cols.map(c => esc(d[c])).join(','));
      const csv = '\uFEFF' + [header, ...rows].join('\n');
      blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      filename = `diary_export_${localDateStr()}.csv`;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleGenerateReport() {
    if (!state.currentUser) {
      alert('請先登入 Google 帳號！');
      return;
    }

    const period = els.reportPeriodSelect ? els.reportPeriodSelect.value : 'week';

    els.btnGenerateReport.disabled = true;
    const originalHtml = els.btnGenerateReport.innerHTML;
    els.btnGenerateReport.innerHTML = '正在產生報告...';

    try {
      const res = await fetch('/api/diaries/report', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ period })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || '報告產生失敗');
      }

      if (data.totalCount === 0) {
        els.reportPlaceholder.classList.remove('hidden');
        els.reportContent.classList.add('hidden');
        els.reportPlaceholder.querySelector('p').textContent = data.message;
        return;
      }

      state.currentReport = data;
      renderReport(data);
    } catch (e) {
      console.error('產生報告失敗:', e);
      alert('產生報告失敗：' + e.message);
    } finally {
      els.btnGenerateReport.disabled = false;
      els.btnGenerateReport.innerHTML = originalHtml;
      safeCreateIcons();
    }
  }

  function renderReport(data) {
    els.reportPlaceholder.classList.add('hidden');
    els.reportContent.classList.remove('hidden');

    els.reportMetaCount.textContent = `共 ${data.totalCount} 篇日記`;
    els.reportMetaRange.textContent = `${data.startDate} ~ ${data.endDate}`;

    els.reportOverview.textContent = data.overview || '無';
    els.reportTrendInsight.textContent = data.trend_insight || '無';
    els.reportRecommendation.textContent = data.recommendation || '無';

    renderChipList(els.reportStressors, data.top_stressors, 'neg');
    renderChipList(els.reportHighlights, data.positive_highlights, 'pos');

    renderWeekdayChart(data.weekdayAverages);
  }

  function renderChipList(container, list, type) {
    if (!container) return;
    container.innerHTML = '';
    const arr = Array.isArray(list) ? list : [];
    if (arr.length === 0) {
      container.innerHTML = '<span class="text-muted" style="font-size:12px">無</span>';
      return;
    }
    arr.forEach(item => {
      const span = document.createElement('span');
      span.className = `keyword-badge ${type}`;
      span.textContent = item;
      container.appendChild(span);
    });
  }

  function renderWeekdayChart(weekdayAverages) {
    const canvas = document.getElementById('weekdayChart');
    if (!canvas || !weekdayAverages) return;

    if (state.charts.weekday) {
      state.charts.weekday.destroy();
    }

    const themeColors = getChartThemeColors();

    state.charts.weekday = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: weekdayAverages.map(w => w.label),
        datasets: [{
          label: '平均情緒分數',
          data: weekdayAverages.map(w => w.average),
          backgroundColor: withAlpha(cssVar('--color-primary'), 0.55),
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            min: 0, max: 100,
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
  }

  function exportReportAsPdf() {
    if (!state.currentReport) {
      alert('請先產生報告。');
      return;
    }
    const d = state.currentReport;
    const printWindow = window.open('', '_blank');
    
    // 使用 escapeHtml 轉義所有注入內容，杜絕 XSS
    const stressors = (d.top_stressors || []).map(s => `<span class="chip neg">${escapeHtml(s)}</span>`).join('');
    const highlights = (d.positive_highlights || []).map(s => `<span class="chip pos">${escapeHtml(s)}</span>`).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="zh-TW"><head><meta charset="UTF-8">
      <title>心靈微光 - AI 心理報告</title>
      <style>
        body { font-family: 'Noto Sans TC', sans-serif; padding: 32px; color: #1a2a30; line-height: 1.7; }
        h1 { color: #7a5c1e; margin-bottom: 4px; }
        h2 { margin-top: 28px; border-left: 4px solid #7a5c1e; padding-left: 10px; }
        .meta { color: #5b6b6c; margin-bottom: 20px; }
        .metrics { display: flex; gap: 16px; margin: 16px 0; }
        .metric { background: #f1efe6; padding: 10px 16px; border-radius: 10px; text-align: center; }
        .chip { display: inline-block; background: #efe6cc; color: #5c4512; padding: 4px 10px; border-radius: 999px; margin: 4px 6px 0 0; font-size: 13px; }
        .chip.neg { background: #fee2e2; color: #b91c1c; }
        @media print { body { padding: 12px; } }
      </style>
      </head><body>
        <h1>心靈微光 · AI 心理報告</h1>
        <p class="meta">期間：${escapeHtml(d.startDate)} ~ ${escapeHtml(d.endDate)}（共 ${Number(d.totalCount) || 0} 篇日記，${d.period === 'month' ? '月報' : '週報'}）</p>

        <div class="metrics">
          <div class="metric"><strong>${Number(d.periodStats?.emotion) || 0}</strong><br>平均情緒</div>
          <div class="metric"><strong>${Number(d.periodStats?.stress) || 0}</strong><br>平均壓力</div>
          <div class="metric"><strong>${Number(d.periodStats?.anxiety) || 0}</strong><br>平均焦慮</div>
          <div class="metric"><strong>${Number(d.periodStats?.stability) || 0}</strong><br>平均穩定度</div>
        </div>

        <h2>整體總結</h2>
        <p>${escapeHtml(d.overview || '')}</p>

        <h2>趨勢觀察</h2>
        <p>${escapeHtml(d.trend_insight || '')}</p>

        <h2>主要壓力來源</h2>
        <p>${stressors || '無'}</p>

        <h2>正向亮點</h2>
        <p>${highlights || '無'}</p>

        <h2>心理健康建議</h2>
        <p>${escapeHtml(d.recommendation || '')}</p>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 400);
  }

  function setupVoiceInput() {
    if (!els.btnVoiceInput) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      els.btnVoiceInput.disabled = true;
      els.btnVoiceInput.title = '此瀏覽器不支援語音輸入';
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-TW';
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript;
        }
      }
      if (finalText) {
        const sep = els.diaryContent.value && !els.diaryContent.value.endsWith('\n') ? '\n' : '';
        els.diaryContent.value += sep + finalText;
        els.charCount.textContent = els.diaryContent.value.length;
      }
    };

    recognition.onerror = (e) => {
      console.error('語音辨識錯誤:', e.error);
      stopRecording();
    };

    recognition.onend = () => {
      if (state.isRecording) {
        try { recognition.start(); } catch (e) { stopRecording(); }
      }
    };

    function startRecording() {
      try {
        recognition.start();
        state.isRecording = true;
        els.btnVoiceInput.classList.add('recording');
        els.btnVoiceInput.title = '點擊停止錄音';
      } catch (e) {
        console.error('無法啟動語音輸入:', e);
      }
    }

    function stopRecording() {
      try { recognition.stop(); } catch (e) {}
      state.isRecording = false;
      els.btnVoiceInput.classList.remove('recording');
      els.btnVoiceInput.title = '點擊開始語音輸入';
    }

    els.btnVoiceInput.addEventListener('click', () => {
      if (state.isRecording) {
        stopRecording();
      } else {
        startRecording();
      }
    });
  }

  function setupReminder() {
    if (!els.btnEnableReminder) return;

    updateReminderStatusUI();

    els.btnEnableReminder.addEventListener('click', async () => {
      if (!('Notification' in window)) {
        alert('此瀏覽器不支援通知功能。');
        return;
      }
      const permission = await Notification.requestPermission();
      updateReminderStatusUI();
      if (permission === 'granted') {
        localStorage.setItem('reminder_enabled', '1');
        new Notification('心靈微光', { body: '提醒功能已開啟，若今天還沒寫日記，我們會在稍後提醒您。' });
      }
    });
  }

  function updateReminderStatusUI() {
    if (!els.reminderStatus) return;
    const enabled = localStorage.getItem('reminder_enabled') === '1' &&
      (typeof Notification !== 'undefined' && Notification.permission === 'granted');
    els.reminderStatus.textContent = enabled ? '提醒已開啟' : '提醒尚未開啟';
    els.reminderStatus.className = enabled ? 'status-text text-emotion' : 'status-text text-muted';
    if (els.btnEnableReminder) {
      els.btnEnableReminder.textContent = enabled ? '提醒已啟用' : '開啟每日提醒';
      els.btnEnableReminder.disabled = enabled;
    }
  }

  async function maybeShowDailyReminder() {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (localStorage.getItem('reminder_enabled') !== '1') return;

    const today = localDateStr();
    const lastPrompt = localStorage.getItem('reminder_last_prompt');
    if (lastPrompt === today) return;

    if (!state.currentUser) return;

    try {
      const res = await fetch(`/api/diaries/${today}`, { headers: await getAuthHeaders() });
      if (res.status === 404) {
        new Notification('心靈微光 · 每日提醒', {
          body: '今天還沒有寫日記喔，花幾分鐘記錄一下今天的心情吧！'
        });
      }
      localStorage.setItem('reminder_last_prompt', today);
    } catch (e) {
      console.error('每日提醒檢查失敗:', e);
    }
  }

  init();
});