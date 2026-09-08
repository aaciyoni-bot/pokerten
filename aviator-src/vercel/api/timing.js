/* Internal timing diagnostics must not be publicly exposed. This route stays
 * closed until an owner-authenticated diagnostic workflow is implemented.
 * No anonymous Firebase account is created and no timing records are read. */
module.exports = async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(404).json({ error: 'Not found' });
};
