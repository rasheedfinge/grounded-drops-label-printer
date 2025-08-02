require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database connection
let db;
MongoClient.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/grounded-labels')
  .then(client => {
    console.log('✅ Connected to MongoDB');
    db = client.db();
  })
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Serve the main app
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🍃 Grounded Drops - Label Printer</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #2d5016 0%, #4a7c59 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 500px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
        }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
        }
        
        .header h1 {
            color: #2d5016;
            font-size: 28px;
            margin-bottom: 10px;
        }
        
        .header p {
            color: #666;
            font-size: 16px;
        }
        
        .form-group {
            margin-bottom: 25px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #333;
        }
        
        .radio-group {
            display: flex;
            gap: 20px;
            margin-bottom: 15px;
        }
        
        .radio-option {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .radio-option input[type="radio"] {
            width: 20px;
            height: 20px;
        }
        
        .input-group {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .input-group input {
            flex: 1;
            padding: 12px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.3s;
        }
        
        .input-group input:focus {
            outline: none;
            border-color: #4a7c59;
        }
        
        .unit {
            font-weight: 600;
            color: #666;
            min-width: 60px;
        }
        
        .quick-buttons {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin-bottom: 30px;
        }
        
        .quick-btn {
            padding: 15px;
            border: 2px solid #e0e0e0;
            border-radius: 12px;
            background: #f8f9fa;
            cursor: pointer;
            text-align: center;
            transition: all 0.3s;
            font-weight: 600;
        }
        
        .quick-btn:hover {
            border-color: #4a7c59;
            background: #f0f8f4;
            transform: translateY(-2px);
        }
        
        .quick-btn.selected {
            border-color: #4a7c59;
            background: #4a7c59;
            color: white;
        }
        
        .print-buttons {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
        }
        
        .btn {
            padding: 15px 25px;
            border: none;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .btn-primary {
            background: #4a7c59;
            color: white;
        }
        
        .btn-primary:hover {
            background: #3d6b4a;
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(74, 124, 89, 0.3);
        }
        
        .btn-secondary {
            background: #f8f9fa;
            color: #333;
            border: 2px solid #e0e0e0;
        }
        
        .btn-secondary:hover {
            background: #e9ecef;
            transform: translateY(-2px);
        }
        
        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none !important;
        }
        
        .status {
            margin-top: 20px;
            padding: 15px;
            border-radius: 8px;
            text-align: center;
            font-weight: 600;
            display: none;
        }
        
        .status.success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        
        .status.error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        
        .stats {
            margin-top: 30px;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 12px;
            text-align: center;
        }
        
        .stats h3 {
            color: #2d5016;
            margin-bottom: 10px;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin-top: 15px;
        }
        
        .stat-item {
            text-align: center;
        }
        
        .stat-number {
            font-size: 24px;
            font-weight: bold;
            color: #4a7c59;
        }
        
        .stat-label {
            font-size: 12px;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🍃 Grounded Drops</h1>
            <p>Thermal Label Printer</p>
        </div>
        
        <div class="quick-buttons">
            <div class="quick-btn" onclick="setQuickDiscount('percentage', 15, 30)">
                <div>15% OFF</div>
                <small>30 days</small>
            </div>
            <div class="quick-btn" onclick="setQuickDiscount('dollar', 5, 30)">
                <div>$5 OFF</div>
                <small>30 days</small>
            </div>
            <div class="quick-btn" onclick="setQuickDiscount('percentage', 20, 14)">
                <div>20% OFF</div>
                <small>14 days</small>
            </div>
            <div class="quick-btn" onclick="setQuickDiscount('dollar', 10, 30)">
                <div>$10 OFF</div>
                <small>30 days</small>
            </div>
        </div>
        
        <form id="labelForm">
            <div class="form-group">
                <label>Discount Type:</label>
                <div class="radio-group">
                    <div class="radio-option">
                        <input type="radio" id="percentage" name="discountType" value="percentage" checked>
                        <label for="percentage">Percentage (%)</label>
                    </div>
                    <div class="radio-option">
                        <input type="radio" id="dollar" name="discountType" value="dollar">
                        <label for="dollar">Dollar Amount ($)</label>
                    </div>
                </div>
            </div>
            
            <div class="form-group">
                <label>Discount Value:</label>
                <div class="input-group">
                    <input type="number" id="discountValue" min="1" max="100" value="15" required>
                    <span class="unit" id="discountUnit">%</span>
                </div>
            </div>
            
            <div class="form-group">
                <label>Expires In:</label>
                <div class="input-group">
                    <input type="number" id="expiryDays" min="1" max="365" value="30" required>
                    <span class="unit">days</span>
                </div>
            </div>
            
            <div class="print-buttons">
                <button type="button" class="btn btn-secondary" onclick="previewLabel()">
                    👁️ Preview
                </button>
                <button type="button" class="btn btn-primary" onclick="printLabel()">
                    🖨️ Print Label
                </button>
            </div>
        </form>
        
        <div id="status" class="status"></div>
        
        <div class="stats">
            <h3>Today's Stats</h3>
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-number" id="todayLabels">0</div>
                    <div class="stat-label">Labels Printed</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number" id="totalLabels">0</div>
                    <div class="stat-label">Total Labels</div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        // Update discount unit when type changes
        document.querySelectorAll('input[name="discountType"]').forEach(radio => {
            radio.addEventListener('change', function() {
                const unit = document.getElementById('discountUnit');
                unit.textContent = this.value === 'percentage' ? '%' : '$';
                
                // Update input max value
                const input = document.getElementById('discountValue');
                if (this.value === 'percentage') {
                    input.max = 100;
                    if (input.value > 100) input.value = 50;
                } else {
                    input.max = 1000;
                }
            });
        });
        
        // Quick discount buttons
        function setQuickDiscount(type, value, days) {
            // Clear previous selection
            document.querySelectorAll('.quick-btn').forEach(btn => btn.classList.remove('selected'));
            event.target.closest('.quick-btn').classList.add('selected');
            
            // Set form values
            document.querySelector(\`input[value="\${type}"]\`).checked = true;
            document.getElementById('discountValue').value = value;
            document.getElementById('expiryDays').value = days;
            
            // Update unit display
            const unit = document.getElementById('discountUnit');
            unit.textContent = type === 'percentage' ? '%' : '$';
        }
        
        // Show status message
        function showStatus(message, type = 'success') {
            const status = document.getElementById('status');
            status.textContent = message;
            status.className = \`status \${type}\`;
            status.style.display = 'block';
            
            setTimeout(() => {
                status.style.display = 'none';
            }, 3000);
        }
        
        // Preview label
        async function previewLabel() {
            const formData = getFormData();
            
            try {
                const response = await fetch('/api/preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });
                
                if (response.ok) {
                    const blob = await response.blob();
                    const url = URL.createObjectURL(blob);
                    window.open(url, '_blank');
                } else {
                    showStatus('Error generating preview', 'error');
                }
            } catch (error) {
                showStatus('Error generating preview', 'error');
            }
        }
        
        // Print label
        async function printLabel() {
            const formData = getFormData();
            
            try {
                const response = await fetch('/api/print', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    showStatus(\`Label printed! Code: \${result.code}\`, 'success');
                    updateStats();
                } else {
                    showStatus(result.error || 'Error printing label', 'error');
                }
            } catch (error) {
                showStatus('Error printing label', 'error');
            }
        }
        
        // Get form data
        function getFormData() {
            return {
                discountType: document.querySelector('input[name="discountType"]:checked').value,
                discountValue: parseInt(document.getElementById('discountValue').value),
                expiryDays: parseInt(document.getElementById('expiryDays').value)
            };
        }
        
        // Update statistics
        async function updateStats() {
            try {
                const response = await fetch('/api/stats');
                const stats = await response.json();
                
                document.getElementById('todayLabels').textContent = stats.today;
                document.getElementById('totalLabels').textContent = stats.total;
            } catch (error) {
                console.error('Error updating stats:', error);
            }
        }
        
        // Load stats on page load
        updateStats();
        
        // Auto-refresh stats every 30 seconds
        setInterval(updateStats, 30000);
    </script>
</body>
</html>
  `);
});

// API: Preview label
app.post('/api/preview', async (req, res) => {
  try {
    const { discountType, discountValue, expiryDays } = req.body;
    
    // Generate preview code
    const previewCode = 'GD-PREVIEW-SAMPLE';
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + expiryDays);
    
    // Create PDF
    const pdfBuffer = await createLabelPDF({
      code: previewCode,
      discountType,
      discountValue,
      expiryDate,
      isPreview: true
    });
    
    res.contentType('application/pdf');
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
});

// API: Print label
app.post('/api/print', async (req, res) => {
  try {
    const { discountType, discountValue, expiryDays } = req.body;
    
    // Generate unique code
    const code = generateUniqueCode();
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + expiryDays);
    
    // Create PDF
    const pdfBuffer = await createLabelPDF({
      code,
      discountType,
      discountValue,
      expiryDate
    });
    
    // Save to database
    await db.collection('labels').insertOne({
      code,
      discountType,
      discountValue,
      expiryDate,
      createdAt: new Date(),
      used: false
    });
    
    // In a real thermal printer setup, you'd send this to the printer
    // For now, we'll save it as a file and return success
    
    res.json({ 
      success: true, 
      code,
      message: 'Label generated successfully!' 
    });
  } catch (error) {
    console.error('Print error:', error);
    res.status(500).json({ error: 'Failed to print label' });
  }
});

// API: Get statistics
app.get('/api/stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayLabels = await db.collection('labels').countDocuments({
      createdAt: { $gte: today }
    });
    
    const totalLabels = await db.collection('labels').countDocuments();
    
    res.json({
      today: todayLabels,
      total: totalLabels
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.json({ today: 0, total: 0 });
  }
});

