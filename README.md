# FYP Project 2 - Online Exam Platform with Anomaly Behavior Detection

## User Manual: How to Run the Application

This is a comprehensive Flask-based online exam monitoring system that uses AI for real-time student monitoring during examinations. The system includes head movement detection, screen monitoring, plagiarism detection, and administrative features.

## Table of Contents
1. [System Requirements](#system-requirements)
2. [Installation Guide](#installation-guide)
3. [Database Setup](#database-setup)
4. [Configuration](#configuration)
5. [Running the Application](#running-the-application)
6. [Accessing the System](#accessing-the-system)
7. [System Features](#system-features)
8. [Troubleshooting](#troubleshooting)

---

## System Requirements

### Hardware Requirements
- **Processor**: Intel i5 or equivalent (recommended for AI processing)
- **RAM**: Minimum 8GB (16GB recommended for optimal AI performance)
- **Storage**: At least 2GB free space for dependencies and evidence storage
- **Camera**: Webcam required for head movement detection
- **Network**: Stable internet connection

### Software Requirements
- **Operating System**: Windows 10/11, macOS, or Linux
- **Python**: Version 3.8 or higher
- **MongoDB**: Version 4.4 or higher
- **Web Browser**: Chrome, Firefox, or Safari (Chrome recommended for best compatibility)

---

## Installation Guide

### Step 1: Install Python
1. Download Python 3.8+ from [python.org](https://www.python.org/downloads/)
2. During installation, make sure to check "Add Python to PATH"
3. Verify installation by opening Command Prompt/Terminal and running:
   ```bash
   python --version
   ```

### Step 2: Install MongoDB
1. **Option A: MongoDB Atlas (Cloud - Recommended for beginners)**
   - Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
   - Create a free account and cluster
   - Get your connection string for later use

2. **Option B: Local MongoDB Installation**
   - Download MongoDB Community Server from [mongodb.com](https://www.mongodb.com/try/download/community)
   - Follow the installation guide for your operating system
   - Start MongoDB service after installation

### Step 3: Clone or Download the Project
1. **If using Git:**
   ```bash
   git clone <repository-url>
   cd FYPProject2
   ```

2. **If downloading ZIP:**
   - Extract the ZIP file to your desired location
   - Open Command Prompt/Terminal in the project folder

### Step 4: Create Virtual Environment (Recommended)
```bash
# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate
```

### Step 5: Install Required Dependencies
```bash
# Install all required packages
pip install -r requirements.txt

# If you encounter any issues, install packages individually:
pip install Flask Flask-PyMongo Werkzeug pymongo scikit-learn opencv-python numpy requests torch torchvision python-docx openpyxl python-dateutil pytz python-dotenv Pillow
```

---

## Database Setup

### Step 6: Configure MongoDB Connection

1. **Create a `.env` file** in the project root directory:
   ```env
   MONGO_URI=mongodb://localhost:27017/exam_system
   SECRET_KEY=your-secret-key-here
   SMTP_SERVER=smtp.gmail.com
   SMTP_PORT=587
   EMAIL_USERNAME=your-email@gmail.com
   EMAIL_PASSWORD=your-app-password
   ```

2. **For MongoDB Atlas (Cloud):**
   Replace the MONGO_URI with your Atlas connection string:
   ```env
   MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/exam_system?retryWrites=true&w=majority
   ```

3. **For Local MongoDB:**
   Keep the default local connection:
   ```env
   MONGO_URI=mongodb://localhost:27017/exam_system
   ```

### Step 7: Initialize Database Collections
The application will automatically create the necessary collections when first run. The main collections include:
- `users` (students, lecturers, admins)
- `courses`
- `assessments`
- `exam_violations`
- `exam_evidence`
- `exam_environment_rules`

---

## Configuration

### Step 8: Download AI Model
1. **Create the models directory** if it doesn't exist:
   ```bash
   mkdir models
   ```

2. **Download the HopeNet model** for head pose detection:
   - The model file `hopenet_robust_alpha1.pkl` should be placed in the `models/` folder
   - If not included, you can download it from the HopeNet repository

### Step 9: Set Up Evidence Storage
The application will automatically create these directories:
```
static/
└── evidence/
    ├── screenshots/
    └── videos/
```

---

## Running the Application

### Step 10: Start the Application

1. **Make sure MongoDB is running** (if using local installation)

2. **Navigate to the project directory** and activate your virtual environment:
   ```bash
   # On Windows:
   venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   ```

3. **Run the Flask application:**
   ```bash
   python app.py
   ```

4. **You should see output similar to:**
   ```
   * Running on http://127.0.0.1:5000
   * Debug mode: on
   ```

5. **The application is now running!** Open your web browser and go to:
   ```
   http://localhost:5000
   ```

---

## Accessing the System

### Step 11: First-Time Setup

1. **Access the application** at `http://localhost:5000`

2. **Register initial users:**
   - Go to `/register` for student registration
   - Go to `/lec_register` for lecturer registration

3. **Login with your credentials:**
   - Students: Use the main login page
   - Lecturers: Use lecturer login
   - Admins: Use admin login (if configured)

### Step 12: System Navigation

**For Lecturers:**
1. Create courses and assessments
2. Set up exam environments and rules
3. Monitor student violations and evidence
4. Generate reports and analytics

**For Students:**
1. Join courses using course codes
2. View assessments and exam schedules
3. Take monitored exams with AI supervision
4. Submit assignments and view results

---

## System Features

### Core Features
- **AI-Powered Head Movement Detection** using HopeNet deep learning
- **Real-time Screen Monitoring** with tab switching detection
- **Keyboard Shortcut Blocking** to prevent cheating
- **Automatic Evidence Collection** (screenshots and videos)
- **Plagiarism Detection** using text similarity algorithms
- **Comprehensive Reporting** and analytics dashboard

### User Roles
- **Students**: Take exams, submit assignments, view results
- **Lecturers**: Create courses, manage exams, review violations
- **Admins**: System-wide management and configuration

### Evidence Collection
- Automatic screenshot capture on violations
- Video recording of suspicious activities
- Timeline analysis of exam progress
- Head pose data for detailed analysis

---

## Troubleshooting

### Common Issues and Solutions

**Issue 1: ModuleNotFoundError**
```bash
# Solution: Install missing packages
pip install <missing-package-name>
```

**Issue 2: MongoDB Connection Error**
```bash
# Check if MongoDB is running
# For local MongoDB:
net start MongoDB
# Or check MongoDB Atlas connection string
```

**Issue 3: Camera/Webcam Not Detected**
- Ensure webcam is connected and not used by other applications
- Grant camera permissions to your web browser
- Try using Google Chrome for better compatibility

**Issue 4: Port Already in Use**
```bash
# Change the port in app.py or kill the process using port 5000
# Windows:
netstat -ano | findstr :5000
taskkill /PID <process-id> /F

# macOS/Linux:
lsof -ti:5000 | xargs kill -9
```

**Issue 5: torch/torchvision Installation Issues**
```bash
# For CPU-only installation:
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu

# For GPU support (if available):
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

**Issue 6: OpenCV Installation Issues**
```bash
# Try alternative installation:
pip uninstall opencv-python
pip install opencv-python-headless
```

### Performance Optimization

**For Better AI Performance:**
1. Ensure sufficient RAM (16GB recommended)
2. Close unnecessary applications during use
3. Use GPU acceleration if available
4. Adjust AI detection intervals in settings

**For Network Issues:**
1. Ensure stable internet connection
2. Check firewall settings
3. Use recommended browsers (Chrome preferred)

### Getting Help

**Log Files:**
- Application logs are displayed in the terminal where you run `python app.py`
- Check browser console for frontend errors (F12 → Console)

**Common Commands for Debugging:**
```bash
# Check Python version
python --version

# Check installed packages
pip list

# Test MongoDB connection
python -c "import pymongo; print('MongoDB connection OK')"

# Test OpenCV
python -c "import cv2; print('OpenCV version:', cv2.__version__)"

# Test PyTorch
python -c "import torch; print('PyTorch version:', torch.__version__)"
```

---

## Additional Resources

### Documentation
- [Flask Documentation](https://flask.palletsprojects.com/)
- [MongoDB Documentation](https://docs.mongodb.com/)
- [OpenCV Documentation](https://docs.opencv.org/)
- [PyTorch Documentation](https://pytorch.org/docs/)

### Support
- Check the application logs for detailed error messages
- Verify all dependencies are correctly installed
- Ensure proper permissions for camera and file access
- Test with different browsers if issues persist

---

## Security Notes

1. **Change default secret keys** in production
2. **Use HTTPS** in production environments
3. **Configure proper firewall rules**
4. **Regularly update dependencies** for security patches
5. **Backup your database** regularly
6. **Monitor system resources** during peak usage

---

## Project Structure
```
FYPProject2/
├── app.py                          # Main Flask application
├── head_pose_detector.py           # AI head pose detection
├── requirements.txt                # Python dependencies
├── README.md                       # This user manual
├── .env                           # Environment configuration
├── models/                        # AI models directory
│   └── hopenet_robust_alpha1.pkl  # Head pose detection model
├── static/                        # Static files (CSS, JS, images)
│   ├── css/                       # Stylesheets
│   ├── js/                        # JavaScript files
│   ├── img/                       # Images
│   └── evidence/                  # Evidence storage
│       ├── screenshots/           # Screenshot evidence
│       └── videos/               # Video evidence
├── templates/                     # HTML templates
├── utils/                         # Utility modules
└── __pycache__/                  # Python cache files
```

This system provides a complete solution for secure online examination with AI-powered monitoring capabilities. Follow the steps above to get started with your examination system.


