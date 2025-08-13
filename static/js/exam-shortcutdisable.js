console.log(" Shortcut block script fully loaded and running...");

// Wait for screenMonitor to be fully initialized
let shortcutDetectionReady = false;

//  Pre-capture system to capture BEFORE violation happens
let preScreenshotInterval = null;
let latestScreenshot = null;
let screenshotUpdateInterval = 2000; // Update every 2 seconds

let lastViolationId = null;

// Function to continuously capture screenshots in background
async function startPreScreenshotCapture() {
  console.log(' Starting pre-screenshot capture system...');
  
  // Clear any existing interval
  if (preScreenshotInterval) {
    clearInterval(preScreenshotInterval);
  }
  
  // Capture initial screenshot
  await updateLatestScreenshot();
  
  // Set up regular captures
  preScreenshotInterval = setInterval(async () => {
    await updateLatestScreenshot();
  }, screenshotUpdateInterval);
}

// Function to update the latest screenshot
async function updateLatestScreenshot() {
  try {
    // Only capture if no warning messages are currently showing
    const warningDiv = document.getElementById('shortcut-violation-warning');
    const violationWarning = document.getElementById('violation-warning');
    
    if (warningDiv && warningDiv.style.display !== 'none') {
      return;
    }
    
    if (violationWarning && violationWarning.style.display !== 'none') {
      return;
    }
    
    let screenshot = null;
    
    //  EXACT SAME METHOD AS TAB SWITCH: Copy captureScreenScreenshot() logic
    if (window.screenMonitor && window.screenMonitor.screenStream) {
      try {
        console.log('📹 Using EXACT same method as tab switch captureScreenScreenshot()...');
        screenshot = await captureScreenScreenshotExact(window.screenMonitor.screenStream);
        
        if (screenshot) {
          console.log(' Screen screenshot captured using EXACT tab switch method!');
        } else {
          console.warn(' Exact method returned null');
        }
      } catch (exactMethodError) {
        console.warn(' Exact tab switch method failed:', exactMethodError);
      }
    }
    
    // Fallback: Try direct screen stream access if exact method failed
    if (!screenshot && window.screenMonitor && window.screenMonitor.screenStream) {
      const tracks = window.screenMonitor.screenStream.getVideoTracks();
      const activeTrack = tracks.find(track => track.readyState === 'live');
      
      if (activeTrack) {
        console.log(' Fallback: Using direct screen stream...');
        screenshot = await captureFromScreenStream(window.screenMonitor.screenStream);
        
        if (screenshot) {
          console.log('Direct screen stream capture successful!');
        }
      }
    }
    
    // Last resort: HTML2Canvas
    if (!screenshot) {
      console.log(' Last resort: Using HTML2Canvas...');
      screenshot = await captureWithHtml2Canvas();
    }
    
    if (screenshot) {
      latestScreenshot = screenshot;
    }
  } catch (error) {
    console.error(' Pre-screenshot update failed:', error);
  }
}

//  Wait for screenMonitor to be fully initialized
async function waitForScreenMonitor() {
  console.log(' Waiting for screenMonitor to be ready...');
  
  return new Promise((resolve) => {
    let attempts = 0;
    const maxAttempts = 15; // 7.5 seconds max wait
    
    const checkForScreenMonitor = () => {
      attempts++;
      
      //  Just check if screenMonitor exists, don't require screenStream
      if (window.screenMonitor) {
        console.log(` ScreenMonitor found (${attempts} attempts)`);
        
        // Give it a moment for screenStream to be ready if not already
        if (window.screenMonitor.screenStream) {
          console.log(` ScreenStream also ready!`);
        } else {
          console.log(` ScreenMonitor exists but screenStream not ready yet - continuing anyway`);
        }
        
        resolve();
        return;
      }
      
      console.log(` Waiting for screenMonitor... (attempt ${attempts})`);
      
      if (attempts >= maxAttempts) {
        console.warn(` Timeout waiting for screenMonitor after ${attempts} attempts - continuing anyway`);
        resolve(); // Continue anyway
        return;
      }
      
      setTimeout(checkForScreenMonitor, 500); // Check every 500ms
    };
    
    checkForScreenMonitor();
  });
}

