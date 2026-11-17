const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  createHash,
  randomBytes,
  scrypt: scryptCallback,
  timingSafeEqual,
} = require('crypto');
const { promisify } = require('util');
const User = require('../models/User');
const Session = require('../models/Session');

const router = express.Router();
const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'pb_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const REMEMBERED_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_HASH_LENGTH = 64;
const DUMMY_PASSWORD_HASH = `scrypt$16384$8$1$${'0'.repeat(32)}$${'0'.repeat(PASSWORD_HASH_LENGTH * 2)}`;
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again later.' },
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return isRecord(value) && Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isValidEmail(email) {
  return typeof email === 'string'
    && email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function toPublicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    dateOfBirth: user.dateOfBirth || '',
    createdAt: user.createdAt,
  };
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, PASSWORD_HASH_LENGTH, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${Buffer.from(derivedKey).toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== '16384' || parts[2] !== '8' || parts[3] !== '1') {
    return false;
  }

  const salt = Buffer.from(parts[4], 'hex');
  const expectedKey = Buffer.from(parts[5], 'hex');
  if (salt.length !== 16 || expectedKey.length !== PASSWORD_HASH_LENGTH) {
    return false;
  }

  const derivedKey = await scrypt(password, salt, PASSWORD_HASH_LENGTH, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(Buffer.from(derivedKey), expectedKey);
}

function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function sessionCookieOptions() {
  const sameSite = process.env.AUTH_COOKIE_SAME_SITE || 'lax';
  if (!['lax', 'strict', 'none'].includes(sameSite.toLowerCase())) {
    throw new Error('AUTH_COOKIE_SAME_SITE must be lax, strict, or none');
  }

  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || sameSite.toLowerCase() === 'none',
    sameSite: sameSite.toLowerCase(),
    path: '/api/auth',
  };
}

function getSessionToken(req) {
  const cookie = (req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return cookie ? cookie.slice(SESSION_COOKIE.length + 1) : '';
}

async function createSession(user, rememberMe, res) {
  const token = randomBytes(32).toString('hex');
  const ttl = rememberMe ? REMEMBERED_SESSION_TTL_MS : SESSION_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);
  await Session.create({
    userId: user._id,
    tokenHash: hashSessionToken(token),
    expiresAt,
  });

  const cookieOptions = sessionCookieOptions();
  if (rememberMe) cookieOptions.maxAge = ttl;
  res.cookie(SESSION_COOKIE, token, cookieOptions);
}

async function requireSession(req, res, next) {
  try {
    const token = getSessionToken(req);
    if (!token) {
      return res.status(401).json({ message: 'Please sign in to continue.' });
    }

    const session = await Session.findOne({
      tokenHash: hashSessionToken(token),
      expiresAt: { $gt: new Date() },
    });
    if (!session) {
      res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
      return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
    }

    const user = await User.findById(session.userId);
    if (!user) {
      await Session.deleteOne({ _id: session._id });
      res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
      return res.status(401).json({ message: 'Your session is no longer valid. Please sign in again.' });
    }

    req.authUser = user;
    req.authSession = session;
    return next();
  } catch (error) {
    return next(error);
  }
}

router.post('/register', authRateLimit, async (req, res) => {
  const { name, email, password } = req.body || {};
  if (
    !hasOnlyKeys(req.body, ['name', 'email', 'password'])
    || typeof name !== 'string'
    || !name.trim()
    || name.trim().length > 80
    || !isValidEmail(email)
    || typeof password !== 'string'
    || password.length < 8
    || password.length > 128
  ) {
    return res.status(400).json({ message: 'Enter your name, a valid email, and a password of at least 8 characters.' });
  }

  try {
    const user = new User({
      name: name.trim(),
      email: normalizeEmail(email),
      passwordHash: await hashPassword(password),
    });
    await user.save();
    await createSession(user, false, res);
    return res.status(201).json({ user: toPublicUser(user) });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }
    console.error('Account registration failed:', error.name);
    return res.status(500).json({ message: 'We could not create your account. Please try again.' });
  }
});

