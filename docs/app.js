const API_BASE = "https://careers10ai.YOUR-SUBDOMAIN.workers.dev";
// Change API_BASE above when the Worker URL is known.

const STUDENT_TOKEN_KEY = "careers10ai.studentToken";
const STUDENT_USER_KEY = "careers10ai.studentUser";

document.addEventListener("DOMContentLoaded", () => {
  initLogoutButtons();

  const page = document.body.dataset.page;
  if (page === "login") {
    initLoginPage();
  }
  if (page === "dashboard") {
    initDashboardPage();
  }
  if (page === "request") {
    initRequestPage();
  }
});

function initLoginPage() {
  const registerForm = byId("registerForm");
  const loginForm = byId("loginForm");

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const resetButton = setLoading(registerForm.querySelector("button"), "Creating...");
    clearMessage("loginMessage");

    try {
      const data = await apiFetch("/api/auth/register", {
        method: "POST",
        auth: false,
        body: {
          realName: fieldValue(registerForm, "realName"),
          username: fieldValue(registerForm, "username"),
          passcode: fieldValue(registerForm, "passcode")
        }
      });
      saveStudentSession(data);
      window.location.href = "dashboard.html";
    } catch (error) {
      showMessage("loginMessage", error.message, "error");
    } finally {
      resetButton();
    }
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const resetButton = setLoading(loginForm.querySelector("button"), "Logging in...");
    clearMessage("loginMessage");

    try {
      const data = await apiFetch("/api/auth/login", {
        method: "POST",
        auth: false,
        body: {
          username: fieldValue(loginForm, "username"),
          passcode: fieldValue(loginForm, "passcode")
        }
      });
      saveStudentSession(data);
      window.location.href = "dashboard.html";
    } catch (error) {
      showMessage("loginMessage", error.message, "error");
    } finally {
      resetButton();
    }
  });
}

async function initDashboardPage() {
  const user = requireStudentSession();
  if (!user) {
    return;
  }

  byId("welcomeName").textContent = `Logged in as ${user.realName || user.username}`;
  const list = byId("requestList");
  renderEmpty(list, "Loading requests...", "Checking your request history.");

  try {
    const me = await apiFetch("/api/me");
    if (me.user) {
      localStorage.setItem(STUDENT_USER_KEY, JSON.stringify(me.user));
      byId("welcomeName").textContent = `Logged in as ${me.user.realName || me.user.username}`;
    }

    const data = await apiFetch("/api/requests");
    renderStudentRequestList(list, data.requests || []);
  } catch (error) {
    showMessage("dashboardMessage", error.message, "error");
    renderEmpty(list, "Requests could not load", "Try logging in again or check the Worker URL in app.js.");
  }
}

function initRequestPage() {
  if (!requireStudentSession()) {
    return;
  }

  const requestId = new URLSearchParams(window.location.search).get("id");
  if (requestId) {
    byId("requestDetailView").hidden = false;
    initRequestDetail(requestId);
  } else {
    byId("newRequestView").hidden = false;
    initNewRequestForm();
  }
}

function initNewRequestForm() {
  const form = byId("requestForm");
  const fileInput = byId("requestFiles");
  const notesContainer = byId("fileNotes");

  fileInput.addEventListener("change", () => {
    renderFileNoteInputs(notesContainer, Array.from(fileInput.files || []));
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage("requestMessage");

    const files = Array.from(fileInput.files || []);
    if (files.length === 0) {
      showMessage("requestMessage", "At least one file is required.", "error");
      return;
    }

    const formData = new FormData();
    formData.append("assignmentTitle", fieldValue(form, "assignmentTitle"));
    formData.append("instructions", fieldValue(form, "instructions"));
    formData.append("requestedOutputs", fieldValue(form, "requestedOutputs"));
    formData.append("tone", fieldValue(form, "tone"));
    formData.append("studentContext", fieldValue(form, "studentContext"));
    formData.append("reviewCheckbox", checkboxValue(form, "reviewCheckbox") ? "true" : "false");
    formData.append("responsibilityCheckbox", checkboxValue(form, "responsibilityCheckbox") ? "true" : "false");

    files.forEach((file) => formData.append("files[]", file));
    notesContainer.querySelectorAll("input").forEach((input) => {
      formData.append("fileNotes[]", input.value.trim());
    });

    const resetButton = setLoading(form.querySelector("button"), "Submitting...");
    try {
      const data = await apiFetch("/api/requests", {
        method: "POST",
        body: formData
      });
      showMessage("requestMessage", "Request submitted.", "success");
      window.location.href = `request.html?id=${encodeURIComponent(data.requestId)}`;
    } catch (error) {
      showMessage("requestMessage", error.message, "error");
    } finally {
      resetButton();
    }
  });
}

