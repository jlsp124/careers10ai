type RequestStatus = "submitted" | "needs_info" | "ready" | "rejected";

interface Env {
  DB: D1Database;
  CAREERS_FILES: R2Bucket;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  ALLOWED_ORIGINS: string;
}

interface UserRow {
  id: string;
  real_name: string;
  username: string;
  passcode_hash: string;
  created_at: string;
  updated_at: string;
}

interface RequestRow {
  id: string;
  user_id: string;
  assignment_title: string;
  instructions: string;
  requested_outputs: string | null;
  tone: string | null;
  student_context: string | null;
  status: RequestStatus;
  admin_note: string | null;
  hidden_from_admin: number;
  created_at: string;
  updated_at: string;
}

interface RequestWithCountsRow extends RequestRow {
  input_file_count: number;
  output_file_count: number;
}

interface AdminRequestWithCountsRow extends RequestWithCountsRow {
  real_name: string;
  username: string;
}

interface RequestFileRow {
  id: string;
  request_id: string;
  kind: "input" | "output";
  original_filename: string;
  stored_filename: string;
  content_type: string | null;
  size_bytes: number | null;
  r2_key: string;
  file_note: string | null;
  created_at: string;
}

interface FileDownloadRow extends RequestFileRow {
  user_id: string;
}

interface SessionPayload {
  sub: string;
  username: string;
  iat: number;
  exp: number;
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_INPUT_TOTAL_BYTES = 75 * 1024 * 1024;
const MAX_INPUT_FILES = 10;
const MAX_OUTPUT_FILES = 10;
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const PASSCODE_ITERATIONS = 100_000;

const VALID_STATUSES = new Set<RequestStatus>([
  "submitted",
  "needs_info",
  "ready",
  "rejected"
]);

const ALLOWED_EXTENSIONS = new Set([
  "doc",
  "docx",
  "pdf",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "txt",
  "rtf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "zip"
]);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return handleOptions(request, env);
    }

    const origin = request.headers.get("Origin");
    if (origin && !isAllowedOrigin(env, origin)) {
      return jsonResponse(request, env, { ok: false, error: "Origin not allowed" }, 403);
    }

    try {
      return await routeRequest(request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse(request, env, { ok: false, error: error.message }, error.status);
      }

      console.error(JSON.stringify({ message: "Unhandled Worker error", error: String(error) }));
      return jsonResponse(request, env, { ok: false, error: "Internal server error" }, 500);
    }
  }
} satisfies ExportedHandler<Env>;

async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);

  if (request.method === "POST" && path === "/api/auth/register") {
    return registerStudent(request, env);
  }

  if (request.method === "POST" && path === "/api/auth/login") {
    return loginStudent(request, env);
  }

  if (request.method === "GET" && path === "/api/me") {
    const user = await requireStudent(request, env);
    return jsonResponse(request, env, { ok: true, user: publicUser(user) });
  }

  if (request.method === "POST" && path === "/api/requests") {
    const user = await requireStudent(request, env);
    return createStudentRequest(request, env, user);
  }

  if (request.method === "GET" && path === "/api/requests") {
    const user = await requireStudent(request, env);
    return listStudentRequests(request, env, user);
  }

  const parts = path.split("/").filter(Boolean);

  if (parts[0] === "api" && parts[1] === "requests" && parts[2]) {
    const requestId = parts[2];

    if (request.method === "GET" && parts.length === 3) {
      const user = await requireStudent(request, env);
      return getStudentRequest(request, env, user, requestId);
    }

    if (request.method === "POST" && parts.length === 4 && parts[3] === "reopen") {
      const user = await requireStudent(request, env);
      return reopenStudentRequest(request, env, user, requestId);
    }

    if (
      request.method === "GET" &&
      parts.length === 6 &&
      parts[3] === "files" &&
      parts[5] === "download"
    ) {
      const user = await requireStudent(request, env);
      return downloadStudentFile(request, env, user, requestId, parts[4]);
    }
  }

  if (parts[0] === "api" && parts[1] === "admin") {
    await requireAdmin(request, env);

    if (request.method === "GET" && parts.length === 3 && parts[2] === "requests") {
      return listAdminRequests(request, env);
    }

    if (parts[2] === "requests" && parts[3]) {
      const requestId = parts[3];

      if (request.method === "GET" && parts.length === 4) {
        return getAdminRequest(request, env, requestId);
      }

      if (
        request.method === "GET" &&
        parts.length === 7 &&
        parts[4] === "files" &&
        parts[6] === "download"
      ) {
        return downloadAdminFile(request, env, requestId, parts[5]);
      }

      if (request.method === "POST" && parts.length === 5 && parts[4] === "output") {
        return uploadAdminOutput(request, env, requestId);
      }

      if (request.method === "PATCH" && parts.length === 4) {
        return patchAdminRequest(request, env, requestId);
      }

      if (request.method === "POST" && parts.length === 5 && parts[4] === "reject") {
        return rejectAdminRequest(request, env, requestId);
      }
    }
  }

  throw new HttpError(404, "Not found");
}

