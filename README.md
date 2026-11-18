# Backend

## Local setup

1. Copy `.env.example` to `.env` and set `MONGO_URI`, `ADMIN_API_KEY`, and the
   Cloudinary credentials (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and
   `CLOUDINARY_API_SECRET`). Keep the Cloudinary secret and admin key only on
   the backend; never add them to a `VITE_` variable.
2. Keep `CORS_ORIGINS=http://localhost:5173` for the local Vite frontend.
3. Run `npm install`, then `npm run dev`.

The frontend uses `http://localhost:5000/api/auth` during local development. Set
`VITE_AUTH_API_URL` to the deployed auth API URL when building for production.
For production, set `NODE_ENV=production` and list the exact frontend origin in
`CORS_ORIGINS`. If the frontend and API are on different sites, use HTTPS and
set `AUTH_COOKIE_SAME_SITE=none`.

## Authentication data

- `users`: normalized, unique email; display name; optional phone and birth date;
  scrypt password hash; Mongoose creation/update timestamps. Password hashes are
  excluded from normal queries and never returned by the API.
- `sessions`: user reference, SHA-256 hash of a random session token, and expiry.
  MongoDB's TTL index removes expired records. The raw token is only sent in an
  HttpOnly cookie.

Passwords are never stored as plaintext. Sign-in, registration, and password
changes are rate limited. `Keep me signed in` extends a session to 30 days;
otherwise it expires after 12 hours and uses a browser-session cookie.

## Auth endpoints

- `POST /api/auth/register` — create an account and sign in.
- `POST /api/auth/login` — sign in.
- `GET /api/auth/me` — return the current user, or `null` when signed out.
- `PUT /api/auth/me` — update the current user's profile.
- `PUT /api/auth/password` — change password and revoke other sessions.
- `POST /api/auth/logout` — revoke the current session.

Email verification, email-based password reset, and Google sign-in are not
configured yet; the login page's password-help link contacts support.

Orders are not part of this authentication database yet. Until their API is
implemented, order history is empty; saved addresses and preferences remain
browser-local and should not be treated as production account storage.

## Admin dashboard

Open `/admin` in the frontend and sign in with `ADMIN_API_KEY`. The dashboard
uploads images through the backend to Cloudinary and stores products, multiple
homepage hero slides, and the optional side banner in MongoDB. Product and
banner images and customer videos must be no larger than 50 MB. Use HTTPS in production;
the admin key is sent to the backend for admin requests.

- `GET /api/products` — list saved products.
- `GET /api/site-settings/homepage` — read database homepage banners.
- `GET /api/admin/homepage` — list homepage banners for the admin dashboard.
- `GET /api/admin/products` — list saved products for the dashboard.
- `POST /api/admin/login` — check the admin key.
- `POST /api/admin/upload` — upload an image or video (up to 50 MB) to Cloudinary.
- `POST`, `PUT`, and `DELETE /api/admin/products` — create, update, and remove
  products (update/delete take the MongoDB ID in the path).
- `PUT /api/admin/homepage` — save hero slides, optional side banner, and up to 30 customer videos.
