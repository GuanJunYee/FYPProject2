// ============================
// Enhanced HopeNet Head Movement Detection with Timeline Support & Enhanced Evidence Recording
// ============================

class HeadMovementDetector {
    constructor(assessmentCode, studentId, examStartTime = null, examEndTime = null) {
        this.assessmentCode = assessmentCode;
        this.studentId = studentId;
        this.examStartTime = examStartTime; // NEW: For timeline analysis
        this.examEndTime = examEndTime;     // NEW: For timeline analysis
        this.video = null;
        this.canvas = null;
        this.ctx = null;
        this.isDetecting = false;
        this.violationBuffer = false;           // Buffer period active
        this.bufferDuration = 5000;             // 5 seconds buffer
        this.bufferTimeout = null;              // Buffer timeout reference
        this.violationRecorded = false;
        
        // 🎨 Visual overlay canvas for bounding box and nose point
        this.overlayCanvas = null;
        this.overlayCtx = null;
        
        // 🔧 Dynamic settings loaded from backend (defaults will be overridden)
        this.settings = {
            violation_duration: 3000,  // milliseconds - need to look away for 3+ seconds
            warning_count: 5,          // 5 warnings before flagging (will be loaded from database)
            max_yaw: 25,              // degrees (will be loaded from database)
            max_pitch: 15,            // degrees (will be loaded from database)
            detection_interval: 1000   // 1 second between detections
        };
        
        // 🚨 Warning system state
        this.warningCounts = {}; // Track warnings per violation type
        this.currentWarningCount = 0;
        this.hasShownWarning = false;
        
        // State tracking
        this.lookAwayStartTime = null;
        this.lastViolationTime = 0;
        this.isLookingAway = false;
        this.detectionActive = false;
        this.detectionTimer = null;
        this.currentPose = null;
        
        // 🔧 NEW: No face detection tracking
        this.noFaceStartTime = null;
        this.isNoFaceDetected = false;
        
        // 🎥 UNIFIED video recording system
        this.mainRecorder = null;
        this.recordedChunks = [];
        this.isRecording = false;
        this.violationStartTime = null;
        this.preRecordDuration = 5000; // 5 seconds before
        this.postRecordDuration = 3000; // 3 seconds after
        
        // 🔧 NEW: Store violation screenshot captured during actual violation
        this.storedViolationScreenshot = null;
        
        this.lastViolationId = null; 

        console.log(`🤖 Enhanced Head Movement Detector initialized for ${assessmentCode}`);
        if (examStartTime && examEndTime) {
            console.log(`📅 Exam timeline: ${new Date(examStartTime).toLocaleString()} → ${new Date(examEndTime).toLocaleString()}`);
        }
    }

    // 🕒 NEW: Calculate exam timeline position
    getExamTimelinePosition() {
        if (!this.examStartTime || !this.examEndTime) {
            console.warn("⚠️ Exam times not provided, cannot determine timeline position");
            return 'unknown';
        }

        const now = Date.now();
        const examStart = new Date(this.examStartTime).getTime();
        const examEnd = new Date(this.examEndTime).getTime();
        const totalDuration = examEnd - examStart;

        // If exam hasn't started or has ended
        if (now < examStart) return 'before_exam';
        if (now > examEnd) return 'after_exam';

        // Calculate position within exam
        const elapsedTime = now - examStart;
        const progressPercent = (elapsedTime / totalDuration) * 100;

        // Define timeline segments
        const startThreshold = 25; // First 25% of exam
        const endThreshold = 75;   // Last 25% of exam

        if (progressPercent <= startThreshold) {
            return 'exam_start';
        } else if (progressPercent >= endThreshold) {
            return 'exam_end';
        } else {
            return 'exam_middle';
        }
    }

    // 🕒 NEW: Get exam progress info for logging
    getExamProgressInfo() {
        if (!this.examStartTime || !this.examEndTime) {
            return { position: 'unknown', progress: 0, timeRemaining: 0 };
        }

        const now = Date.now();
        const examStart = new Date(this.examStartTime).getTime();
        const examEnd = new Date(this.examEndTime).getTime();
        const totalDuration = examEnd - examStart;
        const elapsedTime = now - examStart;
        const timeRemaining = examEnd - now;

        return {
            position: this.getExamTimelinePosition(),
            progress: Math.max(0, Math.min(100, (elapsedTime / totalDuration) * 100)),
            timeRemaining: Math.max(0, timeRemaining),
            elapsedTime: Math.max(0, elapsedTime)
        };
    }

    // 🔧 Load dynamic settings from backend API
    async loadSettings() {
        try {
            console.log("⚙️ Loading head movement settings from backend...");
            
            const response = await fetch('/api/get_head_movement_settings');
            if (response.ok) {
                const data = await response.json();
                if (data.status === 'success' && data.settings) {
                    this.settings = {
                        violation_duration: data.settings.violation_duration, // Already in milliseconds
                        warning_count: data.settings.warning_count,
                        max_yaw: data.settings.max_yaw,
                        max_pitch: data.settings.max_pitch,
                        detection_interval: 1000 // Keep 1 second detection interval
                    };
                    
                    console.log("✅ Settings loaded:", this.settings);
                    console.log(`   Duration: ${this.settings.violation_duration}ms (${this.settings.violation_duration/1000}s)`);
                    console.log(`   Warnings: ${this.settings.warning_count} before flagging`);
                    console.log(`   Angles: ±${this.settings.max_yaw}° yaw, ±${this.settings.max_pitch}° pitch`);
                } else {
                    console.warn("⚠️ Invalid settings response, using defaults");
                }
            } else {
                console.warn("⚠️ Failed to load settings, using defaults");
            }
        } catch (error) {
            console.error("❌ Error loading settings:", error);
            console.log("🔧 Using default settings");
        }
    }