// Function to stop pre-capture system
function stopPreScreenshotCapture() {
  if (preScreenshotInterval) {
    clearInterval(preScreenshotInterval);
    preScreenshotInterval = null;
    console.log(' Pre-screenshot capture stopped');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // WAIT for screenMonitor to be ready before starting
  await waitForScreenMonitor();
  
  setTimeout(async () => {
    try {
      const response = await fetch('/api/exam_environment_rules');
      const rules = await response.json();

      console.log(' Loaded rules:', rules);  // DEBUG
      console.log(' ScreenMonitor available:', !!window.screenMonitor); // DEBUG
      console.log(' ScreenStream available:', !!(window.screenMonitor && window.screenMonitor.screenStream)); // DEBUG

      shortcutDetectionReady = true;
      
      // await startPreScreenshotCapture();

      // Right-click blocking
      if (rules.block_right_click) {
        document.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          console.log(' Right click blocked');  // DEBUG
          recordShortcutViolation('FORBIDDEN_SHORTCUT', 'Right-click attempted');
        });
      }

    // Keyboard shortcut blocking
    document.addEventListener('keydown', (e) => {
      let blocked = false;
      let violationType = 'FORBIDDEN_SHORTCUT'; // Use consistent violation type
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

      // If a shortcut was blocked, handle it
      if (blocked) {
        e.preventDefault();
        e.stopPropagation();
        console.log(` Blocked shortcut: ${description}`);
        
        // Only record if detection is ready
        if (shortcutDetectionReady) {
          recordShortcutViolation(violationType, description);
        } else {
          console.warn(' Shortcut detection not ready yet, skipping violation recording');
        }
        
        return false;
      }
    }, true); // Use capture phase

    } catch (err) {
      console.error(' Failed to fetch exam environment rules:', err);
    }
  }, 1500); // Slightly longer delay but not too long
});

// Helper function to record shortcut violations
async function recordShortcutViolation(type, description) {
  try {
    console.log(` Recording shortcut violation: ${type} - ${description}`);
    showShortcutWarning(` ${description}`);
    await new Promise(resolve => setTimeout(resolve, 500));

    const assessmentCodeElement = document.getElementById('assessment-code');
    const studentIdElement = document.getElementById('student-id');
    
    if (!assessmentCodeElement || !studentIdElement) {
      console.error(' Assessment code or student ID elements not found');
      return;
    }

    const assessmentCode = assessmentCodeElement.value;
    const studentId = studentIdElement.value;

    const payload = {
      assessment_code: assessmentCode,
      student_id: studentId,
      violation_type: type,
      description: description,
      timestamp: new Date().toISOString()
    };

    //  Save violation and get ID
    const response = await fetch('/api/record_violation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const result = await response.json();
      lastViolationId = result.violation_id || null;
      console.log(' Violation recorded with ID:', lastViolationId);
    } else {
      console.warn(' Failed to record violation');
      lastViolationId = null;
    }

    //  Capture screenshot AFTER violation logged
    const screenshot = await captureScreenshotWithWarning();
    if (screenshot) {
      await uploadShortcutScreenshot(screenshot, type, assessmentCode, studentId);
    } else {
      console.warn(` Screenshot capture failed for ${type}`);
    }

  } catch (error) {
    console.error(' Error recording shortcut violation:', error);
  }
}


