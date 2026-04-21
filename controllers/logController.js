const asyncHandler = require("express-async-handler");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function resolveConfiguredLogDir() {
  const configuredDir = process.env.LOG_DIR || process.env.LOGS_DIR;

  if (configuredDir) {
    return path.isAbsolute(configuredDir)
      ? path.resolve(configuredDir)
      : path.resolve(PROJECT_ROOT, configuredDir);
  }

  const logsDir = path.resolve(PROJECT_ROOT, "logs");
  const logDir = path.resolve(PROJECT_ROOT, "log");

  if (fs.existsSync(logsDir)) {
    return logsDir;
  }

  if (fs.existsSync(logDir)) {
    return logDir;
  }

  return logsDir;
}

function toRelativeLogDir(logDir) {
  const relative = path.relative(PROJECT_ROOT, logDir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return logDir;
  }
  return relative.replace(/\\/g, "/");
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function getSafeLogFilePath(filename) {
  const logDir = resolveConfiguredLogDir();
  const requestedName = typeof filename === "string" ? filename.trim() : "";

  if (!requestedName || requestedName.includes("\0")) {
    const error = new Error("Valid log filename is required.");
    error.statusCode = 400;
    throw error;
  }

  if (requestedName.includes("/") || requestedName.includes("\\") || path.basename(requestedName) !== requestedName) {
    const error = new Error("Invalid log filename.");
    error.statusCode = 400;
    throw error;
  }

  const filePath = path.resolve(logDir, requestedName);
  const relativePath = path.relative(logDir, filePath);

  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    const error = new Error("Invalid log filename.");
    error.statusCode = 400;
    throw error;
  }

  return { logDir, filePath, filename: requestedName };
}

const listLogFiles = asyncHandler(async (req, res) => {
  const logDir = resolveConfiguredLogDir();

  let entries;
  try {
    entries = await fsp.readdir(logDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.status(200).json({
        success: true,
        message: "Log folder does not exist yet.",
        data: {
          folder: toRelativeLogDir(logDir),
          count: 0,
          files: [],
        },
      });
    }
    throw error;
  }

  const files = [];

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith(".")) {
      continue;
    }

    const filePath = path.join(logDir, entry.name);
    const stats = await fsp.lstat(filePath);

    files.push({
      name: entry.name,
      size: stats.size,
      size_label: formatBytes(stats.size),
      modified_at: stats.mtime.toISOString(),
      download_url: `${req.baseUrl}/logs/${encodeURIComponent(entry.name)}/download`,
    });
  }

  files.sort((a, b) => new Date(b.modified_at) - new Date(a.modified_at));

  return res.status(200).json({
    success: true,
    message: "Log files fetched successfully.",
    data: {
      folder: toRelativeLogDir(logDir),
      count: files.length,
      files,
    },
  });
});

const downloadLogFile = asyncHandler(async (req, res) => {
  let logFile;

  try {
    logFile = getSafeLogFilePath(req.params.filename);
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }

  let stats;
  try {
    stats = await fsp.lstat(logFile.filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.status(404).json({
        success: false,
        message: "Log file not found.",
      });
    }
    throw error;
  }

  if (!stats.isFile()) {
    return res.status(404).json({
      success: false,
      message: "Log file not found.",
    });
  }

  return res.download(logFile.filePath, logFile.filename);
});

module.exports = {
  listLogFiles,
  downloadLogFile,
};
