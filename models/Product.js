const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  brand: { type: String, default: '', trim: true, maxlength: 100 },
  category: { type: String, required: true, trim: true, maxlength: 100 },
  categoryLabel: { type: String, default: '', trim: true, maxlength: 100 },
  subCategory: { type: String, default: '', trim: true, maxlength: 100 },
  tagline: { type: String, default: '', trim: true, maxlength: 200 },
  subtitle: { type: String, default: '', trim: true, maxlength: 200 },
  price: { type: Number, required: true, min: 0 },
  oldPrice: { type: Number, default: 0, min: 0 },
  discountPercent: { type: Number, default: 0, min: 0, max: 100 },
  rating: { type: Number, default: 0, min: 0, max: 5 },
  reviewCount: { type: Number, default: 0, min: 0 },
  shortDescription: { type: String, default: '', trim: true, maxlength: 2000 },
  image: { type: String, required: true },
  thumbnail: { type: String, default: '' },
  thumbnailAlt: { type: String, default: '' },
  images: { type: [String], default: [] },
  highlights: { type: [mongoose.Schema.Types.Mixed], default: [] },
  howToUse: { type: [String], default: [] },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  delivery: { type: mongoose.Schema.Types.Mixed, default: {} },
  reviews: { type: [mongoose.Schema.Types.Mixed], default: [] },
  relatedIds: { type: [String], default: [] },
  inStock: { type: Boolean, default: true },
  stockLeft: { type: Number, default: 0, min: 0 },
  stockNote: { type: String, default: '', trim: true, maxlength: 160 },
  sizes: { type: [String], default: [] },
  description: { type: String, default: '', trim: true, maxlength: 2000 },
}, { timestamps: true });

productSchema.set('toJSON', {
  transform(_doc, product) {
    product.mongoId = product._id.toString();
    product.id = product.slug;
    product.current = product.price;
    product.old = product.oldPrice;
    product.badge = product.discountPercent;
    delete product._id;
    delete product.__v;
    return product;
  },
});

module.exports = mongoose.model('Product', productSchema);
