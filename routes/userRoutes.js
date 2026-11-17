const express = require('express');
const { timingSafeEqual } = require('crypto');
const router = express.Router();
const User = require('../models/User');

function requireApiKey(req, res, next) {
  const expectedKey = process.env.USER_API_KEY;
  if (!expectedKey) {
    return res.status(503).json({ message: 'User API is not configured' });
  }

  const match = /^Bearer ([^\s]+)$/.exec(req.get('authorization') || '');
  if (!match) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const providedKey = Buffer.from(match[1]);
  const expectedKeyBuffer = Buffer.from(expectedKey);
  if (
    providedKey.length !== expectedKeyBuffer.length ||
    !timingSafeEqual(providedKey, expectedKeyBuffer)
  ) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  next();
}

router.use(requireApiKey);

// Get all users
router.get('/', async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (error) {
    console.error('Failed to retrieve users:', error);
    res.status(500).json({ message: 'Unable to retrieve users' });
  }
});

// Create a user
router.post('/', async (req, res) => {
  try {
    const { name, email } = req.body || {};
    if (
      !req.body ||
      typeof req.body !== 'object' ||
      Array.isArray(req.body) ||
      Object.keys(req.body).some((key) => !['name', 'email'].includes(key)) ||
      typeof name !== 'string' ||
      typeof email !== 'string' ||
      !name.trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ) {
      return res.status(400).json({ message: 'A valid name and email are required' });
    }

    const newUser = new User({ name: name.trim(), email: email.trim().toLowerCase() });
    const savedUser = await newUser.save();
    res.status(201).json({
      id: savedUser.id,
      name: savedUser.name,
      email: savedUser.email,
      createdAt: savedUser.createdAt,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'A user with this email already exists' });
    }
    console.error('Failed to create user:', error);
    res.status(500).json({ message: 'Unable to create user' });
  }
});

module.exports = router;