// Capture screenshot WITH warning message visible
async function captureScreenshotWithWarning() {
  try {
    console.log(' Capturing screenshot with warning message visible...');
    
    let screenshot = null;
    
    // Try screen stream capture first (best quality)
    if (window.screenMonitor && window.screenMonitor.screenStream) {
      console.log(' Using screen stream capture WITH warning...');
      screenshot = await captureFromScreenStream(window.screenMonitor.screenStream);
      
      if (screenshot) {
        console.log(' Screen stream capture successful with warning!');
        return screenshot;
      }
    }
    
    //  Try HTML2Canvas capture (captures full page including warnings)
    if (typeof html2canvas !== 'undefined') {
      console.log(' Using html2canvas WITH warning...');
      
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        scale: 0.7,
        width: window.innerWidth,
        height: window.innerHeight,
        logging: false // Reduce console noise
      });
      
      screenshot = await new Promise((resolve) => {
        canvas.toBlob((blob) => {
          resolve(blob);
        }, 'image/png');
      });
      
      if (screenshot) {
        console.log(' HTML2Canvas capture successful with warning!');
        return screenshot;
      }
    }
    
    //  Fallback to basic page capture
    console.log(' Using fallback capture method...');
    screenshot = await capturePageWithWarning();
    
    return screenshot;
    
  } catch (error) {
    console.error(' Screenshot with warning capture failed:', error);
    return null;
  }
}

// Helper function to capture page content including warning
async function capturePageWithWarning() {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Set canvas size
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    // Fill with page background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Add timestamp and violation info
    ctx.fillStyle = '#000000';
    ctx.font = '14px Arial';
    ctx.fillText('Shortcut Violation Screenshot', 20, 30);
    ctx.fillText(`Timestamp: ${new Date().toLocaleString()}`, 20, 55);
    ctx.fillText(`URL: ${window.location.href}`, 20, 80);
    
    // Check if warning is visible and capture its info
    const warningDiv = document.getElementById('shortcut-violation-warning');
    if (warningDiv && warningDiv.style.display !== 'none') {
      const rect = warningDiv.getBoundingClientRect();
      
      // Draw warning box background (red)
      ctx.fillStyle = '#dc3545';
      ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
      
      // Draw warning text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px Arial';
      const warningText = warningDiv.textContent || 'Warning Message';
      ctx.fillText(warningText, rect.left + 10, rect.top + 25);
      
      console.log('✅ Warning message captured in screenshot');
    }
    
    // Add exam content area
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(20, 100, canvas.width - 40, canvas.height - 120);
    
    ctx.fillStyle = '#000000';
    ctx.font = '12px Arial';
    ctx.fillText('Exam Page Content', 30, 130);
    ctx.fillText('Violation detected and warning shown', 30, 150);
    
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob);
      }, 'image/png');
    });
    
  } catch (error) {
    console.error('❌ Page with warning capture failed:', error);
    return null;
  }
}

// Helper function to capture screenshot directly for shortcut violations
async function captureShortcutScreenshot(violationType) {
  try {
    console.log(` Capturing direct screenshot for ${violationType}...`);
    
    // Get assessment and student info
    const assessmentCodeElement = document.getElementById('assessment-code');
    const studentIdElement = document.getElementById('student-id');
    
    if (!assessmentCodeElement || !studentIdElement) {
      console.error('❌ Cannot find assessment code or student ID elements');
      return;
    }
    
    const assessmentCode = assessmentCodeElement.value;
    const studentId = studentIdElement.value;
    
    // Try to use screen capture from screenMonitor first
    let screenshot = null;
    
    if (window.screenMonitor && window.screenMonitor.screenStream) {
      console.log(' Using screen stream for screenshot...');
      screenshot = await captureFromScreenStream(window.screenMonitor.screenStream);
    } else if (window.screenMonitor && window.screenMonitor.webcamStream) {
      console.log(' Using webcam stream for screenshot...');
      screenshot = await captureFromWebcamStream();
    } else {
      console.log(' No streams available, using html2canvas fallback...');
      screenshot = await captureFromPage();
    }
    
    if (screenshot) {
      console.log(` Uploading screenshot for ${violationType}...`);
      await uploadShortcutScreenshot(screenshot, violationType, assessmentCode, studentId);
    } else {
      console.error('❌ Failed to capture screenshot');
    }
    
  } catch (error) {
    console.error('❌ Screenshot capture error:', error);
  }
}

