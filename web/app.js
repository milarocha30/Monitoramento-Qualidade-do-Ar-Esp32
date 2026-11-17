/**
 * Smart Air IoT - Monitoramento da Qualidade do Ar com ESP32
 * Single Page Application Logic & ThingSpeak Integration
 */

// ThingSpeak API Configuration
const CONFIG = {
  CHANNEL_ID: "3577130",
  READ_API_KEY: "86735BGSD3R77O2F",
  RESULTS_COUNT: 30,
  POLL_INTERVAL_SEC: 20,
  get API_URL() {
    return `https://api.thingspeak.com/channels/${this.CHANNEL_ID}/feeds.json?api_key=${this.READ_API_KEY}&results=${this.RESULTS_COUNT}`;
  }
};

// Classification Metadata & Styling
const STATUS_LEVELS = [
  {
    level: 0,
    name: "EXCELENTE",
    badgeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    bgClass: "bg-emerald-500",
    textClass: "text-emerald-400",
    desc: "Qualidade do ar ideal. Níveis basais limpos e seguros para permanência prolongada.",
    alertClass: ""
  },
  {
    level: 1,
    name: "BOA",
    badgeClass: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
    bgClass: "bg-cyan-500",
    textClass: "text-cyan-400",
    desc: "Qualidade do ar satisfatória. Sem riscos perceptíveis à saúde geral.",
    alertClass: ""
  },
  {
    level: 2,
    name: "MODERADA",
    badgeClass: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    bgClass: "bg-amber-500",
    textClass: "text-amber-400",
    desc: "Atenção: leve aumento de poluentes voláteis ou CO2. Recomenda-se circulação de ar.",
    alertClass: "alert-glow-amber"
  },
  {
    level: 3,
    name: "RUIM",
    badgeClass: "bg-orange-500/20 text-orange-300 border-orange-500/40",
    bgClass: "bg-orange-500",
    textClass: "text-orange-400",
    desc: "Alerta: ar degradado. Pessoas com sensibilidade respiratória podem sentir irritações.",
    alertClass: "alert-glow-orange"
  },
  {
    level: 4,
    name: "MUITO RUIM",
    badgeClass: "bg-red-500/20 text-red-300 border-red-500/40",
    bgClass: "bg-red-500",
    textClass: "text-red-400",
    desc: "Perigo iminente: níveis críticos detectados. Abra janelas, ative exaustores e evacue o local se necessário.",
    alertClass: "alert-glow-red"
  }
];

// Application State
const state = {
  feeds: [],
  channelInfo: null,
  lastUpdated: null,
  countdown: CONFIG.POLL_INTERVAL_SEC,
  timerInterval: null,
  activeTab: 'dashboard',
  soundEnabled: true,
  isLoading: false,
  chartInstance: null,
  audioContext: null
};

// Thresholds calibrated with ESP32 Firmware
const THRESHOLDS = {
  MQ135: [0.05, 0.10, 0.20, 0.35],
  TVOC: [65, 220, 660, 2200],
  ECO2: [600, 1000, 1500, 2500],
  NAMES: ["EXCELENTE", "BOA", "MODERADA", "RUIM", "MUITO RUIM"]
};

// Sound Alert Synth using Web Audio API
function playAlertBeep() {
  if (!state.soundEnabled) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!state.audioContext) {
      state.audioContext = new AudioContext();
    }
    if (state.audioContext.state === 'suspended') {
      state.audioContext.resume();
    }

    const osc = state.audioContext.createOscillator();
    const gain = state.audioContext.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, state.audioContext.currentTime); // A5
    osc.frequency.exponentialRampToValueAtTime(440, state.audioContext.currentTime + 0.3); // Pitch bend down
    
    gain.gain.setValueAtTime(0.2, state.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, state.audioContext.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(state.audioContext.destination);

    osc.start();
    osc.stop(state.audioContext.currentTime + 0.3);
  } catch (e) {
    console.debug('AudioContext not allowed or not supported yet');
  }
}

