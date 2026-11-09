"use strict";

// ---------- SETTINGS ----------

const STORAGE_KEY = "jobtrack.applications.v2";

const STATUSES = [
  "Applied",
  "Heard Back",
  "Assessment",
  "Interview",
  "Passed Interview",
  "Offer",
  "Rejected"
];

// Statuses where the process is over, so no follow-up is needed.
const CLOSED_STATUSES = ["Offer", "Rejected"];

// Statuses that mean the application made it at least to an interview.
const INTERVIEW_STATUSES = ["Interview", "Passed Interview", "Offer"];

// Each column's field name and header live together so they can't drift apart.
const CSV_COLUMNS = [
  ["company", "Company"],
  ["role", "Role"],
  ["location", "Location"],
  ["dateApplied", "Date Applied"],
  ["status", "Status"],
  ["nextStep", "Next Step"],
  ["followUpDate", "Follow-up Date"],
  ["link", "Link"],
  ["notes", "Notes"]
];

const VIEWS = {
  dashboard: {
    title: "Dashboard",
    subtitle: "A quick look at where your job search stands."
  },
  applications: {
    title: "Applications",
    subtitle: "Every application in one place. Search, filter, and update."
  },
  board: {
    title: "Pipeline",
    subtitle: "Drag a card to another column to change its status."
  }
};

// ---------- APPLICATION STATE ----------

let jobs = loadJobs();

// ---------- HELPERS ----------

const $ = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);

// Prevent user-entered text from being interpreted as HTML.
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

// Only allow web links, so a saved "javascript:" URL can't run code when clicked.
// Links typed without a scheme ("careers.acme.com") get https:// added.
function safeLink(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";

  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`;

  try {
    const url = new URL(withScheme);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function createId() {
  return window.crypto?.randomUUID
    ? crypto.randomUUID()
    : `job-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function today() {
  return toISODate(new Date());
}

// A bare "YYYY-MM-DD" is read as midnight UTC, which shows as the previous
// day in US time zones. Noon local time avoids that shift.
function parseDate(value) {
  return new Date(`${value}T12:00:00`);
}

function addDays(value, days) {
  const date = parseDate(value);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

function daysFromToday(value) {
  return Math.round((parseDate(value) - parseDate(today())) / 86400000);
}

function formatDate(value) {
  if (!value) return "—";

  return parseDate(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// "Passed Interview" -> "passed-interview", used to pick colors in style.css.
function tone(status) {
  return status.toLowerCase().replace(/\s+/g, "-");
}

// The same company always gets the same avatar color.
function avatarColor(name) {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % 6;
}

function avatar(name) {
  const letter = name.trim().charAt(0).toUpperCase() || "?";
  return `<span class="avatar" data-avatar="${avatarColor(name)}" aria-hidden="true">${escapeHTML(letter)}</span>`;
}

function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function statusPill(status) {
  return `<span class="pill" data-tone="${tone(status)}">${escapeHTML(status)}</span>`;
}

// Turns a follow-up date into a short label and a color.
function dueBadge(value) {
  const days = daysFromToday(value);

  let label;
  let state;

  if (days < 0) {
    label = days === -1 ? "Overdue · 1 day" : `Overdue · ${-days} days`;
    state = "overdue";
  } else if (days === 0) {
    label = "Today";
    state = "today";
  } else if (days === 1) {
    label = "Tomorrow";
    state = "soon";
  } else if (days <= 7) {
    label = `In ${days} days`;
    state = "soon";
  } else {
    label = formatDate(value);
    state = "later";
  }

  return `<span class="due" data-due="${state}">${icon("clock")}${label}</span>`;
}

// Newest first, with undated applications at the end.
function byNewest(a, b) {
  if (!a.dateApplied) return 1;
  if (!b.dateApplied) return -1;
  return b.dateApplied.localeCompare(a.dateApplied);
}

function isActive(job) {
  return !CLOSED_STATUSES.includes(job.status);
}

// ---------- SAVING AND LOADING ----------

// Cleans up one application from storage or a backup file. Anything missing
// or the wrong type is replaced with a safe default; returns null if the
// company or job title is missing.
function normalizeJob(raw) {
  if (!raw || typeof raw !== "object") return null;

  const text = (value, max) =>
    typeof value === "string" ? value.trim().slice(0, max) : "";

  const date = value =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";

  const job = {
    id: text(raw.id, 100) || createId(),
    company: text(raw.company, 100),
    role: text(raw.role, 160),
    location: text(raw.location, 120),
    dateApplied: date(raw.dateApplied),
    status: STATUSES.includes(raw.status) ? raw.status : "Applied",
    nextStep: text(raw.nextStep, 220),
    followUpDate: date(raw.followUpDate),
    link: safeLink(text(raw.link, 2000)),
    notes: text(raw.notes, 5000)
  };

  return job.company && job.role ? job : null;
}

function normalizeJobs(list) {
  const seen = new Set();

  return list
    .map(normalizeJob)
    .filter(Boolean)
    .map(job => {
      if (seen.has(job.id)) job.id = createId();
      seen.add(job.id);
      return job;
    });
}

function loadJobs() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === null) return [];

    const parsed = JSON.parse(saved);
    return Array.isArray(parsed?.jobs) ? normalizeJobs(parsed.jobs) : [];
  } catch (error) {
    console.error("Unable to load saved applications:", error);
    return [];
  }
}

function saveJobs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, jobs }));
  } catch (error) {
    console.error("Unable to save applications:", error);
    showToast("Couldn't save. Browser storage is unavailable, so download a backup.", { error: true });
  }
}

