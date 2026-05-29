const API_BASE = "https://careers10ai.YOUR-SUBDOMAIN.workers.dev";
// Change API_BASE above when the Worker URL is known.

const ADMIN_PASSWORD_KEY = "careers10ai.adminPassword";
const STATUS_OPTIONS = ["submitted", "needs_info", "ready", "rejected"];

const adminState = {
  requests: [],
  selectedId: null
};

document.addEventListener("DOMContentLoaded", () => {
  initAdminPage();
});

function initAdminPage() {
  const passwordInput = byId("adminPassword");
  const savedPassword = sessionStorage.getItem(ADMIN_PASSWORD_KEY);
  if (savedPassword) {
    passwordInput.value = savedPassword;
  }

  byId("loadAdminRequests").addEventListener("click", () => {
    const password = passwordInput.value.trim();
    if (password) {
      sessionStorage.setItem(ADMIN_PASSWORD_KEY, password);
    }
    loadAdminRequests();
  });

  byId("adminSearch").addEventListener("input", renderAdminRequestList);
  byId("adminStatusFilter").addEventListener("change", renderAdminRequestList);
}

async function loadAdminRequests() {
  clearMessage("adminMessage");
  const list = byId("adminRequestList");
  renderEmpty(list, "Loading queue...", "Checking requests that are visible to admin.");
  const resetButton = setLoading(byId("loadAdminRequests"), "Loading...");

  try {
    const data = await adminFetch("/api/admin/requests");
    adminState.requests = data.requests || [];
    renderAdminRequestList();
    if (adminState.requests.length === 0) {
      renderEmpty(byId("adminDetail"), "No request selected", "The admin queue is empty.");
    }
  } catch (error) {
    showMessage("adminMessage", error.message, "error");
    renderEmpty(list, "Queue could not load", "Check the admin password and Worker URL in admin.js.");
  } finally {
    resetButton();
  }
}