    async startDetection() {
        try {
            this.showDetectionStatus("🔧 Loading configuration...");
            
            // Load dynamic settings first
            await this.loadSettings();
            
            this.showDetectionStatus("🔧 Initializing head detection...");
            
            this.video = document.getElementById('webcam-video');
            if (!this.video) {
                throw new Error("Webcam video element not found");
            }

            this.showDetectionStatus("📹 Connecting to webcam...");

            // Use existing stream or create new one
            if (!this.video.srcObject) {
                this.showDetectionStatus("🎥 Requesting camera access...");
                const stream = await navigator.mediaDevices.getUserMedia({ 
                    video: { 
                        width: { ideal: 640 }, 
                        height: { ideal: 480 },
                        frameRate: { ideal: 15 }
                    } 
                });
                this.video.srcObject = stream;
                this.showDetectionStatus("📹 Webcam connected successfully");
            } else {
                this.showDetectionStatus("📹 Using existing webcam stream");
            }
            
            await new Promise((resolve) => {
                if (this.video.readyState >= 2) {
                    resolve();
                } else {
                    this.video.addEventListener('loadedmetadata', resolve, { once: true });
                }
            });

            this.showDetectionStatus("🧠 Setting up AI detection model...");

            // Setup canvas for frame capture
            this.canvas = document.createElement('canvas');
            this.ctx = this.canvas.getContext('2d');
            this.canvas.width = 320;
            this.canvas.height = 240;

            // Setup visual overlay
            this.setupVisualOverlay();

            this.isDetecting = true;
            this.detectionActive = true;
            
            this.showDetectionStatus("🎬 Starting video recording...");
            
            // Start continuous recording for unified video
            await this.startContinuousRecording();
            
            this.showDetectionStatus("🔍 Starting head pose analysis...");
            
            // Start head pose detection with dynamic interval
            this.startPeriodicDetection();
            
            // Show timeline info if available
            const progressInfo = this.getExamProgressInfo();
            const timelineMsg = progressInfo.position !== 'unknown' 
                ? ` (${progressInfo.position}, ${progressInfo.progress.toFixed(1)}% complete)`
                : '';
            
            this.showDetectionStatus(`✅ Head monitoring active${timelineMsg} (${this.settings.warning_count} warnings, ${this.settings.violation_duration/1000}s threshold)`);
            
            // Initialize pose indicator with placeholder values
            this.updatePoseIndicator({ yaw: '--', pitch: '--', roll: '--' });
            
        } catch (error) {
            console.error("❌ Head detection failed:", error);
            this.showDetectionStatus("❌ Head detection failed");
        }
    }

    // Setup visual overlay for bounding box and nose point
    setupVisualOverlay() {
        try {
            // Create overlay canvas that sits on top of video
            this.overlayCanvas = document.createElement('canvas');
            this.overlayCtx = this.overlayCanvas.getContext('2d');
            
            // Match video dimensions
            const videoContainer = this.video.parentElement;
            if (videoContainer) {
                // Style overlay canvas
                this.overlayCanvas.style.position = 'absolute';
                this.overlayCanvas.style.top = '0';
                this.overlayCanvas.style.left = '0';
                this.overlayCanvas.style.pointerEvents = 'none';
                this.overlayCanvas.style.zIndex = '10';
                
                // Set canvas size to match video display size
                this.overlayCanvas.width = this.video.offsetWidth || 640;
                this.overlayCanvas.height = this.video.offsetHeight || 480;
                this.overlayCanvas.style.width = this.overlayCanvas.width + 'px';
                this.overlayCanvas.style.height = this.overlayCanvas.height + 'px';
                
                // Add overlay to video container
                videoContainer.style.position = 'relative';
                videoContainer.appendChild(this.overlayCanvas);
                
                console.log("🎨 Visual overlay canvas created");
            }
        } catch (error) {
            console.error("❌ Failed to setup visual overlay:", error);
        }
    }

    // Start continuous recording (always recording)
    async startContinuousRecording() {
        try {
            if (!this.video.srcObject) {
                console.warn("⚠️ No stream available for recording");
                return;
            }

            console.log('🎥 HEAD recording - setting up video evidence system');
            
            // 🔧 FIX: Use simple single-session recording instead of chunk combination
            // This avoids the corruption issues from combining chunks from different sessions
            this.isRecording = true;
            console.log('✅ HEAD evidence system ready (video + screenshot)');

        } catch (error) {
            console.error('❌ Failed to setup HEAD evidence system:', error);
        }
    }

    async waitForStreamReady(stream) {
        return new Promise((resolve) => {
            const testVideo = document.createElement('video');
            testVideo.srcObject = stream;
            testVideo.muted = true;
            
            testVideo.addEventListener('canplay', () => {
                console.log('✅ HEAD stream ready for recording');
                resolve();
            });
            
            setTimeout(() => {
                console.log('⏰ HEAD stream timeout, proceeding anyway');
                resolve();
            }, 2000);
        });
    }

    startPeriodicDetection() {
        if (this.detectionTimer) {
            clearInterval(this.detectionTimer);
        }

        this.detectionTimer = setInterval(() => {
            if (this.detectionActive && this.video && !this.video.paused) {
                this.captureAndAnalyzeFrame();
            }
        }, this.settings.detection_interval);

        console.log(`🔄 Head pose detection active (every ${this.settings.detection_interval}ms)`);
    }