// ---------- NOTIFICATIONS ----------

function showToast(message, { actionLabel, onAction, error = false } = {}) {
  const toast = document.createElement("div");
  toast.className = error ? "toast error" : "toast";

  const text = document.createElement("span");
  text.textContent = message;
  toast.append(text);

  // Toasts with a button (like Undo) stay up longer so there's time to click.
  const timer = setTimeout(dismiss, actionLabel ? 6000 : 3500);

  if (actionLabel) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = actionLabel;
    button.addEventListener("click", () => {
      onAction();
      dismiss();
    });
    toast.append(button);
  }

  $("#toasts").append(toast);

  function dismiss() {
    clearTimeout(timer);
    toast.classList.add("leaving");
    setTimeout(() => toast.remove(), 200);
  }
}

// ---------- CHANGING APPLICATIONS ----------

function findJob(id) {
  return jobs.find(job => job.id === id);
}

function setStatus(id, status) {
  const job = findJob(id);
  if (!job || !STATUSES.includes(status) || job.status === status) return;

  job.status = status;
  saveJobs();
  renderAll();
  showToast(`${job.company} moved to ${status}`);
}

function deleteJob(id) {
  const index = jobs.findIndex(job => job.id === id);
  if (index === -1) return;

  const [removed] = jobs.splice(index, 1);
  saveJobs();
  renderAll();

  showToast(`Deleted ${removed.company}`, {
    actionLabel: "Undo",
    onAction() {
      jobs.splice(Math.min(index, jobs.length), 0, removed);
      saveJobs();
      renderAll();
    }
  });
}

// ---------- DASHBOARD ----------

function renderStats() {
  const total = jobs.length;
  const active = jobs.filter(isActive);
  const weekAgo = addDays(today(), -7);

  const addedThisWeek = jobs.filter(job => job.dateApplied && job.dateApplied >= weekAgo).length;
  const due = active.filter(job => job.followUpDate && job.followUpDate <= today()).length;
  const interviews = jobs.filter(job => INTERVIEW_STATUSES.includes(job.status)).length;
  const offers = jobs.filter(job => job.status === "Offer").length;
  const rejected = jobs.filter(job => job.status === "Rejected").length;
  const interviewRate = total ? Math.round((interviews / total) * 100) : 0;

  $("#statTotal").textContent = total;
  $("#statTotalNote").textContent = `${addedThisWeek} in the last 7 days`;

  $("#statActive").textContent = active.length;
  $("#statActiveNote").textContent = due
    ? `${plural(due, "follow-up")} due`
    : "Nothing due right now";

  $("#statInterviews").textContent = interviews;
  $("#statInterviewsNote").textContent = `${interviewRate}% of applications`;

  $("#statOffers").textContent = offers;
  $("#statOffersNote").textContent = `${rejected} rejected`;
}