// Generate unique code
function generateUniqueCode() {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `GD-${timestamp}-${random}`;
}

// Create label PDF
async function createLabelPDF({ code, discountType, discountValue, expiryDate, isPreview = false }) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        size: [252, 144], // 3.5" x 2" at 72 DPI
        margin: 10
      });
      
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      
      // Header
      doc.fontSize(14)
         .font('Helvetica-Bold')
         .text('☕ GROUNDED DROPS', 0, 15, { align: 'center', width: 252 });
      
      // Discount offer
      const discountText = discountType === 'percentage' 
        ? `${discountValue}% OFF`
        : `$${discountValue} OFF`;
      
      doc.fontSize(16)
         .font('Helvetica-Bold')
         .text(`🎁 ${discountText}`, 0, 35, { align: 'center', width: 252 });
      
      doc.fontSize(10)
         .font('Helvetica')
         .text('NEXT ORDER', 0, 52, { align: 'center', width: 252 });
      
      // QR Code
      const qrCodeUrl = `https://groundeddrops.com.au/discount/${code}`;
      const qrCodeData = await QRCode.toDataURL(qrCodeUrl, {
        width: 60,
        margin: 1
      });
      const qrCodeBuffer = Buffer.from(qrCodeData.split(',')[1], 'base64');
      
      doc.image(qrCodeBuffer, 96, 65, { width: 60, height: 60 });
      
      // Code
      doc.fontSize(8)
         .font('Helvetica-Bold')
         .text(isPreview ? 'PREVIEW-CODE' : code, 0, 130, { align: 'center', width: 252 });
      
      // Expiry
      doc.fontSize(7)
         .font('Helvetica')
         .text(`Exp: ${expiryDate.toLocaleDateString()}`, 0, 140, { align: 'center', width: 252 });
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Grounded Drops Label Printer is running!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🍃 Grounded Drops Label Printer running on port ${PORT}`);
  console.log(`🖨️ Ready to print discount labels!`);
});
