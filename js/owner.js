'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const content = $('#content');
  const app = $('#app-view');
  const login = $('#login-view');
  const notice = $('#notice');
  const state = { view: 'overview', data: null, selectedTask: null, filter: '', clarification: null, refreshTimer: null, eventSource: null };
  const titles = {
    overview: ['Overview', 'A real-time view of your travel search operations.'],
    agents: ['Agent monitor', 'Orchestration readiness, worker state, and execution visibility.'],
    operators: ['Website operators', 'Manage source configurations and integration verification.'],
    search: ['Search console', 'Create structured or natural-language tasks for registered verified adapters.'],
    history: ['Search history', 'Review persisted tasks and compare verified offers when available.'],
    activity: ['Activity timeline', 'Auditable Owner Console events from this installation.'],
    alerts: ['Alerts & logs', 'Operational warnings and worker execution records.'],
    settings: ['System settings', 'Persistent scheduler limits and retry policy.']
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }
  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(Number(value));
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
  function formatBytes(value) {
    if (!Number.isFinite(value)) return 'Unavailable';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let amount = value, index = 0;
    while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
    return `${amount.toFixed(index ? 1 : 0)} ${units[index]}`;
  }
  function showNotice(message, error = false) {
    notice.textContent = message;
    notice.classList.toggle('error', error);
    notice.hidden = false;
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => { notice.hidden = true; }, 4200);
  }
  async function request(route, options = {}) {
    const response = await fetch('/api/owner' + route, {
      credentials: 'same-origin',
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
      ...options
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401 && route !== '/login' && route !== '/me') {
      showLogin();
      throw new Error('Your Owner session expired. Please sign in again.');
    }
    if (!response.ok) {
      const messages = {
        owner_auth_not_configured: 'Owner sign-in is not configured on the server.',
        bad_credentials: 'Email or password is incorrect.',
        origin_rejected: 'This request origin was rejected.',
        bad_search_parameters: 'Check the destination, country, dates, and traveler details.',
        no_verified_adapters: 'Search saved, but dispatch is blocked: no operator integrations are verified.',
        no_enabled_sources: 'Search saved, but no operator sources are enabled.',
        invalid_task_transition: 'This task can no longer be cancelled.',
        llm_key_missing: 'The configured Main Agent provider needs an API key in server environment settings.',
        llm_provider_invalid: 'The configured Main Agent provider is not supported.',
        llm_provider_error: 'The configured language provider could not complete the request.',
        llm_timeout: 'The configured language provider timed out.'
      };
      throw new Error(messages[result.error] || 'The request could not be completed.');
    }
    return result;
  }
  function showLogin() {
    if (state.eventSource) { state.eventSource.close(); state.eventSource = null; }
    app.hidden = true;
    login.hidden = false;
  }
  function showApp(owner) {
    login.hidden = true;
    app.hidden = false;
    $('#owner-email').textContent = owner && owner.email || 'Authenticated';
    startEvents();
  }
  function setView(view) {
    if (!titles[view]) return;
    state.view = view;
    document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    $('#page-title').textContent = titles[view][0];
    $('#page-subtitle').textContent = titles[view][1];
    $('#sidebar').classList.remove('open');
    $('#sidebar-scrim').classList.remove('show');
    render();
  }
  function sectionHeading(title, description, action = '') {
    return `<div class="section-heading"><div><p class="eyebrow">OWNER WORKSPACE</p><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
  }
  function stat(label, value, note, icon) {
    return `<article class="card stat-card"><div class="card-label">${label}<span class="card-icon">${icon}</span></div><strong class="stat-value">${value}</strong><small class="stat-note">${note}</small></article>`;
  }
  function tag(label, type = 'pending') {
    const kind = /verified|complete|online|resolved/i.test(label) ? 'ready'
      : /failed|error|critical/i.test(label) ? 'error'
        : /running|queued/i.test(label) ? 'blue' : type;
    return `<span class="tag tag-${kind}">${escapeHtml(label.replace(/_/g, ' '))}</span>`;
  }
  function empty(title, detail) {
    return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(detail)}</div>`;
  }
  function renderOverview(data) {
    const overview = data.overview;
    const sites = overview.websites || {};
    const tasks = overview.tasks || {};
    const activityItems = (data.activities.activities || []).slice(0, 5);
    const runtime = overview.runtime || {};
    const progress = sites.configured ? Math.round((sites.verified / sites.configured) * 100) : 0;
    return sectionHeading('Good to see you, Owner', 'Here is the current operating picture for your travel search platform.',
      '<button class="button button-primary" data-nav="search">＋ New search</button>') +
      `<div class="grid stats-grid">
        ${stat('Configured operators', sites.configured || 0, `${sites.enabled || 0} enabled · all integrations are gated`, '◎')}
        ${stat('Verified integrations', `${sites.verified || 0}<small> / ${sites.configured || 0}</small>`, 'Only verified adapters may execute', '↗')}
        ${stat('Active search tasks', tasks.active || 0, `${tasks.completed || 0} completed · ${tasks.failed || 0} failed`, '⌕')}
        ${stat('Open alerts', overview.openAlerts || 0, overview.openAlerts ? 'Review operational warnings' : 'No unresolved alerts', '◇')}
      </div>
      <div class="grid two-column">
        <article class="card">
          <div class="card-head"><div><h2>Main Agent orchestration</h2><p>Structured dispatch foundation · no active browser workers</p></div>${tag(data.mainAgent.browserWorkers || 'pending_integration')}</div>
          <div class="progress-track"><i style="width:${progress}%"></i></div>
          <div class="progress-meta"><span>${sites.verified || 0} verified integrations</span><b>${progress}%</b></div>
          <div class="system-line"><span>Natural-language parser</span><b>${escapeHtml((data.mainAgent.agentStatus && data.mainAgent.agentStatus.parser) || 'deterministic')}</b></div>
          <div class="system-line"><span>Last search task</span><b>${data.mainAgent.latestTask ? escapeHtml(data.mainAgent.latestTask.status) : 'No tasks yet'}</b></div>
          <div class="system-line"><span>Workers currently running</span><b>${data.mainAgent.workerCounts.running || 0}</b></div>
        </article>
        <article class="card">
          <div class="card-head"><div><h2>System health</h2><p>Live process and host measurements</p></div>${tag('online')}</div>
          <div class="system-line"><span>Process uptime</span><b>${Math.floor((runtime.processUptimeSeconds || 0) / 3600)}h ${Math.floor(((runtime.processUptimeSeconds || 0) % 3600) / 60)}m</b></div>
          <div class="system-line"><span>Process memory</span><b>${formatBytes(runtime.processMemoryBytes)}</b></div>
          <div class="system-line"><span>System memory used</span><b>${formatBytes(runtime.systemMemoryUsedBytes)} / ${formatBytes(runtime.systemMemoryBytes)}</b></div>
          <div class="system-line"><span>Owner database</span><b>${formatBytes(runtime.databaseBytes)}</b></div>
          <div class="system-line"><span>Avg. task runtime</span><b>${tasks.averageCompletionMs == null ? 'No completed data' : `${tasks.averageCompletionMs} ms`}</b></div>
        </article>
      </div>
      <div class="grid two-column">
        <article class="card">
          <div class="card-head"><div><h2>Agent workflow</h2><p>Persistent scheduler active · supplier adapters gated</p></div><button class="button button-small button-quiet" data-nav="agents">View monitor →</button></div>
          <div class="agent-flow"><div class="agent-node"><b>Main Agent</b><small>Structured task intake</small></div><span class="arrow">→</span><div class="agent-node"><b>Worker registry</b><small>${sites.configured || 0} pending sources</small></div><span class="arrow">→</span><div class="agent-node"><b>Result compare</b><small>Verified offers only</small></div></div>
          <p class="form-hint">Search requests are persisted; dispatch requires an enabled, compatible, verified adapter.</p>
        </article>
        <article class="card">
          <div class="card-head"><div><h2>Recent activity</h2><p>Latest persisted system events</p></div><button class="button button-small button-quiet" data-nav="activity">View all →</button></div>
          ${activityItems.length ? `<div class="timeline">${activityItems.map(item => `<div class="timeline-item ${escapeHtml(item.severity)}"><span class="timeline-dot"></span><div><p>${escapeHtml(item.message)}</p><small>${escapeHtml(item.type.replace(/_/g, ' '))}</small></div><time>${escapeHtml(formatDate(item.at))}</time></div>`).join('')}</div>` : empty('No activity yet', 'Events appear here when the system is used.') }
        </article>
      </div>`;
  }
  function renderAgents(data) {
    const agent = data.mainAgent, counts = agent.workerCounts || {};
    return sectionHeading('Agent monitoring', 'Observe orchestration readiness without implying unverified automation.') +
      `<div class="grid stats-grid">${stat('Main Agent', '1', 'Deterministic validation and task orchestration', '✳')}${stat('Running workers', counts.running || 0, 'Bounded by global and per-operator settings', '◈')}${stat('Blocked executions', counts.blocked || 0, 'Awaiting verified adapters', 'Ⅱ')}${stat('Completed worker jobs', counts.completed || 0, 'Recorded from registered adapters', '✓')}</div>
      <article class="card">
        <div class="card-head"><div><h2>Orchestration pipeline</h2><p>Operational queue with no supplier adapters registered</p></div>${tag(agent.agentStatus && agent.agentStatus.parser || 'deterministic')}</div>
        <div class="agent-flow"><div class="agent-node"><b>Main Agent</b><small>Validation · active</small></div><span class="arrow">→</span><div class="agent-node"><b>Persistent queue</b><small>Concurrency capped</small></div><span class="arrow">→</span><div class="agent-node"><b>Worker registry</b><small>${agent.agentStatus ? agent.agentStatus.adaptersRegistered : 0} adapters</small></div><span class="arrow">→</span><div class="agent-node"><b>Normalizer</b><small>Validated results</small></div></div>
        <div class="system-line"><span>Natural-language parser</span>${tag(agent.agentStatus && agent.agentStatus.parser || 'deterministic')}</div>
        <div class="system-line"><span>LLM provider</span>${tag(agent.agentStatus && agent.agentStatus.llmEnabled ? agent.agentStatus.llmProvider : 'disabled')}</div>
        ${agent.agentStatus && agent.agentStatus.llmConfigurationError ? `<div class="system-line"><span>LLM configuration</span><b>${escapeHtml(agent.agentStatus.llmConfigurationError)}</b></div>` : ''}
        <div class="system-line"><span>Browser workers</span>${tag(agent.browserWorkers || 'pending_integration')}</div>
        <div class="system-line"><span>Latest task</span><b>${agent.latestTask ? escapeHtml(agent.latestTask.command) : 'No search tasks recorded'}</b></div>
      </article>
      <article class="card" style="margin-top:14px"><div class="card-head"><div><h2>Worker execution ledger</h2><p>Attempts, retries, timeouts, and errors appear in structured logs.</p></div><button class="button button-small" data-nav="alerts">Open execution logs</button></div><p class="form-hint">The scheduler only dispatches registered verified adapters. No real supplier adapter or browser session is currently installed.</p></article>`;
  }
  function renderOperators(data) {
    const rows = (data.websites.websites || []).filter(site => !state.filter || (site.name + ' ' + site.url).toLowerCase().includes(state.filter.toLowerCase()));
    return sectionHeading('Website operators', 'The initial registry contains 19 source configurations. Integrations remain pending until verified.',
      '<button class="button button-primary" data-action="add-website">＋ Add source</button>') +
      `<article class="card">
        <div class="card-head"><div><h2>Source registry</h2><p>Configuration is not an operational integration.</p></div><div class="toolbar"><input class="search-input" id="operator-filter" placeholder="Filter operators…" value="${escapeHtml(state.filter)}" aria-label="Filter operators"></div></div>
        ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Operator</th><th>Integration</th><th>Worker</th><th>Enabled</th><th>Last verified search</th></tr></thead><tbody>${rows.map(site => `<tr><td><strong>${escapeHtml(site.name)}</strong><small>${escapeHtml(site.url)}</small></td><td>${tag(site.integrationStatus)}</td><td>${tag(site.workerStatus)}</td><td><label class="switch" aria-label="Enable ${escapeHtml(site.name)}"><input type="checkbox" data-site-toggle="${escapeHtml(site.id)}" ${site.enabled ? 'checked' : ''}><span></span></label></td><td>${escapeHtml(formatDate(site.lastSuccessfulSearch))}</td></tr>`).join('')}</tbody></table></div>` : empty('No matching operators', 'Try another name or URL.') }
      </article>
      <p class="form-hint" style="margin:12px 2px">Unsafe or HTTP-only endpoints are not accepted for new configurations. No credentials are stored in the registry.</p>`;
  }
  function renderSearch(data) {
    const p = data.settings.settings || {};
    return sectionHeading('Search task console', 'Create a persisted travel-search request and inspect its execution records.') +
      `<div class="grid two-column">
        <article class="card"><div class="card-head"><div><h2>New structured search</h2><p>Task creation does not contact suppliers.</p></div>${tag('dispatch gated')}</div>
          <form id="search-form"><div class="form-grid">
            <label class="form-wide">Destination<input name="destination" maxlength="120" placeholder="Antalya" required></label>
            <label>Country<select name="country" required><option value="">Select country</option><option value="tr">Turkey</option><option value="ae">United Arab Emirates</option><option value="eg">Egypt</option><option value="th">Thailand</option><option value="vn">Vietnam</option><option value="ge">Georgia</option><option value="mv">Maldives</option><option value="az">Azerbaijan</option><option value="my">Malaysia</option><option value="lk">Sri Lanka</option><option value="id">Indonesia</option></select></label>
            <label>Departure date<input type="date" name="date" required></label>
            <label>Nights<input type="number" name="nights" min="1" max="30" value="7" required></label>
            <label>Adults<input type="number" name="adults" min="1" max="8" value="2" required></label>
            <label>Children ages (comma separated)<input name="childrenAges" placeholder="e.g. 5, 9"></label>
            <label>Budget (optional)<input type="number" name="budget" min="1" max="100000000" placeholder="Maximum total"></label>
            <label>Currency<select name="currency"><option>USD</option><option>EUR</option><option>UZS</option></select></label>
            <label>Departure airport<select name="departureAirport"><option value="">Not specified</option><option value="tas">Tashkent</option><option value="skd">Samarkand</option><option value="dyu">Dushanbe</option></select></label>
          </div><div class="form-actions"><button class="button button-primary" type="submit">Save search task <span>→</span></button><span class="form-hint">Timeout: ${escapeHtml(p.search_timeout_seconds || '—')}s · Concurrency: ${escapeHtml(p.worker_concurrency || '—')}</span></div></form>
        </article>
        <article class="card"><div class="card-head"><div><h2>Execution policy</h2><p>Safety gate status for this environment</p></div>${tag(data.mainAgent.agentStatus && data.mainAgent.agentStatus.adaptersRegistered ? 'adapter registered' : 'pending')}</div>
          <div class="system-line"><span>Enabled sources</span><b>${data.overview.websites.enabled || 0}</b></div>
          <div class="system-line"><span>Verified adapters</span><b>${data.overview.websites.verified || 0}</b></div>
          <div class="system-line"><span>Registered adapters</span><b>${data.mainAgent.agentStatus ? data.mainAgent.agentStatus.adaptersRegistered : 0}</b></div>
          <div class="system-line"><span>Worker dispatch</span>${tag(data.mainAgent.agentStatus && data.mainAgent.agentStatus.adaptersRegistered ? 'adapter gated' : 'no adapters')}</div>
          <p class="form-hint">Search records are stored in the separate Owner database. No supplier requests are made unless an adapter is registered and its operator configuration is explicitly verified.</p>
        </article>
      </div>
      <article class="card" style="margin-top:14px"><div class="card-head"><div><h2>Search in natural language</h2><p>The parser asks for missing required details rather than guessing.</p></div>${tag(data.mainAgent.agentStatus && data.mainAgent.agentStatus.llmEnabled ? 'llm enabled' : 'deterministic fallback')}</div>
        <form id="natural-search-form"><label class="form-label">Travel request<textarea name="command" rows="3" maxlength="4000" placeholder="Find 2 adults, 7 nights in Antalya, Turkey from 2030-06-10, all inclusive" required></textarea></label>
          <div class="form-actions"><button class="button button-primary" type="submit">Interpret and save task <span>→</span></button><span class="form-hint">No supplier search is started when integrations are pending.</span></div></form>
        ${state.clarification ? `<div class="clarification"><strong>More information needed</strong><ul>${state.clarification.questions.map(question => `<li>${escapeHtml(question)}</li>`).join('')}</ul><small>Parser: ${escapeHtml(state.clarification.parserMode)}</small></div>` : ''}
      </article>`;
  }
  function renderHistory(data) {
    const tasks = data.searches.tasks || [];
    return sectionHeading('Search history', 'Persisted requests and recorded outcomes; no placeholder offers are generated.') +
      `<div class="grid two-column">
        <article class="card"><div class="card-head"><div><h2>Recent search tasks</h2><p>${tasks.length} record${tasks.length === 1 ? '' : 's'} loaded</p></div><button class="button button-small" data-nav="search">＋ New search</button></div>
        ${tasks.length ? `<div class="task-list">${tasks.map(task => `<div class="task-row ${state.selectedTask === task.id ? 'selected' : ''}"><button type="button" class="task-select" data-task="${escapeHtml(task.id)}"><span class="task-main"><strong>${escapeHtml(task.command)}</strong><small>Created ${escapeHtml(formatDate(task.createdAt))} · ${task.totalWorkers} selected worker${task.totalWorkers === 1 ? '' : 's'} · ${task.offersFound || 0} offers</small><span class="progress-track"><i style="width:${Math.max(0, Math.min(100, task.progressPercent || 0))}%"></i></span><small>${task.completedWorkers || 0} completed · ${task.failedWorkers || 0} failed · ${task.progressPercent || 0}%</small>${task.errorCode ? `<small class="error-code">${escapeHtml(task.errorCode)}</small>` : ''}</span><span class="task-right">${tag(task.status)}</span></button>${['queued', 'running', 'blocked'].includes(task.status) ? `<button type="button" class="button button-small" data-cancel-task="${escapeHtml(task.id)}">Cancel</button>` : ''}</div>`).join('')}</div>` : empty('No searches saved', 'Create a structured search task to start a history.')}</article>
        <article class="card"><div class="card-head"><div><h2>Results comparison</h2><p>${state.selectedTask ? 'Recorded offers for the selected task' : 'Select a task to inspect its results'}</p></div></div>
          ${renderComparison(data.comparison)}
        </article>
      </div>`;
  }
  function renderComparison(comparison) {
    if (!state.selectedTask) return empty('Select a search task', 'Verified offer groups will appear here when available.');
    const groups = comparison && comparison.comparison || [];
    if (!groups.length) return empty('No offers recorded', 'This task has no supplier results. Pending integrations are never represented as offers.');
    return `<div class="table-wrap"><table><thead><tr><th>Hotel</th><th>Operator</th><th>Price</th><th>Availability</th><th>Verification</th></tr></thead><tbody>${groups.flatMap(group => group.offers.map(offer => `<tr><td><strong>${escapeHtml(offer.hotelName)}</strong><small>${group.identityVerified ? 'Verified identity match' : 'Identity not matched'}</small></td><td>${escapeHtml(offer.operatorName)}</td><td>${escapeHtml(offer.totalPrice)} ${escapeHtml(offer.currency)}</td><td>${escapeHtml(offer.availability)}</td><td>${tag(offer.verificationStatus)}</td></tr>`)).join('')}</tbody></table></div>`;
  }
  function renderActivity(data) {
    const items = data.activities.activities || [];
    return sectionHeading('Activity timeline', 'Recorded administrative and orchestration events.') +
      `<article class="card"><div class="card-head"><div><h2>Recent activity</h2><p>Newest events first · ${items.length} shown</p></div></div>${items.length ? `<div class="timeline">${items.map(item => `<div class="timeline-item ${escapeHtml(item.severity)}"><span class="timeline-dot"></span><div><p>${escapeHtml(item.message)}</p><small>${escapeHtml(item.type.replace(/_/g, ' '))}${item.details && item.details.taskId ? ` · task ${escapeHtml(item.details.taskId.slice(0, 8))}` : ''}</small></div><time>${escapeHtml(formatDate(item.at))}</time></div>`).join('')}</div>` : empty('No activity yet', 'System events will be recorded here.')}</article>`;
  }
  function renderAlerts(data) {
    const alerts = data.alerts.alerts || [], logs = data.logs.logs || [];
    return sectionHeading('Alerts & execution logs', 'Review operational alerts and persistent worker execution status.') +
      `<div class="grid two-column"><article class="card"><div class="card-head"><div><h2>System alerts</h2><p>Warnings are based on recorded system events.</p></div></div>
      ${alerts.length ? alerts.map(item => `<div class="alert-row"><span class="alert-mark">!</span><div class="alert-copy"><b>${escapeHtml(item.message)}</b><small>${escapeHtml(item.type.replace(/_/g, ' '))} · ${escapeHtml(formatDate(item.createdAt))}</small></div>${item.status === 'open' ? `<button class="button button-small" data-resolve-alert="${escapeHtml(item.id)}">Resolve</button>` : tag('resolved')}</div>`).join('') : empty('No alerts', 'There are no stored alerts.')}</article>
      <article class="card"><div class="card-head"><div><h2>Worker execution ledger</h2><p>${logs.length} recent record${logs.length === 1 ? '' : 's'}</p></div></div>
      ${logs.length ? `<div class="table-wrap"><table><thead><tr><th>Operator / event</th><th>Status</th><th>Attempt</th><th>Details</th></tr></thead><tbody>${logs.map(log => `<tr><td><strong>${escapeHtml(log.website)}</strong><small>${escapeHtml(log.eventType || 'status')} · ${escapeHtml(formatDate(log.at))}</small></td><td>${tag(log.status)}</td><td>${log.attempts || 0}</td><td><strong>${escapeHtml(log.errorCode || '—')}</strong><small>${escapeHtml(log.message || '')}</small></td></tr>`).join('')}</tbody></table></div>` : empty('No executions yet', 'Execution records appear when a task is created.')}</article></div>`;
  }
  function renderSettings(data) {
    const settings = data.settings.settings || {};
    return sectionHeading('System settings', 'Configure persistent scheduler limits and retry policy.') +
      `<div class="grid settings-grid"><article class="card"><div class="card-head"><div><h2>Orchestration limits</h2><p>Persisted to the isolated Owner database.</p></div></div>
        <form id="settings-form"><div class="form-grid">
          <label>Global worker concurrency<input name="workerConcurrency" type="number" min="1" max="50" value="${escapeHtml(settings.worker_concurrency)}" required></label>
          <label>Per-operator concurrency<input name="perOperatorConcurrency" type="number" min="1" max="10" value="${escapeHtml(settings.per_operator_concurrency)}" required></label>
          <label>Retry limit<input name="retryLimit" type="number" min="0" max="5" value="${escapeHtml(settings.retry_limit)}" required></label>
          <label>Search timeout (seconds)<input name="searchTimeoutSeconds" type="number" min="5" max="300" value="${escapeHtml(settings.search_timeout_seconds)}" required></label>
          <label>Retention period (days)<input name="retentionDays" type="number" min="1" max="365" value="${escapeHtml(settings.retention_days)}" required></label>
        </div><div class="form-actions"><button class="button button-primary">Save settings</button></div></form>
      </article><article class="card"><div class="card-head"><div><h2>Security &amp; persistence</h2><p>Runtime configuration information</p></div>${tag('separate database')}</div>
        <div class="system-line"><span>Owner authentication</span><b>Server-side scrypt hash</b></div>
        <div class="system-line"><span>Session cookie</span><b>HttpOnly · SameSite Strict · 12h</b></div>
        <div class="system-line"><span>Customer database</span><b>Unchanged · separate SQLite file</b></div>
        <div class="system-line"><span>Credential storage</span><b>Not stored in source registry</b></div>
        <p class="form-hint">These limits are enforced by the task scheduler. No actual supplier adapter or browser worker is currently registered.</p>
      </article></div>`;
  }
  function render() {
    if (!state.data) return;
    const data = state.data;
    const templates = {
      overview: () => renderOverview(data),
      agents: () => renderAgents(data),
      operators: () => renderOperators(data),
      search: () => renderSearch(data),
      history: () => renderHistory(data),
      activity: () => renderActivity(data),
      alerts: () => renderAlerts(data),
      settings: () => renderSettings(data)
    };
    content.innerHTML = templates[state.view]();
  }
  async function loadData(quiet = false) {
    try {
      const [overview, mainAgent, websites, searches, activities, alerts, logs, settings] = await Promise.all([
        request('/overview'), request('/main-agent'), request('/websites'), request('/searches?limit=100'),
        request('/activities?limit=100'), request('/alerts?limit=100'), request('/logs?limit=100'), request('/settings')
      ]);
      const pending = websites.websites.filter(site => site.integrationStatus !== 'verified').length;
      state.data = { overview, mainAgent, websites, searches, activities, alerts, logs, settings, comparison: null };
      $('#nav-pending').textContent = pending;
      $('#last-updated').textContent = 'Updated ' + new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date());
      if (state.selectedTask && state.view === 'history') {
        try { state.data.comparison = await request(`/searches/${encodeURIComponent(state.selectedTask)}/offers`); }
        catch (error) { state.data.comparison = { comparison: [] }; }
      }
      render();
      if (!quiet) showNotice('Dashboard data refreshed.');
    } catch (error) {
      if (state.data) showNotice(error.message, true);
      else content.innerHTML = `<article class="card">${empty('Unable to load dashboard', error.message)}</article>`;
    }
  }
  function startEvents() {
    if (state.eventSource) return;
    state.eventSource = new EventSource('/api/owner/events', { withCredentials: true });
    state.eventSource.addEventListener('update', () => {
      if (state.refreshTimer) return;
      state.refreshTimer = setTimeout(() => { state.refreshTimer = null; loadData(true); }, 400);
    });
    state.eventSource.onerror = () => {
      request('/me').then(result => { if (!result.authenticated) showLogin(); }).catch(() => showLogin());
    };
  }
  function formValues(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  document.addEventListener('click', async event => {
    const nav = event.target.closest('[data-view], [data-nav]');
    if (nav) { setView(nav.dataset.view || nav.dataset.nav); return; }
    const cancel = event.target.closest('[data-cancel-task]');
    if (cancel) {
      event.preventDefault();
      event.stopPropagation();
      try {
        await request(`/searches/${encodeURIComponent(cancel.dataset.cancelTask)}/cancel`, { method: 'POST', body: '{}' });
        await loadData(true);
        showNotice('Search task cancelled.');
      } catch (error) { showNotice(error.message, true); }
      return;
    }
    const task = event.target.closest('[data-task]');
    if (task) {
      state.selectedTask = task.dataset.task;
      try { state.data.comparison = await request(`/searches/${encodeURIComponent(state.selectedTask)}/offers`); }
      catch (error) { showNotice(error.message, true); }
      setView('history');
      return;
    }
    const resolve = event.target.closest('[data-resolve-alert]');
    if (resolve) {
      try { await request(`/alerts/${encodeURIComponent(resolve.dataset.resolveAlert)}/resolve`, { method: 'POST', body: '{}' }); await loadData(true); showNotice('Alert resolved.'); }
      catch (error) { showNotice(error.message, true); }
      return;
    }
    if (event.target.closest('[data-action="add-website"]')) {
      const name = window.prompt('Operator name');
      if (name === null) return;
      const url = window.prompt('HTTPS operator URL');
      if (!url) return;
      try {
        await request('/websites', { method: 'POST', body: JSON.stringify({ name, url }) });
        await loadData(true);
        showNotice('Operator configuration added as pending.');
      } catch (error) { showNotice(error.message, true); }
    }
  });
  document.addEventListener('change', async event => {
    if (event.target.matches('#operator-filter')) {
      state.filter = event.target.value;
      const position = event.target.selectionStart;
      render();
      const replacement = $('#operator-filter');
      replacement.focus();
      replacement.setSelectionRange(position, position);
      return;
    }
    if (event.target.matches('[data-site-toggle]')) {
      try {
        await request(`/websites/${encodeURIComponent(event.target.dataset.siteToggle)}`, {
          method: 'PATCH', body: JSON.stringify({ enabled: event.target.checked })
        });
        await loadData(true);
        showNotice('Operator configuration updated; integration remains pending.');
      } catch (error) { event.target.checked = !event.target.checked; showNotice(error.message, true); }
    }
  });
  document.addEventListener('submit', async event => {
    if (event.target.id === 'login-form') {
      event.preventDefault();
      const errorNode = $('#login-error');
      errorNode.textContent = '';
      try {
        const result = await request('/login', { method: 'POST', body: JSON.stringify(formValues(event.target)) });
        showApp(result.owner);
        await loadData(true);
      } catch (error) { errorNode.textContent = error.message; }
    } else if (event.target.id === 'search-form') {
      event.preventDefault();
      const values = formValues(event.target);
      const childrenAges = values.childrenAges.trim() ? values.childrenAges.split(',').map(value => Number(value.trim())) : [];
      const parameters = {
        destination: values.destination, country: values.country, date: values.date,
        nights: Number(values.nights), adults: Number(values.adults), childrenAges,
        budget: values.budget ? Number(values.budget) : null, currency: values.currency,
        departureAirport: values.departureAirport || null
      };
      try {
        const key = crypto.randomUUID();
        const result = await request('/searches', {
          method: 'POST', body: JSON.stringify({ parameters }),
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }
        });
        state.selectedTask = result.task.id;
        state.clarification = null;
        state.view = 'history';
        await loadData(true);
        setView('history');
        showNotice(result.task.status === 'blocked'
          ? 'Search saved; no compatible verified adapter is registered.'
          : 'Search task queued for compatible verified workers.');
      } catch (error) { showNotice(error.message, true); }
    } else if (event.target.id === 'natural-search-form') {
      event.preventDefault();
      const command = formValues(event.target).command;
      try {
        const result = await request('/agent/searches', {
          method: 'POST',
          body: JSON.stringify({ command }),
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }
        });
        if (result.status === 'needs_clarification') {
          state.clarification = result;
          render();
          return;
        }
        state.clarification = null;
        state.selectedTask = result.task.id;
        state.view = 'history';
        await loadData(true);
        setView('history');
        showNotice(result.task.status === 'blocked'
          ? `Search parsed (${result.parserMode}) and saved; no compatible verified adapter is registered.`
          : `Search parsed (${result.parserMode}) and queued.`);
      } catch (error) { showNotice(error.message, true); }
    } else if (event.target.id === 'settings-form') {
      event.preventDefault();
      const values = formValues(event.target);
      const body = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value)]));
      try {
        await request('/settings', { method: 'POST', body: JSON.stringify(body) });
        await loadData(true);
        showNotice('System settings saved.');
      } catch (error) { showNotice(error.message, true); }
    }
  });
  $('#refresh-button').addEventListener('click', () => loadData(false));
  $('#logout-button').addEventListener('click', async () => {
    try { await request('/logout', { method: 'POST', body: '{}' }); } catch (error) { /* session may already be expired */ }
    showLogin();
  });
  $('#menu-button').addEventListener('click', () => {
    $('#sidebar').classList.add('open');
    $('#sidebar-scrim').classList.add('show');
  });
  $('#sidebar-scrim').addEventListener('click', () => {
    $('#sidebar').classList.remove('open');
    $('#sidebar-scrim').classList.remove('show');
  });

  request('/me').then(result => {
    if (result.authenticated) {
      showApp(result.owner);
      loadData(true);
    } else showLogin();
  }).catch(() => showLogin());
})();
