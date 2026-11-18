const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const adminRoutes = require('../routes/adminRoutes');
const Product = require('../models/Product');
const SiteSettings = require('../models/SiteSettings');

test('protects admin routes and validates product submissions', async (t) => {
  const previousKey = process.env.ADMIN_API_KEY;
  const originalSettingsUpdate = SiteSettings.findOneAndUpdate;
  process.env.ADMIN_API_KEY = 'test-admin-key';

  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (previousKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previousKey;
    SiteSettings.findOneAndUpdate = originalSettingsUpdate;
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}/api/admin`;
  const request = (path, method, body, key) => fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'x-admin-key': key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const rejectedLogin = await request('/login', 'POST', { key: 'wrong-key' });
  assert.equal(rejectedLogin.status, 401);

  const acceptedLogin = await request('/login', 'POST', { key: 'test-admin-key' });
  assert.equal(acceptedLogin.status, 200);

  const unauthorizedList = await request('/products', 'GET');
  assert.equal(unauthorizedList.status, 401);

  const invalidProduct = await request('/products', 'POST', {}, 'test-admin-key');
  assert.equal(invalidProduct.status, 400);
  assert.equal((await invalidProduct.json()).message, 'Name, category, and a product image are required.');

  const product = new Product({
    slug: 'test-product',
    name: 'Test product',
    category: 'test',
    price: 10,
    image: 'https://example.com/image.jpg',
  }).toJSON();
  assert.equal(product.id, 'test-product');
  assert.equal(product.current, 10);
  assert.equal(typeof product.mongoId, 'string');

  SiteSettings.findOneAndUpdate = async (_query, update) => ({
    heroSlides: update.$set.heroSlides,
    sideBanner: update.$set.sideBanner,
    customerVideos: update.$set.customerVideos,
  });
  const banners = await request('/homepage', 'PUT', {
    heroSlides: [
      { id: 'hero-1', eyebrow: 'Fresh', title: 'First', subtitle: 'First banner', image: 'https://example.com/1.jpg', productId: 'item-1', buttonLabel: 'Shop' },
      { id: 'hero-2', eyebrow: 'New', title: 'Second', subtitle: 'Second banner', image: 'https://example.com/2.jpg', productId: 'item-2', buttonLabel: 'View' },
    ],
    sideBanner: {
      eyebrow: 'Deal',
      title: 'Side item',
      description: 'Limited offer',
      image: 'https://example.com/side.jpg',
      price: 20,
      oldPrice: 25,
      productId: 'item-1',
      buttonLabel: 'Buy',
      endTime: '2026-11-20T08:30:00.000Z',
    },
    customerVideos: [{
      id: 'review-1',
      author: 'A customer',
      quote: 'Loved this product.',
      product: 'Test item',
      productId: 'item-1',
      videoUrl: 'https://res.cloudinary.com/demo/video/upload/review.mp4',
      videoPublicId: 'price-buster-shop/review',
    }],
  }, 'test-admin-key');
  assert.equal(banners.status, 200);
  const savedBanners = await banners.json();
  assert.equal(savedBanners.heroSlides.length, 2);
  assert.equal(savedBanners.heroSlides[1].productId, 'item-2');
  assert.equal(savedBanners.sideBanner.price, 20);
  assert.equal(savedBanners.sideBanner.endTime, '2026-11-20T08:30:00.000Z');
  assert.equal(savedBanners.customerVideos[0].videoUrl, 'https://res.cloudinary.com/demo/video/upload/review.mp4');

  const duplicateBannerIds = await request('/homepage', 'PUT', {
    heroSlides: [
      { id: 'same', eyebrow: 'A', title: 'A', subtitle: 'A', image: 'https://example.com/a.jpg' },
      { id: 'same', eyebrow: 'B', title: 'B', subtitle: 'B', image: 'https://example.com/b.jpg' },
    ],
    sideBanner: null,
    customerVideos: [],
  }, 'test-admin-key');
  assert.equal(duplicateBannerIds.status, 400);

  const invalidOfferEnd = await request('/homepage', 'PUT', {
    heroSlides: [],
    sideBanner: {
      eyebrow: 'Special Offer',
      title: 'Special item',
      description: 'Limited deal',
      image: 'https://example.com/offer.jpg',
      price: 20,
      oldPrice: 25,
      productId: 'item-1',
      buttonLabel: 'Shop',
      endTime: 'not-a-date',
    },
    customerVideos: [],
  }, 'test-admin-key');
  assert.equal(invalidOfferEnd.status, 400);
});
