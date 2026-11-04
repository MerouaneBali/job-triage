const MS_MINUTE = 6e4;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;
const MS_WEEK = 7 * MS_DAY;
const MS_MONTH = 30 * MS_DAY;

function formatAgo(iso, now = new Date()) {
  if (!iso) return "—";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  const diff = Math.max(0, now.getTime() - t.getTime());
  if (diff < MS_MINUTE) return "just now";
  if (diff < MS_HOUR) {
    const n = Math.floor(diff / MS_MINUTE);
    return `${n} minute${n === 1 ? "" : "s"} ago`;
  }
  if (diff < MS_DAY) {
    const n = Math.floor(diff / MS_HOUR);
    return `${n} hour${n === 1 ? "" : "s"} ago`;
  }
  if (diff < MS_WEEK) {
    const n = Math.floor(diff / MS_DAY);
    return `${n} day${n === 1 ? "" : "s"} ago`;
  }
  if (diff < MS_MONTH) {
    const n = Math.floor(diff / MS_WEEK);
    return `${n} week${n === 1 ? "" : "s"} ago`;
  }
  const n = Math.floor(diff / MS_MONTH);
  return `${n} month${n === 1 ? "" : "s"} ago`;
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function companyInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function companyCell(j) {
  const name = j.company || "—";
  const initials = esc(companyInitials(name));
  const logo = j.logoUrl
    ? `<img class="logo" src="${esc(j.logoUrl)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'" /><span class="logo fallback" style="display:none">${initials}</span>`
    : `<span class="logo fallback">${initials}</span>`;
  return `<div class="company">${logo}<span class="company-name">${esc(name)}</span></div>`;
}

function descriptionCell(j) {
  if (!j.description) {
    return `<span class="pill off">${esc(j.detailStatus || "missing")}</span>`;
  }
  const short =
    j.description.length > 160
      ? `${j.description.slice(0, 160)}…`
      : j.description;
  return `<details class="desc"><summary>${esc(short)}</summary><pre>${esc(
    j.description
  )}</pre></details>`;
}

function decisionPill(decision) {
  if (!decision) return `<span class="pill off">—</span>`;
  const cls =
    decision === "apply"
      ? "pill yes"
      : decision === "maybe"
        ? "pill maybe"
        : "pill off";
  return `<span class="${cls}">${esc(decision)}</span>`;
}

function aiNotesCell(j) {
  const parts = [];
  if (j.recommendation) parts.push(j.recommendation);
  if (j.qualifyReasons?.length) {
    parts.push("Qualify: " + j.qualifyReasons.join(", "));
  }
  if (j.materials?.outreachMessage) {
    parts.push("Outreach:\n" + j.materials.outreachMessage);
  }
  if (j.materials?.coverLetter) {
    parts.push("Cover letter:\n" + j.materials.coverLetter);
  }
  if (!parts.length) return `<span class="muted">—</span>`;
  const summary = (j.recommendation || parts[0]).slice(0, 120);
  return `<details class="desc"><summary>${esc(summary)}${
    summary.length >= 120 ? "…" : ""
  }</summary><pre>${esc(parts.join("\n\n"))}</pre></details>`;
}

/** Normalize legacy array JSON or { jobs, …meta } payloads. */
function normalizeDump(raw, fallbackName) {
  if (Array.isArray(raw)) {
    return {
      dumpedAt: null,
      parsedAt: null,
      source: fallbackName,
      jobs: raw,
    };
  }
  return {
    dumpedAt: raw.dumpedAt ?? null,
    parsedAt: raw.parsedAt ?? null,
    source: raw.source ?? fallbackName,
    jobs: Array.isArray(raw.jobs) ? raw.jobs : [],
  };
}

const state = {
  dumps: [],
  currentName: null,
  data: null,
  selected: new Set(),
  visibleIds: [],
};

const el = {
  meta: document.getElementById("meta"),
  selectionMeta: document.getElementById("selection-meta"),
  dumpSelect: document.getElementById("dumpSelect"),
  refreshDumps: document.getElementById("refreshDumps"),
  tbody: document.getElementById("tbody"),
  empty: document.getElementById("empty"),
  q: document.getElementById("q"),
  easyOnly: document.getElementById("easyOnly"),
  salaryOnly: document.getElementById("salaryOnly"),
  hasDesc: document.getElementById("hasDesc"),
  applyMaybe: document.getElementById("applyMaybe"),
  selectAll: document.getElementById("selectAll"),
  openSelected: document.getElementById("openSelected"),
  clearSel: document.getElementById("clearSel"),
};

function filteredJobs() {
  if (!state.data) return [];
  const q = el.q.value.trim().toLowerCase();
  return state.data.jobs.filter((j) => {
    if (el.easyOnly.checked && !j.easyApply) return false;
    if (el.salaryOnly.checked && !j.salary) return false;
    if (el.hasDesc.checked && !j.description) return false;
    if (
      el.applyMaybe.checked &&
      j.decision !== "apply" &&
      j.decision !== "maybe"
    ) {
      return false;
    }
    if (!q) return true;
    const hay = `${j.title || ""} ${j.company || ""} ${j.description || ""} ${j.recommendation || ""}`.toLowerCase();
    return hay.includes(q);
  });
}

function updateSelectionMeta() {
  const n = state.selected.size;
  el.selectionMeta.textContent = n ? `${n} selected` : "";
  el.openSelected.disabled = n === 0;
  const vis = state.visibleIds;
  el.selectAll.checked =
    vis.length > 0 && vis.every((id) => state.selected.has(id));
  el.selectAll.indeterminate =
    vis.some((id) => state.selected.has(id)) && !el.selectAll.checked;
}

function renderMeta() {
  if (!state.data) {
    el.meta.textContent = state.dumps.length
      ? "Pick a dump to triage."
      : "No JSON in data/stage1/. Run stage-1 parse first.";
    return;
  }
  const d = state.data;
  const withDesc = d.jobs.filter((j) => j.description).length;
  const apply = d.jobs.filter((j) => j.decision === "apply").length;
  const maybe = d.jobs.filter((j) => j.decision === "maybe").length;
  el.meta.textContent = [
    `${d.jobs.length} jobs`,
    `${withDesc} with description`,
    `apply ${apply} / maybe ${maybe}`,
    d.dumpedAt ? `dumped ${d.dumpedAt}` : null,
    d.source ? `source ${d.source}` : null,
    state.currentName ? `file ${state.currentName}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function renderTable() {
  const now = new Date();
  const rows = filteredJobs();
  state.visibleIds = rows.map((j) => j.id);
  el.tbody.innerHTML = rows
    .map((j) => {
      const checked = state.selected.has(j.id) ? " checked" : "";
      const sel = state.selected.has(j.id) ? " selected" : "";
      return (
        `<tr class="${sel.trim()}" data-id="${esc(j.id)}">` +
        `<td class="check"><input type="checkbox" data-row${checked} /></td>` +
        `<td>${decisionPill(j.decision)}</td>` +
        `<td>${j.fitScore == null ? "—" : esc(String(j.fitScore))}</td>` +
        `<td class="title">${esc(j.title || "—")}</td>` +
        `<td>${companyCell(j)}</td>` +
        `<td>${esc(j.location || "—")}</td>` +
        `<td class="muted">${esc(j.salary || "—")}</td>` +
        `<td>${esc(formatAgo(j.postedAt, now))}</td>` +
        `<td>${
          j.easyApply
            ? '<span class="pill">Yes</span>'
            : '<span class="pill off">No</span>'
        }</td>` +
        `<td class="desc-cell">${descriptionCell(j)}</td>` +
        `<td class="desc-cell">${aiNotesCell(j)}</td>` +
        `<td><a href="${esc(j.url)}" target="_blank" rel="noopener">Open</a></td>` +
        `</tr>`
      );
    })
    .join("");
  el.empty.hidden = !state.data || rows.length > 0;
  if (state.data && rows.length === 0) {
    el.empty.textContent = "No jobs match these filters.";
    el.empty.hidden = false;
  } else if (!state.data) {
    el.empty.textContent = "Select a dump above.";
    el.empty.hidden = false;
  }
  updateSelectionMeta();
}

function render() {
  renderMeta();
  renderTable();
}

function fillDumpSelect() {
  const prev = state.currentName;
  el.dumpSelect.innerHTML = state.dumps
    .map(
      (d) =>
        `<option value="${esc(d.name)}">${esc(d.name)} (${d.jobCount ?? "?"} jobs, ${d.detailsOk ?? 0} desc, apply ${d.stage3Apply ?? 0})</option>`
    )
    .join("");
  if (!state.dumps.length) {
    el.dumpSelect.innerHTML = `<option value="">No dumps</option>`;
    return;
  }
  const pick =
    (prev && state.dumps.some((d) => d.name === prev) && prev) ||
    state.dumps[0].name;
  el.dumpSelect.value = pick;
}

async function loadDumpList() {
  const res = await fetch("/api/dumps");
  if (!res.ok) throw new Error(`Failed to list dumps (${res.status})`);
  const body = await res.json();
  state.dumps = body.dumps || [];
  fillDumpSelect();
  if (state.dumps.length) {
    await loadDump(el.dumpSelect.value);
  } else {
    state.currentName = null;
    state.data = null;
    state.selected.clear();
    render();
  }
}

async function loadDump(name) {
  if (!name) return;
  const res = await fetch(`/api/dumps/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Failed to load ${name} (${res.status})`);
  const raw = await res.json();
  state.currentName = name;
  state.data = normalizeDump(raw, name);
  state.selected.clear();
  render();
}

el.tbody.addEventListener("change", (e) => {
  const input = e.target.closest("input[data-row]");
  if (!input) return;
  const tr = input.closest("tr");
  const id = tr?.dataset.id;
  if (!id) return;
  if (input.checked) state.selected.add(id);
  else state.selected.delete(id);
  tr.classList.toggle("selected", input.checked);
  updateSelectionMeta();
});

el.selectAll.addEventListener("change", () => {
  const on = el.selectAll.checked;
  for (const id of state.visibleIds) {
    if (on) state.selected.add(id);
    else state.selected.delete(id);
  }
  renderTable();
});

el.clearSel.addEventListener("click", () => {
  state.selected.clear();
  renderTable();
});

el.openSelected.addEventListener("click", async () => {
  if (!state.data) return;
  const urls = state.data.jobs
    .filter((j) => state.selected.has(j.id))
    .map((j) => j.url)
    .filter(Boolean);
  if (!urls.length) return;
  let opened = 0;
  for (const url of urls) {
    const w = window.open(url, "_blank");
    if (w) opened += 1;
    await new Promise((r) => setTimeout(r, 180));
  }
  if (opened < urls.length) {
    alert(
      `Opened ${opened} of ${urls.length} tabs. Allow popups for this origin and try again.`
    );
  }
});

el.dumpSelect.addEventListener("change", () => {
  loadDump(el.dumpSelect.value).catch((err) => {
    el.meta.textContent = String(err.message || err);
  });
});

el.refreshDumps.addEventListener("click", () => {
  loadDumpList().catch((err) => {
    el.meta.textContent = String(err.message || err);
  });
});

for (const node of [el.q, el.easyOnly, el.salaryOnly, el.hasDesc, el.applyMaybe]) {
  node.addEventListener("input", renderTable);
  node.addEventListener("change", renderTable);
}

loadDumpList().catch((err) => {
  el.meta.textContent = String(err.message || err);
});