async function registerStudent(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const realName = requiredString(body, "realName", "Real name is required");
  const username = normalizeUsername(requiredString(body, "username", "Username is required"));
  const passcode = requiredString(body, "passcode", "Passcode is required", false);

  if (passcode.length < 4) {
    throw new HttpError(400, "Passcode must be at least 4 characters");
  }

  const now = nowIso();
  const userId = crypto.randomUUID();
  const passcodeHash = await hashPasscode(passcode);

  try {
    await env.DB.prepare(
      `INSERT INTO users (id, real_name, username, passcode_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(userId, realName, username, passcodeHash, now, now)
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HttpError(409, "Username is already taken");
    }
    throw error;
  }

  const user: UserRow = {
    id: userId,
    real_name: realName,
    username,
    passcode_hash: passcodeHash,
    created_at: now,
    updated_at: now
  };
  const token = await createSessionToken(user, requiredEnvSecret(env.SESSION_SECRET, "SESSION_SECRET"));

  return jsonResponse(request, env, { ok: true, token, user: publicUser(user) });
}

async function loginStudent(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const username = normalizeUsername(requiredString(body, "username", "Username is required"));
  const passcode = requiredString(body, "passcode", "Passcode is required", false);

  const user = await env.DB.prepare("SELECT * FROM users WHERE username = ?")
    .bind(username)
    .first<UserRow>();

  if (!user || !(await verifyPasscode(passcode, user.passcode_hash))) {
    throw new HttpError(401, "Invalid username or passcode");
  }

  const token = await createSessionToken(user, requiredEnvSecret(env.SESSION_SECRET, "SESSION_SECRET"));
  return jsonResponse(request, env, { ok: true, token, user: publicUser(user) });
}

async function createStudentRequest(
  request: Request,
  env: Env,
  user: UserRow
): Promise<Response> {
  const form = await request.formData();
  const assignmentTitle = requiredFormString(form, "assignmentTitle", "Assignment title is required");
  const instructions = requiredFormString(form, "instructions", "Instructions are required");
  const requestedOutputs = optionalFormString(form, "requestedOutputs");
  const tone = optionalFormString(form, "tone");
  const studentContext = optionalFormString(form, "studentContext");
  const reviewCheckbox = trueishFormValue(form, "reviewCheckbox");
  const responsibilityCheckbox = trueishFormValue(form, "responsibilityCheckbox");
  const files = getFormFiles(form);
  const fileNotes = getFormStringList(form, "fileNotes");

  if (!reviewCheckbox) {
    throw new HttpError(400, "Review checkbox must be checked");
  }

  if (!responsibilityCheckbox) {
    throw new HttpError(400, "Responsibility checkbox must be checked");
  }

  validateFiles(files, {
    minCount: 1,
    maxCount: MAX_INPUT_FILES,
    maxTotalBytes: MAX_INPUT_TOTAL_BYTES
  });

  const requestId = crypto.randomUUID();
  const now = nowIso();
  const uploadedKeys: string[] = [];
  const insertedFileIds: string[] = [];

  try {
    await env.DB.prepare(
      `INSERT INTO requests (
        id, user_id, assignment_title, instructions, requested_outputs, tone,
        student_context, status, admin_note, hidden_from_admin, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        requestId,
        user.id,
        assignmentTitle,
        instructions,
        nullableText(requestedOutputs),
        nullableText(tone),
        nullableText(studentContext),
        "submitted",
        null,
        0,
        now,
        now
      )
      .run();

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const fileId = crypto.randomUUID();
      const originalFilename = file.name;
      const storedFilename = sanitizeFilename(originalFilename);
      const r2Key = inputR2Key(user.id, requestId, fileId, storedFilename);
      const contentType = nullableText(file.type);
      const note = nullableText(fileNotes[index] ?? "");

      await env.CAREERS_FILES.put(r2Key, file.stream(), {
        httpMetadata: contentType ? { contentType } : undefined
      });
      uploadedKeys.push(r2Key);

      await env.DB.prepare(
        `INSERT INTO request_files (
          id, request_id, kind, original_filename, stored_filename, content_type,
          size_bytes, r2_key, file_note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          fileId,
          requestId,
          "input",
          originalFilename,
          storedFilename,
          contentType,
          file.size,
          r2Key,
          note,
          now
        )
        .run();
      insertedFileIds.push(fileId);
    }
  } catch (error) {
    await cleanupFailedRequest(env, requestId, uploadedKeys, insertedFileIds);
    throw error;
  }

  return jsonResponse(request, env, { ok: true, requestId, status: "submitted" });
}

async function listStudentRequests(
  request: Request,
  env: Env,
  user: UserRow
): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT
      r.*,
      (SELECT COUNT(*) FROM request_files WHERE request_id = r.id AND kind = 'input') AS input_file_count,
      (SELECT COUNT(*) FROM request_files WHERE request_id = r.id AND kind = 'output') AS output_file_count
     FROM requests r
     WHERE r.user_id = ?
     ORDER BY r.created_at DESC`
  )
    .bind(user.id)
    .all<RequestWithCountsRow>();

  return jsonResponse(request, env, {
    ok: true,
    requests: result.results.map(publicRequestSummary)
  });
}

async function getStudentRequest(
  request: Request,
  env: Env,
  user: UserRow,
  requestId: string
): Promise<Response> {
  const requestRow = await findOwnedRequest(env, requestId, user.id);
  const files = await listFilesForRequest(env, requestId);

  return jsonResponse(request, env, {
    ok: true,
    request: publicRequestDetail(requestRow),
    inputFiles: files.filter((file) => file.kind === "input").map(publicFile),
    outputFiles: files.filter((file) => file.kind === "output").map(publicFile)
  });
}

async function reopenStudentRequest(
  request: Request,
  env: Env,
  user: UserRow,
  requestId: string
): Promise<Response> {
  const requestRow = await findOwnedRequest(env, requestId, user.id);

  if (requestRow.status !== "rejected" && requestRow.status !== "needs_info") {
    throw new HttpError(400, "Only rejected or needs_info requests can be reopened");
  }

  const body = await readJsonObject(request);
  const additionalInfo = requiredString(body, "additionalInfo", "Additional info is required");
  const now = nowIso();
  const appendedContext = appendAdditionalInfo(requestRow.student_context, additionalInfo, now);

  await env.DB.prepare(
    `UPDATE requests
     SET student_context = ?, status = ?, hidden_from_admin = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  )
    .bind(appendedContext, "submitted", 0, now, requestId, user.id)
    .run();

  return jsonResponse(request, env, { ok: true, requestId, status: "submitted" });
}

async function downloadStudentFile(
  request: Request,
  env: Env,
  user: UserRow,
  requestId: string,
  fileId: string
): Promise<Response> {
  const file = await env.DB.prepare(
    `SELECT rf.*, r.user_id
     FROM request_files rf
     JOIN requests r ON r.id = rf.request_id
     WHERE rf.id = ? AND rf.request_id = ? AND r.user_id = ?`
  )
    .bind(fileId, requestId, user.id)
    .first<FileDownloadRow>();

  if (!file) {
    throw new HttpError(404, "File not found");
  }

  return downloadFileFromR2(request, env, file);
}

async function listAdminRequests(request: Request, env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT
      r.*,
      u.real_name,
      u.username,
      (SELECT COUNT(*) FROM request_files WHERE request_id = r.id AND kind = 'input') AS input_file_count,
      (SELECT COUNT(*) FROM request_files WHERE request_id = r.id AND kind = 'output') AS output_file_count
     FROM requests r
     JOIN users u ON u.id = r.user_id
     WHERE r.hidden_from_admin = 0
     ORDER BY r.created_at ASC`
  ).all<AdminRequestWithCountsRow>();

  return jsonResponse(request, env, {
    ok: true,
    requests: result.results.map(publicAdminRequestSummary)
  });
}

async function getAdminRequest(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT
      r.*,
      u.real_name,
      u.username
     FROM requests r
     JOIN users u ON u.id = r.user_id
     WHERE r.id = ?`
  )
    .bind(requestId)
    .first<RequestRow & { real_name: string; username: string }>();

  if (!row) {
    throw new HttpError(404, "Request not found");
  }

  const files = await listFilesForRequest(env, requestId);
  const inputFiles = files.filter((file) => file.kind === "input");
  const outputFiles = files.filter((file) => file.kind === "output");
  const user = {
    id: row.user_id,
    realName: row.real_name,
    username: row.username
  };

  return jsonResponse(request, env, {
    ok: true,
    request: publicAdminRequestDetail(row),
    user,
    inputFiles: inputFiles.map(publicAdminFile),
    outputFiles: outputFiles.map(publicAdminFile),
    gptPrompt: generateGptPrompt(row, user, inputFiles, outputFiles)
  });
}

async function downloadAdminFile(
  request: Request,
  env: Env,
  requestId: string,
  fileId: string
): Promise<Response> {
  const file = await env.DB.prepare(
    `SELECT rf.*, r.user_id
     FROM request_files rf
     JOIN requests r ON r.id = rf.request_id
     WHERE rf.id = ? AND rf.request_id = ?`
  )
    .bind(fileId, requestId)
    .first<FileDownloadRow>();

  if (!file) {
    throw new HttpError(404, "File not found");
  }

  return downloadFileFromR2(request, env, file);
}

async function uploadAdminOutput(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  const requestRow = await findRequest(env, requestId);
  const form = await request.formData();
  const files = getFormFiles(form);
  const fileNotes = getFormStringList(form, "fileNotes");

  validateFiles(files, {
    minCount: 1,
    maxCount: MAX_OUTPUT_FILES
  });

  const existingOutputCount = await countFiles(env, requestId, "output");
  if (existingOutputCount + files.length > MAX_OUTPUT_FILES) {
    throw new HttpError(400, `A request can have at most ${MAX_OUTPUT_FILES} output files`);
  }

  const now = nowIso();
  const uploadedKeys: string[] = [];
  const insertedFileIds: string[] = [];

  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const fileId = crypto.randomUUID();
      const originalFilename = file.name;
      const storedFilename = sanitizeFilename(originalFilename);
      const r2Key = outputR2Key(requestRow.user_id, requestId, fileId, storedFilename);
      const contentType = nullableText(file.type);
      const note = nullableText(fileNotes[index] ?? "");

      await env.CAREERS_FILES.put(r2Key, file.stream(), {
        httpMetadata: contentType ? { contentType } : undefined
      });
      uploadedKeys.push(r2Key);

      await env.DB.prepare(
        `INSERT INTO request_files (
          id, request_id, kind, original_filename, stored_filename, content_type,
          size_bytes, r2_key, file_note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          fileId,
          requestId,
          "output",
          originalFilename,
          storedFilename,
          contentType,
          file.size,
          r2Key,
          note,
          now
        )
        .run();
      insertedFileIds.push(fileId);
    }

    await env.DB.prepare("UPDATE requests SET status = ?, updated_at = ? WHERE id = ?")
      .bind("ready", now, requestId)
      .run();
  } catch (error) {
    await cleanupFailedFiles(env, uploadedKeys, insertedFileIds);
    throw error;
  }

  return jsonResponse(request, env, {
    ok: true,
    requestId,
    status: "ready",
    outputFileCount: existingOutputCount + files.length
  });
}