function renderBreakdown() {
  const total = jobs.length;

  const counts = STATUSES.map(status => ({
    status,
    count: jobs.filter(job => job.status === status).length
  }));

  $("#breakdownBar").innerHTML = counts
    .filter(item => item.count > 0)
    .map(item => `
      <span data-tone="${tone(item.status)}"
        style="flex-grow:${item.count}"
        title="${item.status}: ${item.count}"></span>
    `).join("");

  $("#breakdownList").innerHTML = counts.map(item => `
    <li data-tone="${tone(item.status)}">
      <span class="dot"></span>
      <span class="name">${item.status}</span>
      <span class="count">${item.count}</span>
      <span class="percent">${total ? Math.round((item.count / total) * 100) : 0}%</span>
    </li>
  `).join("");
}

// Past-due follow-ups stay in the list, flagged so they stand out.
function renderFollowUps() {
  const upcoming = jobs
    .filter(job => job.followUpDate && isActive(job))
    .sort((a, b) => a.followUpDate.localeCompare(b.followUpDate))
    .slice(0, 6);

  $("#followUpList").innerHTML = upcoming.length
    ? upcoming.map(job => `
        <button class="row-button" type="button" data-edit="${escapeHTML(job.id)}">
          ${avatar(job.company)}
          <span class="row-main">
            <span class="row-title">${escapeHTML(job.company)}</span>
            <span class="row-sub">${escapeHTML(job.nextStep || job.role)}</span>
          </span>
          ${dueBadge(job.followUpDate)}
        </button>
      `).join("")
    : `<p class="panel-empty">No follow-ups scheduled. Add a follow-up date to an application and it will show up here.</p>`;
}

function renderRecent() {
  const recent = [...jobs].sort(byNewest).slice(0, 5);

  $("#recentList").innerHTML = recent.map(job => `
    <button class="row-button" type="button" data-edit="${escapeHTML(job.id)}">
      ${avatar(job.company)}
      <span class="row-main">
        <span class="row-title">${escapeHTML(job.company)}</span>
        <span class="row-sub">${escapeHTML(job.role)}</span>
      </span>
      <span class="row-end">
        ${statusPill(job.status)}
        <span class="row-date">${formatDate(job.dateApplied)}</span>
      </span>
    </button>
  `).join("");
}

function renderDashboard() {
  const empty = jobs.length === 0;

  $("#dashboardEmpty").hidden = !empty;
  $("#dashboardContent").hidden = empty;

  if (empty) return;

  renderStats();
  renderBreakdown();
  renderFollowUps();
  renderRecent();
}

// ---------- APPLICATIONS TABLE ----------

const SORTERS = {
  newest: byNewest,
  oldest: (a, b) => -byNewest(a, b),
  company: (a, b) => a.company.localeCompare(b.company, undefined, { sensitivity: "base" }),
  followup: (a, b) => {
    if (!a.followUpDate) return 1;
    if (!b.followUpDate) return -1;
    return a.followUpDate.localeCompare(b.followUpDate);
  },
  status: (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status)
};

function statusSelect(job) {
  return `
    <select class="status-select"
      data-tone="${tone(job.status)}"
      data-status-for="${escapeHTML(job.id)}"
      aria-label="Status for ${escapeHTML(job.company)}">
      ${STATUSES.map(status => `
        <option value="${status}" ${status === job.status ? "selected" : ""}>${status}</option>
      `).join("")}
    </select>
  `;
}