async function initRequestDetail(requestId) {
  const container = byId("requestDetail");
  renderEmpty(container, "Loading request...", "Fetching request details and file lists.");

  try {
    const data = await apiFetch(`/api/requests/${encodeURIComponent(requestId)}`);
    renderRequestDetail(requestId, data);
  } catch (error) {
    showMessage("requestMessage", error.message, "error");
    renderEmpty(container, "Request could not load", "This request may not exist or may belong to another account.");
  }
}

function renderStudentRequestList(container, requests) {
  clearElement(container);

  if (requests.length === 0) {
    renderEmpty(container, "No requests yet", "Create a new request when you have files ready.");
    return;
  }

  requests.forEach((request) => {
    const card = element("article", "request-card");
    const header = element("div", "request-card-header");
    const title = element("div", "request-title");
    title.append(
      element("h2", "", request.assignmentTitle || "Untitled request"),
      element("div", "meta-row", `Created ${formatDate(request.createdAt)} | Updated ${formatDate(request.updatedAt)}`)
    );
    header.append(title, statusBadge(request.status));
    card.append(header);

    if (request.adminNote) {
      card.append(element("p", "note-preview", `Admin note: ${trimPreview(request.adminNote)}`));
    }

    const footer = element("div", "request-card-footer");
    footer.append(
      element("span", "muted", `${request.inputFileCount || 0} input files | ${request.outputFileCount || 0} output files`),
      linkButton(`request.html?id=${encodeURIComponent(request.id)}`, "Open", "secondary")
    );
    card.append(footer);
    container.append(card);
  });
}

function renderRequestDetail(requestId, data) {
  const request = data.request;
  const inputFiles = data.inputFiles || [];
  const outputFiles = data.outputFiles || [];
  const container = byId("requestDetail");

  byId("detailTitle").textContent = request.assignmentTitle || "Request";
  byId("detailMeta").textContent = `Created ${formatDate(request.createdAt)} | Updated ${formatDate(request.updatedAt)}`;
  clearElement(container);

  const summary = element("section", "surface detail-stack");
  const header = element("div", "request-card-header");
  header.append(element("h2", "", request.assignmentTitle || "Untitled request"), statusBadge(request.status));
  summary.append(header);

  const grid = element("div", "detail-grid");
  grid.append(
    detailItem("Instructions", request.instructions, true),
    detailItem("Requested outputs", request.requestedOutputs || "Not specified"),
    detailItem("Tone/style", request.tone || "Not specified"),
    detailItem("Student context", request.studentContext || "Not provided", true),
    detailItem("Admin note", request.adminNote || "No admin note yet.", true)
  );
  summary.append(grid);
  container.append(summary);

  container.append(fileSection("Input files", inputFiles, (file) => {
    downloadStudentFile(requestId, file);
  }));
  container.append(fileSection("Output files", outputFiles, (file) => {
    downloadStudentFile(requestId, file);
  }));

  if (request.status === "needs_info" || request.status === "rejected") {
    container.append(reopenSection(requestId));
  }
}

function fileSection(title, files, onDownload) {
  const section = element("section", "surface detail-stack");
  section.append(element("h2", "", title));

  if (!files.length) {
    section.append(element("p", "muted", "No files yet."));
    return section;
  }

  const list = element("div", "file-list");
  files.forEach((file) => {
    const row = element("div", "file-item");
    const main = element("div", "file-main");
    main.append(
      element("strong", "", file.originalFilename || "File"),
      element("p", "muted", file.fileNote || `${formatBytes(file.sizeBytes)}${file.contentType ? ` | ${file.contentType}` : ""}`)
    );
    const button = element("button", "button secondary", "Download");
    button.type = "button";
    button.addEventListener("click", () => onDownload(file));
    row.append(main, button);
    list.append(row);
  });
  section.append(list);
  return section;
}

function reopenSection(requestId) {
  const section = element("section", "surface form-stack");
  section.append(
    element("h2", "", "Add more info and reopen"),
    element("p", "muted", "Add the missing details the admin asked for, then send the request back to the queue.")
  );

  const label = element("label");
  label.append(element("span", "", "Additional info"));
  const textarea = element("textarea");
  textarea.rows = 5;
  label.append(textarea);

  const button = element("button", "button primary", "Reopen request");
  button.type = "button";
  button.addEventListener("click", async () => {
    clearMessage("requestMessage");
    const additionalInfo = textarea.value.trim();
    if (!additionalInfo) {
      showMessage("requestMessage", "Add more info before reopening.", "error");
      return;
    }

    const resetButton = setLoading(button, "Reopening...");
    try {
      await apiFetch(`/api/requests/${encodeURIComponent(requestId)}/reopen`, {
        method: "POST",
        body: { additionalInfo }
      });
      showMessage("requestMessage", "Request reopened.", "success");
      await initRequestDetail(requestId);
    } catch (error) {
      showMessage("requestMessage", error.message, "error");
    } finally {
      resetButton();
    }
  });

  section.append(label, button);
  return section;
}

