/* eslint-disable */
/**
 * IntentEra chat webview script.
 *
 * Plain ES2020 (no bundler, no TypeScript build step). Runs inside a VS Code
 * webview, so it talks to the extension host through `acquireVsCodeApi()`.
 *
 * State:
 *   - `attachments`: chips currently shown above the composer.
 *   - `history`:     transcript turns sent to the Lambda (last 6 used).
 *   - `pending`:     map of in-flight requestIds -> placeholder DOM nodes so
 *                    we can replace them with the real answer when it lands.
 *
 * The host pushes:
 *   - `addAttachment` when the user invokes "Ask about selection/file".
 *   - `chatResult` / `chatError` after a Lambda round-trip.
 *   - `config` and `agentStatus` for the status banner.
 */
(function () {
  const vscode = acquireVsCodeApi();

  /** @type {Array<{ file: string, range?: [number, number], content?: string }>} */
  let attachments = [];
  /** @type {Array<{role: 'user'|'assistant', content: string}>} */
  let history = [];
  /** @type {Map<string, HTMLElement>} */
  const pending = new Map();
  /** @type {{lambdaConfigured: boolean, lambdaUrl: string, agentUrl: string}} */
  let lastConfig = { lambdaConfigured: false, lambdaUrl: '', agentUrl: '' };
  /** @type {{ok: boolean, detail?: string}} */
  let lastAgentStatus = { ok: false };

  const transcriptEl = document.getElementById('transcript');
  const attachmentsEl = document.getElementById('attachments');
  const composerEl = document.getElementById('composer');
  const questionEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('question'));
  const sendBtn = /** @type {HTMLButtonElement} */ (document.getElementById('send'));
  const statusEl = document.getElementById('status');

  composerEl.addEventListener('submit', (e) => {
    e.preventDefault();
    submitChat();
  });

  questionEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submitChat();
    }
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    console.log('[IntentEra webview] received', msg.type, {
      requestId: msg.requestId,
      pendingKeys: Array.from(pending.keys()),
    });
    switch (msg.type) {
      case 'addAttachment':
        addAttachment(msg.attachment);
        break;
      case 'chatResult':
        console.log('[IntentEra webview] chatResult payload', msg.response);
        renderResult(msg.requestId, msg.response);
        break;
      case 'chatError':
        console.warn('[IntentEra webview] chatError', msg.message);
        renderError(msg.requestId, msg.message);
        break;
      case 'config':
        lastConfig = msg;
        refreshStatus();
        break;
      case 'agentStatus':
        lastAgentStatus = { ok: msg.ok, detail: msg.detail };
        refreshStatus();
        break;
    }
  });

  vscode.postMessage({ type: 'requestConfig' });

  // Debug hook: lets you inspect/mutate state from the webview devtools console.
  //   __intentera.pending.size
  //   __intentera.clearPending()
  window.__intentera = {
    get pending() {
      return pending;
    },
    get history() {
      return history;
    },
    get attachments() {
      return attachments;
    },
    clearPending() {
      pending.clear();
      setBusy(false);
      document
        .querySelectorAll('.message.assistant .answer.loading')
        .forEach((n) => {
          const card = n.closest('.message');
          if (card) card.remove();
        });
    },
  };

  function addAttachment(att) {
    if (!att || !att.file) return;
    attachments.push(att);
    renderAttachments();
  }

  function removeAttachment(idx) {
    attachments.splice(idx, 1);
    renderAttachments();
  }

  function renderAttachments() {
    attachmentsEl.innerHTML = '';
    attachments.forEach((a, idx) => {
      const chip = document.createElement('span');
      chip.className = 'attachment';
      const path = document.createElement('span');
      path.className = 'path';
      path.title = a.file + (a.range ? ` (lines ${a.range[0]}-${a.range[1]})` : '');
      path.textContent =
        shortenPath(a.file) + (a.range ? `:${a.range[0]}-${a.range[1]}` : '');
      const btn = document.createElement('button');
      btn.className = 'remove';
      btn.type = 'button';
      btn.setAttribute('aria-label', `Remove ${a.file}`);
      btn.textContent = '\u00d7';
      btn.addEventListener('click', () => removeAttachment(idx));
      chip.appendChild(path);
      chip.appendChild(btn);
      attachmentsEl.appendChild(chip);
    });
  }

  function shortenPath(p) {
    const parts = p.split('/');
    if (parts.length <= 2) return p;
    return `\u2026/${parts.slice(-2).join('/')}`;
  }

  function submitChat() {
    const question = questionEl.value.trim();
    if (!question) return;
    if (!lastConfig.lambdaConfigured) {
      refreshStatus();
      return;
    }

    const requestId = String(Date.now()) + Math.random().toString(36).slice(2, 6);

    appendUserTurn(question);
    history.push({ role: 'user', content: question });

    const placeholder = appendAssistantPlaceholder();
    pending.set(requestId, placeholder);

    vscode.postMessage({
      type: 'sendChat',
      requestId,
      question,
      attachments,
      history: history.slice(-6),
    });

    questionEl.value = '';
    setBusy(true);
  }

  function appendUserTurn(text) {
    const el = document.createElement('article');
    el.className = 'message user';
    const role = document.createElement('div');
    role.className = 'role';
    role.textContent = 'You';
    const body = document.createElement('div');
    body.className = 'answer';
    body.textContent = text;
    el.appendChild(role);
    el.appendChild(body);
    if (attachments.length > 0) {
      const meta = document.createElement('div');
      meta.className = 'retrieved-meta';
      meta.textContent =
        'Context: ' +
        attachments
          .map((a) => a.file + (a.range ? ` (${a.range[0]}-${a.range[1]})` : ''))
          .join('; ');
      el.appendChild(meta);
    }
    transcriptEl.appendChild(el);
    scrollToBottom();
  }

  function appendAssistantPlaceholder() {
    const el = document.createElement('article');
    el.className = 'message assistant';
    const role = document.createElement('div');
    role.className = 'role';
    role.textContent = 'IntentEra';
    const body = document.createElement('div');
    body.className = 'answer loading';
    body.textContent = 'Thinking…';
    el.appendChild(role);
    el.appendChild(body);
    transcriptEl.appendChild(el);
    scrollToBottom();
    return el;
  }

  function renderResult(requestId, response) {
    const placeholder = pending.get(requestId);
    pending.delete(requestId);
    setBusy(pending.size > 0);
    if (!placeholder) return;
    placeholder.innerHTML = '';
    const role = document.createElement('div');
    role.className = 'role';
    role.textContent = 'IntentEra';
    placeholder.appendChild(role);

    const answer = document.createElement('div');
    answer.className = 'answer';
    answer.textContent = response.answer || '(no answer returned)';
    placeholder.appendChild(answer);

    const cit = response.citations || { commits: [], tickets: [], prs: [] };
    const citWrap = document.createElement('div');
    citWrap.className = 'citations';
    if (cit.commits?.length) citWrap.appendChild(renderCommitGroup(cit.commits));
    if (cit.tickets?.length) citWrap.appendChild(renderTicketGroup(cit.tickets));
    if (cit.prs?.length) citWrap.appendChild(renderPrGroup(cit.prs));
    placeholder.appendChild(citWrap);

    if (response.retrieved) {
      const meta = document.createElement('div');
      meta.className = 'retrieved-meta';
      meta.textContent =
        `retrieved: ${response.retrieved.localCommitCount} local commits, ` +
        `${response.retrieved.jiraCount} Jira hits, ` +
        `${response.retrieved.githubCount} GitHub hits, ` +
        `${response.retrieved.mergedCount} merged`;
      placeholder.appendChild(meta);
    }

    history.push({ role: 'assistant', content: response.answer || '' });
    // Reset attachments after a successful turn so the next question doesn't
    // accidentally reuse stale context.
    attachments = [];
    renderAttachments();
    scrollToBottom();
  }

  function renderError(requestId, message) {
    const placeholder = pending.get(requestId);
    pending.delete(requestId);
    setBusy(pending.size > 0);
    if (!placeholder) return;
    placeholder.classList.add('error');
    placeholder.innerHTML = '';
    const role = document.createElement('div');
    role.className = 'role';
    role.textContent = 'IntentEra (error)';
    const body = document.createElement('div');
    body.className = 'answer';
    body.textContent = message;
    placeholder.appendChild(role);
    placeholder.appendChild(body);
    scrollToBottom();
  }

  function renderCommitGroup(commits) {
    const group = document.createElement('div');
    group.className = 'citation-group';
    const h = document.createElement('h4');
    h.textContent = 'Commits that shaped this';
    group.appendChild(h);
    for (const c of commits) {
      const item = document.createElement('div');
      item.className = 'citation';
      const head = document.createElement('div');
      head.className = 'head';
      const id = document.createElement('span');
      id.className = 'id';
      id.textContent = c.shortSha + ' • ' + (c.date || '').slice(0, 10);
      const subj = document.createElement('span');
      subj.textContent = c.subject || '';
      head.appendChild(id);
      head.appendChild(subj);
      const reason = document.createElement('div');
      reason.className = 'reason';
      reason.textContent = c.reasonPlain || '';
      item.appendChild(head);
      item.appendChild(reason);
      if (c.jiraKeys?.length) {
        const jira = document.createElement('div');
        jira.className = 'reason';
        jira.textContent = 'Linked: ' + c.jiraKeys.join(', ');
        item.appendChild(jira);
      }
      group.appendChild(item);
    }
    return group;
  }

  function renderTicketGroup(tickets) {
    const group = document.createElement('div');
    group.className = 'citation-group';
    const h = document.createElement('h4');
    h.textContent = 'Linked Jira tickets';
    group.appendChild(h);
    for (const t of tickets) {
      const item = document.createElement('div');
      item.className = 'citation';
      const head = document.createElement('div');
      head.className = 'head';
      const id = document.createElement('span');
      id.className = 'id';
      if (t.url) {
        const a = document.createElement('a');
        a.href = t.url;
        a.textContent = t.key;
        id.appendChild(a);
      } else {
        id.textContent = t.key;
      }
      const summary = document.createElement('span');
      summary.textContent = (t.summary || '') + (t.status ? ` (${t.status})` : '');
      head.appendChild(id);
      head.appendChild(summary);
      const reason = document.createElement('div');
      reason.className = 'reason';
      reason.textContent = t.reasonPlain || '';
      item.appendChild(head);
      item.appendChild(reason);
      group.appendChild(item);
    }
    return group;
  }

  function renderPrGroup(prs) {
    const group = document.createElement('div');
    group.className = 'citation-group';
    const h = document.createElement('h4');
    h.textContent = 'Related GitHub PRs';
    group.appendChild(h);
    for (const p of prs) {
      const item = document.createElement('div');
      item.className = 'citation';
      const head = document.createElement('div');
      head.className = 'head';
      const id = document.createElement('span');
      id.className = 'id';
      const label = `${p.repo}#${p.number}`;
      if (p.url) {
        const a = document.createElement('a');
        a.href = p.url;
        a.textContent = label;
        id.appendChild(a);
      } else {
        id.textContent = label;
      }
      const title = document.createElement('span');
      title.textContent = p.title || '';
      head.appendChild(id);
      head.appendChild(title);
      const reason = document.createElement('div');
      reason.className = 'reason';
      reason.textContent = p.reasonPlain || '';
      item.appendChild(head);
      item.appendChild(reason);
      group.appendChild(item);
    }
    return group;
  }

  function setBusy(busy) {
    sendBtn.disabled = busy;
    sendBtn.textContent = busy ? 'Sending…' : 'Send';
  }

  function refreshStatus() {
    const messages = [];
    if (!lastConfig.lambdaConfigured) {
      messages.push('Set `intentera.lambdaChatUrl` in Settings to enable chat.');
    }
    if (!lastAgentStatus.ok) {
      messages.push(
        `Local git agent unreachable${lastAgentStatus.detail ? ` (${lastAgentStatus.detail})` : ''}. ` +
          'Run `npm run agent` in the IntentEra repo.'
      );
    }
    if (messages.length === 0) {
      statusEl.classList.add('hidden');
      statusEl.classList.add('ok');
      statusEl.textContent = '';
      return;
    }
    statusEl.classList.remove('hidden');
    statusEl.classList.remove('ok');
    statusEl.textContent = messages.join(' ');
  }

  function scrollToBottom() {
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }
})();