// Navigation Tab Switcher
function switchTab(tabId) {
  state.activeTab = tabId;
  const tabs = ['dashboard', 'history', 'alerts'];
  
  tabs.forEach(tab => {
    const view = document.getElementById(`view-${tab}`);
    const btn = document.getElementById(`tab-${tab}`);
    
    if (tab === tabId) {
      view.classList.remove('hidden');
      btn.classList.add('active');
      btn.classList.remove('text-slate-400');
      btn.classList.add('text-white');
    } else {
      view.classList.add('hidden');
      btn.classList.remove('active');
      btn.classList.remove('text-white');
      btn.classList.add('text-slate-400');
    }
  });

  if (tabId === 'dashboard' && state.chartInstance) {
    state.chartInstance.resize();
  }
}

// Calculate level matching ESP32 firmware function
function calculateLevel(value, limits) {
  for (let i = 0; i < 4; i++) {
    if (value < limits[i]) return i;
  }
  return 4;
}

// Parse feed entry into typed numbers
function parseFeedEntry(feed) {
  const eco2 = feed.field1 !== null && feed.field1 !== undefined ? parseFloat(feed.field1) : 400;
  const tvoc = feed.field2 !== null && feed.field2 !== undefined ? parseFloat(feed.field2) : 0;
  const mq135 = feed.field3 !== null && feed.field3 !== undefined ? parseFloat(feed.field3) : 0.0;
  const alertFlag = feed.field4 !== null && feed.field4 !== undefined ? parseInt(feed.field4, 10) : 0;
  
  // Nível Geral: use field5 if present, or compute mathematically as per firmware
  let generalLevel = 0;
  if (feed.field5 !== null && feed.field5 !== undefined && feed.field5 !== "") {
    generalLevel = parseInt(feed.field5, 10);
  } else {
    const nT = calculateLevel(tvoc, THRESHOLDS.TVOC);
    const nC = calculateLevel(eco2, THRESHOLDS.ECO2);
    const nM = calculateLevel(mq135, THRESHOLDS.MQ135);
    generalLevel = Math.max(nT, Math.max(nC, nM));
  }

  return {
    entryId: feed.entry_id,
    createdAt: new Date(feed.created_at),
    eco2: isNaN(eco2) ? 400 : eco2,
    tvoc: isNaN(tvoc) ? 0 : tvoc,
    mq135: isNaN(mq135) ? 0 : mq135,
    alertFlag: alertFlag === 1 ? 1 : 0,
    generalLevel: isNaN(generalLevel) ? 0 : generalLevel
  };
}

