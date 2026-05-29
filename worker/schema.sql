CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  real_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  passcode_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  assignment_title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  requested_outputs TEXT,
  tone TEXT,
  student_context TEXT,
  status TEXT NOT NULL,
  admin_note TEXT,
  hidden_from_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS request_files (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER,
  r2_key TEXT NOT NULL,
  file_note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(request_id) REFERENCES requests(id)
);

CREATE INDEX IF NOT EXISTS idx_requests_user_id ON requests(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_request_files_request_id ON request_files(request_id);
