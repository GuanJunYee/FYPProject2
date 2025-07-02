class ExamScreenMonitor {
    constructor(assessmentCode, studentId) {
        this.assessmentCode = assessmentCode;
        this.studentId = studentId;
        this.violations = [];
        this.isMonitoring = false;
        this.webcamStream = null;
        this.screenStream = null;
        
        // Pre-recording system for BEFORE evidence
        this.preRecorder = null;
        this.recordedSegments = [];
        this.maxPreRecordTime = 6000; // 6 seconds of BEFORE
        this.segmentDuration = 2000;   // 2 seconds per segment
        this.isPreRecording = false;
        
        // Tab switch detection
        this.tabSwitchCount = 0;
        this.violationCount = 0;
        this.isCapturingEvidence = false;
        
        // captures the switch
        this.transitionRecorder = null;
        this.transitionChunks = [];
        this.isRecordingTransition = false;
        
        console.log(`🔍 Initializing BEFORE+TRANSITION monitor for ${assessmentCode}`);
        this.init();
    }

    async init() {
        try {
            await this.setupWebcam();
            await this.setupScreenCapture();
            this.setupEventListeners();
            this.startMonitoring();
            await this.startPreRecording();
        } catch (error) {
            console.error('❌ Failed to initialize monitoring:', error);
            this.showViolationWarning('❌ Monitoring system error. Please refresh the page.');
        }
    }

    async setupWebcam() {
        try {
            console.log('📹 Setting up webcam...');
            this.webcamStream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 640, height: 480 }, 
                audio: false 
            });
            
            const video = document.getElementById('webcam-video');
            if (video) {
                video.srcObject = this.webcamStream;
                console.log('✅ Webcam display activated');
            }
        } catch (error) {
            console.error('❌ Webcam access denied:', error);
            this.recordViolation('WEBCAM_DENIED', 'Student denied webcam access');
        }
    }

    async setupScreenCapture() {
        try {
            console.log('🖥️ Requesting screen sharing...');
            this.screenStream = await navigator.mediaDevices.getDisplayMedia({ 
                video: { 
                    mediaSource: 'screen',
                    width: { max: 1920 },
                    height: { max: 1080 }
                }, 
                audio: false 
            });
            
            this.screenStream.getVideoTracks()[0].addEventListener('ended', () => {
                console.log('❌ Student stopped screen sharing');
                this.recordViolation('SCREEN_SHARE_STOPPED', 'Student stopped screen sharing');
                this.showViolationWarning('⚠️ Screen sharing stopped! Please restart.');
                this.stopPreRecording();
            });
            
            console.log('✅ Screen capture enabled');
        } catch (error) {
            console.warn('❌ Screen capture denied:', error);
            this.recordViolation('SCREEN_CAPTURE_DENIED', 'Screen capture was denied');
        }
    }

    async startPreRecording() {
        try {
            const streamToRecord = this.screenStream || this.webcamStream;
            if (!streamToRecord) {
                console.warn('⚠️ No stream available for pre-recording');
                return;
            }

            console.log('🎥 Starting BEFORE evidence pre-recording...');
            
            await this.waitForStreamReady(streamToRecord);
            
            let options = {
                mimeType: 'video/webm;codecs=vp8',
                videoBitsPerSecond: 1500000
            };

            if (!MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
                options = { mimeType: 'video/webm' };
            }

            this.preRecorder = new MediaRecorder(streamToRecord, options);
            this.isPreRecording = true;

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
                    const beforeCount = this.recordedSegments.length;
                    this.recordedSegments = this.recordedSegments.filter(
                        segment => segment.timestamp > cutoffTime
                    );
                    
                    if (beforeCount !== this.recordedSegments.length) {
                        console.log(`🗑️ Removed ${beforeCount - this.recordedSegments.length} old BEFORE segments`);
                    }
                    
                    console.log(`📹 BEFORE evidence: ${this.recordedSegments.length} segments (${event.data.size} bytes)`);
                }
            };

            this.preRecorder.onstop = () => {
                if (this.isPreRecording && this.isMonitoring) {
                    setTimeout(() => {
                        if (this.isPreRecording && this.isMonitoring && !this.isCapturingEvidence) {
                            try {
                                this.preRecorder.start(this.segmentDuration);
                            } catch (error) {
                                console.error('❌ Failed to restart pre-recorder:', error);
                            }
                        }
                    }, 500);
                }
            };

            this.preRecorder.start(this.segmentDuration);
            console.log('✅ BEFORE evidence recording started');

        } catch (error) {
            console.error('❌ Failed to start pre-recording:', error);
        }
    }

    async waitForStreamReady(stream) {
        return new Promise((resolve) => {
            const video = document.createElement('video');
            video.srcObject = stream;
            video.muted = true;
            
            video.addEventListener('canplay', () => {
                console.log('✅ Stream ready for recording');
                resolve();
            });
            
            setTimeout(() => {
                console.log('⏰ Stream timeout, proceeding anyway');
                resolve();
            }, 2000);
        });
    }

    setupEventListeners() {
        console.log('👂 Setting up tab switch detection...');
        
        // ✅ CRITICAL: Start TRANSITION recording BEFORE tab switch
        window.addEventListener('blur', () => {
            if (this.isMonitoring && !this.isRecordingTransition) {
                console.log('🚨 Window losing focus - START TRANSITION recording NOW');
                this.startTransitionRecording();
            }
        });
        
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.isMonitoring && !this.isCapturingEvidence) {
                this.tabSwitchCount++;
                console.log(`🚨 TAB SWITCH #${this.tabSwitchCount} - Student LEFT exam`);
                this.handleTabSwitchLeaving();
            } else if (!document.hidden && this.isMonitoring) {
                console.log('🔄 Student returned to exam tab');
                this.stopTransitionRecording();
            }
        });
    }

    startMonitoring() {
        this.isMonitoring = true;
        console.log('🚀 BEFORE+TRANSITION monitoring started');
    }

    // ✅ Start TRANSITION recording when window loses focus (BEFORE tab switch)
    async startTransitionRecording() {
        if (this.isRecordingTransition) {
            console.log('🔄 TRANSITION recording already active');
            return;
        }

        try {
            console.log('🔴 Starting TRANSITION recording to catch the switch...');
            
            const streamToRecord = this.screenStream || this.webcamStream;
            if (!streamToRecord) {
                console.error('❌ No stream for TRANSITION recording');
                return;
            }

            this.transitionChunks = [];
            this.transitionRecorder = new MediaRecorder(streamToRecord, {
                mimeType: 'video/webm;codecs=vp8',
                videoBitsPerSecond: 2000000
            });

            this.transitionRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.transitionChunks.push(event.data);
                    console.log(`📹 TRANSITION chunk: ${event.data.size} bytes`);
                }
            };

            this.transitionRecorder.onstop = async () => {
                console.log('⏹️ TRANSITION recording complete');
                
                if (this.transitionChunks.length > 0) {
                    const transitionBlob = new Blob(this.transitionChunks, { type: 'video/webm;codecs=vp8' });
                    console.log(`✅ TRANSITION video: ${transitionBlob.size} bytes`);

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
            
            console.log('✅ TRANSITION recording started - capturing the switch!');

        } catch (error) {
            console.error('❌ Failed to start TRANSITION recording:', error);
            this.isRecordingTransition = false;
        }
    }

    // ✅ Stop TRANSITION recording
    stopTransitionRecording() {
        if (!this.isRecordingTransition || !this.transitionRecorder) {
            return;
        }

        try {
            console.log('⏹️ Stopping TRANSITION recording...');
            
            // Stop after delay to capture return to exam
            setTimeout(() => {
                if (this.transitionRecorder && this.transitionRecorder.state === 'recording') {
                    this.transitionRecorder.stop();
                    console.log('⏹️ TRANSITION recording stopped');
                }
            }, 1500); // 1.5 second delay to capture return

        } catch (error) {
            console.error('❌ Failed to stop TRANSITION recording:', error);
        }
    }

    async handleTabSwitchLeaving() {
        if (this.isCapturingEvidence) {
            console.log('⚠️ Already capturing evidence, skipping...');
            return;
        }

        this.isCapturingEvidence = true;
        
        console.log(`🚨 CAPTURING: Student switched AWAY from exam`);
        console.log(`📊 BEFORE segments available: ${this.recordedSegments.length}`);

        // Record violation
        const violation = {
            type: 'TAB_SWITCH',
            description: `Student switched away from exam tab (Count: ${this.tabSwitchCount})`,
            timestamp: new Date().toISOString()
        };

        this.recordViolation(violation.type, violation.description);
        this.showViolationWarning('⚠️ Tab switch detected! Return to exam immediately.');

        // Capture screenshot immediately
        await this.captureScreenshot('tab_switch');

        // Create BEFORE video (TRANSITION is already recording)
        await this.createBeforeVideo('tab_switch');

        // Reset flag after a delay
        setTimeout(() => {
            this.isCapturingEvidence = false;
            console.log('✅ Evidence capture complete, ready for next violation');
        }, 2000);
    }

    // ✅ Create BEFORE video from pre-recorded segments
    async createBeforeVideo(violationType) {
        try {
            console.log('📹 Creating BEFORE video from pre-recorded segments...');

            if (this.recordedSegments.length === 0) {
                console.warn('⚠️ No BEFORE segments available');
                return;
            }

            // Create BEFORE video from segments
            const beforeSegments = this.recordedSegments.map(segment => segment.data);
            const beforeBlob = new Blob(beforeSegments, { type: 'video/webm;codecs=vp8' });
            
            const beforeDuration = this.recordedSegments.length * 2; // 2 seconds per segment
            
            console.log(`✅ BEFORE video created: ${beforeBlob.size} bytes (${beforeDuration}s)`);

            // Test video before uploading
            const isValid = await this.testVideoPlayback(beforeBlob, 'BEFORE video');
            if (isValid) {
                await this.uploadVideoWithMetadata(
                    beforeBlob, 
                    violationType, 
                    '.webm', 
                    'before', 
                    beforeDuration
                );
            } else {
                console.error('❌ BEFORE video is not playable, skipping upload');
            }

        } catch (error) {
            console.error('❌ Failed to create BEFORE video:', error);
        }
    }

    // ✅ Test if video blob is playable
    async testVideoPlayback(videoBlob, description) {
        return new Promise((resolve) => {
            console.log(`🧪 Testing ${description} playback...`);
            
            const videoURL = URL.createObjectURL(videoBlob);
            const testVideo = document.createElement('video');
            testVideo.src = videoURL;
            testVideo.muted = true;
            
            testVideo.addEventListener('loadedmetadata', () => {
                console.log(`✅ ${description} is playable:`);
                console.log(`   - Duration: ${testVideo.duration}s`);
                console.log(`   - Size: ${videoBlob.size} bytes`);
                console.log(`   - Dimensions: ${testVideo.videoWidth}x${testVideo.videoHeight}`);
                URL.revokeObjectURL(videoURL);
                resolve(true);
            });
            
            testVideo.addEventListener('error', (e) => {
                console.error(`❌ ${description} is NOT playable:`);
                console.error(`   - Error: ${e.target.error?.message || 'Unknown error'}`);
                console.error(`   - Size: ${videoBlob.size} bytes`);
                URL.revokeObjectURL(videoURL);
                resolve(false);
            });
            
            // Timeout after 3 seconds
            setTimeout(() => {
                console.warn(`⏰ ${description} test timeout - assuming invalid`);
                URL.revokeObjectURL(videoURL);
                resolve(false);
            }, 3000);
        });
    }

    async captureScreenshot(violationType) {
        try {
            let screenshot = null;

            if (this.screenStream) {
                screenshot = await this.captureScreenScreenshot();
            } else if (this.webcamStream) {
                screenshot = await this.captureWebcamScreenshot();
            }

            if (screenshot) {
                console.log('📷 Screenshot captured');
                await this.uploadScreenshot(screenshot, violationType);
            }
        } catch (error) {
            console.error('❌ Screenshot failed:', error);
        }
    }

    async captureScreenScreenshot() {
        if (!this.screenStream) return null;

        try {
            const video = document.createElement('video');
            video.srcObject = this.screenStream;
            video.muted = true;
            
            return new Promise((resolve) => {
                video.addEventListener('loadedmetadata', () => {
                    video.play();
                    
                    setTimeout(() => {
                        const canvas = document.createElement('canvas');
                        canvas.width = video.videoWidth;
                        canvas.height = video.videoHeight;
                        
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                        canvas.toBlob((blob) => {
                            resolve(blob);
                        }, 'image/png');
                    }, 200);
                });
            });
        } catch (error) {
            console.error('❌ Screen screenshot failed:', error);
            return null;
        }
    }

    async captureWebcamScreenshot() {
        if (!this.webcamStream) return null;

        try {
            const video = document.getElementById('webcam-video');
            if (!video || !video.videoWidth) return null;

            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            return new Promise((resolve) => {
                canvas.toBlob((blob) => {
                    resolve(blob);
                }, 'image/png');
            });
        } catch (error) {
            console.error('❌ Webcam screenshot failed:', error);
            return null;
        }
    }

    async uploadVideoWithMetadata(videoBlob, violationType, extension, evidenceType, expectedDuration) {
        try {
            console.log(`📤 Uploading ${evidenceType} video (${expectedDuration}s)...`);
            
            const formData = new FormData();
            formData.append('assessment_code', this.assessmentCode);
            formData.append('student_id', this.studentId);
            formData.append('violation_type', violationType);
            formData.append('evidence_type', evidenceType);
            formData.append('expected_duration', expectedDuration.toString());
            formData.append('timestamp', new Date().toISOString());

            const filename = `video_${evidenceType}_${this.assessmentCode}_${this.studentId}_${Date.now()}_${expectedDuration}s${extension}`;
            formData.append('video', videoBlob, filename);

            const response = await fetch('/api/upload_violation_evidence', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                console.log(`✅ ${evidenceType} video uploaded: ${filename}`);
            } else {
                console.error(`❌ Video upload failed:`, response.statusText);
            }
        } catch (error) {
            console.error('❌ Video upload error:', error);
        }
    }

    async uploadScreenshot(screenshotBlob, violationType) {
        try {
            const formData = new FormData();
            formData.append('assessment_code', this.assessmentCode);
            formData.append('student_id', this.studentId);
            formData.append('violation_type', violationType);
            formData.append('timestamp', new Date().toISOString());

            const filename = `screenshot_${this.assessmentCode}_${this.studentId}_${Date.now()}.png`;
            formData.append('screenshot', screenshotBlob, filename);

            const response = await fetch('/api/upload_violation_evidence', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                console.log('✅ Screenshot uploaded successfully');
            } else {
                console.error('❌ Screenshot upload failed:', response.statusText);
            }
        } catch (error) {
            console.error('❌ Screenshot upload error:', error);
        }
    }

    recordViolation(type, description) {
        this.violationCount++;
        const violation = {
            type: type,
            description: description,
            timestamp: new Date().toISOString(),
            count: this.violationCount
        };

        this.violations.push(violation);
        console.log(`⚠️ Violation #${this.violationCount}:`, violation);

        // Send important violations to server
        const importantViolations = ['TAB_SWITCH', 'SCREEN_SHARE_STOPPED', 'WEBCAM_DENIED'];
        if (importantViolations.includes(type)) {
            this.sendViolationToServer(violation);
        }
    }

    async sendViolationToServer(violation) {
        try {
            const response = await fetch('/api/record_violation', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    assessment_code: this.assessmentCode,
                    student_id: this.studentId,
                    ...violation
                })
            });

            if (response.ok) {
                console.log('✅ Violation recorded on server');
            }
        } catch (error) {
            console.error('❌ Violation recording error:', error);
        }
    }

    showViolationWarning(message) {
        console.log(`🚨 Showing warning: ${message}`);
        
        let warningDiv = document.getElementById('violation-warning');
        if (!warningDiv) {
            warningDiv = document.createElement('div');
            warningDiv.id = 'violation-warning';
            warningDiv.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background-color: #dc3545;
                color: white;
                padding: 12px 18px;
                border-radius: 8px;
                z-index: 1000;
                box-shadow: 0 4px 8px rgba(0,0,0,0.3);
                font-weight: bold;
                max-width: 400px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            `;
            document.body.appendChild(warningDiv);
        }

        warningDiv.innerHTML = `
            <span style="flex: 1;">${message}</span>
            <button onclick="document.getElementById('violation-warning').style.display='none'" 
                    style="background: none; border: none; color: white; font-size: 18px; cursor: pointer;">×</button>
        `;

        warningDiv.style.display = 'flex';
    }

    stopPreRecording() {
        this.isPreRecording = false;
        if (this.preRecorder && this.preRecorder.state !== 'inactive') {
            this.preRecorder.stop();
            console.log('🛑 Pre-recording stopped');
        }
    }

    stopMonitoring() {
        this.isMonitoring = false;
        this.stopPreRecording();
        this.stopTransitionRecording();
        
        if (this.webcamStream) {
            this.webcamStream.getTracks().forEach(track => track.stop());
        }
        
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => track.stop());
        }

        console.log('🛑 Monitoring stopped');
    }
}

// Initialize when page loads
let screenMonitor = null;

document.addEventListener('DOMContentLoaded', () => {
    const assessmentCodeElement = document.getElementById('assessment-code');
    const studentIdElement = document.getElementById('student-id');
    
    if (assessmentCodeElement && studentIdElement) {
        const assessmentCode = assessmentCodeElement.value;
        const studentId = studentIdElement.value;
        
        console.log(`🚀 Starting BEFORE+TRANSITION monitor for ${assessmentCode}`);
        screenMonitor = new ExamScreenMonitor(assessmentCode, studentId);
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (screenMonitor) {
        screenMonitor.stopMonitoring();
    }
});

// Prevent right-click
document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (screenMonitor) {
        screenMonitor.recordViolation('RIGHT_CLICK', 'Right-click attempted');
        screenMonitor.showViolationWarning('⚠️ Right-click disabled!');
    }
});

// Prevent shortcuts
document.addEventListener('keydown', (e) => {
    const forbidden = [
        { key: 'F12', desc: 'Developer Tools' },
        { ctrlKey: true, shiftKey: true, key: 'I', desc: 'Developer Tools' },
        { ctrlKey: true, key: 'u', desc: 'View Source' },
        { key: 'F5', desc: 'Refresh' }
    ];

    for (let item of forbidden) {
        const matches = (!item.ctrlKey || e.ctrlKey) &&
                       (!item.shiftKey || e.shiftKey) &&
                       (e.key === item.key);

        if (matches) {
            e.preventDefault();
            if (screenMonitor) {
                screenMonitor.recordViolation('FORBIDDEN_SHORTCUT', `${item.desc} blocked`);
                screenMonitor.showViolationWarning(`⚠️ ${item.desc} disabled!`);
            }
            return false;
        }
    }
});