    async captureAndAnalyzeFrame() {
        try {
            if (!this.video || !this.canvas || !this.ctx) {
                console.warn("⚠️ Video, canvas, or context not ready");
                return;
            }

            // Draw current video frame to canvas
            this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
            
            // Convert to base64
            const imageDataUrl = this.canvas.toDataURL('image/jpeg', 0.7);
            console.log("📸 Frame captured, sending to server...");
            
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
                console.log("🤖 Server response:", result.status);
                this.handleHeadPoseResult(result);
            } else {
                const errorData = await response.json();
                console.error("❌ Server error:", errorData);
            }
        } catch (error) {
            console.warn("⚠️ Frame analysis error:", error);
        }
    }

    handleHeadPoseResult(result) {
        if (result.status === 'success') {
            this.currentPose = result.pose;
            
            // Update visual indicators
            this.updateVisualIndicators(result);
            this.updatePoseIndicator(this.currentPose);
            
            // Check if looking away using DYNAMIC thresholds
            const isLookingAway = result.is_looking_away || 
                                 Math.abs(this.currentPose.yaw) > this.settings.max_yaw || 
                                 Math.abs(this.currentPose.pitch) > this.settings.max_pitch;
            
            if (isLookingAway) {
                this.handleLookingAway(this.currentPose);
                this.showDetectionStatus("⚠️ Looking away detected", true); // true = red color
            } else {
                this.handleLookingForward();
                this.showDetectionStatus("✅ Looking forward", false); // false = green color
            }
            
            // 🔧 NEW: Handle face detected (clear no face tracking)
            this.handleFaceDetected();
            
            console.log(`📊 HEAD: Yaw=${this.currentPose.yaw.toFixed(1)}° Pitch=${this.currentPose.pitch.toFixed(1)}° Away=${isLookingAway} Backend=${result.is_looking_away}`);
            
        } else if (result.status === 'no_face') {
            this.currentPose = null;
            this.showDetectionStatus("👤 No face detected", true); // true = red color for warning
            
            // 🔧 FIX: Clear ALL visual indicators when no face is detected
            this.clearVisualIndicators();
            
            // Show pose indicator with placeholder values (matching your screenshot)
            this.updatePoseIndicator({ yaw: '--', pitch: '--', roll: '--' });
            
            // 🔧 NEW: Treat no face detection as violation after duration threshold
            this.handleNoFaceDetection();
            
            console.log("👤 No face detected in current frame");
        }
    }

    // Update visual bounding box and nose point
    updateVisualIndicators(result) {
        if (!this.overlayCtx || !this.overlayCanvas) return;
        
        // Clear previous drawings first
        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        
        // 🔧 FIX: Only draw indicators if face is successfully detected
        if (result.status === 'success' && result.face_bbox && result.nose_point) {
            // Use actual detection data from backend with DYNAMIC thresholds
            this.drawRealFaceBoundingBox(result);
            this.drawRealNoseDirection(result);
            console.log("🎨 Drawing bounding box and nose direction for detected face");
        } else {
            console.log("🎨 No face detected - visual indicators cleared");
        }
    }

    // 🎯 Draw face bounding box using REAL detection data with DYNAMIC thresholds
    drawRealFaceBoundingBox(result) {
        const bbox = result.face_bbox;
        const pose = result.pose;
        
        // Calculate scale factors from detection canvas to display canvas
        const scaleX = this.overlayCanvas.width / 320;  // Match canvas size from startDetection
        const scaleY = this.overlayCanvas.height / 240;
        
        // Scale the bounding box to fit display canvas
        let x = bbox.x * scaleX;
        let y = bbox.y * scaleY;
        let width = bbox.width * scaleX;
        let height = bbox.height * scaleY;
        
        // Make the box much smaller - focus on head only (reduce by 30% and adjust position)
        const horizontalPadding = 0.15; // 15% padding on sides
        const verticalPadding = 0.25;   // 25% padding top/bottom to focus on head
        
        x = x + (width * horizontalPadding);
        y = y + (height * verticalPadding);
        width = width * (1 - horizontalPadding * 2);
        height = height * (1 - verticalPadding * 1.5); // More reduction from bottom
        
        // Determine color and status based on DYNAMIC thresholds
        const isLookingAway = result.is_looking_away || 
                            Math.abs(pose.yaw) > this.settings.max_yaw || 
                            Math.abs(pose.pitch) > this.settings.max_pitch;
        const boxColor = isLookingAway ? '#ef4444' : '#10b981'; // Red if looking away, green if normal
        const status = isLookingAway ? '⚠️ Looking Away' : '✅ Face Detected';
        
        // Draw main bounding box
        this.overlayCtx.strokeStyle = boxColor;
        this.overlayCtx.lineWidth = 3;
        this.overlayCtx.strokeRect(x, y, width, height);
        
        // Draw corner markers (like professional systems)
        this.drawCornerMarkers(x, y, width, height, boxColor);
        
        // Add label above the box
        this.overlayCtx.fillStyle = boxColor;
        this.overlayCtx.font = 'bold 14px Arial';
        this.overlayCtx.fillText(status, x, y - 8);
    }

    // 🎯 Draw corner markers for professional look
    drawCornerMarkers(x, y, width, height, color) {
        const markerLength = 20;
        const markerWidth = 3;
        
        this.overlayCtx.strokeStyle = color;
        this.overlayCtx.lineWidth = markerWidth;
        
        // Top-left corner
        this.overlayCtx.beginPath();
        this.overlayCtx.moveTo(x, y + markerLength);
        this.overlayCtx.lineTo(x, y);
        this.overlayCtx.lineTo(x + markerLength, y);
        this.overlayCtx.stroke();
        
        // Top-right corner
        this.overlayCtx.beginPath();
        this.overlayCtx.moveTo(x + width - markerLength, y);
        this.overlayCtx.lineTo(x + width, y);
        this.overlayCtx.lineTo(x + width, y + markerLength);
        this.overlayCtx.stroke();
        
        // Bottom-left corner
        this.overlayCtx.beginPath();
        this.overlayCtx.moveTo(x, y + height - markerLength);
        this.overlayCtx.lineTo(x, y + height);
        this.overlayCtx.lineTo(x + markerLength, y + height);
        this.overlayCtx.stroke();
        
        // Bottom-right corner
        this.overlayCtx.beginPath();
        this.overlayCtx.moveTo(x + width - markerLength, y + height);
        this.overlayCtx.lineTo(x + width, y + height);
        this.overlayCtx.lineTo(x + width, y + height - markerLength);
        this.overlayCtx.stroke();
    }

    // 🎯 Draw nose point and direction arrow using REAL data with DYNAMIC thresholds
    drawRealNoseDirection(result) {
        const nosePoint = result.nose_point;
        const pose = result.pose;
        
        // Scale nose point to display canvas (match the scaling from bounding box)
        const scaleX = this.overlayCanvas.width / 320;
        const scaleY = this.overlayCanvas.height / 240;
        
        const noseX = nosePoint.x * scaleX;
        const noseY = nosePoint.y * scaleY;
        
        // Determine if looking away using DYNAMIC thresholds
        const isLookingAway = result.is_looking_away || 
                            Math.abs(pose.yaw) > this.settings.max_yaw || 
                            Math.abs(pose.pitch) > this.settings.max_pitch;
        const arrowColor = isLookingAway ? '#ef4444' : '#10b981';
        
        // Draw nose point (larger and more visible)
        this.overlayCtx.fillStyle = arrowColor;
        this.overlayCtx.beginPath();
        this.overlayCtx.arc(noseX, noseY, 6, 0, 2 * Math.PI);
        this.overlayCtx.fill();
        
        // Draw nose point outline
        this.overlayCtx.strokeStyle = '#ffffff';
        this.overlayCtx.lineWidth = 2;
        this.overlayCtx.stroke();
        
        // Calculate direction vector based on pose angles
        const lineLength = 50; // Good length for visibility
        
        // Convert angles to radians and improve direction calculation
        const yawRadians = (pose.yaw * Math.PI) / 180;
        const pitchRadians = (pose.pitch * Math.PI) / 180;
        
        // Calculate end point of direction line
        const endX = noseX + lineLength * Math.sin(yawRadians);
        const endY = noseY - lineLength * Math.sin(pitchRadians);
        
        // Draw direction line (thicker when looking away)
        this.overlayCtx.strokeStyle = arrowColor;
        this.overlayCtx.lineWidth = isLookingAway ? 5 : 3;
        this.overlayCtx.beginPath();
        this.overlayCtx.moveTo(noseX, noseY);
        this.overlayCtx.lineTo(endX, endY);
        this.overlayCtx.stroke();
        
        // Draw arrow head (larger when looking away)
        const arrowSize = isLookingAway ? 18 : 12;
        const angle = Math.atan2(endY - noseY, endX - noseX);
        
        this.overlayCtx.fillStyle = arrowColor;
        this.overlayCtx.beginPath();
        this.overlayCtx.moveTo(endX, endY);
        this.overlayCtx.lineTo(
            endX - arrowSize * Math.cos(angle - Math.PI / 6),
            endY - arrowSize * Math.sin(angle - Math.PI / 6)
        );
        this.overlayCtx.lineTo(
            endX - arrowSize * Math.cos(angle + Math.PI / 6),
            endY - arrowSize * Math.sin(angle + Math.PI / 6)
        );
        this.overlayCtx.closePath();
        this.overlayCtx.fill();
    }

    // Clear visual indicators when no face detected
    clearVisualIndicators() {
        if (this.overlayCtx && this.overlayCanvas) {
            // Clear the entire overlay canvas
            this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
            console.log("🧹 All visual indicators cleared - no face detected");
        }
    }

    // 🚨 Enhanced looking away handler with WARNING SYSTEM
    handleLookingAway(pose) {
        // 🔧 FIX: Check if exam is being submitted
        if (window.examSubmitting || !this.isDetecting) {
            console.log('📤 Exam submitting or detection stopped, ignoring head movement');
            return;
        }
        
        const now = Date.now();
        
        if (!this.isLookingAway) {
            this.isLookingAway = true;
            this.lookAwayStartTime = now;
            this.violationStartTime = now;
            this.hasShownWarning = false; // Reset warning flag
            console.log(`👀 HEAD: Looking away started - Yaw: ${pose.yaw.toFixed(1)}°, Pitch: ${pose.pitch.toFixed(1)}°`);
        }

        const lookAwayDuration = now - this.lookAwayStartTime;
        
        // Use DYNAMIC violation duration from settings
        if (lookAwayDuration > this.settings.violation_duration) {
            let direction = "";
            if (Math.abs(pose.yaw) > this.settings.max_yaw) {
                direction += pose.yaw > 0 ? " right" : " left";
            }
            if (Math.abs(pose.pitch) > this.settings.max_pitch) {
                direction += pose.pitch > 0 ? " up" : " down";
            }
            
            const description = `Looking away${direction}: yaw=${pose.yaw.toFixed(1)}°, pitch=${pose.pitch.toFixed(1)}°`;
            
            // 🚨 NEW: Implement warning system
            this.handleViolationWithWarnings('looking_away', description);
        }
    }

    // 🔧 NEW: Handle no face detection with warning system
    handleNoFaceDetection() {
        // 🔧 FIX: Check if exam is being submitted
        if (window.examSubmitting || !this.isDetecting) {
            console.log('📤 Exam submitting or detection stopped, ignoring no face detection');
            return;
        }
        
        const now = Date.now();
        
        if (!this.isNoFaceDetected) {
            this.isNoFaceDetected = true;
            this.noFaceStartTime = now;
            this.violationStartTime = now; // Use same violation start time for consistency
            console.log(`👤 HEAD: No face detection started`);
        }

        const noFaceDuration = now - this.noFaceStartTime;
        
        // Use DYNAMIC violation duration from settings
        if (noFaceDuration > this.settings.violation_duration) {
            const description = `No face detected for ${Math.round(noFaceDuration/1000)} seconds`;
            
            // � CHANGED: Record as 'looking_away' instead of 'no_face_detected'
            this.handleViolationWithWarnings('looking_away', description);
        }
    }

    // 🔧 NEW: Handle face detected (clear no face tracking)
    handleFaceDetected() {
        if (this.isNoFaceDetected) {
            this.isNoFaceDetected = false;
            this.noFaceStartTime = null;
            
            console.log("👤 HEAD: Face detected again");
            
            // 🔧 Clear any no face warnings if not a full violation
            if (this.violationStartTime && !this.violationRecorded) {
                console.log("⚠️ DEBUG: No face warnings cleared - face detected again");
                this.violationStartTime = null;
            }
        }
    }

    // 🚨 NEW: Warning system implementation with COMBINED counting
    handleViolationWithWarnings(type, description) {
        // 🔧 NEW: Check if we're in buffer period
        if (this.violationBuffer) {
            console.log("⏸️ In buffer period - ignoring violation detection");
            this.showDetectionStatus("🔄 Buffer period active - Ignoring detections");
            return;
        }
        
        // 🔧 COMBINED: Use single warning counter for both looking_away and no_face_detected
        const combinedViolationType = 'head_movement_violation'; // Unified violation type
        
        // Initialize combined warning count if not exists
        if (!this.warningCounts[combinedViolationType]) {
            this.warningCounts[combinedViolationType] = 0;
        }

        this.warningCounts[combinedViolationType]++;
        
        console.log(`🚨 HEAD VIOLATION ATTEMPT: ${type} - Combined Count: ${this.warningCounts[combinedViolationType]}/${this.settings.warning_count + 1}`);
        console.log(`📊 DEBUG: Current settings - warning_count: ${this.settings.warning_count}, violation_duration: ${this.settings.violation_duration}ms`);

        if (this.warningCounts[combinedViolationType] <= this.settings.warning_count) {
            // Show warning message with combined count
            this.showWarningMessage(type, this.warningCounts[combinedViolationType], description);
            console.log(`⚠️ HEAD WARNING ${this.warningCounts[combinedViolationType]}: ${description}`);
            console.log(`⚠️ DEBUG: Still in warning phase (${this.warningCounts[combinedViolationType]}/${this.settings.warning_count})`);
        } else {
            // Record actual violation after warnings exceeded
            this.recordEnhancedViolation(type, description);
            console.log(`🚨 HEAD VIOLATION RECORDED: ${description}`);
            console.log(`🚨 DEBUG: Full violation recorded after ${this.settings.warning_count} warnings`);
            
            // Reset combined warning count
            this.warningCounts[combinedViolationType] = 0;
        }
    }

    // 🚨 NEW: Show warning message to student with COMBINED counting
    showWarningMessage(type, warningNumber, description) {
        const remainingWarnings = this.settings.warning_count - warningNumber + 1;
        
        // 🔧 COMBINED: Show unified warning title but different messages for context
        let warningTitle = `⚠️ HEAD MOVEMENT WARNING ${warningNumber}/${this.settings.warning_count}`;
        let warningMessage = "";
        
        if (type === 'looking_away') {
            warningMessage = `Please look at the screen. ${remainingWarnings} more warning(s) before violation is recorded.`;
        } else if (type === 'no_face_detected') {
            warningMessage = `Please ensure your face is visible to the camera. ${remainingWarnings} more warning(s) before violation is recorded.`;
        } else {
            warningMessage = `Please look at the screen and ensure your face is visible. ${remainingWarnings} more warning(s) before violation is recorded.`;
        }
        
        // Create or update warning display
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
                font-size: 16px;
                z-index: 1000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                border: 2px solid #f59e0b;
                animation: pulse 1s infinite;
            `;
            document.body.appendChild(warningElement);
        }

        // Update warning message
        warningElement.innerHTML = `
            <div style="text-align: center;">
                ${warningTitle}
            </div>
            <div style="font-size: 14px; margin-top: 4px;">
                ${warningMessage}
            </div>
        `;

        // Show the warning for 3 seconds
        warningElement.style.display = 'block';
        setTimeout(() => {
            if (warningElement) {
                warningElement.style.display = 'none';
            }
        }, 3000);

        // Update status display with combined messaging
        const statusMessage = type === 'no_face_detected' 
            ? `👤 Combined Warning ${warningNumber}/${this.settings.warning_count} - Show your face!`
            : `⚠️ Combined Warning ${warningNumber}/${this.settings.warning_count} - Look at screen!`;
        this.showDetectionStatus(statusMessage, true);
    }

    handleLookingForward() {
        if (this.isLookingAway) {
            this.isLookingAway = false;
            this.lookAwayStartTime = null;
            this.hasShownWarning = false;
            
            // Hide warning display
            const warningElement = document.getElementById('head-warning-display');
            if (warningElement) {
                warningElement.style.display = 'none';
            }
            
            console.log("👀 HEAD: Looking forward again");
            
            // 🔧 FIXED: Video recording is now triggered during violation, not after
            console.log("🔍 DEBUG: Checking violation state...");
            console.log(`🔍 DEBUG: violationStartTime exists: ${this.violationStartTime !== null}`);
            console.log(`🔍 DEBUG: violationRecorded flag: ${this.violationRecorded || false}`);
            
            if (this.violationStartTime) {
                if (this.violationRecorded) {
                    console.log("✅ DEBUG: Full violation was recorded and video should already be recording");
                } else {
                    console.log("⚠️ DEBUG: Only warnings triggered (no full violation recorded)");
                }
                // Clear the violation start time since we're looking forward again
                this.violationStartTime = null;
                this.violationRecorded = false; // Reset the flag
            } else {
                console.log("❌ DEBUG: No violationStartTime");
            }
        }
    }

    // 🔥 ENHANCED: Record violation with timeline support
    async recordEnhancedViolation(type, description) {
        // Accept 'looking_away' violations (including no face scenarios)
        if (type !== 'looking_away') {
            console.log(`❌ HEAD DETECTOR: Rejecting non-head violation: ${type}`);
            return;
        }

        const now = Date.now();
        const cooldownPeriod = 8000;
        const timeSinceLastViolation = now - this.lastViolationTime;
        
        if (timeSinceLastViolation < cooldownPeriod) {
            console.log(`⏳ HEAD: ${type} in cooldown`);
            return;
        }
        
        this.lastViolationTime = now;

        // 🕒 NEW: Get timeline information
        const timelinePosition = this.getExamTimelinePosition();
        const progressInfo = this.getExamProgressInfo();

        console.log(`🚨 HEAD VIOLATION: ${type} - ${description}`);
        console.log(`📅 Timeline: ${timelinePosition} (${progressInfo.progress.toFixed(1)}% complete)`);

        // 🔧 NEW: Capture screenshot immediately while still looking away
        console.log('📷 Capturing violation screenshot while looking away...');
        const violationScreenshot = await this.captureScreenshot();

        // 🔧 NEW: Start video recording immediately during violation (while still looking away)
        console.log('🎥 Starting violation video recording during actual violation...');
        this.startViolationVideoRecording();

        try {
            // 🔥 ENHANCED: Send violation data with timeline and pose information
            const violationData = {
                assessment_code: this.assessmentCode,
                student_id: this.studentId,
                violation_type: type,
                description: description,
                timestamp: new Date().toISOString(),
                // 🕒 NEW: Timeline data
                exam_timeline_position: timelinePosition,
                exam_start_time: this.examStartTime,
                exam_end_time: this.examEndTime,
                exam_progress_percent: progressInfo.progress,
                time_remaining_ms: progressInfo.timeRemaining,
                elapsed_time_ms: progressInfo.elapsedTime,
                // 🤖 NEW: Current pose data
                head_pose_data: this.currentPose ? {
                    yaw: this.currentPose.yaw,
                    pitch: this.currentPose.pitch,
                    roll: this.currentPose.roll
                } : null,
                // ⚙️ NEW: Detection settings used
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
                this.lastViolationId = result.violation_id || null;
                console.log("✅ HEAD violation recorded with timeline data");
                console.log("📊 Violation details:", {
                    position: timelinePosition,
                    progress: `${progressInfo.progress.toFixed(1)}%`,
                    timeRemaining: `${Math.round(progressInfo.timeRemaining / 60000)}min`,
                    pose: this.currentPose
                });
                
                // 🔧 ADD THIS LINE: Set flag that violation was recorded
                this.violationRecorded = true;
                
                // 🔧 NEW: Store the screenshot captured during violation
                this.storedViolationScreenshot = violationScreenshot;
                
                //Reset warning count and start buffer period
                this.resetViolationCounting();

                // Show violation recorded message
                this.showViolationRecordedMessage();
            } else {
                const errorData = await response.json();
                console.error("❌ HEAD violation recording failed:", errorData);
            }
        } catch (error) {
            console.error("❌ HEAD recording error:", error);
        }
    }

    // 🔧 NEW: Start video recording immediately during violation
    async startViolationVideoRecording() {
        try {
            const stream = this.video.srcObject;
            if (!stream) {
                console.error('❌ No video stream available for violation recording');
                return;
            }

            console.log('🎥 Recording violation video (5 seconds) while looking away...');
            
            const chunks = [];
            const recorder = new MediaRecorder(stream, {
                mimeType: 'video/webm;codecs=vp8',
                videoBitsPerSecond: 500000
            });
            
            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunks.push(event.data);
                    console.log(`🎥 HEAD violation chunk: ${event.data.size} bytes`);
                }
            };
            
            recorder.onstop = async () => {
                console.log('🎬 HEAD violation recording complete');
                const videoBlob = new Blob(chunks, { type: 'video/webm' });
                console.log(`✅ HEAD violation video: ${videoBlob.size} bytes`);
                
                const isPlayable = await this.testVideoPlayback(videoBlob, 'HEAD violation video');
                if (isPlayable) {
                    // Always upload as 'looking_away' violation type
                    await this.uploadEnhancedEvidence('looking_away', videoBlob);
                    console.log('✅ HEAD video evidence uploaded successfully');
                } else {
                    console.error('❌ HEAD video not playable, using screenshot only');
                    await this.uploadEnhancedEvidence('looking_away', null);
                    console.log('✅ HEAD screenshot evidence uploaded successfully');
                }
            };
            
            recorder.start();
            setTimeout(() => {
                if (recorder.state === 'recording') {
                    recorder.stop();
                }
            }, 5000);

        } catch (error) {
            console.error('❌ Failed to start violation video recording:', error);
            // Fallback to screenshot only
            await this.uploadEnhancedEvidence('looking_away', null);
            console.log('✅ HEAD screenshot fallback uploaded successfully');
        }
    }

    // 🔧 NEW: Add this method to handle violation counting reset with buffer
    resetViolationCounting() {
        console.log("🔄 Resetting violation counting with buffer period...");
        
        // Reset combined warning count (both looking_away and no_face_detected)
        this.warningCounts = {};
        this.hasShownWarning = false;
        
        // Start buffer period
        this.violationBuffer = true;
        
        // Clear any existing buffer timeout
        if (this.bufferTimeout) {
            clearTimeout(this.bufferTimeout);
        }
        
        // Set buffer timeout
        this.bufferTimeout = setTimeout(() => {
            this.violationBuffer = false;
            console.log("✅ Buffer period ended - combined violation counting can resume");
            this.showDetectionStatus("✅ Head monitoring active - Ready for detection");
        }, this.bufferDuration);
        
        console.log(`⏰ Combined warning buffer period started: ${this.bufferDuration / 1000} seconds`);
        this.showDetectionStatus("🔄 Buffer period active - No counting for 5 seconds");
    }

    // 🚨 NEW: Show violation recorded message
    showViolationRecordedMessage() {
        let violationElement = document.getElementById('head-violation-display');
        if (!violationElement) {
            violationElement = document.createElement('div');
            violationElement.id = 'head-violation-display';
            violationElement.style.cssText = `
                position: fixed;
                top: 100px;
                left: 50%;
                transform: translateX(-50%);
                background: #ef4444;
                color: white;
                padding: 16px 24px;
                border-radius: 8px;
                font-weight: bold;
                font-size: 18px;
                z-index: 1001;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                border: 2px solid #dc2626;
            `;
            document.body.appendChild(violationElement);
        }

        violationElement.innerHTML = `
            <div style="text-align: center;">
                🚨 VIOLATION RECORDED
            </div>
            <div style="font-size: 14px; margin-top: 4px;">
                Head movement violation has been recorded with evidence.
            </div>
        `;

        // Show the violation message for 5 seconds
        violationElement.style.display = 'block';
        setTimeout(() => {
            if (violationElement) {
                violationElement.style.display = 'none';
            }
        }, 5000);

        // Update status display
        this.showDetectionStatus("🚨 VIOLATION RECORDED - Evidence captured", true);
    }

    // 🔧 FIX: Create violation video using new recording approach
    async captureUnifiedViolationVideo() {
        try {
            console.log('🎬 Starting dedicated HEAD violation recording...');
            
            // Skip video recording for now and focus on screenshot evidence
            console.log('⚠️ Skipping video recording due to compatibility issues');
            console.log('� Capturing screenshot evidence instead');
            
            // Always capture screenshot as reliable evidence
            const screenshot = await this.captureScreenshot();
            if (screenshot) {
                await this.uploadEnhancedEvidence('looking_away', null); // Upload without video
                console.log('✅ HEAD screenshot evidence uploaded successfully');
            } else {
                console.error('❌ Failed to capture screenshot evidence');
            }

        } catch (error) {
            console.error('❌ Failed to capture HEAD evidence:', error);
        }
    }

    // 🎥 NEW: Enhanced violation video recording method
    async captureViolationVideoNew() {
        try {
            console.log('🎬 NEW: Starting HEAD violation video recording...');
            
            const stream = this.video.srcObject;
            if (!stream) {
                console.error('❌ No video stream available, using screenshot only');
                const screenshot = await this.captureScreenshot();
                if (screenshot) {
                    await this.uploadEnhancedEvidence('looking_away', null);
                    console.log('✅ HEAD screenshot evidence uploaded successfully');
                }
                return;
            }

            console.log('🎥 Recording fresh violation video (5 seconds)...');
            
            const chunks = [];
            const recorder = new MediaRecorder(stream, {
                mimeType: 'video/webm;codecs=vp8',
                videoBitsPerSecond: 500000
            });
            
            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunks.push(event.data);
                    console.log(`🎥 HEAD violation chunk: ${event.data.size} bytes`);
                }
            };
            
            recorder.onstop = async () => {
                console.log('🎬 HEAD violation recording complete');
                const videoBlob = new Blob(chunks, { type: 'video/webm' });
                console.log(`✅ HEAD violation video: ${videoBlob.size} bytes`);
                
                const isPlayable = await this.testVideoPlayback(videoBlob, 'HEAD violation video');
                if (isPlayable) {
                    await this.uploadEnhancedEvidence('looking_away', videoBlob);
                    console.log('✅ HEAD video evidence uploaded successfully');
                } else {
                    console.error('❌ HEAD video not playable, using screenshot fallback');
                    const screenshot = await this.captureScreenshot();
                    if (screenshot) {
                        await this.uploadEnhancedEvidence('looking_away', null);
                        console.log('✅ HEAD screenshot evidence uploaded successfully');
                    }
                }
            };
            
            recorder.start();
            setTimeout(() => {
                if (recorder.state === 'recording') {
                    recorder.stop();
                }
            }, 5000);

        } catch (error) {
            console.error('❌ Failed to capture HEAD video evidence:', error);
            const screenshot = await this.captureScreenshot();
            if (screenshot) {
                await this.uploadEnhancedEvidence('looking_away', null);
                console.log('✅ HEAD screenshot fallback uploaded successfully');
            }
        }
    }

    // 🔥 ENHANCED: Upload evidence with timeline and pose data
    async uploadEnhancedEvidence(violationType, unifiedVideo) {
        try {
            const formData = new FormData();
            formData.append('assessment_code', this.assessmentCode);
            formData.append('student_id', this.studentId);
            formData.append('violation_type', violationType);
            formData.append('timestamp', new Date().toISOString());
            formData.append('violation_id', this.lastViolationId); 

            // 🕒 NEW: Add timeline data
            const timelinePosition = this.getExamTimelinePosition();
            const progressInfo = this.getExamProgressInfo();
            
            formData.append('exam_timeline_position', timelinePosition);
            formData.append('exam_start_time', this.examStartTime || '');
            formData.append('exam_end_time', this.examEndTime || '');
            formData.append('exam_progress_percent', progressInfo.progress.toString());

            // 🤖 NEW: Add pose data if available
            if (this.currentPose) {
                formData.append('head_pose_data', JSON.stringify({
                    yaw: this.currentPose.yaw,
                    pitch: this.currentPose.pitch,
                    roll: this.currentPose.roll
                }));
            }

            // ⚙️ NEW: Add detection settings
            formData.append('detection_settings', JSON.stringify({
                max_yaw: this.settings.max_yaw,
                max_pitch: this.settings.max_pitch,
                violation_duration: this.settings.violation_duration,
                warning_count: this.settings.warning_count
            }));

            // Add screenshot (use stored violation screenshot if available)
            let screenshot = this.storedViolationScreenshot;
            if (!screenshot) {
                console.log('📷 No stored violation screenshot, capturing new one...');
                screenshot = await this.captureScreenshot();
            } else {
                console.log('📷 Using stored violation screenshot from actual violation moment');
                this.storedViolationScreenshot = null; // Clear after use
            }
            
            if (screenshot) {
                const timestamp = Date.now();
                const screenshotName = `head_looking_away_screenshot_${this.assessmentCode}_${this.studentId}_${timestamp}.png`;
                formData.append('screenshot', screenshot, screenshotName);
                console.log('📷 HEAD screenshot added to upload');
            }

            // Add unified video (only if available)
            if (unifiedVideo && unifiedVideo.size > 0) {
                const timestamp = Date.now();
                const videoName = `head_looking_away_enhanced_${this.assessmentCode}_${this.studentId}_${timestamp}.webm`;
                formData.append('video', unifiedVideo, videoName);
                console.log(`🎬 HEAD unified video added to upload (${unifiedVideo.size} bytes)`);
            } else {
                console.log('⚠️ No valid video to upload, sending screenshot only');
            }

            console.log(`📤 Uploading enhanced HEAD evidence for ${violationType} at ${timelinePosition}`);

            const response = await fetch('/api/upload_violation_evidence', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const result = await response.json();
                console.log("📸 Enhanced HEAD evidence uploaded successfully");
                if (unifiedVideo) {
                    console.log("🎬 Video evidence included");
                } else {
                    console.log("📷 Screenshot-only evidence (video unavailable)");
                }
                console.log("📊 Evidence details:", {
                    timeline: timelinePosition,
                    progress: `${progressInfo.progress.toFixed(1)}%`,
                    files: result.files_uploaded || 'unknown'
                });
            } else {
                const errorData = await response.json();
                console.error("❌ HEAD evidence upload failed:", errorData);
            }

        } catch (error) {
            console.error("❌ HEAD evidence upload error:", error);
        }
    }

    // Test video playability
    async testVideoPlayback(videoBlob, description) {
        return new Promise((resolve) => {
            console.log(`🧪 Testing ${description} playback...`);
            
            const videoURL = URL.createObjectURL(videoBlob);
            const testVideo = document.createElement('video');
            testVideo.src = videoURL;
            testVideo.muted = true;
            
            testVideo.addEventListener('loadedmetadata', () => {
                console.log(`✅ ${description} is playable: ${testVideo.duration}s, ${videoBlob.size} bytes`);
                URL.revokeObjectURL(videoURL);
                resolve(true);
            });
            
            testVideo.addEventListener('error', (e) => {
                console.error(`❌ ${description} is NOT playable: ${e.target.error?.message}`);
                URL.revokeObjectURL(videoURL);
                resolve(false);
            });
            
            setTimeout(() => {
                console.warn(`⏰ ${description} test timeout`);
                URL.revokeObjectURL(videoURL);
                resolve(false);
            }, 3000);
        });
    }

    async captureScreenshot() {
        try {
            if (!this.video || !this.canvas) return null;
            
            // 🎯 NEW: Capture screenshot with bounding box overlay
            console.log('📷 Capturing screenshot with bounding box overlay...');
            
            // Draw video frame to canvas
            this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
            
            // 🎯 ADD: Draw the overlay with bounding box on top of the screenshot
            if (this.overlayCanvas && this.currentPose) {
                // Create a temporary canvas to combine video + overlay
                const combinedCanvas = document.createElement('canvas');
                const combinedCtx = combinedCanvas.getContext('2d');
                combinedCanvas.width = this.canvas.width;
                combinedCanvas.height = this.canvas.height;
                
                // Draw the video frame
                combinedCtx.drawImage(this.canvas, 0, 0);
                
                // Scale and draw the overlay on top
                const scaleX = this.canvas.width / this.overlayCanvas.width;
                const scaleY = this.canvas.height / this.overlayCanvas.height;
                
                // Save current overlay state and redraw it on the screenshot canvas
                if (this.overlayCtx) {
                    combinedCtx.save();
                    combinedCtx.scale(scaleX, scaleY);
                    combinedCtx.drawImage(this.overlayCanvas, 0, 0);
                    combinedCtx.restore();
                    
                    console.log('🎯 Bounding box overlay added to screenshot');
                }
                
                // Use the combined canvas for screenshot
                return new Promise((resolve) => {
                    combinedCanvas.toBlob((blob) => {
                        if (blob) {
                            console.log(`📷 HEAD screenshot with overlay: ${blob.size} bytes`);
                            resolve(blob);
                        } else {
                            resolve(null);
                        }
                    }, 'image/png');
                });
            } else {
                // Fallback to regular screenshot without overlay
                console.log('📷 No overlay available, using regular screenshot');
                return new Promise((resolve) => {
                    this.canvas.toBlob((blob) => {
                        if (blob) {
                            console.log(`📷 HEAD screenshot: ${blob.size} bytes`);
                            resolve(blob);
                        } else {
                            resolve(null);
                        }
                    }, 'image/png');
                });
            }
        } catch (error) {
            console.error("❌ HEAD screenshot failed:", error);
            return null;
        }
    }

    updatePoseIndicator(pose) {
        const indicator = document.getElementById('pose-indicator');
        if (indicator && pose) {
            // Handle both numeric values and string placeholders
            let yawDisplay, pitchDisplay, rollDisplay;
            let yawColor = '#51cf66', pitchColor = '#51cf66'; // Default green
            
            if (typeof pose.yaw === 'number') {
                // Use DYNAMIC thresholds from settings
                const isYawAway = Math.abs(pose.yaw) > this.settings.max_yaw;
                const isPitchAway = Math.abs(pose.pitch) > this.settings.max_pitch;
                
                yawColor = isYawAway ? '#ff6b6b' : '#51cf66';
                pitchColor = isPitchAway ? '#ff6b6b' : '#51cf66';
                
                yawDisplay = `${pose.yaw.toFixed(1)}°`;
                pitchDisplay = `${pose.pitch.toFixed(1)}°`;
                rollDisplay = `${pose.roll.toFixed(1)}°`;
            } else {
                // Handle string values like '--'
                yawDisplay = pose.yaw;
                pitchDisplay = pose.pitch;
                rollDisplay = pose.roll;
                yawColor = '#999'; // Gray for placeholder
                pitchColor = '#999';
            }
            
            indicator.innerHTML = `
                <div class="pose-row">
                    <span>Yaw:</span>
                    <span class="pose-value" style="color: ${yawColor};">${yawDisplay}</span>
                </div>
                <div class="pose-row">
                    <span>Pitch:</span>
                    <span class="pose-value" style="color: ${pitchColor};">${pitchDisplay}</span>
                </div>
                <div class="pose-row">
                    <span>Roll:</span>
                    <span class="pose-value" style="color: #999;">${rollDisplay}</span>
                </div>
                <div class="pose-info">
                    Limits: ±${this.settings.max_yaw}°/±${this.settings.max_pitch}° | ${this.settings.warning_count} warnings
                </div>
            `;
            
            indicator.style.display = 'block';
        }
    }

    showDetectionStatus(message, isError = false) {
        const statusEl = document.getElementById('detection-status');
        if (statusEl) {
            statusEl.textContent = message;
            
            // Color based on isError parameter for looking away status
            if (isError) {
                statusEl.style.color = '#ef4444'; // Red for looking away or errors
                statusEl.style.backgroundColor = '#fee2e2'; // Light red background
                statusEl.style.fontWeight = 'bold'; // Make it more prominent
            } else if (message.includes('✅') || message.includes('forward')) {
                statusEl.style.color = '#10b981'; // Green for looking forward
                statusEl.style.backgroundColor = '#d1fae5'; // Light green background
                statusEl.style.fontWeight = 'normal';
            } else if (message.includes('Initializing') || message.includes('Starting') || message.includes('Connecting') || message.includes('Setting up') || message.includes('Loading configuration')) {
                statusEl.style.color = '#f59e0b'; // Orange for loading
                statusEl.style.backgroundColor = '#fef3c7'; // Light orange background
                statusEl.style.fontWeight = 'normal';
            } else if (message.includes('active')) {
                statusEl.style.color = '#10b981'; // Green for active
                statusEl.style.backgroundColor = '#d1fae5'; // Light green background
                statusEl.style.fontWeight = 'normal';
            } else {
                statusEl.style.color = '#6b7280'; // Gray for neutral
                statusEl.style.backgroundColor = '#f9fafb'; // Light gray background
                statusEl.style.fontWeight = 'normal';
            }
            
            // Add padding for better appearance
            statusEl.style.padding = '4px 8px';
            statusEl.style.borderRadius = '4px';
            statusEl.style.fontSize = '12px';
        }
        console.log(`🎯 AI Monitor Status: ${message}`);
    }

    stopDetection() {
        console.log("🛑 Stopping all HEAD monitoring for exam submission...");
        this.isDetecting = false;
        this.detectionActive = false;
        this.isRecording = false;
        
        // Clear any pending uploads
        this.violationRecorded = false;
        this.violationStartTime = null;
        
        // Clear buffer timeout
        if (this.bufferTimeout) {
            clearTimeout(this.bufferTimeout);
            this.bufferTimeout = null;
        }
        this.violationBuffer = false;
        
        if (this.detectionTimer) {
            clearInterval(this.detectionTimer);
            this.detectionTimer = null;
        }
        
        // Clear visual indicators
        this.clearVisualIndicators();
        
        // Hide any warning messages
        const warningElement = document.getElementById('head-warning-display');
        if (warningElement) {
            warningElement.style.display = 'none';
        }
        
        const violationElement = document.getElementById('head-violation-display');
        if (violationElement) {
            violationElement.style.display = 'none';
        }
        
        this.showDetectionStatus("🛑 Head detection stopped for submission");
        console.log("🛑 HEAD detection completely stopped");
    }
}

// Make available globally
window.HeadMovementDetector = HeadMovementDetector;