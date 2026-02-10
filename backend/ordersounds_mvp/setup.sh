#!/bin/bash
# OrderSounds MVP Setup Script

set -e

echo "============================================"
echo "OrderSounds Phase 1 MVP Setup"
echo "============================================"
echo ""

# Check Python version
echo "Checking Python version..."
python_version=$(python3 --version 2>&1 | awk '{print $2}')
echo "✓ Found Python $python_version"
echo ""

# Create virtual environment (recommended)
echo "Would you like to create a virtual environment? (y/n)"
read -r create_venv

if [ "$create_venv" = "y" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
    echo "✓ Virtual environment activated"
    echo ""
fi

# Install dependencies
echo "Installing dependencies..."
pip install --upgrade pip
pip install -r requirements.txt
echo "✓ Dependencies installed"
echo ""

# Create .env file
if [ ! -f .env ]; then
    echo "Creating .env file from template..."
    cp config/.env.example .env
    echo "✓ Created .env file"
    echo ""
    echo "⚠️  IMPORTANT: Edit .env and add your credentials:"
    echo "   - Google Cloud project ID"
    echo "   - Document AI processor ID"
    echo "   - Service account key path"
    echo "   - Database URL"
    echo ""
else
    echo "✓ .env file already exists"
    echo ""
fi

# Create output directories
echo "Creating output directories..."
mkdir -p outputs/ocr
mkdir -p outputs/data
mkdir -p outputs/reports
mkdir -p data
echo "✓ Output directories created"
echo ""

# Check if database is accessible
echo "Would you like to set up the database now? (y/n)"
read -r setup_db

if [ "$setup_db" = "y" ]; then
    echo "Enter your database URL (or press Enter to skip):"
    read -r db_url
    
    if [ -n "$db_url" ]; then
        echo "Running database schema..."
        psql "$db_url" -f scripts/schema.sql
        echo "✓ Database schema created"
        echo ""
    fi
fi

echo "============================================"
echo "Setup Complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo "1. Edit .env with your credentials"
echo "2. Place CMO report PDF in data/ folder"
echo "3. Run: python src/pipeline.py data/your_report.pdf"
echo ""
echo "For help: python src/pipeline.py --help"
echo ""