async function patchAdminRequest(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  await findRequest(env, requestId);

  const body = await readJsonObject(request);
  const updates: string[] = [];
  const values: unknown[] = [];

  if (Object.hasOwn(body, "status")) {
    const status = requiredString(body, "status", "Status is required");
    if (!isRequestStatus(status)) {
      throw new HttpError(400, "Invalid status");
    }
    updates.push("status = ?");
    values.push(status);
  }

  if (Object.hasOwn(body, "adminNote")) {
    const adminNoteValue = body.adminNote;
    if (adminNoteValue !== null && typeof adminNoteValue !== "string") {
      throw new HttpError(400, "Admin note must be text");
    }
    updates.push("admin_note = ?");
    values.push(nullableText(adminNoteValue ?? ""));
  }

  if (Object.hasOwn(body, "hiddenFromAdmin")) {
    updates.push("hidden_from_admin = ?");
    values.push(booleanish(body.hiddenFromAdmin) ? 1 : 0);
  }

  if (updates.length === 0) {
    throw new HttpError(400, "No valid fields to update");
  }

  const now = nowIso();
  updates.push("updated_at = ?");
  values.push(now, requestId);

  await env.DB.prepare(`UPDATE requests SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  return jsonResponse(request, env, { ok: true, requestId });
}

async function rejectAdminRequest(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  await findRequest(env, requestId);

  const body = await readJsonObject(request);
  const adminNote = requiredString(body, "adminNote", "Admin note is required");
  const now = nowIso();

  await env.DB.prepare(
    `UPDATE requests
     SET status = ?, admin_note = ?, hidden_from_admin = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind("rejected", adminNote, 1, now, requestId)
    .run();

  return jsonResponse(request, env, { ok: true, requestId, status: "rejected" });
}

async function requireStudent(request: Request, env: Env): Promise<UserRow> {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    throw new HttpError(401, "Student authorization token is required");
  }

  const payload = await verifySessionToken(match[1], requiredEnvSecret(env.SESSION_SECRET, "SESSION_SECRET"));
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(payload.sub)
    .first<UserRow>();

  if (!user) {
    throw new HttpError(401, "Invalid session");
  }

  return user;
}

