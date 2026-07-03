<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Grounded Drops Label Editor</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #2d2d2d;
            color: #fff;
            padding: 20px;
            margin: 0;
        }
        
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        
        .editor-section {
            background-color: #3d3d3d;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        
        .input-group {
            margin-bottom: 15px;
        }
        
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }
        
        input[type="text"] {
            width: 100%;
            padding: 10px;
            border: 1px solid #555;
            background-color: #1d1d1d;
            color: #fff;
            border-radius: 4px;
            font-size: 16px;
        }
        
        .label-preview {
            background-color: #fff;
            color: #000;
            width: 300px;
            height: 300px;
            margin: 20px auto;
            border-radius: 8px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 20px;
            box-sizing: border-box;
        }
        
        .label-header {
            font-size: 14px;
            margin-bottom: 10px;
            font-weight: normal;
            max-width: 100%;
            word-wrap: break-word;
        }
        
        .label-title {
            font-size: 20px;
            font-weight: bold;
            margin-bottom: 5px;
        }
        
        .label-discount {
            font-size: 36px;
            font-weight: bold;
            margin-bottom: 5px;
        }
        
        .label-subtitle {
            font-size: 14px;
            margin-bottom: 20px;
        }
        
        .qr-placeholder {
            width: 150px;
            height: 150px;
            background-color: #000;
            background-image: 
                repeating-linear-gradient(45deg, transparent, transparent 3px, #fff 3px, #fff 6px),
                repeating-linear-gradient(-45deg, transparent, transparent 3px, #fff 3px, #fff 6px);
            margin-bottom: 10px;
        }
        
        .label-code {
            font-size: 10px;
            font-weight: bold;
        }
        
        .buttons {
            display: flex;
            gap: 10px;
            justify-content: center;
            margin-top: 20px;
        }
        
        button {
            background-color: #007bff;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            transition: background-color 0.3s;
        }
        
        button:hover {
            background-color: #0056b3;
        }
        
        .print-button {
            background-color: #28a745;
        }
        
        .print-button:hover {
            background-color: #218838;
        }
        
        .info-text {
            text-align: center;
            color: #999;
            font-size: 14px;
            margin-top: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Grounded Drops Label Editor</h1>
        
        <div class="editor-section">
            <h2>Customize Your Label</h2>
            
            <div class="input-group">
                <label for="headerText">Header Text (appears above discount):</label>
                <input 
                    type="text" 
                    id="headerText" 
                    placeholder="Enter custom header text..."
                    value="Here is your code for your next order"
                    maxlength="50"
                >
            </div>
            
            <div class="input-group">
                <label for="discountCode">Discount Code:</label>
                <input 
                    type="text" 
                    id="discountCode" 
                    value="GDmdxxmf3zdP7468"
                    readonly
                    style="background-color: #2d2d2d; cursor: not-allowed;"
                >
            </div>
        </div>
        
        <div class="editor-section">
            <h2>Label Preview</h2>
            
            <div class="label-preview" id="labelPreview">
                <div class="label-header" id="previewHeader">Here is your code for your next order</div>
                <div class="label-title">GROUNDED DROPS</div>
                <div class="label-discount">15% OFF</div>
                <div class="label-subtitle">NEXT ORDER</div>
                <div class="qr-placeholder"></div>
                <div class="label-code">GDmdxxmf3zdP7468</div>
                <div class="label-code" style="font-size: 8px; margin-top: 5px;">Exp: 8/3/2025</div>
            </div>
            
            <div class="buttons">
                <button onclick="resetText()">Reset to Default</button>
                <button class="print-button" onclick="printLabel()">Print Label</button>
            </div>
            
            <div class="info-text">
                The header text will appear at the top of your printed label.
            </div>
        </div>
    </div>
    
    <script>
        const headerInput = document.getElementById('headerText');
        const previewHeader = document.getElementById('previewHeader');
        
        // Update preview as user types
        headerInput.addEventListener('input', function() {
            previewHeader.textContent = this.value || 'Enter text above...';
        });
        
        // Reset to default text
        function resetText() {
            headerInput.value = 'Here is your code for your next order';
            previewHeader.textContent = 'Here is your code for your next order';
        }
        
        // Print label function
        function printLabel() {
            window.print();
        }
        
        // Print styles
        const printStyles = document.createElement('style');
        printStyles.textContent = `
            @media print {
                body {
                    background-color: white;
                    color: black;
                }
                
                .container > h1,
                .editor-section:first-of-type,
                .editor-section h2,
                .buttons,
                .info-text {
                    display: none;
                }
                
                .label-preview {
                    margin: 0;
                    box-shadow: none;
                    border: 1px solid #000;
                }
            }
        `;
        document.head.appendChild(printStyles);
    </script>
</body>
</html>
