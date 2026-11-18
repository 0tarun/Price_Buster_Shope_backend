const express = require('express');
const multer = require('multer');
const { timingSafeEqual } = require('crypto');
const rateLimit = require('express-rate-limit');
const Product = require('../models/Product');
const SiteSettings = require('../models/SiteSettings');
const getCloudinary = require('../config/cloudinary');

const router = express.Router();
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again later.' },
});
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (!file.mimetype.startsWith('image/') && !file.mimetype.startsWith('video/')) {
      callback(new Error('Please choose an image or video file.'));
      return;
    }
    callback(null, true);
  },
});
const editableProductFields = [
  'name', 'slug', 'brand', 'category', 'categoryLabel', 'subCategory', 'tagline', 'subtitle',
  'price', 'oldPrice', 'discountPercent', 'rating', 'reviewCount', 'shortDescription',
  'image', 'thumbnail', 'thumbnailAlt', 'images', 'highlights', 'howToUse', 'details',
  'delivery', 'reviews', 'relatedIds', 'inStock', 'stockLeft', 'stockNote', 'sizes', 'description',
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function requireAdmin(req, res, next) {
  const expectedKey = process.env.ADMIN_API_KEY || '';
  const suppliedKey = req.get('x-admin-key') || '';
  if (!expectedKey) {
    return res.status(503).json({ message: 'Admin access is not configured. Set ADMIN_API_KEY on the backend.' });
  }
  if (!suppliedKey || !safeEqual(suppliedKey, expectedKey)) {
    return res.status(401).json({ message: 'The admin key is incorrect.' });
  }
  return next();
}

function toProductFields(body) {
  if (!isRecord(body) || Object.keys(body).some((key) => !editableProductFields.includes(key))) {
    return { error: 'Enter valid product details.' };
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const image = typeof body.image === 'string' ? body.image.trim() : '';
  const price = Number(body.price);
  const oldPrice = body.oldPrice === undefined || body.oldPrice === '' ? 0 : Number(body.oldPrice);
  const stockLeft = body.stockLeft === undefined || body.stockLeft === '' ? 0 : Number(body.stockLeft);
  if (!name || name.length > 160 || !category || category.length > 100 || !image) {
    return { error: 'Name, category, and a product image are required.' };
  }
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(oldPrice) || oldPrice < 0
    || !Number.isFinite(stockLeft) || stockLeft < 0) {
    return { error: 'Price, original price, and stock must be valid non-negative numbers.' };
  }
  const slugSource = typeof body.slug === 'string' && body.slug.trim()
    ? body.slug.trim()
    : name;
  const slug = slugSource.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) return { error: 'Product name must contain letters or numbers.' };

  return {
    fields: {
      ...body,
      slug,
      name,
      category,
      categoryLabel: typeof body.categoryLabel === 'string' && body.categoryLabel.trim()
        ? body.categoryLabel.trim()
        : category,
      price,
      oldPrice,
      stockLeft,
      image,
      thumbnail: typeof body.thumbnail === 'string' && body.thumbnail ? body.thumbnail : image,
      images: Array.isArray(body.images) && body.images.length ? body.images : [image],
      inStock: stockLeft > 0,
    },
  };
}

router.post('/login', loginRateLimit, (req, res) => {
  const expectedKey = process.env.ADMIN_API_KEY || '';
  const suppliedKey = typeof req.body?.key === 'string' ? req.body.key : '';
  if (!expectedKey) {
    return res.status(503).json({ message: 'Admin access is not configured. Set ADMIN_API_KEY on the backend.' });
  }
  if (!suppliedKey || !safeEqual(suppliedKey, expectedKey)) {
    return res.status(401).json({ message: 'The admin key is incorrect.' });
  }
  return res.json({ ok: true });
});

router.use(requireAdmin);

router.get('/products', async (_req, res, next) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    return res.json(products);
  } catch (error) {
    return next(error);
  }
});

router.get('/homepage', async (_req, res, next) => {
  try {
    const settings = await SiteSettings.findOne({ key: 'homepage' }).lean();
    const heroSlides = settings?.heroSlides?.length
      ? settings.heroSlides
      : settings?.heroSlide?.image ? [{
        id: 'legacy-banner',
        buttonLabel: 'Shop now',
        productId: '',
        ...settings.heroSlide,
      }] : [];
    return res.json({
      heroSlides,
      sideBanner: settings?.sideBanner || null,
      customerVideos: settings?.customerVideos || [],
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/upload', (req, res, next) => {
  mediaUpload.single('image')(req, res, (error) => {
    if (error) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? 'Media must be 50 MB or smaller.'
        : error.message;
      return res.status(400).json({ message });
    }
    return next();
  });
}, async (req, res, next) => {
  if (!req.file) return res.status(400).json({ message: 'Choose an image or video to upload.' });

  try {
    const cloudinary = getCloudinary();
    const uploaded = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'price-buster-shop', resource_type: 'auto' },
        (error, result) => (error ? reject(error) : resolve(result)),
      );
      stream.end(req.file.buffer);
    });
    return res.status(201).json({
      url: uploaded.secure_url,
      publicId: uploaded.public_id,
      resourceType: uploaded.resource_type,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/products', async (req, res, next) => {
  const result = toProductFields(req.body);
  if (result.error) return res.status(400).json({ message: result.error });

  try {
    const product = await Product.create(result.fields);
    return res.status(201).json(product);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'A product with this name already exists.' });
    if (error.name === 'ValidationError') return res.status(400).json({ message: error.message });
    return next(error);
  }
});