async function requireAdmin(request: Request, env: Env): Promise<void> {
  const providedPassword = request.headers.get("x-admin-password") ?? "";

  const adminPassword = requiredEnvSecret(env.ADMIN_PASSWORD, "ADMIN_PASSWORD");

  if (!providedPassword || !constantTimeEqualText(providedPassword, adminPassword)) {
    throw new HttpError(401, "Admin password is required");
  }
}

async function createSessionToken(user: UserRow, secret: string): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64UrlEncodeJson({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlEncodeJson({
    sub: user.id,
    username: user.username,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_TTL_SECONDS
  } satisfies SessionPayload);
  const signature = await signHmac(`${header}.${payload}`, secret);

  return `${header}.${payload}.${signature}`;
}

async function verifySessionToken(token: string, secret: string): Promise<SessionPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new HttpError(401, "Invalid session");
  }

  const [header, payload, signature] = parts;
  const expectedSignature = await signHmac(`${header}.${payload}`, secret);

  if (!constantTimeEqualText(signature, expectedSignature)) {
    throw new HttpError(401, "Invalid session");
  }

  let decoded: unknown;
  try {
    decoded = decodeBase64UrlJson(payload);
  } catch {
    throw new HttpError(401, "Invalid session");
  }
  if (!isSessionPayload(decoded) || decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new HttpError(401, "Invalid session");
  }

  return decoded;
}

