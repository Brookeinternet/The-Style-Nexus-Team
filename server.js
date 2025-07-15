
const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000; // Render provides a PORT environment variable

// Serve static files from the current directory (where your HTML files are)
app.use(express.static(path.join(__dirname)));

// Fallback for any other route to serve the main HTML file (e.g., index.html)
// Adjust 'index.html' if your main homepage file has a different name
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html')); // Assuming your homepage is index.html
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