router.put('/products/:id', async (req, res, next) => {
  const result = toProductFields(req.body);
  if (result.error) return res.status(400).json({ message: result.error });

  try {
    const product = await Product.findByIdAndUpdate(req.params.id, result.fields, {
      new: true,
      runValidators: true,
    });
    if (!product) return res.status(404).json({ message: 'Product not found.' });
    return res.json(product);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'A product with this name already exists.' });
    if (error.name === 'ValidationError' || error.name === 'CastError') {
      return res.status(400).json({ message: error.message });
    }
    return next(error);
  }
});

router.delete('/products/:id', async (req, res, next) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found.' });
    return res.status(204).end();
  } catch (error) {
    if (error.name === 'CastError') return res.status(400).json({ message: 'Invalid product ID.' });
    return next(error);
  }
});

router.put('/homepage', async (req, res, next) => {
  const { heroSlides, sideBanner, customerVideos } = req.body || {};
  if (!Array.isArray(heroSlides) || !Array.isArray(customerVideos)
    || customerVideos.length > 30
    || (sideBanner !== null && sideBanner !== undefined && !isRecord(sideBanner))) {
    return res.status(400).json({ message: 'Enter valid homepage banner data.' });
  }
  const ids = new Set();
  const normalizedSlides = [];
  for (const slide of heroSlides) {
    if (!isRecord(slide)
      || ['id', 'eyebrow', 'title', 'subtitle', 'image'].some((key) => (
        typeof slide[key] !== 'string'
      ))
      || (slide.buttonLabel !== undefined && typeof slide.buttonLabel !== 'string')
      || (slide.productId !== undefined && typeof slide.productId !== 'string')
      || !slide.id.trim() || ids.has(slide.id)
      || !slide.eyebrow.trim() || !slide.title.trim() || !slide.subtitle.trim() || !slide.image.trim()
      || slide.id.length > 100 || slide.eyebrow.length > 100 || slide.title.length > 160
      || slide.subtitle.length > 300 || slide.image.length > 2048
      || (slide.buttonLabel || '').length > 60 || (slide.productId || '').length > 160) {
      return res.status(400).json({ message: 'Every main banner needs a unique ID, heading, description, and image.' });
    }
    ids.add(slide.id);
    normalizedSlides.push({
      id: slide.id,
      eyebrow: slide.eyebrow.trim(),
      title: slide.title.trim(),
      subtitle: slide.subtitle.trim(),
      image: slide.image.trim(),
      buttonLabel: (slide.buttonLabel || 'Shop now').trim(),
      productId: (slide.productId || '').trim(),
    });
  }

  const videoIds = new Set();
  const normalizedVideos = [];
  for (const video of customerVideos) {
    if (!isRecord(video)
      || ['id', 'author', 'quote', 'product', 'productId', 'videoUrl'].some((key) => (
        typeof video[key] !== 'string'
      ))
      || (video.videoPublicId !== undefined && typeof video.videoPublicId !== 'string')
      || !video.id.trim() || videoIds.has(video.id)
      || !video.author.trim() || !video.quote.trim() || !video.product.trim() || !video.videoUrl.trim()
      || video.id.length > 100 || video.author.length > 100 || video.quote.length > 500
      || video.product.length > 160 || video.productId.length > 160 || video.videoUrl.length > 2048
      || (video.videoPublicId || '').length > 255) {
      return res.status(400).json({ message: 'Every customer video needs a unique ID, author, quote, product, and video.' });
    }
    videoIds.add(video.id);
    normalizedVideos.push({
      id: video.id,
      author: video.author.trim(),
      quote: video.quote.trim(),
      product: video.product.trim(),
      productId: video.productId.trim(),
      videoUrl: video.videoUrl.trim(),
      videoPublicId: (video.videoPublicId || '').trim(),
    });
  }

  if (sideBanner !== null && sideBanner !== undefined) {
    const allowedKeys = ['eyebrow', 'title', 'description', 'image', 'price', 'oldPrice', 'productId', 'buttonLabel', 'endTime'];
    const { eyebrow, title, description, image, price, oldPrice, productId, buttonLabel, endTime } = sideBanner;
    if (Object.keys(sideBanner).some((key) => !allowedKeys.includes(key))
      || [eyebrow, title, description, image, productId, buttonLabel].some((value) => typeof value !== 'string')
      || (endTime !== undefined && typeof endTime !== 'string')
      || !eyebrow.trim() || !title.trim() || !description.trim() || !image.trim()
      || eyebrow.length > 100 || title.length > 160 || description.length > 300 || image.length > 2048
      || productId.length > 160 || buttonLabel.length > 60
      || !Number.isFinite(Number(price)) || Number(price) < 0
      || (oldPrice !== '' && (!Number.isFinite(Number(oldPrice)) || Number(oldPrice) < 0))
      || (endTime && !Number.isFinite(Date.parse(endTime)))) {
      return res.status(400).json({ message: 'Enter a valid side banner with text, image, and price.' });
    }
  }

  try {
    const settings = await SiteSettings.findOneAndUpdate(
      { key: 'homepage' },
      {
        $set: {
          heroSlides: normalizedSlides,
          customerVideos: normalizedVideos,
          sideBanner: sideBanner ? {
            ...sideBanner,
            eyebrow: sideBanner.eyebrow.trim(),
            title: sideBanner.title.trim(),
            description: sideBanner.description.trim(),
            image: sideBanner.image.trim(),
            price: Number(sideBanner.price),
            oldPrice: Number(sideBanner.oldPrice) || 0,
            endTime: sideBanner.endTime || '',
          } : null,
        },
        $unset: { heroSlide: 1 },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
    return res.json({
      heroSlides: settings.heroSlides,
      sideBanner: settings.sideBanner,
      customerVideos: settings.customerVideos,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