async function hashPasscode(passcode: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hashBytes = await derivePasscodeBytes(passcode, salt, PASSCODE_ITERATIONS);

  return [
    "pbkdf2-sha256",
    String(PASSCODE_ITERATIONS),
    base64UrlEncodeBytes(salt),
    base64UrlEncodeBytes(hashBytes)
  ].join("$");
}

async function verifyPasscode(passcode: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") {
    return false;
  }

  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isSafeInteger(iterations) || iterations < 10_000) {
    return false;
  }

  try {
    const salt = base64UrlDecodeBytes(parts[2]);
    const expectedHash = base64UrlDecodeBytes(parts[3]);
    const actualHash = await derivePasscodeBytes(passcode, salt, iterations);

    return constantTimeEqualBytes(actualHash, expectedHash);
  } catch {
    return false;
  }
}

async function derivePasscodeBytes(
  passcode: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(passcode),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations
    },
    keyMaterial,
    256
  );

  return new Uint8Array(derivedBits);
}

async function signHmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(value));

  return base64UrlEncodeBytes(new Uint8Array(signature));
}

async function findOwnedRequest(
  env: Env,
  requestId: string,
  userId: string
): Promise<RequestRow> {
  const row = await env.DB.prepare("SELECT * FROM requests WHERE id = ? AND user_id = ?")
    .bind(requestId, userId)
    .first<RequestRow>();

  if (!row) {
    throw new HttpError(404, "Request not found");
  }

  return row;
}