// EXACT COPY of captureScreenScreenshot() from tab switch system
async function captureScreenScreenshotExact(screenStream) {
  if (!screenStream) return null;

  try {
    const video = document.createElement('video');
    video.srcObject = screenStream;
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
    console.error(' Exact screen screenshot failed:', error);
    return null;
  }
}

// Capture screenshot from screen stream
async function captureFromScreenStream(screenStream) {
  try {
    console.log(' Setting up screen stream capture...');
    const video = document.createElement('video');
    video.srcObject = screenStream;
    video.muted = true;
    video.autoplay = true;
    
    return new Promise((resolve, reject) => {
      let resolved = false;
      
      video.addEventListener('loadedmetadata', () => {
        console.log(` Screen stream video loaded: ${video.videoWidth}x${video.videoHeight}`);
        
        if (video.videoWidth === 0 || video.videoHeight === 0) {
          console.error('❌ Screen stream has invalid dimensions');
          if (!resolved) {
            resolved = true;
            resolve(null);
          }
          return;
        }
        
        video.play().then(() => {
          // Wait a bit for video to be ready
          setTimeout(() => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              
              const ctx = canvas.getContext('2d');
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              
              console.log(`✅ Screen captured from stream: ${canvas.width}x${canvas.height}`);

              canvas.toBlob((blob) => {
                if (!resolved) {
                  resolved = true;
                  resolve(blob);
                }
              }, 'image/png');
            } catch (drawError) {
              console.error('❌ Error drawing screen to canvas:', drawError);
              if (!resolved) {
                resolved = true;
                resolve(null);
              }
            }
          }, 300); // Increased wait time
        }).catch((playError) => {
          console.error('❌ Error playing screen video:', playError);
          if (!resolved) {
            resolved = true;
            resolve(null);
          }
        });
      });
      
      video.addEventListener('error', (error) => {
        console.error('❌ Screen stream video error:', error);
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      });
      
      // Timeout fallback
      setTimeout(() => {
        if (!resolved) {
          console.warn('⚠️ Screen stream capture timeout');
          resolved = true;
          resolve(null);
        }
      }, 2000);
    });
  } catch (error) {
    console.error('❌ Screen stream capture failed:', error);
    return null;
  }
}

// Capture screenshot from webcam stream
async function captureFromWebcamStream() {
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
    console.error('❌ Webcam capture failed:', error);
    return null;
  }
}

// Capture real page content using html2canvas-like approach
async function captureWithHtml2Canvas() {
  try {
    console.log(' Attempting to capture real page content...');
    
    // Hide warnings temporarily
    const warningDivs = document.querySelectorAll('#shortcut-violation-warning, #violation-warning');
    const originalDisplays = [];
    
    warningDivs.forEach((div, index) => {
      originalDisplays[index] = div.style.display;
      div.style.display = 'none';
    });
    
    // Wait for warnings to be hidden
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Try to use html2canvas if available
    if (typeof html2canvas !== 'undefined') {
      console.log('📱 Using html2canvas library...');
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        scale: 0.5, // Reduce size for better performance
        width: window.innerWidth,
        height: window.innerHeight
      });
      
      // Restore warnings
      warningDivs.forEach((div, index) => {
        div.style.display = originalDisplays[index];
      });
      
      return new Promise((resolve) => {
        canvas.toBlob((blob) => {
          resolve(blob);
        }, 'image/png');
      });
    } else {
      console.log('📱 html2canvas not available, using DOM to canvas...');
      // Fallback: Use native DOM to canvas approach
      const result = await capturePageWithDOMToCanvas();
      
      // Restore warnings
      warningDivs.forEach((div, index) => {
        div.style.display = originalDisplays[index];
      });
      
      return result;
    }
    
  } catch (error) {
    console.error('❌ HTML2Canvas capture failed:', error);
    return null;
  }
}

