const multer = require('multer');
const path = require('path');

// Configure storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

// File filter - Accept multiple CSV MIME types
const fileFilter = (req, file, cb) => {
  const csvMimeTypes = [
    'text/csv',
    'text/comma-separated-values',
    'application/csv',
    'application/vnd.ms-excel',
    'text/plain' // Some systems send CSV as text/plain
  ];
  
  const fileExtension = path.extname(file.originalname).toLowerCase();
  
  if (csvMimeTypes.includes(file.mimetype) || fileExtension === '.csv') {
    cb(null, true);
  } else {
    cb(new Error('Only CSV files are allowed!'), false);
  }
};

// Create multer upload instance
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

module.exports = upload; 