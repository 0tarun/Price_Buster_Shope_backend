const express = require('express');
const SiteSettings = require('../models/SiteSettings');

const router = express.Router();

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

module.exports = router;