// Format Date / Time (pt-BR)
function formatTime(date) {
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(date) {
  return date.toLocaleDateString('pt-BR');
}

// ============================================================================
// CHART.JS DYNAMIC VISUALIZATION ENGINE
// ============================================================================
function initChart() {
  const ctx = document.getElementById('airQualityChart');
  if (!ctx) return;

  const chartCtx = ctx.getContext('2d');

  // Gradient Fills
  const gradientEco2 = chartCtx.createLinearGradient(0, 0, 0, 300);
  gradientEco2.addColorStop(0, 'rgba(16, 185, 129, 0.28)');
  gradientEco2.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

  const gradientTvoc = chartCtx.createLinearGradient(0, 0, 0, 300);
  gradientTvoc.addColorStop(0, 'rgba(6, 182, 212, 0.25)');
  gradientTvoc.addColorStop(1, 'rgba(6, 182, 212, 0.0)');

  const gradientMq135 = chartCtx.createLinearGradient(0, 0, 0, 300);
  gradientMq135.addColorStop(0, 'rgba(245, 158, 11, 0.25)');
  gradientMq135.addColorStop(1, 'rgba(245, 158, 11, 0.0)');

  state.chartInstance = new Chart(chartCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'eCO2 (ppm)',
          data: [],
          borderColor: '#10b981',
          backgroundColor: gradientEco2,
          borderWidth: 2.2,
          pointBackgroundColor: '#10b981',
          pointBorderColor: '#0f172a',
          pointBorderWidth: 1.5,
          pointRadius: 3,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.35,
          yAxisID: 'y'
        },
        {
          label: 'TVOC (ppb)',
          data: [],
          borderColor: '#06b6d4',
          backgroundColor: gradientTvoc,
          borderWidth: 2,
          pointBackgroundColor: '#06b6d4',
          pointBorderColor: '#0f172a',
          pointBorderWidth: 1.5,
          pointRadius: 3,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.35,
          yAxisID: 'y1'
        },
        {
          label: 'MQ-135 (ΔV)',
          data: [],
          borderColor: '#f59e0b',
          backgroundColor: gradientMq135,
          borderWidth: 2,
          pointBackgroundColor: '#f59e0b',
          pointBorderColor: '#0f172a',
          pointBorderWidth: 1.5,
          pointRadius: 3,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.35,
          yAxisID: 'y2'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleColor: '#f8fafc',
          bodyColor: '#cbd5e1',
          borderColor: 'rgba(51, 65, 85, 0.8)',
          borderWidth: 1,
          padding: 12,
          boxPadding: 6,
          usePointStyle: true,
          callbacks: {
            title: function (items) {
              return `Horário: ${items[0].label}`;
            },
            label: function (context) {
              const datasetLabel = context.dataset.label || '';
              const value = context.parsed.y;
              if (datasetLabel.includes('eCO2')) {
                return ` ${datasetLabel}: ${value.toFixed(0)} ppm`;
              } else if (datasetLabel.includes('TVOC')) {
                return ` ${datasetLabel}: ${value.toFixed(0)} ppb`;
              } else if (datasetLabel.includes('MQ-135')) {
                return ` ${datasetLabel}: ${value.toFixed(3)} V`;
              }
              return ` ${datasetLabel}: ${value}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(51, 65, 85, 0.25)',
            borderColor: 'rgba(51, 65, 85, 0.6)'
          },
          ticks: {
            color: '#94a3b8',
            font: { family: 'Inter', size: 10 },
            maxRotation: 45,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: 10
          }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: {
            display: true,
            text: 'eCO2 (ppm)',
            color: '#10b981',
            font: { family: 'Inter', size: 10, weight: 'bold' }
          },
          grid: {
            color: 'rgba(51, 65, 85, 0.25)'
          },
          ticks: {
            color: '#10b981',
            font: { family: 'Inter', size: 10 },
            callback: value => `${value}`
          }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: {
            display: true,
            text: 'TVOC (ppb)',
            color: '#06b6d4',
            font: { family: 'Inter', size: 10, weight: 'bold' }
          },
          grid: {
            drawOnChartArea: false
          },
          ticks: {
            color: '#06b6d4',
            font: { family: 'Inter', size: 10 }
          }
        },
        y2: {
          type: 'linear',
          display: false,
          position: 'right',
          grid: {
            drawOnChartArea: false
          },
          ticks: {
            color: '#f59e0b',
            font: { family: 'Inter', size: 10 }
          }
        }
      }
    }
  });
}

// Toggle individual dataset on Chart
function toggleDataset(index) {
  if (!state.chartInstance) return;
  
  const isVisible = state.chartInstance.isDatasetVisible(index);
  state.chartInstance.setDatasetVisibility(index, !isVisible);
  
  if (index === 2) {
    state.chartInstance.options.scales.y2.display = !isVisible;
  }

  state.chartInstance.update();

  const btnIds = ['toggle-eco2', 'toggle-tvoc', 'toggle-mq135'];
  const btn = document.getElementById(btnIds[index]);
  if (btn) {
    if (!isVisible) {
      btn.classList.add('active');
      btn.classList.remove('inactive');
    } else {
      btn.classList.remove('active');
      btn.classList.add('inactive');
    }
  }
}

// Update Chart with new feeds
function updateChartData(feeds) {
  if (!state.chartInstance || !feeds || feeds.length === 0) return;

  const labels = feeds.map(f => formatTime(f.createdAt));
  const eco2Data = feeds.map(f => f.eco2);
  const tvocData = feeds.map(f => f.tvoc);
  const mq135Data = feeds.map(f => f.mq135);

  state.chartInstance.data.labels = labels;
  state.chartInstance.data.datasets[0].data = eco2Data;
  state.chartInstance.data.datasets[1].data = tvocData;
  state.chartInstance.data.datasets[2].data = mq135Data;

  state.chartInstance.update();

  const chartLoader = document.getElementById('chart-loader');
  if (chartLoader) {
    chartLoader.classList.add('opacity-0');
    setTimeout(() => {
      chartLoader.classList.add('hidden');
    }, 300);
  }
}

// ============================================================================
// REAL-TIME STATUS BADGES & ALERT TRIGGERS
// ============================================================================

// Update UI with latest feed
function updateDashboardUI(latest, allFeeds) {
  if (!latest) return;

  const meta = STATUS_LEVELS[latest.generalLevel] || STATUS_LEVELS[0];

  // 1. General Air Quality Badge & Description
  const genBadge = document.getElementById('general-status-badge');
  const genText = document.getElementById('general-status-text');
  const genDesc = document.getElementById('general-status-desc');

  if (genBadge && genText) {
    genBadge.className = `inline-flex items-center gap-2 px-4 py-2 rounded-xl text-base font-bold tracking-wide border shadow-sm ${meta.badgeClass} badge-pulse`;
    genText.textContent = meta.name;
  }
  if (genDesc) {
    genDesc.textContent = meta.desc;
  }

  // 2. Multi-tier step visual bar (0 to 4)
  for (let i = 0; i <= 4; i++) {
    const stepEl = document.getElementById(`bar-step-${i}`);
    if (stepEl) {
      if (i <= latest.generalLevel) {
        stepEl.className = `rounded-sm ${STATUS_LEVELS[i].bgClass} opacity-100 transition-all duration-300 shadow-sm`;
      } else {
        stepEl.className = `rounded-sm ${STATUS_LEVELS[i].bgClass} opacity-20 transition-all duration-300`;
      }
    }
  }

  // 3. Last Updated Timestamps
  const timeEl = document.getElementById('last-updated-time');
  const dateEl = document.getElementById('last-updated-date');
  if (timeEl) timeEl.textContent = formatTime(latest.createdAt);
  if (dateEl) dateEl.textContent = formatDate(latest.createdAt);

  // 4. Hardware LEDs Mirror (ESP32 GPIO 25, 27, 26)
  // Firmware rule:
  // LED_VERDE: geral < NIVEL_AMARELO (2)
  // LED_AMARELO: geral >= 2 && geral < NIVEL_VERMELHO (3)
  // LED_VERMELHO: geral >= 3
  const ledGreen = document.getElementById('hw-led-green');
  const ledYellow = document.getElementById('hw-led-yellow');
  const ledRed = document.getElementById('hw-led-red');

  if (ledGreen) {
    ledGreen.className = latest.generalLevel < 2 
      ? 'w-4 h-4 rounded-full led-active-green' 
      : 'w-4 h-4 rounded-full bg-slate-700';
  }
  if (ledYellow) {
    ledYellow.className = (latest.generalLevel >= 2 && latest.generalLevel < 3)
      ? 'w-4 h-4 rounded-full led-active-yellow' 
      : 'w-4 h-4 rounded-full bg-slate-700';
  }
  if (ledRed) {
    ledRed.className = latest.generalLevel >= 3 
      ? 'w-4 h-4 rounded-full led-active-red' 
      : 'w-4 h-4 rounded-full bg-slate-700';
  }

  // 5. Metric Cards
  // eCO2
  const valEco2 = document.getElementById('val-eco2');
  const progEco2 = document.getElementById('prog-eco2');
  const badgeEco2 = document.getElementById('status-eco2-badge');
  if (valEco2) valEco2.textContent = Math.round(latest.eco2);
  const eco2Percent = Math.min(100, Math.max(5, (latest.eco2 / 2500) * 100));
  if (progEco2) {
    progEco2.style.width = `${eco2Percent}%`;
    progEco2.className = latest.eco2 > 1000 ? (latest.eco2 > 1500 ? 'bg-red-500 h-full rounded-full transition-all' : 'bg-amber-500 h-full rounded-full transition-all') : 'bg-emerald-500 h-full rounded-full transition-all';
  }
  if (badgeEco2) {
    const lvlEco2 = calculateLevel(latest.eco2, THRESHOLDS.ECO2);
    badgeEco2.textContent = THRESHOLDS.NAMES[lvlEco2];
    badgeEco2.className = `px-2 py-0.5 rounded text-[10px] font-semibold ${STATUS_LEVELS[lvlEco2].badgeClass}`;
  }

  // TVOC
  const valTvoc = document.getElementById('val-tvoc');
  const progTvoc = document.getElementById('prog-tvoc');
  const badgeTvoc = document.getElementById('status-tvoc-badge');
  if (valTvoc) valTvoc.textContent = Math.round(latest.tvoc);
  const tvocPercent = Math.min(100, Math.max(5, (latest.tvoc / 2200) * 100));
  if (progTvoc) {
    progTvoc.style.width = `${tvocPercent}%`;
    progTvoc.className = latest.tvoc > 220 ? (latest.tvoc > 660 ? 'bg-red-500 h-full rounded-full transition-all' : 'bg-amber-500 h-full rounded-full transition-all') : 'bg-cyan-500 h-full rounded-full transition-all';
  }
  if (badgeTvoc) {
    const lvlTvoc = calculateLevel(latest.tvoc, THRESHOLDS.TVOC);
    badgeTvoc.textContent = THRESHOLDS.NAMES[lvlTvoc];
    badgeTvoc.className = `px-2 py-0.5 rounded text-[10px] font-semibold ${STATUS_LEVELS[lvlTvoc].badgeClass}`;
  }

  // MQ-135
  const valMq = document.getElementById('val-mq135');
  const progMq = document.getElementById('prog-mq135');
  const badgeMq = document.getElementById('status-mq135-badge');
  if (valMq) valMq.textContent = latest.mq135.toFixed(3);
  const mqPercent = Math.min(100, Math.max(5, (latest.mq135 / 0.35) * 100));
  if (progMq) {
    progMq.style.width = `${mqPercent}%`;
    progMq.className = latest.mq135 > 0.10 ? (latest.mq135 > 0.20 ? 'bg-red-500 h-full rounded-full transition-all' : 'bg-amber-500 h-full rounded-full transition-all') : 'bg-amber-500 h-full rounded-full transition-all';
  }
  if (badgeMq) {
    const lvlMq = calculateLevel(latest.mq135, THRESHOLDS.MQ135);
    badgeMq.textContent = THRESHOLDS.NAMES[lvlMq];
    badgeMq.className = `px-2 py-0.5 rounded text-[10px] font-semibold ${STATUS_LEVELS[lvlMq].badgeClass}`;
  }

  // Alert State Card & Global Emergency Alert Banner
  const isAlertActive = latest.alertFlag === 1 || latest.generalLevel >= 2;
  const valAlert = document.getElementById('val-alert');
  const badgeAlert = document.getElementById('status-alert-badge');
  const progAlert = document.getElementById('prog-alert');
  const alertIconBox = document.getElementById('alert-icon-box');

  const globalBanner = document.getElementById('global-alert-banner');
  const bannerBadge = document.getElementById('alert-banner-badge');
  const bannerTitle = document.getElementById('alert-banner-title');
  const bannerMsg = document.getElementById('alert-banner-message');
  const bannerIconBox = document.getElementById('alert-banner-icon-box');
  const bannerIcon = document.getElementById('alert-banner-icon');

  if (isAlertActive) {
    if (valAlert) {
      valAlert.textContent = "ALERTA ATIVO";
      valAlert.className = "text-3xl font-extrabold tracking-tight text-amber-400 animate-pulse";
    }
    if (badgeAlert) {
      badgeAlert.textContent = "Disparo Ativo";
      badgeAlert.className = "px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40";
    }
    if (progAlert) {
      progAlert.style.width = "100%";
      progAlert.className = "bg-amber-500 h-full rounded-full";
    }
    if (alertIconBox) {
      alertIconBox.className = "w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 animate-bounce";
    }

    // Trigger audible alarm if enabled
    playAlertBeep();

    // Show Global Alert Banner
    if (globalBanner) {
      globalBanner.classList.remove('hidden');
      globalBanner.className = `relative overflow-hidden rounded-2xl border p-5 shadow-2xl transition-all duration-300 ${meta.alertClass || 'alert-glow-amber'}`;
    }
    if (bannerBadge) {
      bannerBadge.textContent = meta.name;
      bannerBadge.className = `px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${meta.badgeClass}`;
    }
    if (bannerTitle) {
      bannerTitle.textContent = `ATENÇÃO: QUALIDADE DO AR ${meta.name}`;
      bannerTitle.className = `text-lg font-bold tracking-tight ${meta.textClass}`;
    }
    if (bannerMsg) {
      bannerMsg.textContent = `Foram detectados níveis anormais no ambiente (eCO2: ${Math.round(latest.eco2)} ppm | TVOC: ${Math.round(latest.tvoc)} ppb | MQ-135: ${latest.mq135.toFixed(3)} V). ${meta.desc}`;
    }
    if (bannerIconBox) {
      bannerIconBox.className = `w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${meta.bgClass}/20 ${meta.textClass}`;
    }
  } else {
    if (valAlert) {
      valAlert.textContent = "NORMAL";
      valAlert.className = "text-3xl font-extrabold tracking-tight text-white";
    }
    if (badgeAlert) {
      badgeAlert.textContent = "Sem Disparo";
      badgeAlert.className = "px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
    }
    if (progAlert) {
      progAlert.style.width = "0%";
      progAlert.className = "bg-emerald-500 h-full rounded-full";
    }
    if (alertIconBox) {
      alertIconBox.className = "w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400";
    }
    if (globalBanner) {
      globalBanner.classList.add('hidden');
    }
  }

  // 6. Update History Tab & Metrics
  updateHistoryTab(allFeeds);

  // 7. Update Alerts Tab
  updateAlertsTab(allFeeds);
}

// Update History View
function updateHistoryTab(feeds) {
  if (!feeds || feeds.length === 0) return;

  const total = feeds.length;
  const avgEco2 = Math.round(feeds.reduce((acc, f) => acc + f.eco2, 0) / total);
  const peakTvoc = Math.round(Math.max(...feeds.map(f => f.tvoc)));
  const alertCount = feeds.filter(f => f.alertFlag === 1 || f.generalLevel >= 2).length;

  document.getElementById('hist-total-samples').textContent = total;
  document.getElementById('hist-avg-eco2').textContent = avgEco2;
  document.getElementById('hist-peak-tvoc').textContent = peakTvoc;
  document.getElementById('hist-alert-count').textContent = alertCount;
  
  const alertBadgeCount = document.getElementById('alerts-count-badge');
  if (alertBadgeCount) {
    alertBadgeCount.textContent = alertCount;
    if (alertCount > 0) {
      alertBadgeCount.className = "ml-1.5 px-2 py-0.2 text-[10px] rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse";
    } else {
      alertBadgeCount.className = "ml-1.5 px-2 py-0.2 text-[10px] rounded-full bg-slate-800 text-slate-400";
    }
  }

  // Populate Table Body (Latest on top)
  const tbody = document.getElementById('history-table-body');
  if (!tbody) return;

  const reversedFeeds = [...feeds].reverse();
  tbody.innerHTML = reversedFeeds.map(feed => {
    const meta = STATUS_LEVELS[feed.generalLevel] || STATUS_LEVELS[0];
    const isAlert = feed.alertFlag === 1 || feed.generalLevel >= 2;

    return `
      <tr class="border-b border-slate-800/60 ${isAlert ? 'bg-amber-500/5' : ''}">
        <td class="py-3 px-4 font-mono text-slate-400">#${feed.entryId}</td>
        <td class="py-3 px-4 text-slate-300 font-sans whitespace-nowrap">
          ${formatDate(feed.createdAt)} <span class="text-slate-500">${formatTime(feed.createdAt)}</span>
        </td>
        <td class="py-3 px-4 text-emerald-400 font-semibold">${Math.round(feed.eco2)}</td>
        <td class="py-3 px-4 text-cyan-400 font-semibold">${Math.round(feed.tvoc)}</td>
        <td class="py-3 px-4 text-amber-400 font-semibold">${feed.mq135.toFixed(3)}</td>
        <td class="py-3 px-4">
          <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${isAlert ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-slate-800 text-slate-400'}">
            ${isAlert ? 'ALERTA (1)' : 'NORMAL (0)'}
          </span>
        </td>
        <td class="py-3 px-4">
          <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${meta.badgeClass}">
            ${meta.name}
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

// Update Alerts View
function updateAlertsTab(feeds) {
  if (!feeds) return;

  const alertFeeds = feeds.filter(f => f.alertFlag === 1 || f.generalLevel >= 2).reverse();
  const listEl = document.getElementById('alerts-log-list');
  const summaryTag = document.getElementById('alerts-summary-tag');

  if (summaryTag) {
    if (alertFeeds.length > 0) {
      summaryTag.textContent = `${alertFeeds.length} evento(s) registrado(s)`;
      summaryTag.className = "px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40";
    } else {
      summaryTag.textContent = "Nenhuma anomalia";
      summaryTag.className = "px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-300";
    }
  }

  if (!listEl) return;

  if (alertFeeds.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-12 text-slate-500 text-xs">
        <i class="fa-solid fa-circle-check text-emerald-400 text-3xl mb-2"></i>
        <p class="font-medium text-slate-300">Nenhum alerta crítico registrado nas últimas ${feeds.length} medições.</p>
        <p class="text-[11px] text-slate-500 mt-1">Ambiente mantido em níveis satisfatórios (Excelente / Boa).</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = alertFeeds.map(feed => {
    const meta = STATUS_LEVELS[feed.generalLevel] || STATUS_LEVELS[2];
    return `
      <div class="p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 flex items-start justify-between gap-3 transition hover:border-slate-700">
        <div class="flex items-start space-x-3">
          <div class="w-8 h-8 rounded-lg ${meta.bgClass}/20 ${meta.textClass} flex items-center justify-center shrink-0 mt-0.5">
            <i class="fa-solid fa-triangle-exclamation text-sm"></i>
          </div>
          <div>
            <div class="flex items-center space-x-2">
              <span class="text-xs font-bold text-slate-200">Qualidade ${meta.name}</span>
              <span class="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">Entry #${feed.entryId}</span>
            </div>
            <p class="text-[11px] text-slate-400 mt-0.5">
              Valores: eCO2 <strong class="text-emerald-400">${Math.round(feed.eco2)} ppm</strong>, 
              TVOC <strong class="text-cyan-400">${Math.round(feed.tvoc)} ppb</strong>, 
              MQ-135 <strong class="text-amber-400">${feed.mq135.toFixed(3)} V</strong>
            </p>
          </div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-[11px] font-mono text-slate-300">${formatTime(feed.createdAt)}</div>
          <div class="text-[10px] text-slate-500 font-mono">${formatDate(feed.createdAt)}</div>
        </div>
      </div>
    `;
  }).join('');
}

// Export CSV handler
function exportToCSV() {
  if (!state.feeds || state.feeds.length === 0) {
    alert('Nenhum dado disponível para exportação.');
    return;
  }

  const headers = ['ID', 'Data/Hora (ISO)', 'Data', 'Hora', 'eCO2 (ppm)', 'TVOC (ppb)', 'MQ-135 (Delta V)', 'Alerta (Field4)', 'Nivel Geral', 'Classificacao'];
  const rows = state.feeds.map(f => [
    f.entryId,
    f.createdAt.toISOString(),
    formatDate(f.createdAt),
    formatTime(f.createdAt),
    f.eco2,
    f.tvoc,
    f.mq135.toFixed(3),
    f.alertFlag,
    f.generalLevel,
    THRESHOLDS.NAMES[f.generalLevel] || ''
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `smart-air-telemetria-${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Fetch telemetry data from ThingSpeak REST API
async function fetchThingSpeakData() {
  if (state.isLoading) return;
  state.isLoading = true;

  const refreshIcon = document.getElementById('refresh-icon');
  const pingIndicator = document.getElementById('ping-indicator');
  const statusDot = document.getElementById('status-dot');
  
  if (refreshIcon) refreshIcon.classList.add('fa-spin');

  try {
    const response = await fetch(CONFIG.API_URL);
    if (!response.ok) {
      throw new Error(`Erro HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    state.channelInfo = data.channel;
    
    if (data.feeds && Array.isArray(data.feeds) && data.feeds.length > 0) {
      state.feeds = data.feeds.map(parseFeedEntry);
      state.lastUpdated = new Date();
      
      // Update connection indicator to connected
      if (statusDot) {
        statusDot.className = "relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500";
      }
      if (pingIndicator) {
        pingIndicator.className = "animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75";
      }

      // Update Chart visualization
      updateChartData(state.feeds);

      // Update Badges, Status and Alerts
      const latestFeed = state.feeds[state.feeds.length - 1];
      updateDashboardUI(latestFeed, state.feeds);

      console.log(`[Smart Air] ${state.feeds.length} feeds recebidos com sucesso.`);
    } else {
      console.warn('[Smart Air] Resposta da API não contém feeds válidos.');
    }
  } catch (err) {
    console.error('[Smart Air] Erro ao buscar telemetria do ThingSpeak:', err);
    
    if (statusDot) {
      statusDot.className = "relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500";
    }
    if (pingIndicator) {
      pingIndicator.className = "animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75";
    }
  } finally {
    state.isLoading = false;
    if (refreshIcon) refreshIcon.classList.remove('fa-spin');
    state.countdown = CONFIG.POLL_INTERVAL_SEC;
  }
}

// Polling interval timer countdown handler
function startPollingTimer() {
  if (state.timerInterval) clearInterval(state.timerInterval);

  state.countdown = CONFIG.POLL_INTERVAL_SEC;
  const timerEl = document.getElementById('countdown-timer');

  state.timerInterval = setInterval(() => {
    state.countdown--;
    if (timerEl) {
      timerEl.textContent = `${state.countdown}s`;
    }

    if (state.countdown <= 0) {
      fetchThingSpeakData();
    }
  }, 1000);
}

// Event Listeners Initialization
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Chart.js
  initChart();

  // Manual refresh button
  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      fetchThingSpeakData();
    });
  }

  // Sound toggle button
  const btnSound = document.getElementById('btn-sound-toggle');
  const soundIcon = document.getElementById('sound-icon');
  if (btnSound && soundIcon) {
    btnSound.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      if (state.soundEnabled) {
        soundIcon.className = "fa-solid fa-volume-high text-xs";
        btnSound.title = "Alarme sonoro ativado";
        playAlertBeep();
      } else {
        soundIcon.className = "fa-solid fa-volume-xmark text-xs text-slate-500";
        btnSound.title = "Alarme sonoro desativado";
      }
    });
  }

  // Export CSV button
  const btnExport = document.getElementById('btn-export-csv');
  if (btnExport) {
    btnExport.addEventListener('click', exportToCSV);
  }

  // Initial fetch and start polling
  fetchThingSpeakData();
  startPollingTimer();
});