function renderAdminRequestList() {
  const list = byId("adminRequestList");
  clearElement(list);

  const search = byId("adminSearch").value.trim().toLowerCase();
  const status = byId("adminStatusFilter").value;
  const filtered = adminState.requests.filter((request) => {
    const target = [
      request.assignmentTitle,
      request.status,
      request.user && request.user.realName,
      request.user && request.user.username
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (!status || request.status === status) && (!search || target.includes(search));
  });

  if (filtered.length === 0) {
    renderEmpty(list, "No matching requests", "Adjust the search or status filter.");
    return;
  }

  filtered.forEach((request) => {
    const card = element("article", "request-card");
    const header = element("div", "request-card-header");
    const title = element("div", "request-title");
    title.append(
      element("h3", "", request.assignmentTitle || "Untitled request"),
      element("div", "meta-row", `${request.user?.realName || "Student"} | ${request.user?.username || "username"}`)
    );
    header.append(title, statusBadge(request.status));

    const meta = element(
      "div",
      "meta-row",
      `Created ${formatDate(request.createdAt)} | Updated ${formatDate(request.updatedAt)}`
    );
    const counts = element(
      "p",
      "muted",
      `${request.inputFileCount || 0} input files | ${request.outputFileCount || 0} output files`
    );
    const footer = element("div", "request-card-footer");
    const button = element("button", "button secondary", "Open/manage");
    button.type = "button";
    button.addEventListener("click", () => openAdminRequest(request.id));
    footer.append(counts, button);

    card.append(header, meta, footer);
    list.append(card);
  });
}

async function openAdminRequest(requestId) {
  adminState.selectedId = requestId;
  clearMessage("adminMessage");
  renderEmpty(byId("adminDetail"), "Loading request...", "Fetching full request details.");

  try {
    const data = await adminFetch(`/api/admin/requests/${encodeURIComponent(requestId)}`);
    renderAdminDetail(data);
  } catch (error) {
    showMessage("adminMessage", error.message, "error");
    renderEmpty(byId("adminDetail"), "Request could not load", "It may have been hidden or removed.");
  }
}

function renderAdminDetail(data) {
  const request = data.request;
  const user = data.user || {};
  const inputFiles = data.inputFiles || [];
  const outputFiles = data.outputFiles || [];
  const container = byId("adminDetail");
  clearElement(container);

  const summary = element("section", "surface detail-stack");
  const header = element("div", "request-card-header");
  header.append(
    element("h2", "", request.assignmentTitle || "Untitled request"),
    statusBadge(request.status)
  );
  summary.append(header);

  const grid = element("div", "detail-grid");
  grid.append(
    detailItem("Student", `${user.realName || "Student"} (${user.username || "username"})`),
    detailItem("Created", formatDate(request.createdAt)),
    detailItem("Updated", formatDate(request.updatedAt)),
    detailItem("Instructions", request.instructions, true),
    detailItem("Requested outputs", request.requestedOutputs || "Not specified", true),
    detailItem("Tone/style", request.tone || "Not specified"),
    detailItem("Student context", request.studentContext || "Not provided", true),
    detailItem("Admin note", request.adminNote || "No admin note yet.", true)
  );
  summary.append(grid);
  container.append(summary);

  container.append(fileSection("Input files", inputFiles, (file) => {
    downloadAdminFile(request.id, file);
  }));
  container.append(fileSection("Output files", outputFiles, (file) => {
    downloadAdminFile(request.id, file);
  }));
  container.append(promptSection(data.gptPrompt || ""));
  container.append(manageSection(request));
  container.append(outputUploadSection(request.id));
}

function promptSection(promptText) {
  const section = element("section", "surface form-stack");
  section.append(
    element("h2", "", "Generated GPT prompt"),
    element("p", "muted", "Copy this prompt and use it with the uploaded files outside this app.")
  );
  const textarea = element("textarea", "copy-box");
  textarea.readOnly = true;
  textarea.value = promptText;
  section.append(textarea);

  const button = element("button", "button primary", "Copy GPT prompt");
  button.type = "button";
  button.addEventListener("click", async () => {
    try {
      await copyText(promptText, textarea);
      showMessage("adminMessage", "GPT prompt copied.", "success");
    } catch (error) {
      showMessage("adminMessage", error.message, "error");
    }
  });
  section.append(button);
  return section;
}

function manageSection(request) {
  const section = element("section", "surface form-stack");
  section.append(element("h2", "", "Manage request"));

  const statusLabel = element("label");
  statusLabel.append(element("span", "", "Status"));
  const statusSelect = element("select");
  STATUS_OPTIONS.forEach((status) => {
    const option = element("option", "", formatStatus(status));
    option.value = status;
    statusSelect.append(option);
  });
  statusSelect.value = request.status || "submitted";
  statusLabel.append(statusSelect);

  const noteLabel = element("label");
  noteLabel.append(element("span", "", "Admin note"));
  const noteInput = element("textarea");
  noteInput.rows = 5;
  noteInput.value = request.adminNote || "";
  noteLabel.append(noteInput);

  const hiddenLabel = element("label", "check-row");
  const hiddenInput = element("input");
  hiddenInput.type = "checkbox";
  hiddenInput.checked = Boolean(request.hiddenFromAdmin);
  hiddenLabel.append(hiddenInput, element("span", "", "Hide from admin queue"));

  const actions = element("div", "admin-actions");
  const saveButton = element("button", "button primary", "Save changes");
  saveButton.type = "button";
  saveButton.addEventListener("click", async () => {
    const resetButton = setLoading(saveButton, "Saving...");
    clearMessage("adminMessage");

    try {
      await adminFetch(`/api/admin/requests/${encodeURIComponent(request.id)}`, {
        method: "PATCH",
        body: {
          status: statusSelect.value,
          adminNote: noteInput.value,
          hiddenFromAdmin: hiddenInput.checked
        }
      });
      showMessage("adminMessage", "Request updated.", "success");
      await refreshAdminAfterChange(request.id);
    } catch (error) {
      showMessage("adminMessage", error.message, "error");
    } finally {
      resetButton();
    }
  });

  const rejectButton = element("button", "button danger", "Reject and hide");
  rejectButton.type = "button";
  rejectButton.addEventListener("click", async () => {
    clearMessage("adminMessage");
    const adminNote = noteInput.value.trim();
    if (!adminNote) {
      showMessage("adminMessage", "Add an admin note before rejecting.", "error");
      return;
    }
    if (!window.confirm("Reject this request and hide it from the admin queue?")) {
      return;
    }

    const resetButton = setLoading(rejectButton, "Rejecting...");
    try {
      await adminFetch(`/api/admin/requests/${encodeURIComponent(request.id)}/reject`, {
        method: "POST",
        body: { adminNote }
      });
      showMessage("adminMessage", "Request rejected and hidden from admin queue.", "success");
      await refreshAdminAfterChange(request.id);
    } catch (error) {
      showMessage("adminMessage", error.message, "error");
    } finally {
      resetButton();
    }
  });

  actions.append(saveButton, rejectButton);
  section.append(statusLabel, noteLabel, hiddenLabel, actions);
  return section;
}

function outputUploadSection(requestId) {
  const section = element("section", "surface form-stack");
  section.append(
    element("h2", "", "Upload finished files"),
    element("p", "muted", "Add one or more output files. Uploading sets the request status to ready.")
  );

  const fileLabel = element("label");
  fileLabel.append(element("span", "", "Output files"));
  const fileInput = element("input");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileLabel.append(fileInput);

  const notes = element("div", "file-note-list");
  fileInput.addEventListener("change", () => {
    renderFileNoteInputs(notes, Array.from(fileInput.files || []));
  });

  const uploadButton = element("button", "button primary", "Upload output files");
  uploadButton.type = "button";
  uploadButton.addEventListener("click", async () => {
    clearMessage("adminMessage");
    const files = Array.from(fileInput.files || []);
    if (files.length === 0) {
      showMessage("adminMessage", "Choose at least one output file.", "error");
      return;
    }

    const formData = new FormData();
    files.forEach((file) => formData.append("files[]", file));
    notes.querySelectorAll("input").forEach((input) => {
      formData.append("fileNotes[]", input.value.trim());
    });

    const resetButton = setLoading(uploadButton, "Uploading...");
    try {
      await adminFetch(`/api/admin/requests/${encodeURIComponent(requestId)}/output`, {
        method: "POST",
        body: formData
      });
      showMessage("adminMessage", "Output files uploaded.", "success");
      await refreshAdminAfterChange(requestId);
    } catch (error) {
      showMessage("adminMessage", error.message, "error");
    } finally {
      resetButton();
    }
  });

  section.append(fileLabel, notes, uploadButton);
  return section;
}

async function refreshAdminAfterChange(requestId) {
  const data = await adminFetch("/api/admin/requests");
  adminState.requests = data.requests || [];
  renderAdminRequestList();
  await openAdminRequest(requestId);
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

function renderFileNoteInputs(container, files) {
  clearElement(container);

  files.forEach((file, index) => {
    const label = element("label");
    label.append(element("span", "", `Optional note for ${file.name}`));
    const input = element("input");
    input.type = "text";
    input.name = "fileNotes[]";
    input.placeholder = index === 0 ? "Example: finished DOCX" : "Optional file note";
    label.append(input);
    container.append(label);
  });
}

async function downloadAdminFile(requestId, file) {
  clearMessage("adminMessage");
  try {
    await downloadWithAdminPassword(
      `/api/admin/requests/${encodeURIComponent(requestId)}/files/${encodeURIComponent(file.id)}/download`,
      file.originalFilename || "download"
    );
  } catch (error) {
    showMessage("adminMessage", error.message, "error");
  }
}

async function adminFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const requestOptions = {
    method: options.method || "GET",
    headers
  };

  headers.set("x-admin-password", getAdminPassword());

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
    throw new Error("Could not reach the backend. Check API_BASE in docs/admin.js.");
  }

  const data = await readJsonResponse(response);
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

async function downloadWithAdminPassword(path, filename) {
  let response;
  try {
    response = await fetch(apiUrl(path), {
      headers: {
        "x-admin-password": getAdminPassword()
      }
    });
  } catch {
    throw new Error("Could not reach the backend. Check API_BASE in docs/admin.js.");
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

function getAdminPassword() {
  const inputValue = byId("adminPassword").value.trim();
  const storedValue = sessionStorage.getItem(ADMIN_PASSWORD_KEY) || "";
  const password = inputValue || storedValue;

  if (!password) {
    throw new Error("Admin password is required.");
  }

  sessionStorage.setItem(ADMIN_PASSWORD_KEY, password);
  return password;
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

async function copyText(text, fallbackTextarea) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  fallbackTextarea.focus();
  fallbackTextarea.select();
  if (!document.execCommand("copy")) {
    throw new Error("Copy failed. Select the prompt text and copy it manually.");
  }
}

function byId(id) {
  return document.getElementById(id);
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

function detailItem(label, value, full = false) {
  const item = element("div", `detail-item${full ? " full" : ""}`);
  item.append(element("span", "", label), element("p", "", value || "Not provided"));
  return item;
}

function statusBadge(status) {
  return element("span", `badge ${status || "submitted"}`, formatStatus(status));
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
