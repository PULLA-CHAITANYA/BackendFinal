import 'dotenv/config';

export const config = {
  mongoUri: process.env.MONGO_URI,
  dbName: process.env.DB_NAME || 'ClaimsDB',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  port: Number(process.env.PORT || 3000),

  collections: {
    users: 'Users',
    existingClaims: 'ExistingClaims',
    newClaims: 'NewClaims'
  },
  emailUser: process.env.EMAIL_USER,       // Your Gmail (or SMTP) user
  emailPassword: process.env.EMAIL_PASS,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  // Azure ML Scoring
  mlUrl: process.env.ML_URL || '',
  mlKey: process.env.ML_KEY || ''
};
