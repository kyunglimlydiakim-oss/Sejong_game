const { apiKey } = require("./_stdict");

module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ stdict: Boolean(apiKey()) });
};
