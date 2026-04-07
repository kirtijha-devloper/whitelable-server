const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const LOGIN_POPUP_UPLOAD_DIR = process.env.NODE_ENV === 'test'
  ? path.join('uploads', 'test-login-popups')
  : path.join('uploads', 'login-popups');

function ensureUploadDirExists() {
  if (!fs.existsSync(LOGIN_POPUP_UPLOAD_DIR)) {
    fs.mkdirSync(LOGIN_POPUP_UPLOAD_DIR, { recursive: true });
  }
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    ensureUploadDirExists();
    cb(null, LOGIN_POPUP_UPLOAD_DIR);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const uniqueName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    cb(null, uniqueName);
  },
});

const allowedMimeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const allowedExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

  if (allowedMimeTypes.has(file.mimetype) || allowedExts.has(ext)) {
    return cb(null, true);
  }

  return cb(new Error('Only PNG, JPG, JPEG, WEBP, and GIF images are allowed.'), false);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

function loginPopupUpload(req, res, next) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();

  if (!contentType.includes('multipart/form-data')) {
    return next();
  }

  return upload.single('image')(req, res, next);
}

module.exports = {
  loginPopupUpload,
  LOGIN_POPUP_UPLOAD_DIR,
};
