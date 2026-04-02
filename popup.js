// DNS over HTTPS providers (Chinese providers first for reliability and CDN-optimized IPs)
const DNS_PROVIDERS = [
  {
    name: 'AliDNS',
    url: (domain) => `https://dns.alidns.com/resolve?name=${domain}&type=A`,
    parse: (data) => (data.Answer || []).filter(r => r.RR_TYPE === 1 || r.type === 1).map(r => r.data || r.RDATA)
  },
  {
    name: 'DNSPod',
    url: (domain) => `https://doh.pub/dns-query?name=${domain}&type=A`,
    headers: { 'Accept': 'application/dns-json' },
    parse: (data) => (data.Answer || []).filter(r => r.type === 1).map(r => r.data)
  },
  {
    name: 'Cloudflare',
    url: (domain) => `https://cloudflare-dns.com/dns-query?name=${domain}&type=A`,
    headers: { 'Accept': 'application/dns-json' },
    parse: (data) => (data.Answer || []).filter(r => r.type === 1).map(r => r.data)
  },
  {
    name: 'Google',
    url: (domain) => `https://dns.google/resolve?name=${domain}&type=A`,
    parse: (data) => (data.Answer || []).filter(r => r.type === 1).map(r => r.data)
  }
];

// State
let currentDomain = '';
let ipResults = {};
let sortMode = 'latency';
let queryAbortController = null;

// DOM refs
const domainInput = document.getElementById('domainInput');
const queryBtn = document.getElementById('queryBtn');
const spinner = document.getElementById('spinner');
const statusText = document.getElementById('statusText');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const errorMsg = document.getElementById('errorMsg');
const resultsArea = document.getElementById('resultsArea');
const resultsList = document.getElementById('resultsList');
const resultsCount = document.getElementById('resultsCount');
const hostsSection = document.getElementById('hostsSection');
const hostsBox = document.getElementById('hostsBox');
const copyHostsBtn = document.getElementById('copyHostsBtn');
const emptyState = document.getElementById('emptyState');
const dnsSources = document.getElementById('dnsSources');
const sortLatencyBtn = document.getElementById('sortLatency');
const sortIPBtn = document.getElementById('sortIP');

// Init
document.addEventListener('DOMContentLoaded', () => {
  // Load current tab's domain
  if (chrome.tabs) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) {
        try {
          const url = new URL(tabs[0].url);
          if (url.hostname && !url.hostname.startsWith('chrome')) {
            domainInput.value = url.hostname;
          }
        } catch {}
      }
    });
  }

  domainInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startQuery();
  });

  queryBtn.addEventListener('click', startQuery);
  copyHostsBtn.addEventListener('click', copyHostsEntry);
  sortLatencyBtn.addEventListener('click', () => setSort('latency'));
  sortIPBtn.addEventListener('click', () => setSort('ip'));
});

function setSort(mode) {
  sortMode = mode;
  sortLatencyBtn.classList.toggle('active', mode === 'latency');
  sortIPBtn.classList.toggle('active', mode === 'ip');
  renderResults();
}

function setStatus(msg, loading = false) {
  statusText.textContent = msg;
  spinner.classList.toggle('show', loading);
}

function setProgress(pct) {
  progressBar.classList.add('show');
  progressFill.style.width = `${pct}%`;
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.add('show');
}

function clearError() {
  errorMsg.classList.remove('show');
}