async function findRequest(env: Env, requestId: string): Promise<RequestRow> {
  const row = await env.DB.prepare("SELECT * FROM requests WHERE id = ?")
    .bind(requestId)
    .first<RequestRow>();

  if (!row) {
    throw new HttpError(404, "Request not found");
  }

  return row;
}

async function listFilesForRequest(env: Env, requestId: string): Promise<RequestFileRow[]> {
  const result = await env.DB.prepare(
    `SELECT *
     FROM request_files
     WHERE request_id = ?
     ORDER BY created_at ASC`
  )
    .bind(requestId)
    .all<RequestFileRow>();

  return result.results;
}

async function countFiles(
  env: Env,
  requestId: string,
  kind: "input" | "output"
): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM request_files WHERE request_id = ? AND kind = ?"
  )
    .bind(requestId, kind)
    .first<{ count: number }>();

  return row?.count ?? 0;
}

async function downloadFileFromR2(
  request: Request,
  env: Env,
  file: RequestFileRow
): Promise<Response> {
  const object = await env.CAREERS_FILES.get(file.r2_key);

  if (!object) {
    throw new HttpError(404, "Stored file not found");
  }

  const headers = new Headers({
    "content-type": file.content_type || "application/octet-stream",
    "content-disposition": contentDispositionAttachment(file.original_filename)
  });

  if (file.size_bytes !== null && file.size_bytes >= 0) {
    headers.set("content-length", String(file.size_bytes));
  }

  applyCorsHeaders(headers, request, env);
  return new Response(object.body, { status: 200, headers });
}

async function cleanupFailedRequest(
  env: Env,
  requestId: string,
  uploadedKeys: string[],
  insertedFileIds: string[]
): Promise<void> {
  await cleanupFailedFiles(env, uploadedKeys, insertedFileIds);
  await env.DB.prepare("DELETE FROM requests WHERE id = ?").bind(requestId).run().catch(logCleanupError);
}

async function cleanupFailedFiles(
  env: Env,
  uploadedKeys: string[],
  insertedFileIds: string[]
): Promise<void> {
  if (uploadedKeys.length > 0) {
    await env.CAREERS_FILES.delete(uploadedKeys).catch(logCleanupError);
  }

  for (const fileId of insertedFileIds) {
    await env.DB.prepare("DELETE FROM request_files WHERE id = ?")
      .bind(fileId)
      .run()
      .catch(logCleanupError);
  }
}

function logCleanupError(error: unknown): void {
  console.error(JSON.stringify({ message: "Cleanup failed", error: String(error) }));
}

function validateFiles(
  files: File[],
  options: { minCount: number; maxCount: number; maxTotalBytes?: number }
): void {
  if (files.length < options.minCount) {
    throw new HttpError(400, "At least one file is required");
  }

  if (files.length > options.maxCount) {
    throw new HttpError(400, `A request can include at most ${options.maxCount} files`);
  }

  let totalBytes = 0;
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      throw new HttpError(400, `File ${file.name} is larger than 25 MB`);
    }

    const extension = fileExtension(file.name);
    if (!extension || !ALLOWED_EXTENSIONS.has(extension)) {
      throw new HttpError(400, `File ${file.name} has an unsupported file type`);
    }

    totalBytes += file.size;
  }

  if (options.maxTotalBytes !== undefined && totalBytes > options.maxTotalBytes) {
    throw new HttpError(400, "Total input upload size cannot exceed 75 MB");
  }
}

function getFormFiles(form: FormData): File[] {
  const values: unknown[] = [...form.getAll("files[]"), ...form.getAll("files")];
  return values.filter((value): value is File => isFileValue(value) && value.name.trim() !== "");
}

function isFileValue(value: unknown): value is File {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { name?: unknown; size?: unknown; stream?: unknown };
  return (
    typeof candidate.name === "string" &&
    typeof candidate.size === "number" &&
    typeof candidate.stream === "function"
  );
}

function getFormStringList(form: FormData, key: string): string[] {
  const values = [...form.getAll(`${key}[]`), ...form.getAll(key)];
  return values.map((value) => (typeof value === "string" ? value.trim() : ""));
}

