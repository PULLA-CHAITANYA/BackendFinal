import bcrypt from 'bcryptjs';
import { Router } from 'express';
import Joi from 'joi';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer'; // For sending emails
import { config } from '../config.js';
import { getDb } from '../lib/mongo.js';

const router = Router();

// Schemas
const schemaSignup = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  role: Joi.string().valid('admin', 'provider').required(),
  providerId: Joi.string().allow('', null) // required only for providers
});
const schemaLogin = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

// Forgot Password Route
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const db = getDb();
  const users = db.collection('Users');

  // Check if user exists
  const user = await users.findOne({ email });
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Create a reset token (JWT) that expires in 1 hour
  const resetToken = jwt.sign({ email }, config.jwtSecret, { expiresIn: '1h' });

  // Send reset token via email
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: config.emailUser,
      pass: config.emailPassword
    }
  });

  const mailOptions = {
    from: config.emailUser,
    to: email,
    subject: 'Password Reset Request',
    text: `To reset your password, use the following link: 
    ${config.frontendUrl}/reset-password?token=${resetToken}`
  };

  transporter.sendMail(mailOptions, (err, info) => {
    if (err) {
      console.error("Error sending email: ", err);  // Log email sending errors
      return res.status(500).json({ error: 'Failed to send email' });
    }
    console.log('Password reset email sent to:', email);  // Log success for debugging
    res.status(200).json({ message: 'Password reset email sent' });
  });
});

// Reset Password Route
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;

  try {
    // Verify the reset token
    const decoded = jwt.verify(token, config.jwtSecret);
    const db = getDb();
    const users = db.collection('Users');

    // Find the user by email
    const user = await users.findOne({ email: decoded.email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Hash the new password
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update the user's password
    await users.updateOne({ email: decoded.email }, { $set: { passwordHash } });

    res.status(200).json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error("Error resetting password: ", err);  // Log errors if token is invalid
    res.status(400).json({ error: 'Invalid or expired token' });
  }
});

// Signup Route
router.post('/signup', async (req, res) => {
  try {
    const body = await schemaSignup.validateAsync(req.body);
    const db = getDb();
    const users = db.collection('Users');

    if (body.role === 'provider' && !body.providerId) {
      return res.status(400).json({ error: 'providerId is required for provider role' });
    }

    const exists = await users.findOne({ email: body.email });
    if (exists) return res.status(409).json({ error: 'Email already exists' });

    const passwordHash = await bcrypt.hash(body.password, 10);
    const doc = {
      _id: body.email,           // convenience
      email: body.email,
      passwordHash,
      role: body.role,
      providerId: body.role === 'provider' ? body.providerId : null,
      createdAt: new Date()
    };

    await users.insertOne(doc);
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Login Route
router.post('/login', async (req, res) => {
  try {
    const body = await schemaLogin.validateAsync(req.body);
    const db = getDb();
    const users = db.collection('Users');

    const user = await users.findOne({ email: body.email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(body.password, user.passwordHash || '');
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { email: user.email, role: user.role, providerId: user.providerId || null },
      config.jwtSecret,
      { expiresIn: '12h' }
    );
    res.json({ 
      token, 
      role: user.role, 
      providerId: user.providerId || null 
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
