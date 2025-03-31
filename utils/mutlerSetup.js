const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname); // get file extension
    const uniqueName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });
module.exports = upload;