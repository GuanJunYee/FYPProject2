# Student Exam Interface Implementation Guide

This document explains how the student exam interface implements security monitoring features including head movement detection, screen monitoring, and shortcut blocking.

## Table of Contents
1. [Overview](#overview)
2. [Head Movement Detection](#head-movement-detection)
3. [Screen Monitoring](#screen-monitoring)
4. [Shortcut Disable Checking](#shortcut-disable-checking)
5. [Evidence Storage](#evidence-storage)
6. [File Structure](#file-structure)

---

## Overview

The student exam interface provides comprehensive monitoring during online examinations through three main security systems:

1. **Head Movement Detection** - AI-powered head pose estimation using HopeNet
2. **Screen Monitoring** - Tab switching and screen sharing detection
3. **Shortcut Blocking** - Prevention of forbidden keyboard shortcuts and right-clicks

All violations are automatically recorded with evidence (screenshots and videos) for lecturer review.

---

## Head Movement Detection

### Implementation Architecture

The head movement detection system uses a **HopeNet deep learning model** for real-time head pose estimation.

#### Core Components

**1. Backend Head Pose Detector (`head_pose_detector.py`)**

```python
class HeadPoseDetector:
    def __init__(self):
        """Initialize HopeNet-based head pose detector"""
        
        # Load OpenCV Haar Cascade face detector for bounding box detection
        self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        
        # Initialize HopeNet model (ResNet-50 architecture)
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.model = Hopenet(torchvision.models.resnet.Bottleneck, [3, 4, 6, 3], 66)
        
        # Load pre-trained model weights
        model_path = os.path.join('models', 'hopenet_robust_alpha1.pkl')
        saved_state_dict = torch.load(model_path, map_location=self.device, weights_only=False)
        self.model.load_state_dict(saved_state_dict)
        self.model.to(self.device)
        self.model.eval()
        
        # Image preprocessing for HopeNet
        self.transform = transforms.Compose([
            transforms.Resize(224),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        ])
```

**2. Real-time Pose Detection**

```python
def detect_head_pose_with_landmarks(self, image):
    """Detect head pose using HopeNet deep learning model"""
    
    # Convert to grayscale for face detection
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Detect faces using OpenCV Haar Cascade
    faces = self.face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.3,
        minNeighbors=5,
        minSize=(30, 30)
    )
    
    if len(faces) == 0:
        return None
    
    # Get the largest face
    x, y, w, h = faces[0] if len(faces) == 1 else faces[np.argmax([w*h for (x,y,w,h) in faces])]
    
    # Extract and resize face to 224x224 for HopeNet
    face_img = image[y:y+h, x:x+w]
    face_img = cv2.resize(face_img, (224, 224))
    face_img = Image.fromarray(cv2.cvtColor(face_img, cv2.COLOR_BGR2RGB))
    
    # Preprocess for HopeNet
    input_tensor = self.transform(face_img).unsqueeze(0).to(self.device)
    
    # Get head pose prediction
    with torch.no_grad():
        yaw_pred, pitch_pred, roll_pred = self.model(input_tensor)
        
        # Convert from classification to regression
        yaw_predicted = torch.sum(torch.softmax(yaw_pred, dim=1) * self.idx_tensor) * 3 - 99
        pitch_predicted = torch.sum(torch.softmax(pitch_pred, dim=1) * self.idx_tensor) * 3 - 99
        roll_predicted = torch.sum(torch.softmax(roll_pred, dim=1) * self.idx_tensor) * 3 - 99
        
        pose = {
            'yaw': float(yaw_predicted.item()),
            'pitch': float(pitch_predicted.item()),
            'roll': float(roll_predicted.item())
        }
    
    return {
        'pose': pose,
        'landmarks': self.generate_facial_landmarks(x, y, w, h),
        'bbox': {'x': x, 'y': y, 'width': w, 'height': h},
        'nose_point': {'x': int(x + w // 2), 'y': int(y + h // 2)},
        'confidence': self.calculate_detection_confidence(w, h, image.shape)
    }
```

**3. Frontend JavaScript Implementation (`head-movement-detection.js`)**

```javascript
class HeadMovementDetector {
    constructor(assessmentCode, studentId, examStartTime = null, examEndTime = null) {
        this.assessmentCode = assessmentCode;
        this.studentId = studentId;
        this.examStartTime = examStartTime;
        this.examEndTime = examEndTime;
        
        // Dynamic settings loaded from backend
        this.settings = {
            violation_duration: 3000,  // milliseconds
            warning_count: 5,          // warnings before violation
            max_yaw: 25,              // degrees
            max_pitch: 15,            // degrees
            detection_interval: 1000   // 1 second between detections
        };
        
        // State tracking
        this.lookAwayStartTime = null;
        this.warningCounts = {};
        this.violationBuffer = false;
    }

    async startDetection() {
        // Load dynamic settings from backend
        await this.loadSettings();
        
        // Setup webcam
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: { ideal: 640 }, height: { ideal: 480 } } 
        });
        this.video.srcObject = stream;
        
        // Setup canvas for frame capture
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.canvas.width = 320;
        this.canvas.height = 240;
        
        // Start periodic detection
        this.startPeriodicDetection();
        
        // Start continuous recording for evidence
        await this.startContinuousRecording();
    }

    async captureAndAnalyzeFrame() {
        // Draw current video frame to canvas
        this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
        
        // Convert to base64 and send to server
        const imageDataUrl = this.canvas.toDataURL('image/jpeg', 0.7);
        
        const response = await fetch('/api/stream_head_pose', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image_data: imageDataUrl,
                timestamp: new Date().toISOString(),
                assessment_code: this.assessmentCode
            })
        });

        if (response.ok) {
            const result = await response.json();
            this.handleHeadPoseResult(result);
        }
    }

    handleHeadPoseResult(result) {
        if (result.status === 'success') {
            this.currentPose = result.pose;
            
            // Check if looking away using dynamic thresholds
            const isLookingAway = result.is_looking_away || 
                                 Math.abs(this.currentPose.yaw) > this.settings.max_yaw || 
                                 Math.abs(this.currentPose.pitch) > this.settings.max_pitch;
            
            if (isLookingAway) {
                this.handleLookingAway(this.currentPose);
            } else {
                this.handleLookingForward();
            }
            
            // Update visual indicators
            this.updateVisualIndicators(result);
            this.updatePoseIndicator(this.currentPose);
        }
    }
}
```

**4. Warning System Implementation**

```javascript
handleViolationWithWarnings(type, description) {
    // Check if we're in buffer period
    if (this.violationBuffer) {
        return;
    }
    
    // Use combined warning counter for all head movement violations
    const combinedViolationType = 'head_movement_violation';
    
    if (!this.warningCounts[combinedViolationType]) {
        this.warningCounts[combinedViolationType] = 0;
    }

    this.warningCounts[combinedViolationType]++;
    
    if (this.warningCounts[combinedViolationType] <= this.settings.warning_count) {
        // Show warning message
        this.showWarningMessage(type, this.warningCounts[combinedViolationType], description);
    } else {
        // Record actual violation after warnings exceeded
        this.recordEnhancedViolation(type, description);
        
        // Reset warning count and start buffer period
        this.resetViolationCounting();
    }
}

showWarningMessage(type, warningNumber, description) {
    const remainingWarnings = this.settings.warning_count - warningNumber + 1;
    
    let warningTitle = `⚠️ HEAD MOVEMENT WARNING ${warningNumber}/${this.settings.warning_count}`;
    let warningMessage = type === 'looking_away' 
        ? `Please look at the screen. ${remainingWarnings} more warning(s) before violation is recorded.`
        : `Please ensure your face is visible to the camera. ${remainingWarnings} more warning(s) before violation is recorded.`;
    
    // Create warning display
    let warningElement = document.getElementById('head-warning-display');
    if (!warningElement) {
        warningElement = document.createElement('div');
        warningElement.id = 'head-warning-display';
        warningElement.style.cssText = `
            position: fixed;
            top: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: #fbbf24;
            color: #92400e;
            padding: 12px 20px;
            border-radius: 8px;
            font-weight: bold;
            z-index: 1000;
        `;
        document.body.appendChild(warningElement);
    }

    warningElement.innerHTML = `
        <div style="text-align: center;">${warningTitle}</div>
        <div style="font-size: 14px; margin-top: 4px;">${warningMessage}</div>
    `;
    
    warningElement.style.display = 'block';
    setTimeout(() => warningElement.style.display = 'none', 3000);
}
```

**5. Timeline Support for Exam Progress Analysis**

```javascript
getExamTimelinePosition() {
    if (!this.examStartTime || !this.examEndTime) {
        return 'unknown';
    }

    const now = Date.now();
    const examStart = new Date(this.examStartTime).getTime();
    const examEnd = new Date(this.examEndTime).getTime();
    const totalDuration = examEnd - examStart;
    const elapsedTime = now - examStart;
    const progressPercent = (elapsedTime / totalDuration) * 100;

    if (progressPercent <= 25) {
        return 'exam_start';
    } else if (progressPercent >= 75) {
        return 'exam_end';
    } else {
        return 'exam_middle';
    }
}

async recordEnhancedViolation(type, description) {
    const timelinePosition = this.getExamTimelinePosition();
    const progressInfo = this.getExamProgressInfo();

    // Capture screenshot immediately while looking away
    const violationScreenshot = await this.captureScreenshot();
    
    // Start video recording during violation
    this.startViolationVideoRecording();

    const violationData = {
        assessment_code: this.assessmentCode,
        student_id: this.studentId,
        violation_type: type,
        description: description,
        timestamp: new Date().toISOString(),
        
        // Timeline data for lecturer analysis
        exam_timeline_position: timelinePosition,
        exam_start_time: this.examStartTime,
        exam_end_time: this.examEndTime,
        exam_progress_percent: progressInfo.progress,
        time_remaining_ms: progressInfo.timeRemaining,
        elapsed_time_ms: progressInfo.elapsedTime,
        
        // Current pose data
        head_pose_data: this.currentPose ? {
            yaw: this.currentPose.yaw,
            pitch: this.currentPose.pitch,
            roll: this.currentPose.roll
        } : null,
        
        // Detection settings used
        detection_settings: {
            max_yaw: this.settings.max_yaw,
            max_pitch: this.settings.max_pitch,
            violation_duration: this.settings.violation_duration,
            warning_count: this.settings.warning_count
        }
    };

    const response = await fetch('/api/record_violation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(violationData)
    });

    if (response.ok) {
        const result = await response.json();
        this.lastViolationId = result.violation_id;
        this.violationRecorded = true;
        this.storedViolationScreenshot = violationScreenshot;
    }
}
```

---

## Screen Monitoring

### Implementation Architecture

The screen monitoring system tracks tab switching and ensures screen sharing is active throughout the exam.

#### Core Components

**1. Screen Capture Setup (`exam-screenmonitoring.js`)**

```javascript
class ExamScreenMonitor {
    constructor(assessmentCode, studentId) {
        this.assessmentCode = assessmentCode;
        this.studentId = studentId;
        this.isMonitoring = false;
        this.webcamStream = null;
        this.screenStream = null;
        
        // Pre-recording system for BEFORE evidence
        this.preRecorder = null;
        this.recordedSegments = [];
        this.maxPreRecordTime = 6000; // 6 seconds of BEFORE
        this.segmentDuration = 2000;   // 2 seconds per segment
        
        // Tab switch detection
        this.tabSwitchCount = 0;
        this.violationCount = 0;
        this.isCapturingEvidence = false;
    }

    async setupScreenCapture() {
        try {
            // Request screen sharing permission
            this.screenStream = await navigator.mediaDevices.getDisplayMedia({ 
                video: { 
                    mediaSource: 'screen',
                    width: { max: 1920 },
                    height: { max: 1080 }
                }, 
                audio: false 
            });
            
            // Listen for screen sharing end
            this.screenStream.getVideoTracks()[0].addEventListener('ended', () => {
                this.recordViolation('SCREEN_SHARE_STOPPED', 'Student stopped screen sharing');
                this.showViolationWarning('⚠️ Screen sharing stopped! Please restart.');
            });
            
        } catch (error) {
            this.recordViolation('SCREEN_CAPTURE_DENIED', 'Screen capture was denied');
        }
    }

    async startPreRecording() {
        // Continuously record 6-second segments for BEFORE evidence
        const streamToRecord = this.screenStream || this.webcamStream;
        
        this.preRecorder = new MediaRecorder(streamToRecord, {
            mimeType: 'video/webm;codecs=vp8',
            videoBitsPerSecond: 1500000
        });

        this.preRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                const timestamp = Date.now();
                this.recordedSegments.push({
                    data: event.data,
                    timestamp: timestamp,
                    size: event.data.size
                });

                // Keep only last 6 seconds (3 segments x 2 seconds)
                const cutoffTime = timestamp - this.maxPreRecordTime;
                this.recordedSegments = this.recordedSegments.filter(
                    segment => segment.timestamp > cutoffTime
                );
            }
        };

        this.preRecorder.start(this.segmentDuration);
    }
}
```

**2. Tab Switch Detection**

```javascript
setupEventListeners() {
    // Enhanced file dialog detection to prevent false violations
    this.setupFileDialogDetection();
    
    // Start TRANSITION recording BEFORE tab switch
    window.addEventListener('blur', () => {
        if (this.isMonitoring && !this.isRecordingTransition) {
            // Check if this is a file dialog before starting transition recording
            if (this.isFileDialogLikelyActive()) {
                return;
            }
            
            this.startTransitionRecording();
        }
    });
    
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.isMonitoring && !this.isCapturingEvidence) {
            // Check if this is a file dialog before recording violation
            if (this.isFileDialogLikelyActive()) {
                return;
            }
            
            this.tabSwitchCount++;
            this.handleTabSwitchLeaving();
        } else if (!document.hidden && this.isMonitoring) {
            this.stopTransitionRecording();
        }
    });
}

setupFileDialogDetection() {
    // Listen for file input clicks to prevent false violations
    document.addEventListener('click', (event) => {
        if (event.target && event.target.type === 'file') {
            this.markFileDialogActive();
        }
    });
    
    // Listen for any button clicks that might trigger file operations
    document.addEventListener('click', (event) => {
        const target = event.target;
        if (target) {
            const elementText = target.textContent || target.value || target.innerText || '';
            const isFileRelated = /submit|upload|file|attach|browse|choose|send/i.test(elementText);
            
            if (isFileRelated) {
                this.markFileDialogActive();
            }
        }
    });
}

async handleTabSwitchLeaving() {
    if (this.isCapturingEvidence) {
        return;
    }

    this.isCapturingEvidence = true;
    
    // Record violation
    const violation = {
        type: 'TAB_SWITCH',
        description: `Student switched away from exam tab (Count: ${this.tabSwitchCount})`,
        timestamp: new Date().toISOString()
    };

    this.recordViolation(violation.type, violation.description);
    this.showViolationWarning('Tab switch detected! Return to exam immediately.');

    // Capture screenshot immediately
    await this.captureScreenshot('tab_switch');

    // Reset flag after delay
    setTimeout(() => {
        this.isCapturingEvidence = false;
    }, 2000);
}
```

**3. Transition Video Recording**

```javascript
async startTransitionRecording() {
    try {
        const streamToRecord = this.screenStream || this.webcamStream;
        
        this.transitionChunks = [];
        this.transitionRecorder = new MediaRecorder(streamToRecord, {
            mimeType: 'video/webm;codecs=vp8',
            videoBitsPerSecond: 2000000
        });

        this.transitionRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.transitionChunks.push(event.data);
            }
        };

        this.transitionRecorder.onstop = async () => {
            if (this.transitionChunks.length > 0) {
                const transitionBlob = new Blob(this.transitionChunks, { type: 'video/webm;codecs=vp8' });
                
                // Test and upload
                const isValid = await this.testVideoPlayback(transitionBlob, 'TRANSITION video');
                if (isValid) {
                    await this.uploadVideoWithMetadata(
                        transitionBlob, 
                        'tab_switch', 
                        '.webm', 
                        'transition', 
                        8 // 8 seconds to capture full transition
                    );
                }
            }
            
            this.isRecordingTransition = false;
        };

        // Start recording immediately
        this.transitionRecorder.start(500);
        this.isRecordingTransition = true;

    } catch (error) {
        console.error('Failed to start TRANSITION recording:', error);
        this.isRecordingTransition = false;
    }
}
```

---

## Shortcut Disable Checking

### Implementation Architecture

The shortcut blocking system prevents students from using forbidden keyboard shortcuts and right-click operations.

#### Core Components

**1. Dynamic Rule Loading (`exam-shortcutdisable.js`)**

```javascript
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Load exam environment rules from backend
        const response = await fetch('/api/exam_environment_rules');
        const rules = await response.json();

        // Right-click blocking
        if (rules.block_right_click) {
            document.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                recordShortcutViolation('FORBIDDEN_SHORTCUT', 'Right-click attempted');
            });
        }

        // Keyboard shortcut blocking
        document.addEventListener('keydown', (e) => {
            let blocked = false;
            let description = '';

            // Check each shortcut individually
            if (rules.block_f12 && e.key === 'F12') {
                blocked = true;
                description = 'Developer Tools (F12) blocked';
            }
            else if (rules.block_ctrl_shift_i && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'i') {
                blocked = true;
                description = 'Inspect Element (Ctrl+Shift+I) blocked';
            }
            else if (rules.block_ctrl_u && e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'u') {
                blocked = true;
                description = 'View Source (Ctrl+U) blocked';
            }
            else if (rules.block_copy && e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'c') {
                blocked = true;
                description = 'Copy (Ctrl+C) blocked';
            }
            else if (rules.block_paste && e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'v') {
                blocked = true;
                description = 'Paste (Ctrl+V) blocked';
            }

            if (blocked) {
                e.preventDefault();
                e.stopPropagation();
                recordShortcutViolation('FORBIDDEN_SHORTCUT', description);
                return false;
            }
        }, true); // Use capture phase

    } catch (err) {
        console.error('Failed to fetch exam environment rules:', err);
    }
});
```

**2. Violation Recording with Evidence**

```javascript
async function recordShortcutViolation(type, description) {
    try {
        // Show warning to student
        showShortcutWarning(`⚠️ ${description}`);
        await new Promise(resolve => setTimeout(resolve, 500));

        const assessmentCodeElement = document.getElementById('assessment-code');
        const studentIdElement = document.getElementById('student-id');
        
        const assessmentCode = assessmentCodeElement.value;
        const studentId = studentIdElement.value;

        const payload = {
            assessment_code: assessmentCode,
            student_id: studentId,
            violation_type: type,
            description: description,
            timestamp: new Date().toISOString()
        };

        // Save violation and get ID
        const response = await fetch('/api/record_violation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            const result = await response.json();
            lastViolationId = result.violation_id;
        }

        // Capture screenshot AFTER violation logged
        const screenshot = await captureScreenshotWithWarning();
        if (screenshot) {
            await uploadShortcutScreenshot(screenshot, type, assessmentCode, studentId);
        }

    } catch (error) {
        console.error('Error recording shortcut violation:', error);
    }
}

// Capture screenshot WITH warning message visible
async function captureScreenshotWithWarning() {
    try {
        let screenshot = null;
        
        // Try screen stream capture first (best quality)
        if (window.screenMonitor && window.screenMonitor.screenStream) {
            screenshot = await captureFromScreenStream(window.screenMonitor.screenStream);
            
            if (screenshot) {
                return screenshot;
            }
        }
        
        // Try HTML2Canvas capture (captures full page including warnings)
        if (typeof html2canvas !== 'undefined') {
            const canvas = await html2canvas(document.body, {
                useCORS: true,
                allowTaint: true,
                scale: 0.7,
                width: window.innerWidth,
                height: window.innerHeight,
                logging: false
            });
            
            screenshot = await new Promise((resolve) => {
                canvas.toBlob((blob) => {
                    resolve(blob);
                }, 'image/png');
            });
            
            if (screenshot) {
                return screenshot;
            }
        }
        
        // Fallback to basic page capture
        screenshot = await capturePageWithWarning();
        return screenshot;
        
    } catch (error) {
        console.error('Screenshot with warning capture failed:', error);
        return null;
    }
}
```

**3. Backend Rule Configuration (app.py)**

```python
@app.route('/api/exam_environment_rules')
def get_exam_environment_rules():
    """Enhanced to include head movement settings"""
    try:
        rule = mongo.db.exam_environment_rules.find_one({}, {'_id': 0})
        
        # If no rule exists, return defaults
        if not rule:
            rule = {
                'block_f12': True,
                'block_ctrl_shift_i': False,
                'block_ctrl_u': False,
                'block_right_click': True,
                'block_copy': False,
                'block_paste': False,
                'head_movement_settings': {
                    'violation_duration': 2000,  # milliseconds
                    'warning_count': 3,
                    'max_yaw': 20,
                    'max_pitch': 10
                }
            }
        
        return jsonify(rule)
        
    except Exception as e:
        print(f"Error loading exam environment rules: {e}")
        return jsonify({'error': 'Failed to load rules'}), 500
```

---

## Evidence Storage

### Database Structure

The system uses MongoDB to store violations and evidence with the following collections:

#### 1. exam_violations Collection

```python
violation_record = {
    'assessment_code': 'CS101_EXAM1',
    'student_id': 'STU001',
    'violation_type': 'looking_away',  # or 'tab_switch', 'forbidden_shortcut'
    'description': 'Looking away right: yaw=30.5°, pitch=5.2°',
    'timestamp': datetime.now(),
    
    # Timeline data for lecturer analysis
    'exam_timeline_position': 'exam_middle',  # exam_start/middle/end
    'exam_start_time': '2024-01-15T09:00:00Z',
    'exam_end_time': '2024-01-15T11:00:00Z',
    'exam_progress_percent': 45.2,
    'time_remaining_ms': 3600000,
    'elapsed_time_ms': 2700000,
    
    # Head pose data when violation occurred
    'head_pose_data': {
        'yaw': 30.5,
        'pitch': 5.2,
        'roll': -2.1
    },
    
    # Detection settings that were active
    'detection_settings': {
        'max_yaw': 25,
        'max_pitch': 15,
        'violation_duration': 3000,
        'warning_count': 5
    },

    'status': 'pending',  # pending/reviewed/dismissed
    'notes': ''
}
```

#### 2. exam_evidence Collection

```python
evidence_record = {
    'violation_id': ObjectId('...'),  # Links to violation
    'assessment_code': 'CS101_EXAM1',
    'student_id': 'STU001',
    'violation_type': 'looking_away',
    'timestamp': datetime.now(),
    
    # Timeline context
    'exam_timeline_position': 'exam_middle',
    'exam_start_time': '2024-01-15T09:00:00Z',
    'exam_end_time': '2024-01-15T11:00:00Z',
    'exam_progress_percent': 45.2,
    
    # Head pose context when evidence was captured
    'head_pose_data': {
        'yaw': 30.5,
        'pitch': 5.2,
        'roll': -2.1
    },
    
    # File information
    'files': [
        {
            'type': 'screenshot',
            'filename': 'looking_away_screenshot_CS101_EXAM1_STU001_20240115_093045.png',
            'filepath': '/static/evidence/screenshots/...',
            'size': 156789,
            'url': '/static/evidence/screenshots/...'
        },
        {
            'type': 'video',
            'filename': 'looking_away_enhanced_CS101_EXAM1_STU001_20240115_093045.webm',
            'filepath': '/static/evidence/videos/...',
            'size': 2456789,
            'duration': 5,
            'url': '/static/evidence/videos/...'
        }
    ],
    'total_files': 2,
    'total_size': 2613578,
    'uploaded_at': datetime.now(),
    'status': 'uploaded'
}
```

### File Storage Structure

Evidence files are stored in the filesystem with organized folder structure:

```
static/
└── evidence/
    ├── screenshots/
    │   ├── looking_away_screenshot_CS101_EXAM1_STU001_20240115_093045.png
    │   ├── tab_switch_screenshot_CS101_EXAM1_STU002_20240115_093145.png
    │   └── forbidden_shortcut_screenshot_CS101_EXAM1_STU003_20240115_093245.png
    └── videos/
        ├── looking_away_enhanced_CS101_EXAM1_STU001_20240115_093045.webm
        ├── tab_switch_transition_CS101_EXAM1_STU002_20240115_093145.webm
        └── looking_away_enhanced_CS101_EXAM1_STU004_20240115_093345.webm
```

### Evidence Upload Implementation

**1. Backend Evidence Upload API (app.py)**

```python
@app.route('/api/upload_violation_evidence', methods=['POST'])
def upload_violation_evidence():
    """Enhanced evidence upload with timeline and pose data"""
    if 'user_id' not in session or session.get('role') != 'student':
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        # Get form data
        assessment_code = request.form.get('assessment_code')
        student_id = request.form.get('student_id')
        violation_type = request.form.get('violation_type')
        violation_id = request.form.get('violation_id')
        
        # Get enhanced timeline data
        exam_timeline_position = request.form.get('exam_timeline_position')
        exam_progress_percent = request.form.get('exam_progress_percent')
        head_pose_data_str = request.form.get('head_pose_data')
        
        uploaded_files = []
        timestamp_str = datetime.now().strftime('%Y%m%d_%H%M%S_%f')[:-3]
        
        # Handle screenshot upload
        if 'screenshot' in request.files:
            screenshot = request.files['screenshot']
            if screenshot and screenshot.filename:
                filename = secure_filename(f"{violation_type}_screenshot_{assessment_code}_{student_id}_{timestamp_str}.png")
                filepath = os.path.join(SCREENSHOTS_FOLDER, filename)
                
                os.makedirs(SCREENSHOTS_FOLDER, exist_ok=True)
                screenshot.save(filepath)
                
                if os.path.exists(filepath):
                    file_size = os.path.getsize(filepath)
                    uploaded_files.append({
                        'type': 'screenshot',
                        'filename': filename,
                        'filepath': filepath,
                        'size': file_size,
                        'url': f'/static/evidence/screenshots/{filename}'
                    })

        # Handle video upload
        if 'video' in request.files:
            video = request.files['video']
            if video and video.filename:
                original_extension = os.path.splitext(video.filename)[1] or '.webm'
                filename = secure_filename(f"{violation_type}_enhanced_{assessment_code}_{student_id}_{timestamp_str}{original_extension}")
                filepath = os.path.join(VIDEOS_FOLDER, filename)
                
                os.makedirs(VIDEOS_FOLDER, exist_ok=True)
                video.save(filepath)
                
                if os.path.exists(filepath):
                    file_size = os.path.getsize(filepath)
                    uploaded_files.append({
                        'type': 'video',
                        'filename': filename,
                        'filepath': filepath,
                        'size': file_size,
                        'url': f'/static/evidence/videos/{filename}'
                    })

        # Create enhanced evidence record
        if uploaded_files:
            evidence_record = {
                'violation_id': ObjectId(violation_id) if violation_id else None,
                'assessment_code': assessment_code,
                'student_id': student_id,
                'violation_type': violation_type,
                'timestamp': datetime.now(),
                'exam_timeline_position': exam_timeline_position,
                'exam_progress_percent': float(exam_progress_percent) if exam_progress_percent else None,
                'head_pose_data': json.loads(head_pose_data_str) if head_pose_data_str else None,
                'files': uploaded_files,
                'total_files': len(uploaded_files),
                'total_size': sum(f.get('size', 0) for f in uploaded_files),
                'uploaded_at': datetime.now(),
                'status': 'uploaded'
            }
            
            result = mongo.db.exam_evidence.insert_one(evidence_record)
            
            return jsonify({
                'status': 'success',
                'evidence_id': str(result.inserted_id),
                'files_uploaded': len(uploaded_files),
                'total_size': evidence_record['total_size'],
                'timeline_position': exam_timeline_position,
                'message': f'Successfully uploaded {len(uploaded_files)} file(s) with enhanced timeline data'
            }), 200
            
    except Exception as e:
        print(f"Error uploading enhanced evidence: {e}")
        return jsonify({'error': 'Failed to upload evidence', 'details': str(e)}), 500
```

### Evidence Retrieval for Lecturers

**1. Lecturer Violation Review Interface**

```python
@app.route('/lecturer/exam/violations/<assessment_code>')
def lecturer_exam_violations(assessment_code):
    """View violations for specific assessment with evidence"""
    if 'user_id' not in session or session.get('role') != 'lecturer':
        flash("Unauthorized access.", "danger")
        return redirect(url_for('login'))

    try:
        # Get violations with evidence count
        violations = list(mongo.db.exam_violations.find({
            'assessment_code': assessment_code
        }).sort('timestamp', -1))
        
        # Get evidence for each violation
        for violation in violations:
            evidence_count = mongo.db.exam_evidence.count_documents({
                'violation_id': violation['_id']
            })
            violation['evidence_count'] = evidence_count
            
            # Get evidence files
            evidence_records = list(mongo.db.exam_evidence.find({
                'violation_id': violation['_id']
            }))
            
            violation['evidence_files'] = []
            for evidence in evidence_records:
                violation['evidence_files'].extend(evidence.get('files', []))
            
            # Get student name
            student = mongo.db.users.find_one({'user_id': violation['student_id']})
            violation['student_name'] = student.get('name', 'Unknown') if student else 'Unknown'
        
        return render_template('lec_exam_violation.html', 
                             violations=violations, 
                             assessment_code=assessment_code)
        
    except Exception as e:
        flash(f"Error loading violations: {str(e)}", "danger")
        return redirect(url_for('lec_dashboard'))
```

### Timeline Analysis for Lecturers

The system provides timeline analysis showing when violations occur during exams:

```python
@app.route('/api/violations/timeline/<assessment_code>')
def get_violations_by_timeline(assessment_code):
    """Get violations grouped by timeline position for lecturer analysis"""
    try:
        violations = list(mongo.db.exam_violations.find(
            {'assessment_code': assessment_code}
        ))
        
        # Group by timeline position
        timeline_analysis = {
            'exam_start': [],    # First 25% of exam
            'exam_middle': [],   # Middle 50% of exam  
            'exam_end': [],      # Last 25% of exam
            'unknown': []        # No timeline data
        }
        
        for violation in violations:
            position = violation.get('exam_timeline_position', 'unknown')
            if position in timeline_analysis:
                timeline_analysis[position].append(violation)
            else:
                timeline_analysis['unknown'].append(violation)
        
        return jsonify({
            'status': 'success',
            'assessment_code': assessment_code,
            'timeline_analysis': timeline_analysis,
            'statistics': {
                'total_violations': len(violations),
                'by_position': {pos: len(viols) for pos, viols in timeline_analysis.items()}
            }
        })
        
    except Exception as e:
        return jsonify({'error': 'Failed to get violations'}), 500
```

---

## File Structure

```
FYPProject2/
├── app.py                                    # Main Flask application
├── head_pose_detector.py                     # HopeNet head pose detection
├── models/
│   └── hopenet_robust_alpha1.pkl            # Pre-trained HopeNet model
├── static/
│   ├── css/
│   │   └── student_exam_interface.css       # Exam interface styling
│   ├── js/
│   │   ├── head-movement-detection.js       # Head movement detection frontend
│   │   ├── exam-screenmonitoring.js         # Screen monitoring frontend
│   │   └── exam-shortcutdisable.js          # Shortcut blocking frontend
│   └── evidence/                            # Evidence storage directory
│       ├── screenshots/                     # Screenshot evidence files
│       └── videos/                          # Video evidence files
├── templates/
│   └── student_exam_interface.html          # Main exam interface template
└── utils/
    └── draw_utils.py                        # Drawing utilities for pose visualization
```

---

## Summary

The student exam interface implements a comprehensive monitoring system that:

1. **Monitors head movement** using AI-powered pose estimation with configurable thresholds and warning systems
2. **Tracks screen activity** through tab switching detection and screen sharing requirements  
3. **Blocks forbidden shortcuts** with dynamic rule configuration and immediate evidence capture
4. **Stores comprehensive evidence** including screenshots, videos, timeline data, and pose information
5. **Provides timeline analysis** for lecturers to understand violation patterns throughout exams

All violations are automatically detected, recorded with evidence, and made available for lecturer review through a comprehensive dashboard system.
