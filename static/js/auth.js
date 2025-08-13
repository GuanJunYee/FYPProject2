// =====================
// Tab Switching
// =====================
function showTab(tabId) {
  const tabs = document.querySelectorAll('.tab-content');
  tabs.forEach(tab => tab.classList.remove('active'));

  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => btn.classList.remove('active'));

  document.getElementById(tabId).classList.add('active');
  if (tabId === 'login') tabButtons[0].classList.add('active');
  if (tabId === 'register') tabButtons[1].classList.add('active');
}

// =====================
// Go to Next Step
// =====================
async function nextStep(step) {
  const current = document.querySelector(`#step-${step}`);
  const next = document.querySelector(`#step-${step + 1}`);

  // Basic input validation
  const inputs = current.querySelectorAll("input, select");
  for (let input of inputs) {
    if (!input.checkValidity()) {
      input.reportValidity();
      return;
    }
  }

  // Step 1: Check duplicates AND validate password confirmation
  if (step === 1) {
    // Check password confirmation
    const pw = document.getElementById('register-password').value;
    const confirm = document.getElementById('confirm-password').value;
    if (pw !== confirm) {
      showError("password-error", "Password and confirm password do not match.");
      return;
    }

    // Check for duplicate user ID
    const userIdValid = await checkUserIdDuplicate();
    if (!userIdValid) {
      return; // Stop if user ID already exists
    }

    // Check for duplicate email
    const emailValid = await checkEmailDuplicate();
    if (!emailValid) {
      return; // Stop if email already exists
    }
  }

  // Step 3: Validate OTP with backend
  if (step === 3) {
    const email = document.querySelector('[name="email"]').value;
    const otp = document.querySelector('[name="otp"]').value;

    fetch("/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, otp })
    })
    .then(res => res.json())
    .then(data => {
      if (!data.success) {
        showError("otp-error", data.error || "Invalid OTP");
        return;
      }
      // Submit form after valid OTP
      document.querySelector('form').submit();
    })
    .catch(err => {
      console.error(err);
      showError("otp-error", "An error occurred.");
    });
    return;
  }

  // Move to next step if all is good
  if (current && next) {
    current.classList.remove('active');
    next.classList.add('active');
    updateProgressBar(step + 1);
  }
}

// =====================
// Go to Previous Step
// =====================
function prevStep(step) {
  const current = document.getElementById(`step-${step}`);
  const prev = document.getElementById(`step-${step - 1}`);

  if (current && prev) {
    current.classList.remove('active');
    prev.classList.add('active');
    updateProgressBar(step - 1);
  }
}

// =====================
// Send OTP via Email
// =====================
function sendVerificationCode() {
  const email = document.querySelector('[name="email"]').value;
  const button = document.querySelector('#get-code-btn');

  if (!email) {
    alert("Please enter your email in Step 1 first.");
    return;
  }

  // Disable and start countdown
  button.disabled = true;
  let countdown = 30;
  button.textContent = `Resend in ${countdown}s`;
  const timer = setInterval(() => {
    countdown--;
    button.textContent = `Resend in ${countdown}s`;
    if (countdown <= 0) {
      clearInterval(timer);
      button.disabled = false;
      button.textContent = "Get Code";
    }
  }, 1000);

  fetch("/send-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      alert("OTP code sent to your email.");
    } else {
      alert("Failed to send OTP: " + data.error);
    }
  })
  .catch(err => {
    console.error(err);
    alert("Something went wrong.");
  });
}

// =====================
// Update Progress Bar
// =====================
function updateProgressBar(step) {
  const fill = document.getElementById('progress-fill');
  const steps = document.querySelectorAll('.progress-step');

  steps.forEach((s, index) => {
    s.classList.remove('active', 'completed');
    if (index + 1 < step) s.classList.add('completed');
    else if (index + 1 === step) s.classList.add('active');
  });

  const width = ((step - 1) / (steps.length - 1)) * 100;
  fill.style.width = width + '%';
}

// =====================
// Show Inline Error Message
// =====================
function showError(id, message) {
  const div = document.getElementById(id);
  if (div) {
    div.textContent = message;
    div.style.display = 'block';
    setTimeout(() => {
      div.style.transition = 'opacity 0.5s ease-out';
      div.style.opacity = '0';
      setTimeout(() => {
        div.textContent = '';
        div.style.opacity = '1';
        div.style.display = 'none';
      }, 500);
    }, 5000);
  }
}

// =====================
// Toggle Password Visibility
// =====================
function togglePassword(inputId, icon) {
  const input = document.getElementById(inputId);
  if (input.type === "password") {
    input.type = "text";
    icon.classList.remove("fa-eye-slash");
    icon.classList.add("fa-eye");
  } else {
    input.type = "password";
    icon.classList.remove("fa-eye");
    icon.classList.add("fa-eye-slash");
  }
}

// =====================
// Show Forgot Password Tab
// =====================
function showForgotPassword() {
  showTab('forgot-password');
}

// =====================
// Auto-hide Flash Messages
// =====================
setTimeout(() => {
  const messages = document.querySelectorAll('.flash');
  messages.forEach(msg => {
    msg.style.transition = 'opacity 0.5s ease-out';
    msg.style.opacity = '0';
    setTimeout(() => msg.remove(), 500);
  });
}, 5000);   

// =====================
// Check User ID Duplicate
// =====================
async function checkUserIdDuplicate() {
  const userIdInput = document.querySelector('input[name="user_id"]');
  const userId = userIdInput.value.trim();
  
  if (!userId || userId.length !== 7) {
    return true; // Let HTML5 validation handle this
  }
  
  try {
    const response = await fetch('/check-user-id', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id: userId })
    });
    
    const data = await response.json();
    
    if (data.exists) {
      showError("password-error", "User ID already exists. Please choose a different ID.");
      return false;
    } else {
      return true;
    }
  } catch (error) {
    console.error('Error checking user ID:', error);
    return true; // Allow to proceed if check fails
  }
}

// =====================
// Check Email Duplicate
// =====================
async function checkEmailDuplicate() {
  const emailInput = document.querySelector('input[name="email"]');
  const email = emailInput.value.trim();
  
  if (!email) {
    return true; // Let HTML5 validation handle this
  }
  
  try {
    const response = await fetch('/check-email-duplicate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: email })
    });
    
    const data = await response.json();
    
    if (data.exists) {
      showError("password-error", "Email already exists. Please use a different email.");
      return false;
    } else {
      return true;
    }
  } catch (error) {
    console.error('Error checking email:', error);
    return true; // Allow to proceed if check fails
  }
}