function renderFileNoteInputs(container, files) {
  clearElement(container);

  files.forEach((file, index) => {
    const label = element("label");
    label.append(element("span", "", `Optional note for ${file.name}`));
    const input = element("input");
    input.type = "text";
    input.name = "fileNotes[]";
    input.placeholder = index === 0 ? "Example: this is my worksheet" : "Optional file note";
    label.append(input);
    container.append(label);
  });
}

async function downloadStudentFile(requestId, file) {
  clearMessage("requestMessage");
  try {
    await downloadWithAuth(
      `/api/requests/${encodeURIComponent(requestId)}/files/${encodeURIComponent(file.id)}/download`,
      file.originalFilename || "download"
    );
  } catch (error) {
    showMessage("requestMessage", error.message, "error");
  }
}

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const requestOptions = {
    method: options.method || "GET",
    headers
  };

  if (options.auth !== false) {
    const token = localStorage.getItem(STUDENT_TOKEN_KEY);
    if (!token) {
      throw new Error("Please log in first.");
    }
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (options.body instanceof FormData) {
    requestOptions.body = options.body;
  } else if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    requestOptions.body = JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(apiUrl(path), requestOptions);
  } catch {
    throw new Error("Could not reach the backend. Check API_BASE in docs/app.js.");
  }

  const data = await readJsonResponse(response);
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

async function downloadWithAuth(path, filename) {
  const token = localStorage.getItem(STUDENT_TOKEN_KEY);
  if (!token) {
    throw new Error("Please log in first.");
  }

  let response;
  try {
    response = await fetch(apiUrl(path), {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
  } catch {
    throw new Error("Could not reach the backend. Check API_BASE in docs/app.js.");
  }

  if (!response.ok) {
    const data = await readJsonResponse(response);
    throw new Error(data.error || "Download failed.");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { ok: response.ok, error: text };
  }
}

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function saveStudentSession(data) {
  localStorage.setItem(STUDENT_TOKEN_KEY, data.token);
  localStorage.setItem(STUDENT_USER_KEY, JSON.stringify(data.user));
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(STUDENT_USER_KEY) || "null");
  } catch {
    return null;
  }
}

function requireStudentSession() {
  const token = localStorage.getItem(STUDENT_TOKEN_KEY);
  const user = getStoredUser();

  if (!token || !user) {
    window.location.href = "login.html";
    return null;
  }

  return user;
}

function initLogoutButtons() {
  document.querySelectorAll("#logoutButton").forEach((button) => {
    button.addEventListener("click", () => {
      localStorage.removeItem(STUDENT_TOKEN_KEY);
      localStorage.removeItem(STUDENT_USER_KEY);
      window.location.href = "login.html";
    });
  });
}

function byId(id) {
  return document.getElementById(id);
}

function fieldValue(form, name) {
  const field = form.elements.namedItem(name);
  return field && "value" in field ? String(field.value).trim() : "";
}

function checkboxValue(form, name) {
  const field = form.elements.namedItem(name);
  return Boolean(field && "checked" in field && field.checked);
}

function clearElement(node) {
  while (node.firstChild) {
    node.firstChild.remove();
  }
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== "") {
    node.textContent = text;
  }
  return node;
}

function linkButton(href, text, tone = "secondary") {
  const link = element("a", `button ${tone}`, text);
  link.href = href;
  return link;
}

function detailItem(label, value, full = false) {
  const item = element("div", `detail-item${full ? " full" : ""}`);
  item.append(element("span", "", label), element("p", "", value || "Not provided"));
  return item;
}

function statusBadge(status) {
  const badge = element("span", `badge ${status || "submitted"}`, formatStatus(status));
  return badge;
}

function formatStatus(status) {
  const labels = {
    submitted: "Submitted",
    needs_info: "Needs info",
    ready: "Ready",
    rejected: "Rejected"
  };
  return labels[status] || "Submitted";
}

function formatDate(value) {
  if (!value) {
    return "unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) {
    return "Size unknown";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function trimPreview(value) {
  const text = String(value || "").trim();
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function showMessage(id, text, tone = "") {
  const node = byId(id);
  node.hidden = false;
  node.className = `message ${tone}`.trim();
  node.textContent = text;
}

function clearMessage(id) {
  const node = byId(id);
  if (!node) {
    return;
  }
  node.hidden = true;
  node.textContent = "";
  node.className = "message";
}

function setLoading(button, label) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = label;

  return () => {
    button.disabled = false;
    button.textContent = originalText;
  };
}

function renderEmpty(container, title, text) {
  clearElement(container);
  const empty = element("div", "empty-state");
  empty.append(element("h2", "", title), element("p", "", text));
  container.append(empty);
}
