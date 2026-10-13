// Vercel serverless entry — отдаёт express-приложение как функцию.
const app = require('../server');

module.exports = (req, res) => app(req, res);