// Alternative: Use DOM-to-canvas approach
async function capturePageWithDOMToCanvas() {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Set canvas size
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    // Fill with page background color
    const computedStyle = window.getComputedStyle(document.body);
    ctx.fillStyle = computedStyle.backgroundColor || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Try to capture visible elements
    const visibleElements = document.querySelectorAll('*');
    
    for (let element of visibleElements) {
      try {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        
        // Skip hidden elements
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) {
          continue;
        }
        
        // Skip warning elements
        if (element.id === 'shortcut-violation-warning' || element.id === 'violation-warning') {
          continue;
        }
        
        // Draw background if element has one
        if (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
          ctx.fillStyle = style.backgroundColor;
          ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
        }
        
        // Draw text content for text elements
        if (element.textContent && element.textContent.trim()) {
          const text = element.textContent.trim();
          if (text.length < 200) { // Only short text to avoid clutter
            ctx.fillStyle = style.color || '#000000';
            ctx.font = `${style.fontSize || '14px'} ${style.fontFamily || 'Arial'}`;
            
            // Simple text wrapping
            const words = text.split(' ');
            let line = '';
            let y = rect.top + (parseInt(style.fontSize) || 14);
            
            for (let word of words) {
              const testLine = line + word + ' ';
              const metrics = ctx.measureText(testLine);
              
              if (metrics.width > rect.width && line !== '') {
                ctx.fillText(line, rect.left, y);
                line = word + ' ';
                y += parseInt(style.fontSize) || 14;
              } else {
                line = testLine;
              }
              
              if (y > rect.bottom) break; // Don't overflow element
            }
            
            if (line.trim()) {
              ctx.fillText(line, rect.left, y);
            }
          }
        }
        
        // Draw borders if visible
        if (style.borderWidth && parseInt(style.borderWidth) > 0) {
          ctx.strokeStyle = style.borderColor || '#000000';
          ctx.lineWidth = parseInt(style.borderWidth);
          ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
        }
        
      } catch (elementError) {
        // Skip problematic elements
        continue;
      }
    }
    
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob);
      }, 'image/png');
    });
    
  } catch (error) {
    console.error('❌ DOM to canvas capture failed:', error);
    return null;
  }
}

// Fallback: Capture clean screenshot from page content (BEFORE violations)
async function captureCleanPageScreenshot() {
  try {
    // Hide any existing warnings temporarily for clean capture
    const warningDivs = document.querySelectorAll('#shortcut-violation-warning, #violation-warning');
    const originalDisplays = [];
    
    warningDivs.forEach((div, index) => {
      originalDisplays[index] = div.style.display;
      div.style.display = 'none';
    });
    
    // Wait a moment for warnings to be hidden
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Capture clean page content
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Set canvas size to viewport
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    // Fill with white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Add exam content information (without violation text)
    ctx.fillStyle = '#000000';
    ctx.font = '14px Arial';
    ctx.fillText('Exam Page Screenshot', 20, 30);
    ctx.fillText(`Timestamp: ${new Date().toLocaleString()}`, 20, 55);
    ctx.fillText(`URL: ${window.location.href}`, 20, 80);
    
    // Try to capture actual page content if possible
    try {
      // Get the main exam content area
      const examContent = document.querySelector('main, .exam-content, .container, body');
      if (examContent) {
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(20, 100, canvas.width - 40, canvas.height - 120);
        
        ctx.fillStyle = '#000000';
        ctx.font = '12px Arial';
        ctx.fillText('Exam Content Area Detected', 30, 130);
        ctx.fillText('Page Title: ' + (document.title || 'Unknown'), 30, 150);
        
        // Add some basic page info
        const inputs = document.querySelectorAll('input, textarea, select');
        ctx.fillText(`Form Elements: ${inputs.length} found`, 30, 170);
        
        const buttons = document.querySelectorAll('button');
        ctx.fillText(`Buttons: ${buttons.length} found`, 30, 190);
      }
    } catch (contentError) {
      console.log('Could not capture detailed content, using basic info');
    }
    
    // Restore warning displays
    warningDivs.forEach((div, index) => {
      div.style.display = originalDisplays[index];
    });
    
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob);
      }, 'image/png');
    });
  } catch (error) {
    console.error('❌ Clean page capture failed:', error);
    return null;
  }
}