router.post('/login', authRateLimit, async (req, res) => {
  const { email, password, rememberMe = false } = req.body || {};
  if (
    !hasOnlyKeys(req.body, ['email', 'password', 'rememberMe'])
    || !isValidEmail(email)
    || typeof password !== 'string'
    || password.length > 128
    || typeof rememberMe !== 'boolean'
  ) {
    return res.status(400).json({ message: 'Enter a valid email address and password.' });
  }

  try {
    const user = await User.findOne({ email: normalizeEmail(email) }).select('+passwordHash');
    const passwordMatches = await verifyPassword(password, user?.passwordHash || DUMMY_PASSWORD_HASH);
    if (!user || !passwordMatches) {
      return res.status(401).json({ message: 'Email or password is incorrect.' });
    }

    await createSession(user, rememberMe, res);
    return res.json({ user: toPublicUser(user) });
  } catch (error) {
    console.error('Account sign-in failed:', error.name);
    return res.status(500).json({ message: 'We could not sign you in. Please try again.' });
  }
});

router.get('/me', (req, res, next) => {
  if (!getSessionToken(req)) {
    return res.json({ user: null });
  }
  return requireSession(req, res, () => {
    res.json({ user: toPublicUser(req.authUser) });
  });
});

router.put('/me', requireSession, async (req, res) => {
  const updates = req.body;
  if (!hasOnlyKeys(updates, ['name', 'email', 'phone', 'dateOfBirth']) || !Object.keys(updates).length) {
    return res.status(400).json({ message: 'Enter valid profile details.' });
  }

  if (updates.name !== undefined && (typeof updates.name !== 'string' || !updates.name.trim() || updates.name.trim().length > 80)) {
    return res.status(400).json({ message: 'Name must be between 1 and 80 characters.' });
  }
  if (updates.email !== undefined && !isValidEmail(updates.email)) {
    return res.status(400).json({ message: 'Enter a valid email address.' });
  }
  if (updates.phone !== undefined && (typeof updates.phone !== 'string' || updates.phone.length > 30)) {
    return res.status(400).json({ message: 'Phone number must be 30 characters or fewer.' });
  }
  if (updates.dateOfBirth !== undefined && (
    typeof updates.dateOfBirth !== 'string'
    || (updates.dateOfBirth !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(updates.dateOfBirth))
  )) {
    return res.status(400).json({ message: 'Enter a valid date of birth.' });
  }

  try {
    if (updates.name !== undefined) req.authUser.name = updates.name.trim();
    if (updates.email !== undefined) req.authUser.email = normalizeEmail(updates.email);
    if (updates.phone !== undefined) req.authUser.phone = updates.phone.trim();
    if (updates.dateOfBirth !== undefined) req.authUser.dateOfBirth = updates.dateOfBirth;
    await req.authUser.save();
    return res.json({ user: toPublicUser(req.authUser) });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }
    console.error('Profile update failed:', error.name);
    return res.status(500).json({ message: 'We could not update your profile. Please try again.' });
  }
});

router.put('/password', authRateLimit, requireSession, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (
    !hasOnlyKeys(req.body, ['currentPassword', 'newPassword'])
    || typeof currentPassword !== 'string'
    || typeof newPassword !== 'string'
    || newPassword.length < 8
    || newPassword.length > 128
  ) {
    return res.status(400).json({ message: 'Your new password must be at least 8 characters.' });
  }

  try {
    const user = await User.findById(req.authUser._id).select('+passwordHash');
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      return res.status(400).json({ message: 'Your current password is incorrect.' });
    }

    user.passwordHash = await hashPassword(newPassword);
    await user.save();
    await Session.deleteMany({ userId: user._id });
    await createSession(user, false, res);
    return res.json({ message: 'Your password has been updated.' });
  } catch (error) {
    console.error('Password update failed:', error.name);
    return res.status(500).json({ message: 'We could not update your password. Please try again.' });
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const token = getSessionToken(req);
    if (token) {
      await Session.deleteOne({ tokenHash: hashSessionToken(token) });
    }
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