function createTableRow(job) {
  const url = safeLink(job.link);
  const hasFollowUp = job.followUpDate && isActive(job);

  return `
    <tr>
      <td class="col-company">
        <div class="company-cell">
          ${avatar(job.company)}
          <div>
            <div class="company-name">${escapeHTML(job.company)}</div>
            ${job.location ? `<div class="cell-sub">${escapeHTML(job.location)}</div>` : ""}
          </div>
        </div>
      </td>

      <td class="col-role">
        <div>${escapeHTML(job.role)}</div>
        ${job.nextStep ? `<div class="cell-sub">Next: ${escapeHTML(job.nextStep)}</div>` : ""}
      </td>

      <td class="col-status">${statusSelect(job)}</td>

      <td class="col-applied">${formatDate(job.dateApplied)}</td>

      ${hasFollowUp
        ? `<td class="col-follow">${dueBadge(job.followUpDate)}</td>`
        : `<td class="col-follow is-empty"><span class="cell-sub">—</span></td>`}

      <td class="col-actions">
        <div class="row-actions">
          ${url ? `
            <a class="icon-btn" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer"
              title="Open job posting" aria-label="Open job posting for ${escapeHTML(job.company)}">
              ${icon("external")}
            </a>` : ""}

          <button class="icon-btn" type="button" data-edit="${escapeHTML(job.id)}"
            title="Edit" aria-label="Edit ${escapeHTML(job.company)}">
            ${icon("edit")}
          </button>

          <button class="icon-btn danger" type="button" data-delete="${escapeHTML(job.id)}"
            title="Delete" aria-label="Delete ${escapeHTML(job.company)}">
            ${icon("trash")}
          </button>
        </div>
      </td>
    </tr>
  `;
}

function renderTable() {
  const search = $("#searchInput").value.toLowerCase().trim();
  const filter = $("#statusFilter").value;
  const sort = SORTERS[$("#sortSelect").value] || byNewest;

  const filtered = jobs
    .filter(job => {
      const text = `${job.company} ${job.role} ${job.location} ${job.nextStep} ${job.notes}`.toLowerCase();
      return text.includes(search) && (filter === "All" || job.status === filter);
    })
    .sort(sort);

  $("#resultCount").textContent = filtered.length === jobs.length
    ? plural(jobs.length, "application")
    : `${filtered.length} of ${jobs.length}`;

  $("#tableBody").innerHTML = filtered.map(createTableRow).join("");

  const empty = $("#tableEmpty");
  $(".table-wrap").hidden = filtered.length === 0;
  empty.hidden = filtered.length > 0;

  if (jobs.length === 0) {
    empty.innerHTML = `
      <h3>No applications yet</h3>
      <p>Add your first one to get started.</p>
      <button class="btn btn-primary" type="button" data-action="add">${icon("plus")} Add application</button>
    `;
  } else if (filtered.length === 0) {
    empty.innerHTML = `
      <h3>No matches</h3>
      <p>Nothing matches your search or filter.</p>
      <button class="btn btn-ghost" type="button" data-action="clear-filters">Clear filters</button>
    `;
  }
}

// ---------- PIPELINE BOARD ----------

function createBoardCard(job) {
  return `
    <article class="job-card" draggable="true" tabindex="0" role="button"
      data-edit="${escapeHTML(job.id)}" data-drag="${escapeHTML(job.id)}"
      aria-label="${escapeHTML(job.company)}, ${escapeHTML(job.role)}. Press Enter to edit.">

      <div class="job-card-top">
        ${avatar(job.company)}
        <span class="job-card-company">${escapeHTML(job.company)}</span>
      </div>

      <div class="job-card-role">${escapeHTML(job.role)}</div>

      <div class="job-card-meta">
        <span>${formatDate(job.dateApplied)}</span>
        ${job.followUpDate && isActive(job) ? dueBadge(job.followUpDate) : ""}
      </div>
    </article>
  `;
}

function renderBoard() {
  $("#board").innerHTML = STATUSES.map(status => {
    const stageJobs = jobs.filter(job => job.status === status).sort(byNewest);

    return `
      <section class="lane" data-stage="${status}" data-tone="${tone(status)}" aria-label="${status}">
        <header class="lane-header">
          <h3>${status}</h3>
          <span class="lane-count">${stageJobs.length}</span>
        </header>

        <div class="lane-body">
          ${stageJobs.length
            ? stageJobs.map(createBoardCard).join("")
            : `<div class="lane-empty">Drop here</div>`}
        </div>
      </section>
    `;
  }).join("");
}

// ---------- PAGES ----------

function currentView() {
  const view = location.hash.slice(1);
  return Object.hasOwn(VIEWS, view) ? view : "dashboard";
}

function showView() {
  const view = currentView();

  $$("[data-section]").forEach(section => {
    section.hidden = section.dataset.section !== view;
  });

  $$("[data-nav]").forEach(link => {
    if (link.dataset.nav === view) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });

  $("#pageTitle").textContent = VIEWS[view].title;
  $("#pageSubtitle").textContent = VIEWS[view].subtitle;
  document.title = `${VIEWS[view].title} · JobTrack`;
}

