Write-Host "============================================"
Write-Host "OrderSounds Phase 1 MVP Setup (Windows)"
Write-Host "============================================"
Write-Host ""

# Check Python version
Write-Host "Checking Python version..."
$pythonVersion = & python --version 2>&1
Write-Host "✓ Found $pythonVersion"
Write-Host ""

# Create virtual environment
$createVenv = Read-Host "Create a virtual environment? (y/n)"
if ($createVenv -eq "y") {
    Write-Host "Creating virtual environment..."
    python -m venv venv
    Write-Host "✓ Virtual environment created"
    Write-Host "Activate it with: .\\venv\\Scripts\\Activate.ps1"
    Write-Host ""
}

# Install dependencies
Write-Host "Installing dependencies..."
python -m pip install --upgrade pip
pip install -r requirements.txt
Write-Host "✓ Dependencies installed"
Write-Host ""

# Create .env file
if (-Not (Test-Path ".env")) {
    Write-Host "Creating .env file from template..."
    Copy-Item -Path "config\\.env.example" -Destination ".env"
    Write-Host "✓ Created .env file"
    Write-Host ""
    Write-Host "IMPORTANT: Edit .env and add your credentials"
    Write-Host " - Google Cloud project ID"
    Write-Host " - Document AI processor ID"
    Write-Host " - Service account key path"
    Write-Host " - Database URL"
    Write-Host ""
}
else {
    Write-Host "✓ .env file already exists"
    Write-Host ""
}

# Create output directories
Write-Host "Creating output directories..."
New-Item -ItemType Directory -Path "outputs\\ocr" -Force | Out-Null
New-Item -ItemType Directory -Path "outputs\\data" -Force | Out-Null
New-Item -ItemType Directory -Path "outputs\\reports" -Force | Out-Null
New-Item -ItemType Directory -Path "data" -Force | Out-Null
Write-Host "✓ Output directories created"
Write-Host ""

# Optional database setup
$setupDb = Read-Host "Set up database now? (y/n)"
if ($setupDb -eq "y") {
    $dbUrl = Read-Host "Enter your database URL (or press Enter to skip)"
    if ($dbUrl) {
        Write-Host "Running database schema..."
        psql "$dbUrl" -f scripts\\schema.sql
        Write-Host "✓ Database schema created"
        Write-Host ""
    }
}

Write-Host "============================================"
Write-Host "Setup Complete!"
Write-Host "============================================"
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Edit .env with your credentials"
Write-Host "2. Place CMO report PDF in data\\ folder"
Write-Host "3. Run: python src\\pipeline.py data\\your_report.pdf"
Write-Host ""