function requiredFormString(form: FormData, key: string, message: string): string {
  const value = optionalFormString(form, key);
  if (!value) {
    throw new HttpError(400, message);
  }
  return value;
}

function optionalFormString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function trueishFormValue(form: FormData, key: string): boolean {
  const value = form.get(key);
  return typeof value === "string" ? isTrueish(value) : value !== null;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;

  try {
    parsed = await request.json();
  } catch {
    throw new HttpError(400, "Valid JSON body is required");
  }

  if (!isRecord(parsed)) {
    throw new HttpError(400, "JSON body must be an object");
  }

  return parsed;
}

function requiredString(
  body: Record<string, unknown>,
  key: string,
  message: string,
  trim = true
): string {
  const value = body[key];
  if (typeof value !== "string") {
    throw new HttpError(400, message);
  }

  const text = trim ? value.trim() : value;
  if (!text) {
    throw new HttpError(400, message);
  }

  return text;
}

function requiredEnvSecret(value: string, name: string): string {
  if (!value) {
    throw new HttpError(500, `${name} is not configured`);
  }

  return value;
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequestStatus(value: string): value is RequestStatus {
  return VALID_STATUSES.has(value as RequestStatus);
}

function isSessionPayload(value: unknown): value is SessionPayload {
  return (
    isRecord(value) &&
    typeof value.sub === "string" &&
    typeof value.username === "string" &&
    typeof value.iat === "number" &&
    typeof value.exp === "number"
  );
}

function isTrueish(value: string): boolean {
  return ["true", "1", "yes", "on", "checked"].includes(value.trim().toLowerCase());
}

function booleanish(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return isTrueish(value);
  }
  return false;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function inputR2Key(
  userId: string,
  requestId: string,
  fileId: string,
  safeFilename: string
): string {
  return `users/${userId}/requests/${requestId}/inputs/${fileId}-${safeFilename}`;
}

function outputR2Key(
  userId: string,
  requestId: string,
  fileId: string,
  safeFilename: string
): string {
  return `users/${userId}/requests/${requestId}/outputs/${fileId}-${safeFilename}`;
}

function sanitizeFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? "file";
  const normalized = basename
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return normalized || "file";
}

function fileExtension(filename: string): string | null {
  const safe = sanitizeFilename(filename);
  const index = safe.lastIndexOf(".");
  if (index <= 0 || index === safe.length - 1) {
    return null;
  }
  return safe.slice(index + 1).toLowerCase();
}