function renderAll() {
  $("#navCount").textContent = jobs.length;
  renderDashboard();
  renderTable();
  renderBoard();
}

// ---------- ADD / EDIT DIALOG ----------

const editor = $("#editor");
const editorForm = $("#editorForm");

function openEditor(id) {
  const job = id ? findJob(id) : null;
  if (id && !job) return;

  editorForm.reset();

  const fields = editorForm.elements;

  if (job) {
    for (const key of Object.keys(job)) {
      if (fields[key]) fields[key].value = job[key];
    }
  } else {
    fields.id.value = "";
    fields.dateApplied.value = today();
    fields.status.value = "Applied";
  }

  $("#editorTitle").textContent = job ? "Edit application" : "Add application";
  $("#editorSubmit").textContent = job ? "Save changes" : "Add application";
  $("#editorDelete").hidden = !job;

  editor.showModal();
  fields.company.focus();
}

function closeEditor() {
  editor.close();
}

editorForm.addEventListener("submit", event => {
  event.preventDefault();

  const fields = editorForm.elements;
  const existingId = fields.id.value;

  const job = normalizeJob({
    id: existingId || createId(),
    company: fields.company.value,
    role: fields.role.value,
    location: fields.location.value,
    dateApplied: fields.dateApplied.value,
    status: fields.status.value,
    nextStep: fields.nextStep.value,
    followUpDate: fields.followUpDate.value,
    link: fields.link.value,
    notes: fields.notes.value
  });

  // "required" lets a field full of spaces through, so check again after trimming.
  if (!job) {
    showToast("Please enter a company and a job title.", { error: true });
    return;
  }

  if (fields.link.value.trim() && !job.link) {
    showToast("That link doesn't look like a web address, so it wasn't saved.", { error: true });
  }

  const index = jobs.findIndex(item => item.id === existingId);

  if (index === -1) {
    jobs.unshift(job);
    showToast(`Added ${job.company}`);
  } else {
    jobs[index] = job;
    showToast("Changes saved");
  }

  saveJobs();
  closeEditor();
  renderAll();
});

// Clicking the dimmed area around the dialog closes it. The form fills the
// whole dialog, so a click whose target is the dialog itself was outside it.
editor.addEventListener("click", event => {
  if (event.target === editor) closeEditor();
});

// ---------- EXPORT, BACKUP, AND RESTORE ----------

function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  // Give the browser a moment to start the download before freeing the file.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCSV() {
  if (!jobs.length) {
    showToast("Nothing to export yet. Add an application first.");
    return;
  }

  function csvCell(value) {
    let text = String(value ?? "");

    // Protect spreadsheet programs from formula injection.
    if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;

    return '"' + text.replace(/"/g, '""') + '"';
  }

  const rows = [
    CSV_COLUMNS.map(([, header]) => csvCell(header)).join(","),
    ...[...jobs].sort(byNewest).map(job =>
      CSV_COLUMNS.map(([field]) => csvCell(job[field])).join(",")
    )
  ];

  // The leading byte-order mark makes Excel read the file as UTF-8,
  // so characters like "—" and accented names display correctly.
  downloadFile(`jobtrack-${today()}.csv`, "﻿" + rows.join("\r\n"), "text/csv;charset=utf-8");
}

function downloadBackup() {
  if (!jobs.length) {
    showToast("Nothing to back up yet. Add an application first.");
    return;
  }

  const backup = {
    app: "JobTrack",
    version: 2,
    exportedAt: new Date().toISOString(),
    jobs
  };

  downloadFile(`jobtrack-backup-${today()}.json`, JSON.stringify(backup, null, 2), "application/json");
  showToast(`Backup downloaded (${plural(jobs.length, "application")})`);
}

