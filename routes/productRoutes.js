const express = require('express');
const Product = require('../models/Product');

const router = express.Router();

router.get('/', async (_req, res, next) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    return res.json(products);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
