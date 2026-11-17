const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Session = require('../models/Session');
const authRoutes = require('../routes/authRoutes');

test('registers accounts, authenticates sessions, and revokes them on logout', async (t) => {
  const users = new Map();
  const sessions = new Map();
  const originals = {
    userSave: User.prototype.save,
    findOne: User.findOne,
    findById: User.findById,
    createSession: Session.create,
    findSession: Session.findOne,
    deleteSession: Session.deleteOne,
    deleteUserSessions: Session.deleteMany,
  };

  User.prototype.save = async function save() {
    const duplicate = [...users.values()].some((user) => user.email === this.email && !user._id.equals(this._id));
    if (duplicate) throw Object.assign(new Error('duplicate'), { code: 11000 });
    this.createdAt ||= new Date();
    users.set(this._id.toString(), this);
    return this;
  };
  User.findOne = (query) => ({
    select: async () => [...users.values()].find((user) => user.email === query.email) || null,
  });
  User.findById = (id) => {
    const query = Promise.resolve(users.get(id.toString()) || null);
    query.select = async () => users.get(id.toString()) || null;
    return query;
  };
  Session.create = async (values) => {
    const session = { _id: new mongoose.Types.ObjectId(), ...values };
    sessions.set(session.tokenHash, session);
    return session;
  };
  Session.findOne = async (query) => {
    const session = sessions.get(query.tokenHash);
    return session && session.expiresAt > query.expiresAt.$gt ? session : null;
  };
  Session.deleteOne = async (query) => {
    for (const [tokenHash, session] of sessions) {
      if (query.tokenHash === tokenHash || query._id?.toString() === session._id.toString()) {
        sessions.delete(tokenHash);
      }
    }
  };
  Session.deleteMany = async (query) => {
    for (const [tokenHash, session] of sessions) {
      if (query.userId.toString() === session.userId.toString()) sessions.delete(tokenHash);
    }
  };

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    User.prototype.save = originals.userSave;
    User.findOne = originals.findOne;
    User.findById = originals.findById;
    Session.create = originals.createSession;
    Session.findOne = originals.findSession;
    Session.deleteOne = originals.deleteSession;
    Session.deleteMany = originals.deleteUserSessions;
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
  const request = (path, method, body, cookie) => fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const emptySession = await request('/me', 'GET');
  assert.deepEqual(await emptySession.json(), { user: null });

  const invalidRegistration = await request('/register', 'POST', {
    name: 'Test Shopper',
    email: 'shopper@example.com',
    password: 'short',
  });
  assert.equal(invalidRegistration.status, 400);

  const registration = await request('/register', 'POST', {
    name: 'Test Shopper',
    email: 'SHOPPER@example.com',
    password: 'secure-password-123',
  });
  assert.equal(registration.status, 201);
  const registered = await registration.json();
  assert.equal(registered.user.email, 'shopper@example.com');
  assert.equal(Object.hasOwn(registered.user, 'passwordHash'), false);

  const storedUser = [...users.values()][0];
  assert.notEqual(storedUser.passwordHash, 'secure-password-123');
  const cookie = registration.headers.get('set-cookie').split(';')[0];

  const currentUser = await request('/me', 'GET', null, cookie);
  assert.equal((await currentUser.json()).user.name, 'Test Shopper');

  const wrongPassword = await request('/login', 'POST', {
    email: 'shopper@example.com',
    password: 'incorrect-password',
    rememberMe: false,
  });
  assert.equal(wrongPassword.status, 401);

  const duplicate = await request('/register', 'POST', {
    name: 'Another Shopper',
    email: 'shopper@example.com',
    password: 'secure-password-123',
  });
  assert.equal(duplicate.status, 409);

  const login = await request('/login', 'POST', {
    email: 'shopper@example.com',
    password: 'secure-password-123',
    rememberMe: true,
  });
  assert.equal(login.status, 200);
  const loginCookie = login.headers.get('set-cookie');
  assert.match(loginCookie, /HttpOnly/);
  assert.match(loginCookie, /Max-Age=2592000/);
  const loginCookieValue = loginCookie.split(';')[0];

  const passwordUpdate = await request('/password', 'PUT', {
    currentPassword: 'secure-password-123',
    newPassword: 'a-new-secure-password',
  }, loginCookieValue);
  assert.equal(passwordUpdate.status, 200);
  const updatedCookie = passwordUpdate.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/me', 'GET', null, loginCookieValue)).status, 401);
  assert.equal((await request('/me', 'GET', null, updatedCookie)).status, 200);

  const oldPasswordLogin = await request('/login', 'POST', {
    email: 'shopper@example.com',
    password: 'secure-password-123',
    rememberMe: false,
  });
  assert.equal(oldPasswordLogin.status, 401);

  const newPasswordLogin = await request('/login', 'POST', {
    email: 'shopper@example.com',
    password: 'a-new-secure-password',
    rememberMe: false,
  });
  assert.equal(newPasswordLogin.status, 200);
  const finalCookie = newPasswordLogin.headers.get('set-cookie').split(';')[0];

  const logout = await request('/logout', 'POST', null, finalCookie);
  assert.equal(logout.status, 204);
  const revokedSession = await request('/me', 'GET', null, finalCookie);
  assert.equal(revokedSession.status, 401);
});
