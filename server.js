const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3000;

// MIME types for different file extensions
const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon'
};

// Create HTTP server
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url);
  let pathname = parsedUrl.pathname;

  // Route handlers
  if (pathname === '/monitor') {
    res.writeHead(302, { Location: '/bluetooth-monitor.html' });
    res.end();
    return;
  }
  
  if (pathname === '/debug') {
    res.writeHead(302, { Location: '/debug-chart.html' });
    res.end();
    return;
  }

  // Default to index.html for root path
  if (pathname === '/') {
    pathname = '/index.html';
  }
  
  // Construct file path
  const filePath = path.join(__dirname, pathname);
  
  // Get file extension
  const ext = path.extname(filePath);
  
  // Set default content type
  const contentType = mimeTypes[ext] || 'text/plain';
  
  // Check if file exists
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      // File not found
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>404 - Not Found</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            h1 { color: #e74c3c; }
          </style>
        </head>
        <body>
          <h1>404 - File Not Found</h1>
          <p>The requested file <strong>${pathname}</strong> was not found.</p>
          <a href="/">Go back to ECG Monitor</a>
        </body>
        </html>
      `);
      return;
    }
    
    // Read and serve the file
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>500 - Server Error</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
              h1 { color: #e74c3c; }
            </style>
          </head>
          <body>
            <h1>500 - Internal Server Error</h1>
            <p>Error reading file: ${err.message}</p>
            <a href="/">Go back to ECG Monitor</a>
          </body>
          </html>
        `);
        return;
      }
      
      // Set appropriate headers
      res.writeHead(200, { 
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      
      // Send the file content
      res.end(data);
    });
  });
});

// Start the server
server.listen(PORT, () => {
  console.log('=================================');
  console.log('🏥 ECG Monitor Server Started');
  console.log('=================================');
  console.log(`📡 Server running at: http://localhost:${PORT}`);
  console.log(`📁 Serving files from: ${__dirname}`);
  console.log('🔗 Open your browser and navigate to the URL above');
  console.log('=================================');
  console.log('📋 Available endpoints:');
  console.log(`   • http://localhost:${PORT}/ - ECG Monitor Dashboard`);
  console.log('=================================');
  console.log('💡 Tips:');
  console.log('   • Make sure your ESP32 is connected and running');
  console.log('   • Check that HiveMQ Cloud credentials are correct');
  console.log('   • Enter your device ID (e.g., "P3") to connect to your ESP32');
  console.log('   • Click "Debug" button to see connection details');
  console.log('=================================');
});

// Handle server errors
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Please try a different port or stop the other server.`);
  } else {
    console.error('❌ Server error:', err.message);
  }
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down ECG Monitor Server...');
  server.close(() => {
    console.log('✅ Server closed successfully');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed successfully');
    process.exit(0);
  });
});
