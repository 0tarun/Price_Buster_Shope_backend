const mongoose = require('mongoose');

const siteSettingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'homepage' },
  heroSlide: {
    eyebrow: { type: String, default: '' },
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    image: { type: String, default: '' },
  },
  heroSlides: { type: [mongoose.Schema.Types.Mixed], default: [] },
  sideBanner: { type: mongoose.Schema.Types.Mixed, default: null },
  customerVideos: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('SiteSettings', siteSettingsSchema);