function cleanDomain(input) {
  let d = input.trim().toLowerCase();
  // Remove protocol
  d = d.replace(/^https?:\/\//, '');
  // Remove path
  d = d.split('/')[0];
  // Remove port
  d = d.split(':')[0];
  return d;
}

async function startQuery() {
  const raw = domainInput.value;
  if (!raw.trim()) return;

  const domain = cleanDomain(raw);
  if (!domain) {
    showError('请输入有效的域名');
    return;
  }

  // Abort previous if any
  if (queryAbortController) {
    queryAbortController.abort();
  }
  queryAbortController = new AbortController();

  currentDomain = domain;
  ipResults = {};

  clearError();
  emptyState.style.display = 'none';
  resultsArea.style.display = 'none';
  hostsSection.style.display = 'none';
  queryBtn.disabled = true;
  setProgress(5);
  setStatus(`正在查询 ${domain}...`, true);

  // Update DNS source tags
  const tags = dnsSources.querySelectorAll('.dns-tag');
  tags.forEach(t => t.classList.remove('active'));

  try {
    // Step 1: Collect IPs from all providers
    const allIPs = new Set();
    let resolvedCount = 0;

    const dnsPromises = DNS_PROVIDERS.map(async (provider, i) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      queryAbortController.signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        controller.abort();
      });
      try {
        const res = await fetch(provider.url(domain), {
          signal: controller.signal,
          headers: provider.headers || {}
        });
        const data = await res.json();
        const ips = provider.parse(data);
        ips.forEach(ip => {
          if (isValidIPv4(ip)) allIPs.add(ip);
        });
        tags[i]?.classList.add('active');
      } catch (e) {
        if (e.name === 'AbortError' && queryAbortController.signal.aborted) throw e;
      } finally {
        clearTimeout(timeoutId);
        resolvedCount++;
        setProgress(5 + (resolvedCount / DNS_PROVIDERS.length) * 35);
      }
    });

    await Promise.allSettled(dnsPromises);

    if (queryAbortController.signal.aborted) return;

    const ipList = [...allIPs];

    if (ipList.length === 0) {
      setStatus('未找到任何IP地址', false);
      spinner.classList.remove('show');
      progressBar.classList.remove('show');
      showError(`无法解析域名 "${domain}"，请检查域名是否正确`);
      queryBtn.disabled = false;
      return;
    }

    setStatus(`找到 ${ipList.length} 个IP，正在测速...`, true);
    setProgress(40);

    // Step 2: Show IP rows immediately, start speed tests
    resultsArea.style.display = 'block';
    resultsList.innerHTML = '';

    // Initialize all IPs as testing
    ipList.forEach(ip => {
      ipResults[ip] = { ip, latency: null, status: 'testing' };
    });
    renderResults();

    // Step 3: Speed test each IP
    let testedCount = 0;
    const testPromises = ipList.map(async (ip) => {
      const latency = await measureLatency(ip, domain, queryAbortController.signal);
      if (queryAbortController.signal.aborted) return;
      ipResults[ip] = { ip, latency, status: latency === null ? 'timeout' : 'done' };
      testedCount++;
      setProgress(40 + (testedCount / ipList.length) * 58);
      setStatus(`测速中... ${testedCount}/${ipList.length}`, true);
      renderResults();
    });

    await Promise.allSettled(testPromises);

    if (queryAbortController.signal.aborted) return;

    setProgress(100);
    const validCount = Object.values(ipResults).filter(r => r.latency !== null).length;
    setStatus(`完成！${validCount}/${ipList.length} 个IP可达`, false);
    spinner.classList.remove('show');
    setTimeout(() => { progressBar.classList.remove('show'); }, 600);

    renderResults();
    updateHostsSection();

  } catch (e) {
    if (e.name === 'AbortError') return;
    setStatus('查询失败', false);
    showError('查询出错: ' + e.message);
  } finally {
    queryBtn.disabled = false;
  }
}

async function measureLatency(ip, domain, signal) {
  // Strategy: use fetch with the IP directly, measure time
  // We try HTTPS first, then HTTP
  const methods = [
    () => fetchWithTimeout(`https://${ip}`, { signal, headers: { Host: domain }, mode: 'no-cors' }, 4000),
    () => fetchWithTimeout(`http://${ip}`, { signal, headers: { Host: domain }, mode: 'no-cors' }, 4000),
  ];

  for (const method of methods) {
    const latency = await method();
    if (latency !== null) return latency;
    if (signal?.aborted) return null;
  }
  return null;
}

async function fetchWithTimeout(url, options, timeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Merge abort signals
  const parentSignal = options.signal;
  if (parentSignal) {
    parentSignal.addEventListener('abort', () => controller.abort());
  }

  const start = performance.now();
  try {
    await fetch(url, { ...options, signal: controller.signal });
    const elapsed = Math.round(performance.now() - start);
    clearTimeout(timeoutId);
    return elapsed;
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError' && parentSignal?.aborted) return null;
    // For no-cors, an opaque response still registers as "reachable" 
    // Check if it's a network error vs abort
    const elapsed = Math.round(performance.now() - start);
    // If we got a quick non-timeout error, it might still mean the server responded
    if (elapsed < timeout - 100 && e.message && !e.message.includes('abort')) {
      return elapsed; // Server responded (even with error = reachable)
    }
    return null;
  }
}