// Upload screenshot for shortcut violations
async function uploadShortcutScreenshot(screenshotBlob, violationType, assessmentCode, studentId) {
  try {
    const formData = new FormData();
    formData.append('assessment_code', assessmentCode);
    formData.append('student_id', studentId);
    formData.append('violation_type', violationType);
    formData.append('timestamp', new Date().toISOString());
    formData.append('violation_id', lastViolationId); 

    const filename = `screenshot_${violationType}_${assessmentCode}_${studentId}_${Date.now()}.png`;
    formData.append('screenshot', screenshotBlob, filename);

    console.log(`📤 Uploading screenshot: ${filename}`);

    const response = await fetch('/api/upload_violation_evidence', {
      method: 'POST',
      body: formData
    });

    if (response.ok) {
      console.log('✅ Shortcut screenshot uploaded successfully');
    } else {
      const errorText = await response.text();
      console.error('❌ Screenshot upload failed:', response.status, errorText);
    }
  } catch (error) {
    console.error('❌ Screenshot upload error:', error);
  }
}

// Helper function to show shortcut warnings
function showShortcutWarning(message) {
  console.log(` Shortcut warning: ${message}`);
  
  // Try to use screenMonitor's warning system if available (keeps same position)
  if (window.screenMonitor && typeof window.screenMonitor.showViolationWarning === 'function') {
    window.screenMonitor.showViolationWarning(message);
    return;
  }
  
  // Fallback: Create our own warning display in the SAME position as screenMonitor (right side)
  let warningDiv = document.getElementById('shortcut-violation-warning');
  if (!warningDiv) {
    warningDiv = document.createElement('div');
    warningDiv.id = 'shortcut-violation-warning';
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
    <button onclick="document.getElementById('shortcut-violation-warning').style.display='none'" 
            style="background: none; border: none; color: white; font-size: 18px; cursor: pointer;">×</button>
  `;

  warningDiv.style.display = 'flex';
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    warningDiv.style.display = 'none';
  }, 5000);
}

// Function to check and restart screen sharing if needed
async function ensureScreenSharing() {
  console.log(' Checking screen sharing status...');
  
  if (!window.screenMonitor) {
    console.warn('⚠️ ScreenMonitor not available');
    return false;
  }
  
  if (!window.screenMonitor.screenStream) {
    console.warn('⚠️ Screen sharing not active, attempting to restart...');
    
    try {
      await window.screenMonitor.setupScreenCapture();
      
      if (window.screenMonitor.screenStream) {
        console.log('✅ Screen sharing restarted successfully!');
        showShortcutWarning('✅ Screen sharing restarted for better monitoring');
        return true;
      } else {
        console.error('❌ Failed to restart screen sharing');
        showShortcutWarning('⚠️ Please enable screen sharing for proper monitoring');
        return false;
      }
    } catch (error) {
      console.error('❌ Error restarting screen sharing:', error);
      showShortcutWarning('⚠️ Screen sharing required - please allow screen access');
      return false;
    }
  }
  
  // Check if screen stream is still active
  const tracks = window.screenMonitor.screenStream.getVideoTracks();
  const activeTrack = tracks.find(track => track.readyState === 'live');
  
  if (!activeTrack) {
    console.warn('⚠️ Screen sharing tracks are not active');
    return false;
  }
  
  console.log('✅ Screen sharing is active and working');
  return true;
}

