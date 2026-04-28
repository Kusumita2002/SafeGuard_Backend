const express = require('express');
const router = express.Router();
router.post('/trigger', async (req, res) => {
  // Save GPS/location
  // Send email/message to contacts (use nodemailer)
  res.json({success: true});
});
module.exports = router;
app.post('/api/feedback', async (req, res) => {
  try {
    const { name, email, message } = req.body || {};
    if (!name || !email || !message) {
      return res.status(400).json({ success: false, message: 'All fields required.' });
    }
    const fb = new Feedback({ name, email, message });
    await fb.save();
    res.json({ success: true, message: 'Feedback received. Thank you!' });
  } catch (err) {
    console.error('Feedback error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