function renderResults() {
  const items = Object.values(ipResults);

  // Sort
  const sorted = [...items].sort((a, b) => {
    if (sortMode === 'latency') {
      if (a.latency === null && b.latency === null) return 0;
      if (a.latency === null) return 1;
      if (b.latency === null) return -1;
      if (a.status === 'testing' && b.status !== 'testing') return 1;
      if (b.status === 'testing' && a.status !== 'testing') return -1;
      return a.latency - b.latency;
    } else {
      return ipToNum(a.ip) - ipToNum(b.ip);
    }
  });

  resultsCount.textContent = `${items.length} 个IP`;

  // Find fastest
  const fastestIP = sorted.find(r => r.latency !== null && r.status === 'done')?.ip;

  // Rebuild list
  resultsList.innerHTML = '';
  sorted.forEach((item, idx) => {
    const row = createIPRow(item, item.ip === fastestIP);
    row.style.animationDelay = `${idx * 30}ms`;
    resultsList.appendChild(row);
  });
}

function createIPRow(item, isFastest) {
  const { ip, latency, status } = item;
  const row = document.createElement('div');
  row.className = 'ip-row' + (isFastest ? ' fastest' : '');
  row.dataset.ip = ip;

  // Latency display
  let latencyClass = 'testing';
  let latencyText = '测速中...';
  let barWidth = 0;
  let barColor = '#374151';

  if (status === 'timeout') {
    latencyClass = 'timeout';
    latencyText = '超时';
    barColor = '#374151';
    barWidth = 0;
  } else if (status === 'done' && latency !== null) {
    if (latency < 100) {
      latencyClass = 'fast';
      barColor = '#10b981';
      barWidth = Math.max(10, 100 - latency);
    } else if (latency < 300) {
      latencyClass = 'medium';
      barColor = '#f59e0b';
      barWidth = Math.max(10, 100 - (latency - 100) / 2);
    } else {
      latencyClass = 'slow';
      barColor = '#ef4444';
      barWidth = Math.max(5, 30 - latency / 20);
    }
    latencyText = `${latency}ms`;
    barWidth = Math.min(100, barWidth);
  }

  row.innerHTML = `<div class="ip-address"><span>${ip}</span><span class="fastest-badge">BEST</span></div><div class="latency-bar-wrap"><div class="latency-bar" style="width:${barWidth}%;background:${barColor}"></div></div><div class="latency-val ${latencyClass}">${latencyText}</div><button class="copy-btn" data-ip="${ip}">复制</button>`;

  row.querySelector('.copy-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    copyToClipboard(ip, e.target);
  });

  return row;
}

function updateHostsSection() {
  const items = Object.values(ipResults);
  const valid = items.filter(r => r.latency !== null && r.status === 'done');

  if (valid.length === 0) {
    hostsSection.style.display = 'none';
    return;
  }

  valid.sort((a, b) => a.latency - b.latency);
  const fastest = valid[0];

  hostsSection.style.display = 'block';
  hostsBox.innerHTML = `<div class="entry">
    <span class="ip">${fastest.ip}</span>
    <span class="domain">${currentDomain}</span>
  </div>`;
}

async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = orig;
        btn.classList.remove('copied');
      }, 1500);
    }
  } catch {}
}

async function copyHostsEntry() {
  const items = Object.values(ipResults);
  const valid = items.filter(r => r.latency !== null && r.status === 'done');
  if (valid.length === 0) return;

  valid.sort((a, b) => a.latency - b.latency);
  const entry = `${valid[0].ip}  ${currentDomain}`;
  await copyToClipboard(entry, copyHostsBtn);

  const orig = copyHostsBtn.textContent;
  copyHostsBtn.textContent = '✓ 已复制';
  setTimeout(() => { copyHostsBtn.textContent = orig; }, 1500);
}

function isValidIPv4(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => {
    const n = parseInt(p, 10);
    return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p;
  });
}

function ipToNum(ip) {
  return ip.split('.').reduce((acc, part) => acc * 256 + parseInt(part, 10), 0);
}