function contentDispositionAttachment(filename: string): string {
  const fallback = sanitizeFilename(filename).replace(/"/g, "");
  const encoded = encodeURIComponent(filename.replace(/[\r\n]/g, " "));
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function appendAdditionalInfo(
  existingContext: string | null,
  additionalInfo: string,
  timestamp: string
): string {
  const prefix = existingContext?.trim() ? `${existingContext.trim()}\n\n` : "";
  return `${prefix}[Additional info added ${timestamp}]\n${additionalInfo}`;
}

function publicUser(user: UserRow): { id: string; realName: string; username: string } {
  return {
    id: user.id,
    realName: user.real_name,
    username: user.username
  };
}

function publicRequestSummary(row: RequestWithCountsRow): Record<string, unknown> {
  return {
    id: row.id,
    assignmentTitle: row.assignment_title,
    status: row.status,
    adminNote: row.admin_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    inputFileCount: Number(row.input_file_count),
    outputFileCount: Number(row.output_file_count)
  };
}

function publicRequestDetail(row: RequestRow): Record<string, unknown> {
  return {
    id: row.id,
    assignmentTitle: row.assignment_title,
    instructions: row.instructions,
    requestedOutputs: row.requested_outputs,
    tone: row.tone,
    studentContext: row.student_context,
    status: row.status,
    adminNote: row.admin_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicAdminRequestSummary(row: AdminRequestWithCountsRow): Record<string, unknown> {
  return {
    id: row.id,
    assignmentTitle: row.assignment_title,
    status: row.status,
    hiddenFromAdmin: row.hidden_from_admin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    inputFileCount: Number(row.input_file_count),
    outputFileCount: Number(row.output_file_count),
    user: {
      id: row.user_id,
      realName: row.real_name,
      username: row.username
    }
  };
}

function publicAdminRequestDetail(row: RequestRow): Record<string, unknown> {
  return {
    id: row.id,
    userId: row.user_id,
    assignmentTitle: row.assignment_title,
    instructions: row.instructions,
    requestedOutputs: row.requested_outputs,
    tone: row.tone,
    studentContext: row.student_context,
    status: row.status,
    adminNote: row.admin_note,
    hiddenFromAdmin: row.hidden_from_admin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicFile(file: RequestFileRow): Record<string, unknown> {
  return {
    id: file.id,
    kind: file.kind,
    originalFilename: file.original_filename,
    contentType: file.content_type,
    sizeBytes: file.size_bytes,
    fileNote: file.file_note,
    createdAt: file.created_at
  };
}

function publicAdminFile(file: RequestFileRow): Record<string, unknown> {
  return {
    ...publicFile(file),
    storedFilename: file.stored_filename
  };
}

function generateGptPrompt(
  request: RequestRow,
  user: { realName: string; username: string },
  inputFiles: RequestFileRow[],
  outputFiles: RequestFileRow[]
): string {
  const fileList = inputFiles
    .map((file, index) => `${index + 1}. ${file.original_filename}${file.file_note ? ` - ${file.file_note}` : ""}`)
    .join("\n");
  const outputList = outputFiles
    .map((file, index) => `${index + 1}. ${file.original_filename}${file.file_note ? ` - ${file.file_note}` : ""}`)
    .join("\n");

  return [
    "You are helping with a high-school careers-class assignment.",
    "",
    "Required working rules:",
    "- Do not use personal memories or assumptions about the student.",
    "- Use only the uploaded files and request details.",
    "- Do not invent personal experiences.",
    "- If important info is missing, ask clearly.",
    "- If safe assumptions are needed, state them.",
    "- Keep the work appropriate for Grade 10 careers class.",
    "- Include a Student Review Notes section listing what the student must check, personalize, or verify.",
    "",
    "Request details:",
    `- Student name: ${user.realName}`,
    `- Username: ${user.username}`,
    `- Assignment title: ${request.assignment_title}`,
    `- Instructions: ${request.instructions}`,
    `- Requested outputs: ${request.requested_outputs ?? "Not specified"}`,
    `- Tone: ${request.tone ?? "Not specified"}`,
    `- Student context: ${request.student_context ?? "Not provided"}`,
    "",
    "Uploaded input files:",
    fileList || "No input files listed.",
    "",
    "Already uploaded output files:",
    outputList || "No output files uploaded yet.",
    "",
    "Your response must include:",
    "1. The requested assignment work or a clear request for missing information.",
    "2. A Student Review Notes section with specific items the student must check, personalize, or verify."
  ].join("\n");
}

function jsonResponse(
  request: Request,
  env: Env,
  payload: unknown,
  status = 200
): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  applyCorsHeaders(headers, request, env);
  return new Response(JSON.stringify(payload), { status, headers });
}

function handleOptions(request: Request, env: Env): Response {
  const origin = request.headers.get("Origin");
  if (origin && !isAllowedOrigin(env, origin)) {
    return jsonResponse(request, env, { ok: false, error: "Origin not allowed" }, 403);
  }

  const headers = new Headers();
  applyCorsHeaders(headers, request, env);
  headers.set("access-control-max-age", "86400");

  return new Response(null, { status: 204, headers });
}

function applyCorsHeaders(headers: Headers, request: Request, env: Env): void {
  const origin = request.headers.get("Origin");
  headers.set("vary", "Origin");

  if (!origin || !isAllowedOrigin(env, origin)) {
    return;
  }

  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET, POST, PATCH, OPTIONS");
  headers.set("access-control-allow-headers", "content-type, authorization, x-admin-password");
}

function isAllowedOrigin(env: Env, origin: string): boolean {
  return env.ALLOWED_ORIGINS.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(origin);
}

function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncodeBytes(textEncoder.encode(JSON.stringify(value)));
}

function decodeBase64UrlJson(value: string): unknown {
  return JSON.parse(textDecoder.decode(base64UrlDecodeBytes(value)));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecodeBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "="
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function constantTimeEqualText(a: string, b: string): boolean {
  return constantTimeEqualBytes(textEncoder.encode(a), textEncoder.encode(b));
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  const maxLength = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;

  for (let index = 0; index < maxLength; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }

  return difference === 0;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("unique");
}