async function restoreBackup(file) {
  let data;

  try {
    data = JSON.parse(await file.text());
  } catch {
    showToast("That file isn't valid JSON.", { error: true });
    return;
  }

  // Accept a full backup object or a plain list of applications.
  const list = Array.isArray(data) ? data : data?.jobs;

  if (!Array.isArray(list)) {
    showToast("That file isn't a JobTrack backup.", { error: true });
    return;
  }

  const restored = normalizeJobs(list);
  const skipped = list.length - restored.length;

  if (!restored.length) {
    showToast("No applications found in that backup.", { error: true });
    return;
  }

  if (
    jobs.length &&
    !confirm(`Replace your ${plural(jobs.length, "application")} with the ${plural(restored.length, "application")} in this backup?`)
  ) {
    return;
  }

  jobs = restored;
  saveJobs();
  renderAll();

  showToast(
    `Restored ${plural(restored.length, "application")}` +
    (skipped ? `, skipped ${skipped} without a company or title` : "")
  );
}

$("#exportCsvBtn").addEventListener("click", exportCSV);
$("#backupBtn").addEventListener("click", downloadBackup);
$("#restoreBtn").addEventListener("click", () => $("#restoreInput").click());

$("#restoreInput").addEventListener("change", event => {
  const [file] = event.target.files;
  if (file) restoreBackup(file);

  // Reset so choosing the same file again still triggers a change.
  event.target.value = "";
});

// ---------- EVENTS ----------

document.addEventListener("click", event => {
  const target = event.target;

  const action = target.closest("[data-action]")?.dataset.action;

  if (action === "add") openEditor();
  if (action === "close-editor") closeEditor();
  if (action === "restore") $("#restoreInput").click();

  if (action === "delete-from-editor") {
    const id = editorForm.elements.id.value;
    closeEditor();
    deleteJob(id);
  }

  if (action === "clear-filters") {
    $("#searchInput").value = "";
    $("#statusFilter").value = "All";
    renderTable();
  }

  const editButton = target.closest("[data-edit]");
  if (editButton) openEditor(editButton.dataset.edit);

  const deleteButton = target.closest("[data-delete]");
  if (deleteButton) deleteJob(deleteButton.dataset.delete);
});

// Board cards act like buttons, so Enter and Space open them too.
document.addEventListener("keydown", event => {
  const card = event.target.closest?.(".job-card");

  if (card && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    openEditor(card.dataset.edit);
  }
});

document.addEventListener("change", event => {
  const select = event.target.closest("[data-status-for]");
  if (select) setStatus(select.dataset.statusFor, select.value);
});

$("#searchInput").addEventListener("input", renderTable);
$("#statusFilter").addEventListener("change", renderTable);
$("#sortSelect").addEventListener("change", renderTable);

window.addEventListener("hashchange", showView);

// ---------- DRAG AND DROP ----------

document.addEventListener("dragstart", event => {
  const card = event.target.closest?.("[data-drag]");
  if (!card || !event.dataTransfer) return;

  event.dataTransfer.setData("text/plain", card.dataset.drag);
  event.dataTransfer.effectAllowed = "move";
  card.classList.add("dragging");
});

document.addEventListener("dragend", () => {
  $$(".dragging, .drag-over").forEach(element => {
    element.classList.remove("dragging", "drag-over");
  });
});

document.addEventListener("dragover", event => {
  const lane = event.target.closest?.(".lane");
  if (!lane) return;

  event.preventDefault();
  event.dataTransfer.dropEffect = "move";

  $$(".lane.drag-over").forEach(other => {
    if (other !== lane) other.classList.remove("drag-over");
  });
  lane.classList.add("drag-over");
});

document.addEventListener("dragleave", event => {
  const lane = event.target.closest?.(".lane");

  if (lane && !lane.contains(event.relatedTarget)) {
    lane.classList.remove("drag-over");
  }
});

document.addEventListener("drop", event => {
  const lane = event.target.closest?.(".lane");
  if (!lane || !event.dataTransfer) return;

  event.preventDefault();
  lane.classList.remove("drag-over");
  setStatus(event.dataTransfer.getData("text/plain"), lane.dataset.stage);
});

// ---------- START APPLICATION ----------

function fillStatusOptions() {
  const options = STATUSES.map(status => `<option value="${status}">${status}</option>`).join("");

  $("#statusInput").innerHTML = options;
  $("#statusFilter").insertAdjacentHTML("beforeend", options);
}

fillStatusOptions();
renderAll();
showView();
